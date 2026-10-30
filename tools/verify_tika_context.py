#!/usr/bin/env python3
"""Independent standard-library Tika context consistency verifier; not runtime/identity certification."""
import argparse
import base64
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

PROFILE = '9a31e0678635591dc2caaa5c9379850e5a15a5c33c38bd9cda08885369915c53'
KIND = 'tika_pdf_text_lab_v1'
BASIS = 'tika_xhtml_page_utf8_not_original_bytes'
CONTROL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def digest(value):
    return sha(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode())


def sealed(value):
    return {**value, 'digest': digest(value)}


def pairs(values):
    result = {}
    for key, value in values:
        require(key not in result, 'Duplicate JSON key')
        result[key] = value
    return result


def decode(value):
    def invalid(_):
        raise ValueError('Nonfinite JSON value')
    return json.loads(value.decode('utf-8'), object_pairs_hook=pairs, parse_constant=invalid)


def stamp(value):
    require(isinstance(value, str) and len(value) <= 40, 'Time bound')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(parsed.tzinfo is not None, 'Explicit timezone required')
    return parsed


def text(value, maximum, minimum=1):
    require(isinstance(value, str) and len(value.strip()) >= minimum and len(value.encode('utf-16-le')) // 2 <= maximum and not CONTROL.search(value), 'Text bound')
    return value


def actor(record, prefix):
    require(re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', record[prefix + 'Id']) is not None, 'Actor identifier')
    text(record[prefix + 'Name'], 300)
    stamp(record['recordedAt'])


def raw64(value, maximum):
    require(isinstance(value, str) and len(value) <= (maximum + 2) // 3 * 4, 'Encoded byte bound')
    raw = base64.b64decode(value, validate=True)
    require(0 < len(raw) <= maximum and base64.b64encode(raw).decode() == value, 'Base64 differs')
    return raw


def pages(raw, count):
    require(0 < len(raw) <= 524288, 'XHTML bound')
    value = raw.decode('utf-8')
    require(not re.search(r'<!|<\?(?!xml version="1\.0" encoding="UTF-8"\?>)', value), 'XML declarations/comments prohibited')
    root = ET.fromstring(value)
    ns = '{http://www.w3.org/1999/xhtml}'
    stack, nodes = [(root, 1)], 0
    while stack:
        element, depth = stack.pop(); nodes += 1
        require(depth <= 64 and nodes <= 100000, 'XML nesting/node bound')
        stack.extend((child, depth + 1) for child in element)
    require(root.tag == ns + 'html' and all(isinstance(e.tag, str) and e.tag.startswith(ns) for e in root.iter()), 'XHTML namespace differs')
    require(len(root.findall(ns + 'body')) == 1, 'One XHTML body required')
    entries = root.findall(ns + 'body/' + ns + 'div[@class="page"]')
    body = root.find(ns + 'body')
    require(not (body.text or '').strip() and all(not (child.tail or '').strip() for child in body), 'Text outside PDF pages')
    require(all(child in entries or not ''.join(child.itertext()).strip() for child in body), 'Unaccounted body text')
    all_pages = [e for e in root.iter() if e.tag == ns + 'div' and e.get('class') == 'page']
    require(len(entries) == count and entries == all_pages, 'Direct PDF page coverage differs')
    rows = []
    for number, page in enumerate(entries, 1):
        value = re.sub(r'[ \t\r\n]+', ' ', ''.join(page.itertext())).strip(' ')
        encoded = value.encode('utf-8')
        require(len(encoded) <= 262144, 'Extracted page byte bound')
        rows.append({'page': number, 'path': f'/html/body/div[@class="page"][{number}]', 'text': value, 'textSha256': sha(encoded), 'utf8Bytes': len(encoded), 'textPresent': bool(value)})
    return rows


def verify(data, expected=None):
    require(0 < len(data) <= 12582912, 'Export byte bound')
    envelope = decode(data)
    require(set(envelope) == {'payload', 'sha256'} and digest(envelope['payload']) == envelope['sha256'], 'Context digest differs')
    if expected is not None:
        require(envelope['sha256'] == expected, 'Trusted fingerprint differs')
    p = envelope['payload']
    require(set(p) == set('format inspection originalBase64 rawBase64 derivativeBase64 runtime processingAuthority sourceUse job exportedAt limitation'.split()) and p['format'] == 'inveos.tika_context.v1', 'Context schema differs')
    i, job = p['inspection'], p['job']
    original, raw, derived_bytes = raw64(p['originalBase64'], 2097152), raw64(p['rawBase64'], 1048576), raw64(p['derivativeBase64'], 1048576)
    require(len(original) >= 8 and original.startswith(b'%PDF-') and sha(original) == i['source']['sha256'], 'Original PDF digest/signature differs')
    profile = decode(i['profile'].encode())
    require(sha(i['profile'].encode()) == i['profileDigest'] == PROFILE, 'Unsupported exact runtime profile')
    r = decode(raw)
    require(set(r) == set('format metadata parseNanos peakRssKiB processCpuNanos sourceSha256 state xhtmlBase64 xhtmlSha256'.split()), 'Raw output schema differs')
    require(r['format'] == 'inveos_tika_research_probe_v1' and r['state'] == 'unreviewed_research_derivative' and r['sourceSha256'] == sha(original) and sha(raw) == i['rawDigest'], 'Raw output identity differs')
    metadata = r['metadata']
    require(isinstance(metadata, dict) and len(metadata) <= 1000, 'Metadata bound')
    for key, values in metadata.items():
        require(len(key) <= 1000 and isinstance(values, list) and len(values) <= 1000 and all(isinstance(v, str) and len(v) <= 262144 for v in values), 'Metadata fields differ')
    count = metadata['xmpTPg:NPages']
    require(isinstance(count, list) and len(count) == 1 and re.fullmatch(r'(?:[1-9]|1[0-6])', count[0]) is not None, 'PDF page count bound')
    require(metadata.get('pdf:ocr-page-count') == ['0'] and metadata.get('pdf:encrypted') == ['false'] and metadata.get('access-permission:extract-content') == ['true'], 'OCR/encryption/permission profile differs')
    xhtml = raw64(r['xhtmlBase64'], 524288)
    require(sha(xhtml) == r['xhtmlSha256'], 'XHTML digest differs')
    page_rows = pages(xhtml, int(count[0]))
    metrics = {k: r[k] for k in ('parseNanos', 'processCpuNanos', 'peakRssKiB')}
    require(all(type(v) is int and 0 <= v <= 9007199254740991 for v in metrics.values()) and metrics['peakRssKiB'] > 0, 'Reported metrics bound')
    runtime, authority = p['runtime'], p['processingAuthority']
    require(set(runtime) == {'qualification', 'preparation'} and len(json.dumps(runtime).encode()) <= 32768, 'Runtime receipt schema/bound differs')
    q, prep = runtime['qualification'], runtime['preparation']
    require(isinstance(q, dict) and isinstance(prep, dict) and isinstance(q['checks'], list) and isinstance(q['repoDigests'], list), 'Runtime receipt field types differ')
    require(q['status'] == 'host_probe_passed' and q['parserExecuted'] is False and q['profile'] == 'runtime-1g' and q['daemonLogging'] is False and q['imageId'] == profile['imageId'] and profile['image'] in q['repoDigests'] and q['runtimeLockSha256'] == profile['runtimeLockSha256'], 'Historical host receipt differs')
    require(all(k in q['checks'] for k in ('boundaries', 'timeout', 'stdout_limit', 'stderr_limit', 'memory', 'pids', 'cpu')) and q['resourceEvidence']['oomKilled'] is True and all(type(q['resourceEvidence'][k]) is int and 0 < q['resourceEvidence'][k] <= 9007199254740991 for k in ('pids', 'cpu')), 'Host probe evidence missing')
    require(prep['status'] == 'verified_locked_tika_bundle' and prep['parserExecuted'] is False and all(prep[k] == profile[k] for k in ('sourceRevision', 'compiledJarSha256', 'runtimeLockSha256', 'wrapperSha256')), 'Artifact preparation differs')
    context = i['derivative']['context']
    require(set(context) == set('tenantId caseId jobId evidenceId sourceDigest authorityVersion'.split()) and type(context['authorityVersion']) is int and context['authorityVersion'] > 0, 'Processing context shape differs')
    for key in ('tenantId', 'caseId', 'jobId', 'evidenceId'):
        require(isinstance(context[key], str) and re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', context[key]) is not None, 'Scoped identifier differs')
    require(context['caseId'] == i['caseId'] == authority['case_id'] and context['tenantId'] == authority['tenant_id'] and context['authorityVersion'] == authority['version'] and context['evidenceId'] == i['evidenceId'] and context['jobId'] == i['jobId'] == job['id'] and context['sourceDigest'] == sha(original), 'Scoped source/processing authority differs')
    require(job['kind'] == KIND and job['status'] == 'succeeded' and type(job['attempt']) is int and 1 <= job['attempt'] <= 3, 'Successful processing attempt required')
    require(stamp(authority['approved_at']) <= stamp(job['finishedAt']) and stamp(job['createdAt']) <= stamp(job['finishedAt']) <= stamp(i['processedAt']) <= stamp(p['exportedAt']), 'Processing chronology differs')
    require(0 <= (stamp(i['processedAt']) - stamp(q['checkedAt'])).total_seconds() <= 1200, 'Historical qualification time differs')
    derivative = {'format': 'inveos.tika_page_text.v1', 'context': context, 'profileDigest': PROFILE, 'rawDigest': sha(raw), 'xhtmlDigest': sha(xhtml), 'runtimeDigest': digest(runtime), 'state': 'unreviewed_extraction', 'offsetBasis': BASIS, 'pages': page_rows, 'coverage': {'pagesWithoutText': [v['page'] for v in page_rows if not v['textPresent']], 'completeExtractionVerified': False}, 'metrics': metrics}
    require(decode(derived_bytes) == derivative == i['derivative'] and sha(derived_bytes) == i['derivativeDigest'], 'Derived page text/coverage differs')
    require(type(i['canChange']) is bool and type(i['canReview']) is bool and isinstance(i['citations'], list) and len(i['citations']) <= 25, 'Inspection bound')
    seen, interpretations = set(), 0
    for item in i['citations']:
        entry, reviews, claims = item['entry'], item['reviews'], item['claims']
        require(entry['id'] not in seen, 'Duplicate citation'); seen.add(entry['id'])
        actor(entry, 'author')
        require(stamp(entry['recordedAt']) >= stamp(i['processedAt']), 'Citation predates processing')
        citation, loc = entry['citation'], entry['citation']['location']
        require(type(loc['page']) is int and 1 <= loc['page'] <= len(page_rows), 'Citation page differs')
        page = page_rows[loc['page'] - 1]
        start, end = loc['startByte'], loc['endByte']
        require(type(start) is int and type(end) is int and 0 <= start < end <= page['utf8Bytes'], 'Derived occurrence bound')
        page_bytes = page['text'].encode(); page_bytes[:start].decode('utf-8')
        quote = page_bytes[start:end].decode('utf-8')
        require(quote.strip() and len(quote.encode()) <= 4096, 'Quote bound')
        expected_citation = {'format': 'inveos.tika_page_citation.v1', 'context': context, 'profileDigest': PROFILE, 'rawDigest': sha(raw), 'xhtmlDigest': sha(xhtml), 'derivativeDigest': i['derivativeDigest'], 'location': {'kind': 'tika_pdf_page_text', 'page': loc['page'], 'path': page['path'], 'pageTextSha256': page['textSha256'], 'startByte': start, 'endByte': end, 'offsetBasis': BASIS}, 'quote': quote, 'state': 'unreviewed_candidate'}
        require(entry == sealed({k: entry[k] for k in ('id', 'authorId', 'authorName', 'recordedAt')} | {'citation': expected_citation}) and citation == expected_citation, 'Citation identity/content differs')
        require(isinstance(reviews, list) and len(reviews) <= 20 and isinstance(claims, list) and len(claims) <= 10, 'Human review bound')
        previous = None
        for sequence, review in enumerate(reviews, 1):
            actor(review, 'reviewer'); text(review['reason'], 3000, 10)
            require(review['reviewerId'] != entry['authorId'] and review['decision'] in ('accepted', 'rejected') and type(review['originalCompared']) is bool and (review['decision'] != 'accepted' or review['originalCompared']), 'Independent original comparison missing')
            require(stamp(review['recordedAt']) >= stamp(previous['recordedAt'] if previous else entry['recordedAt']), 'Review chronology differs')
            value = {k: review[k] for k in ('id', 'decision', 'reason', 'originalCompared', 'reviewerId', 'reviewerName', 'recordedAt')}
            require(review == sealed(value | {'citationId': entry['id'], 'citationDigest': entry['digest'], 'sequence': sequence, 'previousDigest': previous['digest'] if previous else None, 'scope': 'extraction_correspondence_only'}), 'Review chain differs')
            previous = review
        claim_ids = set()
        for row in claims:
            claim, decision = row['claim'], row['decision']; actor(claim, 'author'); text(claim['text'], 6000)
            require(claim['id'] not in claim_ids, 'Duplicate interpretation'); claim_ids.add(claim['id'])
            review = next((v for v in reviews if v['digest'] == claim['correspondenceDigest']), None)
            require(review is not None and review['decision'] == 'accepted' and stamp(claim['recordedAt']) >= stamp(review['recordedAt']), 'Interpretation lacks accepted correspondence')
            value = {k: claim[k] for k in ('id', 'text', 'authorId', 'authorName', 'recordedAt')}
            require(claim == sealed(value | {'citationId': entry['id'], 'citationDigest': entry['digest'], 'correspondenceDigest': review['digest'], 'state': 'proposed_interpretation'}), 'Interpretation linkage differs')
            if decision is not None:
                actor(decision, 'reviewer'); text(decision['reason'], 3000, 10)
                require(type(decision['accepted']) is bool and decision['reviewerId'] != claim['authorId'] and stamp(decision['recordedAt']) >= stamp(claim['recordedAt']), 'Independent interpretation decision missing')
                value = {k: decision[k] for k in ('id', 'accepted', 'reason', 'reviewerId', 'reviewerName', 'recordedAt')}
                require(decision == sealed(value | {'claimId': claim['id'], 'claimDigest': claim['digest'], 'scope': 'interpretation_only'}), 'Interpretation decision linkage differs')
            eligible = bool(decision and decision['accepted'] and previous and previous['decision'] == 'accepted' and previous['digest'] == claim['correspondenceDigest'] and i['canChange'])
            require(type(row['eligible']) is bool and row['eligible'] == eligible, 'Superseded review eligibility differs')
            interpretations += 1
    require(isinstance(p['sourceUse'], list) and len(p['sourceUse']) <= 200, 'Source-use snapshot bound')
    source_ids = set()
    for proof in p['sourceUse']:
        record, decision, review = proof['record'], proof['decision'], proof['metadataReview']
        require(record['id'] not in source_ids, 'Duplicate source-use record'); source_ids.add(record['id'])
        require(sealed({k: v for k, v in record.items() if k != 'digest'}) == record and sealed({k: v for k, v in decision.items() if k != 'digest'}) == decision, 'Source-use digest differs')
        require(record['original']['id'] == i['evidenceId'] == decision['evidenceId'] and record['caseId'] == decision['caseId'] == i['caseId'] and record['id'] == decision['sourceId'] and decision['sourceDigest'] == record['digest'] == review['digest'] and decision['sourceVersion'] == record['version'] and review['accepted'] is True and record['withdrawn'] is False, 'Source-use context differs')
        require(decision['permission'] in ('analysis', 'analysis_and_release') and decision['actorId'] != record['recordedBy'] and review['reviewerId'] != record['recordedBy'], 'Source-use independence differs')
        require(decision['authorityVersion'] == record['original']['authorityVersion'] and 0 < (stamp(decision['expiresAt']) - stamp(decision['recordedAt'])).total_seconds() <= 720 * 3600, 'Source-use authority/lifetime differs')
        require(stamp(decision['recordedAt']) <= stamp(p['exportedAt']) < stamp(decision['expiresAt']), 'Historical source-use expiry differs')
        for a, b in (('filename', 'filename'), ('sha256', 'sha256'), ('sourceTime', 'sourceTime'), ('receivedTime', 'receivedAt'), ('authorityId', 'authorityId'), ('authorityVersion', 'authorityVersion')):
            require(record['original'][a] == i['source'][b], 'Source-use original differs')
    return {'status': 'consistency_checks_passed', 'sha256': envelope['sha256'], 'profileDigest': PROFILE, 'pagesChecked': len(page_rows), 'citationsChecked': len(i['citations']), 'interpretationsChecked': interpretations, 'actualParserExecutionVerified': False, 'actorAuthenticityVerified': False, 'currentPermissionVerified': False, 'productionOrLegalApprovalVerified': False, 'clientReleaseApproved': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path', type=Path)
    parser.add_argument('--expected-sha256')
    args = parser.parse_args()
    try:
        with args.path.open('rb') as stream:
            result = verify(stream.read(12582913), args.expected_sha256)
        print(json.dumps(result))
        return 0
    except (ValueError, KeyError, TypeError, IndexError, OSError, UnicodeError, RecursionError, ET.ParseError) as error:
        print('Tika context verification failed: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
