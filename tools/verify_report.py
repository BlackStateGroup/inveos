#!/usr/bin/env python3
"""Offline integrity checks for INVEOS's current internal JSON report draft.

No network, database, credentials, third-party packages or original-file writes.
Consistency is not authenticity: use an independently retained report SHA-256 to
bind report text, reviewer labels, timestamps and policy metadata to an export.
"""
from datetime import datetime
import uuid
import argparse
import base64
import binascii
import hashlib
import json
from pathlib import Path
import re
import sys


MAX_REPORT_BYTES = 32 * 1024 * 1024
MAX_FINDINGS = 1000
MAX_ORIGINAL_BYTES = 2 * 1024 * 1024


class InvalidReport(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise InvalidReport(message)


def text_field(obj, name):
    value = obj.get(name)
    require(isinstance(value, str) and bool(value.strip()), 'Missing or invalid ' + name)
    return value


def object_field(obj, name):
    value = obj.get(name)
    require(isinstance(value, dict), 'Missing or invalid ' + name)
    return value


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate JSON key')
        result[key] = value
    return result


def reject_constant(_):
    raise InvalidReport('Non-finite JSON number')


def verify_chronology(report):
    def require(ok, message):
        if not ok:
            raise ValueError('Chronology: ' + message)

    def fields(value, names):
        require(isinstance(value, dict) and set(value) == set(names.split()), 'unexpected fields')

    def identifier(value):
        require(isinstance(value, str) and re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', value), 'invalid identity')

    def text(value, low, high):
        require(isinstance(value, str) and low <= len(value) <= high and (not low or value.strip())
                and not re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', value), 'invalid text')
        value.encode('utf-8', errors='strict')

    def instant(value):
        require(isinstance(value, str) and re.fullmatch(r'[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,3})?(?:Z|[+-](?:0[0-9]|1[0-4]):[0-5][0-9])', value), 'invalid instant')
        require(not value.endswith('-00:00') and not re.search(r'[+-]14:(?!00)', value), 'unknown or invalid offset')
        return datetime.fromisoformat(value.replace('Z', '+00:00'))

    context = report.get('investigation')
    if not isinstance(context, dict) or 'chronology' not in context:
        return 0
    require(context.get('status') == 'working_context_not_findings', 'accounts must remain separate')
    rows = context['chronology']
    require(isinstance(rows, list) and len(rows) <= 1000, 'event limit')
    sources = {'text_finding': {f['id'] for f in report.get('findings', [])},
               'document_finding': {f['id'] for f in report.get('documentFindings', [])}}
    seen = set()
    for event in rows:
        fields(event, 'id caseId title account status time source version createdBy createdAt recordedAt interpretation')
        for key in ('id', 'caseId', 'createdBy'):
            identifier(event[key])
        require(event['id'] not in seen and event['caseId'] == report['case']['id'], 'duplicate or cross-case account')
        seen.add(event['id'])
        require(event['interpretation'] == 'recorded_account_not_finding', 'account is not a finding')
        require(type(event['version']) is int and event['version'] > 0, 'invalid version')
        require(instant(event['recordedAt']) >= instant(event['createdAt']), 'revision predates creation')
        require(event['status'] in ('alleged', 'disputed', 'withdrawn'), 'invalid account status')
        text(event['title'], 3, 200)
        text(event['account'], 1, 4000)
        source = event['source']
        fields(source, 'kind findingId')
        identifier(source['findingId'])
        require(source['kind'] in sources and source['findingId'] in sources[source['kind']], 'missing or mistyped source finding')
        time = event['time']
        fields(time, 'precision start end timezone note')
        text(time['timezone'], 0, 100)
        text(time['note'], 1, 1000)
        precision, start, end = time['precision'], time['start'], time['end']
        if precision == 'unknown':
            require(start is None and end is None, 'unknown dates contain precision')
        elif precision == 'range':
            require(instant(start) <= instant(end), 'reversed range')
        else:
            require(end is None, 'unexpected range end')
            if precision == 'instant':
                instant(start)
            elif precision == 'day':
                require(isinstance(start, str) and re.fullmatch(r'[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}', start), 'invalid day')
                datetime.strptime(start, '%Y-%m-%d')
            elif precision == 'month':
                require(isinstance(start, str) and re.fullmatch(r'[1-9][0-9]{3}-(?:0[1-9]|1[0-2])', start), 'invalid month')
            else:
                require(False, 'unsupported precision')
    return len(rows)


def verify_transcript_findings(report, finding_ids, evidence):
    """Verify selected transcript lineage independently, without media-alignment claims."""
    def fields(value, names):
        require(type(value) is dict and set(value) == set(names.split()), 'Transcript field set differs')
    def identifier(value):
        require(type(value) is str and re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', value), 'Transcript identifier')
    def string(value, maximum, minimum=1):
        require(type(value) is str and len(value.strip()) >= minimum and len(value.encode('utf-16-le')) // 2 <= maximum and not re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', value), 'Transcript text bound')
    def stamp(value, utc=False):
        require(type(value) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})', value), 'Transcript timestamp')
        require(not utc or value.endswith('Z'), 'Transcript server time must retain UTC')
        datetime.fromisoformat(value.replace('Z', '+00:00'))
    def segment(value, corrected=False, supplied=False):
        fields(value, 'id startMs endMs speakerLabel speakerUncertain text' + (' version reason actorId actorName recordedAt' if corrected else ''))
        identifier(value['id'])
        integral = lambda n: type(n) is int or (supplied and type(n) is float and n.is_integer())
        require(integral(value['startMs']) and integral(value['endMs']) and 0 <= value['startMs'] < value['endMs'] <= 86400000, 'Declared transcript range')
        string(value['speakerLabel'], 120); string(value['text'], 10000)
        require(type(value['speakerUncertain']) is bool, 'Explicit speaker uncertainty required')
        if corrected:
            require(type(value['version']) is int and 1 <= value['version'] <= 100, 'Correction version')
            identifier(value['actorId']); string(value['actorName'], 500); string(value['reason'], 3000, 10); stamp(value['recordedAt'], True)
    values = report.get('transcriptFindings', [])
    require(type(values) is list and len(values) <= 200, 'Transcript finding count limit')
    for finding in values:
        fields(finding, 'kind id text reviewer reviewedAt claim review originalBase64')
        require(finding['kind'] == 'reviewed_transcript', 'Unsupported transcript finding')
        identifier(finding['id']); require(finding['id'] not in finding_ids, 'Duplicate finding identity'); finding_ids.add(finding['id'])
        claim, decision = finding['claim'], finding['review']
        fields(claim, 'id caseId text proposedBy proposedAt digest source transcript reference limitations')
        identifier(claim['id']); identifier(claim['caseId']); identifier(claim['proposedBy']); stamp(claim['proposedAt'], True)
        require(claim['caseId'] == report['case']['id'], 'Cross-case transcript claim')
        string(claim['text'], 2000, 10)
        require(claim['limitations'] == 'Reviewed interpretation of a supplied transcript, not proof of speech or source truth. Timecodes and speaker labels are declared; audio alignment and identity are unverified.', 'Transcript limitations changed')
        canonical = json.dumps({k: v for k, v in claim.items() if k != 'digest'}, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
        require(hashlib.sha256(canonical).hexdigest() == claim['digest'], 'Transcript proposal fingerprint differs')
        source, transcript, reference = claim['source'], claim['transcript'], claim['reference']
        fields(source, 'id filename sha256 sourceTime receivedTime policy'); identifier(source['id']); string(source['filename'], 128)
        stamp(source['sourceTime']); stamp(source['receivedTime'], True)
        fields(source['policy'], 'authorityId authorityVersion purpose lawfulBasis scope retentionDays minimisation')
        identifier(source['policy']['authorityId'])
        for key in ('authorityVersion', 'retentionDays'):
            require(type(source['policy'][key]) is int and source['policy'][key] > 0, 'Transcript authority declaration')
        for key in ('purpose', 'lawfulBasis', 'scope', 'minimisation'):
            text_field(source['policy'], key)
        encoded = finding['originalBase64']; require(type(encoded) is str and len(encoded) <= 349528, 'Transcript original bound')
        original = base64.b64decode(encoded, validate=True)
        require(0 < len(original) <= 262144 and base64.b64encode(original).decode() == encoded and hashlib.sha256(original).hexdigest() == source['sha256'], 'Transcript original identity differs')
        supplied = json.loads(original.decode('utf-8-sig'), object_pairs_hook=unique_object, parse_constant=reject_constant)
        fields(supplied, 'format segments'); require(supplied['format'] == 'inveos.supplied_transcript.v1', 'Unsupported supplied transcript')
        require(type(supplied['segments']) is list and 1 <= len(supplied['segments']) <= 100, 'Supplied segment bound')
        raw_ids = set()
        for value in supplied['segments']:
            segment(value, supplied=True); require(value['id'] not in raw_ids, 'Duplicate raw segment'); raw_ids.add(value['id'])
        fields(transcript, 'id title registeredBy registeredAt segmentId sourcePointer version raw corrections')
        for key in ('id', 'registeredBy', 'segmentId'):
            identifier(transcript[key])
        string(transcript['title'], 240, 3); stamp(transcript['registeredAt'], True)
        require(type(transcript['version']) is int and 0 <= transcript['version'] <= 100, 'Selected transcript version')
        pointer = re.fullmatch(r'/segments/(0|[1-9][0-9]?)', transcript['sourcePointer'])
        require(pointer is not None and int(pointer[1]) < len(supplied['segments']), 'Transcript source pointer')
        segment(transcript['raw'])
        require(transcript['raw'] == supplied['segments'][int(pointer[1])] and transcript['raw']['id'] == transcript['segmentId'], 'Raw transcript differs from original')
        corrections = transcript['corrections']; require(type(corrections) is list and len(corrections) == transcript['version'], 'Correction history length')
        correction_ids, authors = set(), {claim['proposedBy']}
        for version, value in enumerate(corrections, 1):
            segment(value, True); require(value['version'] == version and value['id'] not in correction_ids, 'Correction history ordering/identity')
            correction_ids.add(value['id']); authors.add(value['actorId'])
        selected = corrections[-1] if corrections else transcript['raw']
        fields(reference, 'offsetBasis startByte endByte quote startMs endMs speakerLabel speakerUncertain')
        require(reference['offsetBasis'] == 'selected_transcript_utf8_not_original_media', 'Transcript offset meaning changed')
        for key in ('startMs', 'endMs', 'speakerLabel', 'speakerUncertain'):
            require(type(reference[key]) is type(selected[key]) and reference[key] == selected[key], 'Declared transcript context differs')
        start, end = reference['startByte'], reference['endByte']; content = selected['text'].encode('utf-8'); string(reference['quote'], 10000)
        require(type(start) is int and type(end) is int and 0 <= start < end <= len(content) and content[start:end] == reference['quote'].encode('utf-8'), 'Transcript quote byte span differs')
        fields(decision, 'id claimId claimDigest accepted reason reviewerId reviewerName recordedAt')
        identifier(decision['id']); identifier(decision['reviewerId']); string(decision['reviewerName'], 500); string(decision['reason'], 3000, 10); stamp(decision['recordedAt'], True)
        require(decision['accepted'] is True and decision['claimId'] == claim['id'] and decision['claimDigest'] == claim['digest'] and decision['reviewerId'] not in authors, 'Independent accepted transcript decision required')
        require(finding['text'] == claim['text'] and finding['reviewer'] == decision['reviewerName'] and finding['reviewedAt'] == decision['recordedAt'], 'Finding does not match its decision')
        identity = {k: source[k] for k in ('sha256', 'filename', 'sourceTime', 'receivedTime', 'policy')}; identity['contentBase64'] = encoded
        if source['id'] in evidence:
            require(identity == evidence[source['id']], 'Conflicting transcript original identity')
        evidence[source['id']] = identity
    return len(values)


def verify_transcript_work_links(report):
    """Check frozen typed joins; linked working assessments remain interpretations."""
    context = report.get('investigation')
    if not isinstance(context, dict) or 'transcriptLinks' not in context:
        return 0
    require(context.get('status') == 'working_context_not_findings', 'Working context must remain separate')
    links = context['transcriptLinks']
    require(isinstance(links, list) and len(links) <= 1000, 'Transcript working link limit')
    def identifier(value):
        require(isinstance(value, str) and re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', value), 'Invalid working identity')
    items = set()
    for name in ('objectives', 'questions', 'hypotheses', 'blockers'):
        rows = context.get(name)
        require(isinstance(rows, list) and len(rows) <= 1000, 'Invalid working context')
        for item in rows:
            identifier(item['id'])
            require(item['caseId'] == report['case']['id'] and item['id'] not in items, 'Working context scope or duplicate')
            items.add(item['id'])
    findings = {f['id'] for f in report.get('transcriptFindings', [])}
    seen, relations = set(), set()
    for link in links:
        require(isinstance(link, dict) and set(link) == set('id caseId itemId kind findingId relation reason createdBy createdAt'.split()), 'Unexpected transcript link fields')
        for key in ('id', 'caseId', 'itemId', 'findingId', 'createdBy'):
            identifier(link[key])
        require(link['caseId'] == report['case']['id'] and link['itemId'] in items, 'Transcript link scope mismatch')
        require(link['kind'] == 'transcript_finding' and link['findingId'] in findings, 'Missing or mistyped transcript source')
        require(link['relation'] in ('supports', 'contradicts', 'context'), 'Invalid transcript relation')
        reason = link['reason']
        require(isinstance(reason, str) and reason.strip() and len(reason) <= 3000 and not re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', reason), 'Invalid transcript relevance reason')
        reason.encode('utf-8', errors='strict')
        instant = link['createdAt']
        require(isinstance(instant, str) and re.fullmatch(r'[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z', instant), 'Invalid link receipt time')
        datetime.fromisoformat(instant.replace('Z', '+00:00'))
        key = (link['itemId'], link['findingId'], link['relation'])
        require(link['id'] not in seen and key not in relations, 'Duplicate transcript working source')
        seen.add(link['id'])
        relations.add(key)
    return len(links)


def verify_report(raw: bytes, expected_sha256=None, expected_case_id=None):
    require(0 < len(raw) <= MAX_REPORT_BYTES, 'Report size limit')
    actual = hashlib.sha256(raw).hexdigest()
    if expected_sha256 is not None:
        require(isinstance(expected_sha256, str) and re.fullmatch('[0-9a-f]{64}', expected_sha256), 'Invalid trusted report digest')
        require(actual == expected_sha256, 'Report digest mismatch')
    try:
        report = json.loads(raw.decode('utf-8'), object_pairs_hook=unique_object,
                            parse_constant=reject_constant)
    except (UnicodeError, ValueError, RecursionError) as exc:
        raise InvalidReport('Malformed UTF-8 JSON') from exc
    require(isinstance(report, dict), 'Expected report object')
    require(report.get('status') == 'draft_not_released', 'Unsupported report status')
    require('documentFindings' not in report,
            'Document-derived reports require the derivative package verifier; unsupported by this verifier')
    case = object_field(report, 'case')
    case_id = text_field(case, 'id')
    for key in ('ref', 'title', 'client', 'scope', 'jurisdiction'):
        text_field(case, key)
    if expected_case_id is not None:
        require(case_id == expected_case_id, 'Case identity mismatch')
    text_field(report, 'limitations')
    findings = report.get('findings')
    require(isinstance(findings, list) and len(findings) <= MAX_FINDINGS, 'Finding count limit')
    finding_ids, evidence = set(), {}
    for finding in findings:
        require(isinstance(finding, dict), 'Invalid finding')
        finding_id = text_field(finding, 'id')
        require(finding_id not in finding_ids, 'Duplicate finding identity')
        finding_ids.add(finding_id)
        for key in ('text', 'reviewer', 'reviewedAt'):
            text_field(finding, key)
        source = object_field(finding, 'source')
        evidence_id = text_field(source, 'id')
        for key in ('filename', 'sourceTime', 'receivedTime'):
            text_field(source, key)
        encoded = text_field(source, 'contentBase64')
        require(len(encoded) <= 4 * ((MAX_ORIGINAL_BYTES + 2) // 3), 'Original size limit')
        try:
            original = base64.b64decode(encoded, validate=True)
            original.decode('utf-8')
        except (ValueError, binascii.Error, UnicodeError) as exc:
            raise InvalidReport('Invalid original encoding') from exc
        require(base64.b64encode(original).decode('ascii') == encoded, 'Non-canonical base64')
        require(0 < len(original) <= MAX_ORIGINAL_BYTES, 'Original size limit')
        require(source.get('sha256') == hashlib.sha256(original).hexdigest(), 'Original digest mismatch')
        start, end = source.get('startByte'), source.get('endByte')
        require(type(start) is int and type(end) is int and 0 <= start < end <= len(original), 'Invalid quote byte range')
        quote = text_field(source, 'quote')
        try:
            quote_bytes = quote.encode('utf-8')
        except UnicodeError as exc:
            raise InvalidReport('Invalid quote encoding') from exc
        require(original[start:end] == quote_bytes, 'Quote byte range mismatch')
        policy = object_field(source, 'policy')
        for key in ('authorityId', 'purpose', 'lawfulBasis', 'scope', 'minimisation'):
            text_field(policy, key)
        for key in ('authorityVersion', 'retentionDays'):
            require(type(policy.get(key)) is int and policy[key] > 0, 'Invalid ' + key)
        # Same evidence may support different quotes, but cannot change its
        # original bytes, acquisition metadata or authority between findings.
        identity = {k: source[k] for k in ('sha256', 'contentBase64', 'filename', 'sourceTime', 'receivedTime', 'policy')}
        if evidence_id in evidence:
            require(identity == evidence[evidence_id], 'Conflicting evidence identity')
        evidence[evidence_id] = identity
    try:
        transcript_count = verify_transcript_findings(report, finding_ids, evidence)
        require(0 < len(findings) + transcript_count <= MAX_FINDINGS, 'Finding count limit')
        chronology_count = verify_chronology(report)
        transcript_links = verify_transcript_work_links(report)
    except (ValueError, TypeError, KeyError, UnicodeError, IndexError, AttributeError, binascii.Error) as exc:
        raise InvalidReport('Invalid frozen chronology or transcript lineage') from exc
    return {'status': 'integrity_checks_passed', 'chronologyEventsChecked': chronology_count, 'reportSha256': actual,
            'trustedReportDigestMatched': expected_sha256 is not None,
            'caseId': case_id, 'findingsChecked': len(findings) + transcript_count, **({'transcriptFindingsChecked': transcript_count} if transcript_count else {}),
            **({'transcriptWorkLinksChecked': transcript_links} if transcript_links else {}), 'originalsChecked': len(evidence), 'releaseStatus': 'draft_not_released',
            'limitations': 'No signature, reviewer authentication, lawful-authority validation, custody-chain verification or factual truth check. An unanchored result establishes internal consistency only.'}


def verify(raw: bytes, expected_sha256=None):
    """Compatibility API for the persistent-casework HTTP verification tool.

    Shares all byte, size and JSON checks with package verification, then checks
    the persistent API's UUID/time/retention shapes. These are declarations, not
    authentication of reviewer identity or source time.
    """
    expected = expected_sha256.lower() if isinstance(expected_sha256, str) else expected_sha256
    result = verify_report(raw, expected)
    report = json.loads(raw)
    identifiers = [report['case']['id']]
    for finding in report['findings']:
        source = finding['source']
        identifiers.extend([finding['id'], source['id'], source['policy']['authorityId']])
        require(source['policy']['retentionDays'] <= 3650, 'Invalid retentionDays')
        for timestamp in (finding['reviewedAt'], source['sourceTime'], source['receivedTime']):
            try:
                parsed = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
                require(parsed.tzinfo is not None, 'Timestamp requires timezone')
            except ValueError as exc:
                raise InvalidReport('Invalid declared timestamp') from exc
    for identifier in identifiers:
        try:
            uuid.UUID(identifier)
        except (ValueError, TypeError, AttributeError) as exc:
            raise InvalidReport('Invalid persistent record identifier') from exc
    return {**result, 'sha256': result['reportSha256'], 'findings': result['findingsChecked'],
            'originals': result['originalsChecked'],
            'trusted_fingerprint_checked': result['trustedReportDigestMatched']}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report', type=Path)
    parser.add_argument('--expected-sha256', help='Digest retained separately at trusted export time')
    parser.add_argument('--expected-case-id')
    args = parser.parse_args(argv)
    try:
        with args.report.open('rb') as handle:
            raw = handle.read(MAX_REPORT_BYTES + 1)
        result = verify_report(raw, args.expected_sha256, args.expected_case_id)
    except (InvalidReport, OSError) as exc:
        # Never echo report content or paths into logs.
        message = str(exc) if isinstance(exc, InvalidReport) else 'Cannot read report'
        print(json.dumps({'status': 'verification_failed', 'error': message}), file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
