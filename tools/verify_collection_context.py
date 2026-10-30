#!/usr/bin/env python3
"""Offline consistency check for a bounded INVEOS collection record, not legal approval."""
import argparse
import base64
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path

PROFILE = '0b7dd5a9ba019c0a6a61c9a4071e3c664d6ca364fb6cfe25ecfcb3b228c60f1c'
FIELDS = ('company_number', 'company_name', 'company_status', 'type', 'date_of_creation', 'date_of_cessation', 'jurisdiction')


def require(value, message):
    if not value:
        raise ValueError(message)


def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, 'Duplicate JSON member')
        result[key] = value
    return result


def decode(data):
    return json.loads(data.decode('utf-8'), object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite number')))


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def instant(value):
    require(isinstance(value, str) and len(value) <= 40, 'Invalid time')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(parsed.tzinfo is not None, 'Time needs explicit offset')
    return parsed


def verify(data, expected=None):
    require(0 < len(data) <= 600000, 'Context size outside bound')
    envelope = decode(data)
    require(set(envelope) == {'payload', 'sha256'}, 'Invalid envelope')
    p = envelope['payload']
    require(set(p) == {'schemaVersion', 'receipt', 'receiptSha256', 'originalBase64', 'authorisation', 'caseAuthority', 'sourcePolicy', 'policyReview'}, 'Invalid context members')
    require(p['schemaVersion'] == 'inveos.collection-context.v1', 'Unsupported context')
    require(digest(p) == envelope['sha256'] and (expected is None or expected == envelope['sha256']), 'Context digest mismatch')
    r, a, s, review = p['receipt'], p['authorisation'], p['sourcePolicy'], p['policyReview']
    require(r['schemaVersion'] == 'inveos.collection.v1' and r['profileDigest'] == PROFILE, 'Unrecognised collection profile')
    require(r['captureMode'] in ('fictional_fixture', 'provider'), 'Missing capture mode')
    require(r['interpretation'] == 'unreviewed_provider_assertions', 'Collection is not a reviewed finding')
    require(type(r['httpStatus']) is int and r['httpStatus'] == 200, 'Only a successful bounded response can be captured')
    require(re.fullmatch('[A-Z0-9]{8}', r['companyNumber']) is not None, 'Invalid bounded company identifier')
    require(r['url'] == 'https://api.company-information.service.gov.uk/company/' + r['companyNumber'], 'Unexpected source endpoint')
    require(isinstance(p['originalBase64'], str) and len(p['originalBase64']) <= 349528, 'Original exceeds bound')
    raw = base64.b64decode(p['originalBase64'], validate=True)
    require(base64.b64encode(raw).decode() == p['originalBase64'], 'Noncanonical original encoding')
    require(0 < len(raw) <= 262144 and type(r['byteLength']) is int and r['byteLength'] == len(raw), 'Original length mismatch')
    require(hashlib.sha256(raw).hexdigest() == r['originalSha256'] and digest(r) == p['receiptSha256'], 'Original or receipt digest mismatch')
    source = decode(raw)
    require(isinstance(source, dict) and source.get('company_number') == r['companyNumber'], 'Original company identity differs')
    require(isinstance(source.get('company_name'), str) and bool(source['company_name'].strip()), 'Missing company name')
    fields = []
    for name in FIELDS:
        if name in source:
            value = source[name]
            require(isinstance(value, str) and 0 < len(value) <= 1000 and not re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', value), 'Invalid provider field')
            fields.append({'pointer': '/' + name, 'value': value})
    require(r['fields'] == fields, 'Extracted field differs from original JSON pointer')
    require(r['sourceTimeBasis'] == 'http_response_date_not_record_creation', 'Source time meaning changed')
    received = instant(r['receivedAt'])
    require(instant(r['sourceTime']).timestamp() <= received.timestamp() + 300, 'Response date is after capture')
    require(a['tenant_id'] == s['tenant_id'] == review['tenant_id'] == r['tenantId'] and a['case_id'] == r['caseId'], 'Tenant/case boundary differs')
    authority = p['caseAuthority']
    require(authority['tenant_id'] == r['tenantId'] and authority['case_id'] == r['caseId'] and authority['id'] == a['authority_id'] and authority['version'] == r['authorityVersion'], 'Immutable case authority differs')
    require(instant(authority['approved_at']) <= instant(a['recorded_at']), 'Case approval postdates collection authorisation')
    require(type(authority['retention_days']) is int and a['retention_days'] <= authority['retention_days'], 'Collection retention exceeds case authority')
    require(a['id'] == r['authorisationId'] and a['company_number'] == r['companyNumber'], 'Collection scope differs')
    require(type(r['authorityVersion']) is int and r['authorityVersion'] == a['authority_version'], 'Case authority version differs')
    require(a['adapter_id'] == s['adapter_id'] == review['adapter_id'] == 'companies_house_profile_v1', 'Adapter differs')
    require(type(r['policyVersion']) is int and r['policyVersion'] == a['policy_version'] == s['version'] == review['version'], 'Policy version differs')
    require(type(s['requests_per_window']) is int and 1 <= s['requests_per_window'] <= 600, 'Source policy exceeds the fixed provider request bound')
    require(re.fullmatch('[a-f0-9]{64}', s['terms_sha256'].strip()) is not None, 'Invalid inspected-terms digest')
    require(s['profile_digest'].strip() == PROFILE and review['accepted'] is True and review['reviewer_id'] != s['proposed_by'], 'Independent policy approval missing')
    require(instant(s['proposed_at']) <= instant(review['recorded_at']) <= instant(a['recorded_at']) <= received < instant(a['valid_until']) <= instant(s['valid_until']), 'Approval chronology or expiry differs')
    require(0 < (instant(a['valid_until']) - instant(a['recorded_at'])).total_seconds() <= 86400, 'Collection permission exceeds one day')
    require(0 < (instant(s['valid_until']) - instant(s['proposed_at'])).total_seconds() <= 30 * 86400, 'Source policy exceeds thirty days')
    require(type(a['retention_days']) is int and type(s['retention_days']) is int and 1 <= a['retention_days'] <= s['retention_days'] <= 3650, 'Retention decision differs')
    return {'status': 'consistency_checks_passed', 'sha256': envelope['sha256'], 'captureMode': r['captureMode'], 'companyNumber': r['companyNumber'], 'fieldsChecked': len(fields), 'actorAuthenticityVerified': False, 'providerTruthVerified': False, 'currentUseApproved': False, 'clientReleaseApproved': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path', type=Path)
    parser.add_argument('--expected-sha256')
    args = parser.parse_args()
    try:
        with args.path.open('rb') as stream:
            result = verify(stream.read(600001), args.expected_sha256)
        print(json.dumps(result))
        return 0
    except (ValueError, KeyError, TypeError, OSError, UnicodeError, RecursionError) as error:
        print('Collection verification failed: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
