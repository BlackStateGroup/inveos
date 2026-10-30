#!/usr/bin/env python3
"""Verify preserved supplied/fictional research consistency, never truth or permission.

Standalone standard-library verifier. Stored HTML is decoded as inert text only.
"""
import argparse
import base64
import hashlib
import ipaddress
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

PROFILES = {
    'rdap_domain_v1': '25b70948af4174fe0da2f2af2fb9f44ce49683d2e7237ae7888326d154d9cc18',
    'gleif_lei_v1': '421eae6fcad6722302efd1fb6c36bd2278f7478e83ec014035f895493eae178c',
    'supplied_webpage_v1': '166adc21d0982926d764b9eeb89faaa327b041b5e293853b354608f5d5062be8',
}
CONTROL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')


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
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def instant(value):
    require(isinstance(value, str) and len(value) <= 40, 'Invalid time')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(parsed.tzinfo is not None, 'Explicit timezone required')
    return parsed


def text(value, maximum=2000, minimum=1):
    require(isinstance(value, str) and minimum <= len(value.strip()) <= maximum and not CONTROL.search(value), 'Invalid bounded text')
    return value


def https(value):
    text(value)
    u = urlsplit(value)
    require(u.scheme == 'https' and u.netloc == u.hostname and bool(u.hostname) and '.' in u.hostname and u.path.startswith('/') and not u.query and not u.fragment and not re.search(r'[\s\\%]', value), 'Invalid declared HTTPS scope')
    require(value == 'https://' + u.netloc + u.path and u.netloc == u.netloc.lower(), 'Noncanonical scope')
    try:
        ipaddress.ip_address(u.hostname)
    except ValueError:
        pass
    else:
        raise ValueError('IP scope is not supported')
    require(not u.hostname.endswith(('.localhost', '.local')), 'Local scope denied')
    return u


def target_url(adapter, target, endpoint):
    scope = https(endpoint)
    if adapter == 'gleif_lei_v1':
        require(endpoint == 'https://api.gleif.org/api/v1/lei-records/', 'LEI endpoint differs')
        require(isinstance(target, str) and re.fullmatch('[A-Z0-9]{18}[0-9]{2}', target) is not None, 'Invalid LEI shape')
        require(int(''.join(c if c.isdigit() else str(ord(c) - 55) for c in target)) % 97 == 1, 'LEI check digits differ')
        return endpoint + target
    if adapter == 'rdap_domain_v1':
        require(scope.path.endswith('/domain/'), 'RDAP endpoint path differs')
        require(isinstance(target, str) and len(target) <= 253 and '.' in target and all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', x) for x in target.split('.')), 'Invalid domain')
        try:
            ipaddress.ip_address(target)
        except ValueError:
            pass
        else:
            raise ValueError('IP is not a domain target')
        require(not target.endswith(('.localhost', '.local')), 'Local domain denied')
        return endpoint + target
    require(scope.path == '/' and https(target).netloc == scope.netloc, 'Page outside approved origin')
    return target


def fields_for(raw, target):
    v = decode(raw)
    require(isinstance(v, dict) and v.get('objectClassName') == 'domain' and isinstance(v.get('ldhName'), str) and v['ldhName'].lower() == target, 'RDAP identity differs')
    fields = []

    def add(pointer, value):
        fields.append({'pointer': pointer, 'value': text(value, 1000)})

    add('/objectClassName', v['objectClassName']); add('/ldhName', v['ldhName'])
    if 'handle' in v:
        add('/handle', v['handle'])
    if 'status' in v:
        require(isinstance(v['status'], list) and len(v['status']) <= 50, 'RDAP status bound')
        for i, value in enumerate(v['status']):
            add('/status/' + str(i), value)
    if 'events' in v:
        require(isinstance(v['events'], list) and len(v['events']) <= 50, 'RDAP event bound')
        for i, value in enumerate(v['events']):
            require(isinstance(value, dict), 'Invalid RDAP event')
            add('/events/' + str(i) + '/eventAction', value.get('eventAction'))
            add('/events/' + str(i) + '/eventDate', value.get('eventDate'))
    return fields


def lei_fields_for(raw, target):
    v = decode(raw)
    require(isinstance(v, dict) and 'errors' not in v and isinstance(v.get('data'), dict), 'Single LEI record required')
    d = v['data']
    a = d.get('attributes')
    require(isinstance(a, dict) and d.get('type') == 'lei-records' and d.get('id') == target and a.get('lei') == target, 'LEI identity differs')
    entity, registration = a.get('entity'), a.get('registration')
    require(isinstance(entity, dict) and isinstance(registration, dict) and isinstance(entity.get('legalName'), dict), 'LEI record shape differs')
    name = entity['legalName']
    fields = []
    def add(pointer, value):
        fields.append({'pointer': pointer, 'value': text(value, 1000)})
    add('/data/type', d['type']); add('/data/id', d['id']); add('/data/attributes/lei', a['lei'])
    add('/data/attributes/entity/legalName/name', name.get('name'))
    if 'language' in name:
        add('/data/attributes/entity/legalName/language', name['language'])
    for key in ('jurisdiction', 'category', 'status', 'registeredAs'):
        if key in entity:
            add('/data/attributes/entity/' + key, entity[key])
    for key in ('status', 'initialRegistrationDate', 'lastUpdateDate', 'nextRenewalDate'):
        if key in registration:
            add('/data/attributes/registration/' + key, registration[key])
    return fields


def verify(data, expected=None):
    require(0 < len(data) <= 600000, 'Context bound')
    envelope = decode(data)
    require(isinstance(envelope, dict) and set(envelope) == {'payload', 'sha256'}, 'Invalid context envelope')
    p = envelope['payload']
    require(set(p) == set('schemaVersion receipt receiptSha256 request caseAuthority sourcePolicy policyReview policyScope originalBase64'.split()), 'Invalid context members')
    require(p['schemaVersion'] == 'inveos.research-context.v1' and digest(p) == envelope['sha256'] and (expected is None or expected == envelope['sha256']), 'Context digest differs')
    r, q, a, s, review, scope = (p[k] for k in ('receipt', 'request', 'caseAuthority', 'sourcePolicy', 'policyReview', 'policyScope'))
    require(r['schemaVersion'] == 'inveos.research-capture.v1' and r['adapterId'] in PROFILES, 'Unsupported research adapter')
    adapter = r['adapterId']
    require(r['profileDigest'] == q['profileDigest'] == s['profile_digest'].strip() == PROFILES[adapter], 'Profile differs')
    require(r['fictional'] is True and r['interpretation'] == 'unreviewed_supplied_assertions', 'Capture is fictional unreviewed source data')
    require(r['credentialScope'] == q['credentialScope'] == scope['credential_scope'] == 'none:controlled-input', 'Credential scope differs')
    require(r['endpointScope'] == q['endpointScope'] == scope['endpoint_scope'] and r['target'] == q['target'], 'Request endpoint or target differs')
    require(r['url'] == target_url(adapter, q['target'], q['endpointScope']), 'Capture URL differs')
    require(isinstance(p['originalBase64'], str) and len(p['originalBase64']) <= 349528, 'Original encoding bound')
    raw = base64.b64decode(p['originalBase64'], validate=True)
    require(base64.b64encode(raw).decode() == p['originalBase64'] and 0 < len(raw) <= 262144, 'Original bound or encoding differs')
    original_text = raw.decode('utf-8')
    require(not CONTROL.search(original_text), 'Unsupported original control bytes')
    require(type(r['byteLength']) is int and r['byteLength'] == len(raw) and hashlib.sha256(raw).hexdigest() == r['originalSha256'], 'Original digest or length differs')
    require(digest(r) == p['receiptSha256'] and digest({k: v for k, v in q.items() if k != 'digest'}) == q['digest'] == r['requestDigest'], 'Receipt or request digest differs')
    for key in ('title', 'purpose', 'minimisation', 'reason'):
        text(q[key])
    text(r['filename'], 200); text(r['publisher'], 300)
    require(not re.search(r'[/\\]', r['filename']), 'Filename contains path')
    require(type(r['networkRequests']) is int, 'Network request count must be explicit')
    if adapter in ('rdap_domain_v1', 'gleif_lei_v1'):
        media = ('application/vnd.api+json', 'application/json') if adapter == 'gleif_lei_v1' else ('application/rdap+json', 'application/json')
        fields = lei_fields_for(raw, q['target']) if adapter == 'gleif_lei_v1' else fields_for(raw, q['target'])
        require(r['mediaType'] in media and r['fields'] == fields, 'Registry media or extracted fields differ')
        require(r['captureMode'] in ('fictional_fixture', 'controlled_response', 'fictional_transport'), 'Registry capture mode differs')
        if r['captureMode'] == 'fictional_transport':
            require(r['networkRequests'] == 1 and r['sourceTimeBasis'] == 'http_response_date_not_record_creation', 'Fixture transport context differs')
            response = r['response']
            require(response['transport'] == 'loopback_http_fixture' and type(response['status']) is int and response['status'] == 200, 'Transport response differs')
            require((q['target'] == '000000FICTIONAL00040' and q['endpointScope'] == 'https://api.gleif.org/api/v1/lei-records/') if adapter == 'gleif_lei_v1' else (q['target'] == 'example.test' and q['endpointScope'] == 'https://rdap.example.test/domain/'), 'Unexpected fictional transport destination')
            from email.utils import parsedate_to_datetime
            require(parsedate_to_datetime(response['date']) == instant(r['sourceTime']), 'HTTP response time differs')
        else:
            require(r['networkRequests'] == 0 and r['sourceTimeBasis'] == 'declared_response_date' and 'response' not in r, 'Supplied response must not claim observed transport')
    else:
        require(r['mediaType'] in ('text/html', 'text/plain') and r['captureMode'] == 'supplied_webpage' and r['sourceTimeBasis'] == 'declared_page_time' and r['fields'] == [] and r['networkRequests'] == 0 and 'response' not in r, 'Supplied webpage context differs')
    require(r['tenantId'] == q['tenantId'] == a['tenant_id'] == s['tenant_id'] == review['tenant_id'] and r['caseId'] == q['caseId'] == a['case_id'], 'Tenant/case differs')
    require(r['requestId'] == q['requestId'] and type(r['requestVersion']) is int and r['requestVersion'] == q['version'], 'Request version differs')
    require(type(r['authorityVersion']) is int and r['authorityVersion'] == q['authorityVersion'] == a['version'] and q['authorityId'] == a['id'], 'Case authority differs')
    require(type(r['policyVersion']) is int and r['policyVersion'] == q['policyVersion'] == s['version'] == review['version'] and q['adapterId'] == s['adapter_id'] == review['adapter_id'] == adapter, 'Policy version differs')
    require(review['accepted'] is True and review['reviewer_id'] != s['proposed_by'], 'Independent policy review missing')
    require(type(s['requests_per_window']) is int and 1 <= s['requests_per_window'] <= 30, 'Profile quota exceeded')
    require(re.fullmatch('[a-f0-9]{64}', s['terms_sha256'].strip()) is not None, 'Terms digest missing')
    require(type(q['retentionDays']) is int and type(s['retention_days']) is int and type(a['retention_days']) is int and 1 <= q['retentionDays'] <= min(s['retention_days'], a['retention_days']) <= 3650, 'Retention exceeds scope')
    received = instant(r['receivedAt'])
    require(instant(a['approved_at']) <= instant(q['recordedAt']) and instant(s['proposed_at']) <= instant(review['recorded_at']) <= instant(q['recordedAt']) <= received < instant(q['validUntil']) <= instant(s['valid_until']), 'Approval/expiry chronology differs')
    require(0 < (instant(q['validUntil']) - instant(q['recordedAt'])).total_seconds() <= 86400 and 0 < (instant(s['valid_until']) - instant(s['proposed_at'])).total_seconds() <= 30 * 86400, 'Permission lifetime exceeds bound')
    require(instant(r['sourceTime']).timestamp() <= instant(r['retrievedAt']).timestamp() + 300 and instant(r['retrievedAt']).timestamp() <= received.timestamp() + 300, 'Source/retrieval time differs')
    return {'status': 'consistency_checks_passed', 'sha256': envelope['sha256'], 'adapterId': adapter, 'captureMode': r['captureMode'], 'fieldsChecked': len(r['fields']), 'providerTruthVerified': False, 'actorAuthenticityVerified': False, 'currentUseApproved': False, 'clientReleaseApproved': False}


def verify_provenance(value, original_base64, original, case_id):
    require(set(value) == {'payload', 'sha256'}, 'Invalid provenance envelope')
    p = value['payload']
    require(set(p) == set('schemaVersion receipt receiptSha256 request caseAuthority sourcePolicy policyReview policyScope'.split()) and p['schemaVersion'] == 'inveos.research-provenance.v1' and digest(p) == value['sha256'], 'Research provenance digest differs')
    r, q = p['receipt'], p['request']
    require(r['caseId'] == case_id and r['originalSha256'] == original['sha256'] and r['filename'] == original['filename'], 'Research cites another original/case')
    require(r['sourceTime'] == original['sourceTime'] and r['receivedAt'] == original['receivedTime'] and q['authorityId'] == original['authorityId'] and q['authorityVersion'] == original['authorityVersion'], 'Research original time/authority differs')
    context = {**p, 'schemaVersion': 'inveos.research-context.v1', 'originalBase64': original_base64}
    return verify(json.dumps({'payload': context, 'sha256': digest(context)}, ensure_ascii=False).encode())


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
        print('Research verification failed: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
