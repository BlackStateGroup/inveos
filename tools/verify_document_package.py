#!/usr/bin/env python3
"""Offline first-party verification of bounded document report JSON packages.

Never executes a PDF/parser, extracts files, accesses a network or imports code
from the package. Use an independently trusted copy of this script.
"""
import argparse
import base64
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import re
import sys

if __package__:
    from .verify_report import InvalidReport, require, unique_object, reject_constant, verify_report
else:
    from verify_report import InvalidReport, require, unique_object, reject_constant, verify_report

MAX_PACKAGE = 64 * 1024 * 1024
PROFILE = '3598b04aaddec299619919cb1f54922d6f3b0431929cc9124e23bb2b013d27a3'
FORMAT = 'inveos_document_report_package_v1'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def parse(raw):
    try:
        return json.loads(raw.decode('utf-8'), object_pairs_hook=unique_object, parse_constant=reject_constant)
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise InvalidReport('Invalid or duplicate-key JSON') from exc


def fields(value, names):
    require(isinstance(value, dict) and set(value) == set(names.split()), 'Unexpected record fields')


def blob(value, maximum):
    require(isinstance(value, str) and 0 < len(value) <= 4 * ((maximum + 2) // 3), 'Encoded record size limit')
    try:
        raw = base64.b64decode(value, validate=True)
    except ValueError as exc:
        raise InvalidReport('Invalid base64') from exc
    require(0 < len(raw) <= maximum and base64.b64encode(raw).decode('ascii') == value, 'Non-canonical or oversized bytes')
    return raw


def number(value):
    require(type(value) in (int, float) and math.isfinite(value), 'Invalid geometry')
    return value


def identifier(value):
    require(isinstance(value, str) and re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', value, re.I), 'Invalid identity')
    return value


def same(a, b):
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    if type(a) is bool or type(b) is bool:
        return type(a) is type(b) and a == b
    return a == b


def timestamp(value):
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z', value), 'Invalid record timestamp')
    try:
        datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as exc:
        raise InvalidReport('Invalid record timestamp') from exc


def native_derivative(raw, context):
    """Independent replay of the supported two-page native text contract."""
    data = parse(raw)
    require(isinstance(data, dict) and data.get('schema_name') == 'DoclingDocument', 'Unsupported parser output')
    pages = data.get('pages')
    require(isinstance(pages, dict) and 1 <= len(pages) <= 2, 'Page limit')
    require(set(pages) == {str(i + 1) for i in range(len(pages))}, 'Page identities')
    dimensions = []
    for index in range(len(pages)):
        page = pages[str(index + 1)]
        require(type(page['page_no']) is int and page['page_no'] == index + 1, 'Page identity')
        width, height = number(page['size']['width']), number(page['size']['height'])
        require(width > 0 and height > 0, 'Page dimensions')
        dimensions.append({'page': index + 1, 'width': width, 'height': height})
    for key in ('tables', 'key_value_items'):
        require(key not in data or data[key] == [], 'Unsupported structured extraction')
    texts = data.get('texts')
    require(isinstance(texts, list) and len(texts) <= 1000, 'Text item limit')
    parts, references, counts, offset = [], [], [0] * len(pages), 0
    for index, item in enumerate(texts):
        text = item['text']
        require(isinstance(text, str) and text and item['self_ref'] == f'#/texts/{index}', 'Text item identity')
        encoded = text.encode('utf-8')
        require(isinstance(item['prov'], list) and len(item['prov']) == 1, 'Ambiguous provenance')
        prov = item['prov'][0]
        page = prov['page_no']
        require(type(page) is int and 1 <= page <= len(pages), 'Reference page')
        require(prov['charspan'] == [0, len(text)] and all(type(v) is int for v in prov['charspan']), 'Partial native span')
        box = prov['bbox']
        l, r, b, t = [number(box[k]) for k in ('l', 'r', 'b', 't')]
        origin = box['coord_origin']
        require(origin in ('TOPLEFT', 'BOTTOMLEFT') and 0 <= l < r <= dimensions[page - 1]['width']
                and 0 <= min(b, t) < max(b, t) <= dimensions[page - 1]['height']
                and (b < t if origin == 'BOTTOMLEFT' else t < b), 'Reference geometry')
        if index:
            offset += 1
        start = offset
        offset += len(encoded)
        require(offset <= 1048576, 'Extracted text size')
        parts.append(text)
        counts[page - 1] += 1
        references.append({'itemRef': item['self_ref'], 'page': page, 'bbox': {'l': l, 'r': r, 'b': b, 't': t, 'origin': origin}, 'startByte': start, 'endByte': offset})
    missing = [i + 1 for i, count in enumerate(counts) if not count]
    return {'format': 'inveos_native_document_v1', 'context': context, 'profileDigest': PROFILE,
            'rawDigest': sha(raw), 'reviewState': 'unreviewed', 'offsetBasis': 'extracted_utf8_not_original_pdf',
            'pages': dimensions, 'text': '\n'.join(parts), 'references': references,
            'coverage': {'pageTextCounts': counts, 'pagesWithoutText': missing,
                         'disposition': 'needs_page_review' if missing else 'unreviewed_text', 'completeExtractionVerified': False}}


def verify_exhibit(f, exhibit, case_id):
    fields(exhibit, 'findingId candidateCreatedBy originalBase64 rawBase64 derivativeBase64 citationBase64 reviewBase64 claimBase64 decisionBase64')
    require(f['kind'] == 'derived_document' and exhibit['findingId'] == f['id'], 'Finding identity')
    identifier(f['id'])
    identifier(f['source']['authorityId'])
    require(type(f['source']['authorityVersion']) is int and f['source']['authorityVersion'] > 0
            and type(f['extraction']['attempt']) is int and f['extraction']['attempt'] > 0, 'Authority or attempt metadata')
    timestamp(f['extraction']['processedAt'])
    original = blob(exhibit['originalBase64'], 65536)
    require(original.startswith(b'%PDF-') and sha(original) == f['source']['sha256'], 'Original fingerprint')
    raw, derivative_bytes, citation_bytes = [blob(exhibit[key], 1048576) for key in ('rawBase64', 'derivativeBase64', 'citationBase64')]
    d, c = parse(derivative_bytes), parse(citation_bytes)
    context = d['context']
    fields(context, 'tenantId caseId jobId evidenceId sourceDigest authorityVersion')
    for key in ('tenantId', 'caseId', 'jobId', 'evidenceId'):
        identifier(context[key])
    require(context['caseId'] == case_id and context['jobId'] == f['extraction']['jobId']
            and context['evidenceId'] == f['source']['id'] and context['sourceDigest'] == sha(original)
            and type(context['authorityVersion']) is int and context['authorityVersion'] > 0
            and context['authorityVersion'] == f['extraction']['authorityVersion'], 'Extraction scope')
    require(sha(f['extraction']['profile'].encode('utf-8')) == PROFILE == f['extraction']['profileDigest'], 'Unsupported processing profile')
    require(sha(raw) == f['extraction']['rawDigest'] and sha(derivative_bytes) == f['extraction']['derivativeDigest'], 'Extraction fingerprints')
    require(same(d, native_derivative(raw, context)), 'Normalised extraction does not replay')
    ref = f['reference']
    selected = next((r for r in d['references'] if r['itemRef'] == ref['itemRef']), None)
    require(selected is not None, 'Missing selected occurrence')
    start, end = ref['startByte'], ref['endByte']
    require(type(start) is int and type(end) is int and selected['startByte'] <= start < end <= selected['endByte'], 'Citation range')
    text = d['text'].encode('utf-8')
    text[:start].decode('utf-8')
    require(text[start:end].decode('utf-8') == ref['quote'] and len(ref['quote'].encode('utf-8')) <= 4096, 'Exact quote')
    expected = {'format': 'inveos_document_citation_candidate_v1', 'context': context,
                'derivativeDigest': sha(derivative_bytes), 'rawDigest': sha(raw), 'profileDigest': PROFILE,
                'status': 'unreviewed_candidate', 'offsetBasis': d['offsetBasis'], 'itemRef': selected['itemRef'],
                'page': selected['page'], 'bbox': selected['bbox'], 'startByte': start, 'endByte': end, 'quote': ref['quote']}
    require(same(c, expected) and sha(citation_bytes) == ref['citationDigest'] and same(ref['page'], selected['page'])
            and same(ref['bbox'], selected['bbox']) and ref['offsetBasis'] == d['offsetBasis'], 'Citation lineage')
    identifier(ref['citationId'])
    reviews = exhibit['reviewBase64']
    require(isinstance(reviews, list) and 1 <= len(reviews) <= 100, 'Review history limit')
    previous_id = previous_digest = None
    review_ids = set()
    for sequence, encoded in enumerate(reviews, 1):
        review_bytes = blob(encoded, 16384)
        review = parse(review_bytes)
        timestamp(review['reviewedAt'])
        fields(review, 'format context citationId citationDigest id sequence previousReviewId previousReviewDigest decision reason originalCompared reviewedBy reviewedAt scope')
        require(review['format'] == 'inveos_document_citation_review_v1' and same(review['context'], context)
                and review['citationId'] == ref['citationId'] and review['citationDigest'] == sha(citation_bytes)
                and type(review['sequence']) is int and review['sequence'] == sequence
                and review['previousReviewId'] == previous_id and review['previousReviewDigest'] == previous_digest
                and review['scope'] == 'extraction_correspondence_not_finding', 'Review chain')
        identifier(review['id']); identifier(review['reviewedBy']); identifier(exhibit['candidateCreatedBy'])
        require(review['id'] not in review_ids, 'Duplicate review identity')
        review_ids.add(review['id'])
        require(review['reviewedBy'] != exhibit['candidateCreatedBy'] and review['decision'] in ('accepted', 'rejected')
                and isinstance(review['reason'], str) and review['reason'].strip() and len(review['reason'].encode()) <= 4096
                and type(review['originalCompared']) is bool and (review['decision'] != 'accepted' or review['originalCompared']), 'Correspondence decision')
        previous_id, previous_digest = review['id'], sha(review_bytes)
    require(review['decision'] == 'accepted' and f['correspondence'] == {'id': previous_id, 'digest': previous_digest,
            'reviewer': review['reviewedBy'], 'reviewedAt': review['reviewedAt'], 'reason': review['reason']}, 'Selected current correspondence')
    claim_bytes, decision_bytes = blob(exhibit['claimBase64'], 16384), blob(exhibit['decisionBase64'], 16384)
    claim, decision = parse(claim_bytes), parse(decision_bytes)
    timestamp(claim['createdAt']); timestamp(decision['reviewedAt'])
    fields(claim, 'format context id citationId citationDigest correspondenceReviewId correspondenceReviewDigest text status createdBy createdAt')
    fields(decision, 'format context id claimId claimDigest citationId citationDigest correspondenceReviewId correspondenceReviewDigest accepted reason reviewedBy reviewedAt scope')
    interpretation = f['interpretation']
    require(sha(claim_bytes) == interpretation['claimDigest'] and sha(decision_bytes) == interpretation['decisionDigest'], 'Interpretation fingerprints')
    require(claim['format'] == 'inveos_document_claim_v1' and same(claim['context'], context) and claim['id'] == interpretation['claimId']
            and claim['status'] == 'proposed_interpretation' and claim['text'] == f['text'] and claim['text'].strip() and 0 < len(claim['text'].encode()) <= 8000, 'Proposed interpretation')
    for record in (claim, decision):
        require(record['citationId'] == ref['citationId'] and record['citationDigest'] == sha(citation_bytes)
                and record['correspondenceReviewId'] == previous_id and record['correspondenceReviewDigest'] == previous_digest, 'Interpretation correspondence binding')
    identifier(claim['createdBy']); identifier(claim['id']); identifier(decision['reviewedBy'])
    require(decision['format'] == 'inveos_document_claim_decision_v1' and same(decision['context'], context)
            and decision['scope'] == 'interpretation_decision' and decision['accepted'] is True
            and decision['id'] == interpretation['decisionId'] == f['id'] and decision['claimId'] == claim['id']
            and decision['claimDigest'] == sha(claim_bytes) and decision['reviewedBy'] != claim['createdBy']
            and decision['reviewedBy'] == f['reviewer'] and decision['reviewedAt'] == f['reviewedAt']
            and decision['reason'] == interpretation['reason'] and decision['reason'].strip() and 0 < len(decision['reason'].encode()) <= 6000, 'Independent finding decision')
    return context['tenantId']


def verify_package(raw, expected_report_sha256=None, expected_package_sha256=None):
    require(0 < len(raw) <= MAX_PACKAGE, 'Package size limit')
    if expected_package_sha256 is not None:
        require(sha(raw) == expected_package_sha256, 'Trusted package fingerprint mismatch')
    try:
        package = parse(raw)
        fields(package, 'format reportSha256 reportBase64 exhibits')
        require(package['format'] == FORMAT, 'Unsupported package format')
        report_raw = blob(package['reportBase64'], 32 * 1024 * 1024)
        require(sha(report_raw) == package['reportSha256'], 'Report fingerprint mismatch')
        if expected_report_sha256 is not None:
            require(sha(report_raw) == expected_report_sha256, 'Trusted report fingerprint mismatch')
        report = parse(report_raw)
        require(report['status'] == 'draft_not_released', 'Unsupported report status')
        case_id = identifier(report['case']['id'])
        for field in ('ref', 'title', 'client', 'scope', 'jurisdiction'):
            require(isinstance(report['case'][field], str) and report['case'][field].strip(), 'Report case metadata')
        require(isinstance(report['limitations'], str) and report['limitations'].strip(), 'Report limitations')
        legacy, findings, exhibits = report['findings'], report['documentFindings'], package['exhibits']
        require(isinstance(legacy, list) and isinstance(findings, list) and isinstance(exhibits, list)
                and 1 <= len(findings) == len(exhibits) and len(legacy) + len(findings) <= 1000, 'Finding count limit')
        if legacy:
            original_report = {key: value for key, value in report.items() if key != 'documentFindings'}
            verify_report(json.dumps(original_report, ensure_ascii=False).encode('utf-8'))
        ids = [f['id'] for f in legacy + findings]
        require(len(set(ids)) == len(ids), 'Duplicate finding identity')
        sources = {}
        original_ids = {f['source']['id'] for f in legacy}
        for finding in findings:
            source = finding['source']
            require(source['id'] not in original_ids, 'Conflicting original representation')
            if source['id'] in sources:
                require(same(source, sources[source['id']]), 'Conflicting document original metadata')
            sources[source['id']] = source
        tenants = {verify_exhibit(f, e, case_id) for f, e in zip(findings, exhibits)}
        require(len(tenants) == 1, 'Mixed tenant lineage')
    except (KeyError, TypeError, IndexError, AttributeError, UnicodeError, OverflowError, RecursionError, StopIteration) as exc:
        raise InvalidReport('Malformed document package') from exc
    return {'status': 'integrity_checks_passed', 'reportSha256': sha(report_raw), 'packageSha256': sha(raw),
            'caseId': case_id, 'documentFindingsChecked': len(findings), 'originalFindingsChecked': len(legacy),
            'trustedReportDigestMatched': expected_report_sha256 is not None, 'trustedPackageDigestMatched': expected_package_sha256 is not None,
            'releaseStatus': 'draft_not_released', 'limitations': 'Consistency only; no parser execution, source truth, reviewer authentication, current server policy, signature or release certification. Trust report and package fingerprints through a separate channel.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', type=Path)
    parser.add_argument('--expected-report-sha256')
    parser.add_argument('--expected-package-sha256')
    args = parser.parse_args()
    try:
        with args.package.open('rb') as source:
            raw = source.read(MAX_PACKAGE + 1)
        result = verify_package(raw, args.expected_report_sha256, args.expected_package_sha256)
    except (InvalidReport, OSError) as exc:
        print(json.dumps({'status': 'verification_failed', 'error': str(exc) if isinstance(exc, InvalidReport) else 'Cannot read package'}), file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    sys.exit(main())
