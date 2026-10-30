#!/usr/bin/env python3
"""Offline Tika report exhibit consistency. No parser, PDF execution or network.

Run this helper on one finding/exhibit pair, or use verify_document_package.py
for the complete report, source-use, Field and composition bindings. Keep the
standard-library dependency verify_tika_context.py alongside this file.
"""
import argparse
import json
from pathlib import Path
import re
import sys
if __package__:
    from .verify_tika_context import verify_material, require, digest, decode, stamp
else:
    from verify_tika_context import verify_material, require, digest, decode, stamp

LIMITATION = 'Human-reviewed Tika PDF page-text interpretation. UTF-8 offsets address normalized extracted page text only; no geometry or original PDF byte offsets. Pinned reduced research parser, without OCR or completeness/source-truth/runtime/legal approval. Verify exact original and raw/derivative/runtime/authority exhibits separately.'


def verify_exhibit(f, e, case_id):
    require(set(e) == set('format findingId inspection originalBase64 rawBase64 derivativeBase64 runtime processingAuthority sourceAuthority job'.split()) and e['format'] == 'inveos.tika_report_exhibit.v1', 'Tika exhibit schema differs')
    verify_material(e)
    i, job = e['inspection'], e['job']
    require(i['caseId'] == case_id and e['findingId'] == f['id'] and i['canChange'] is True and i['canReview'] is False, 'Tika exhibit case/identity differs')
    require(len(i['citations']) == 1 and len(i['citations'][0]['claims']) == 1, 'Exhibit must cover exactly one finding')
    item = i['citations'][0]
    row = item['claims'][0]
    require(set(row) == {'claim', 'decision', 'eligible'} and row['eligible'] is True and row['decision']['accepted'] is True, 'Tika report interpretation is not eligible')
    claim, decision, source, derivative = row['claim'], row['decision'], i['source'], i['derivative']
    require(re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', decision['id']), 'Invalid finding identity')
    require(isinstance(source['filename'], str) and 0 < len(source['filename']) <= 255 and isinstance(source['sourceTime'], str) and source['sourceTime'], 'Source metadata differs')
    stamp(source['receivedAt'])
    require(type(source['authorityVersion']) is int and source['authorityVersion'] > 0 and isinstance(source['authorityId'], str), 'Source authority differs')
    authority = e['sourceAuthority']
    require(authority['id'] == source['authorityId'] and authority['version'] == source['authorityVersion'] and authority['case_id'] == case_id and authority['tenant_id'] == derivative['context']['tenantId'] and stamp(authority['approved_at']) <= stamp(source['receivedAt']), 'Original authority snapshot differs')
    expected = {'kind': 'reviewed_tika_page_text', 'id': decision['id'], 'text': claim['text'], 'reviewer': decision['reviewerId'], 'reviewedAt': decision['recordedAt'],
                'source': {'id': i['evidenceId'], 'filename': source['filename'], 'sha256': source['sha256'], 'sourceTime': source['sourceTime'], 'receivedTime': source['receivedAt'], 'authorityId': source['authorityId'], 'authorityVersion': source['authorityVersion']},
                'extraction': {'jobId': i['jobId'], 'authorityVersion': derivative['context']['authorityVersion'], 'attempt': job['attempt'], 'processedAt': i['processedAt'], 'profile': i['profile'], 'profileDigest': i['profileDigest'], 'rawDigest': i['rawDigest'], 'derivativeDigest': i['derivativeDigest'], 'xhtmlDigest': derivative['xhtmlDigest'], 'runtimeDigest': derivative['runtimeDigest'], 'processingAuthorityDigest': digest(e['processingAuthority']), 'sourceAuthorityDigest': digest(e['sourceAuthority'])},
                'reference': item['entry'], 'correspondence': item['reviews'], 'interpretation': {'claim': claim, 'decision': decision}, 'limitations': LIMITATION}
    require(f == expected, 'Frozen Tika finding differs from exact material/citation/decision exhibit')
    return derivative['context']['tenantId']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pair', type=Path, help='JSON object with finding, exhibit and caseId')
    args = parser.parse_args()
    try:
        require(args.pair.stat().st_size <= 16 * 1024 * 1024, 'Pair size bound')
        pair = decode(args.pair.read_bytes())
        require(set(pair) == {'finding', 'exhibit', 'caseId'}, 'Pair schema differs')
        tenant = verify_exhibit(pair['finding'], pair['exhibit'], pair['caseId'])
        print(json.dumps({'status': 'consistency_checks_passed', 'tenantId': tenant, 'currentPermissionVerified': False, 'actualParserExecutionVerified': False, 'actorAuthenticityVerified': False, 'clientReleaseApproved': False}))
    except (ValueError, KeyError, TypeError, IndexError, AttributeError, OverflowError, RecursionError, OSError) as exc:
        print('Verification failed: ' + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
