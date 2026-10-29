#!/usr/bin/env python3
"""Exercise a running loopback synthetic lab through real HTTP; no external data.

Creates visibly fictional cases, originals, claims, work records and an internal
report. Start the local lab first. Outputs go to ignored .local-data by default.
"""
import argparse
import base64
import hashlib
import http.cookiejar
import json
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from verify_report import verify


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:3001')
    parser.add_argument('--output', type=Path, default=Path('.local-data/casework-verification'))
    args = parser.parse_args()
    parsed = urllib.parse.urlsplit(args.base_url)
    if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or parsed.path not in ('', '/'):
        parser.error('Only a local HTTP lab on 127.0.0.1 is supported')
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    csrf = ''
    results = []

    def call(name, method, path, data=None, expected=200):
        headers = {'Origin': 'http://127.0.0.1:5173', 'Content-Type': 'application/json'}
        if csrf:
            headers['X-CSRF-Token'] = csrf
        request = urllib.request.Request(args.base_url.rstrip('/') + '/api' + path,
            data=None if data is None else json.dumps(data, ensure_ascii=False).encode(), headers=headers, method=method)
        start = time.perf_counter()
        try:
            with opener.open(request, timeout=20) as response:
                status, body = response.status, response.read()
                cache = response.headers.get('Cache-Control')
        except urllib.error.HTTPError as error:
            status, body = error.code, error.read()
            cache = error.headers.get('Cache-Control')
        result = json.loads(body)
        if path == '/workspace' and status == 200:
            assert cache == 'no-store', 'Private workspace responses must not be cached'
        results.append({'name': name, 'expected': expected, 'actual': status,
                        'milliseconds': round((time.perf_counter() - start) * 1000, 2), 'passed': status == expected})
        if status != expected:
            raise AssertionError(f'{name}: HTTP {status}, expected {expected}: {result}')
        return result

    csrf = call('Start synthetic reviewer session', 'POST', '/session/start', {})['csrf']
    case = call('Create fictional supplier case', 'POST', '/cases', {
        'title': 'FICTIONAL supplier ownership investigation', 'client': 'Northstar Demo Client (fictional)',
        'scope': 'Review supplied fictional ownership declarations and an older register extract only. No external collection.',
        'jurisdiction': 'Synthetic UK training exercise'})
    case_id = case['id']
    base = f'/cases/{case_id}'
    call('Approve versioned synthetic authority', 'POST', base + '/authority', {
        'purpose': 'Compare supplied fictional ownership assertions.', 'lawfulBasis': 'Synthetic exercise only; no real people or client data.',
        'scope': 'Only fictional supplied text originals; no external registry collection.', 'retentionDays': 30,
        'minimisation': 'Use labelled fictional records without real identifiers or personal details.'})
    workspace = call('Read persistent case membership', 'GET', '/workspace')
    owner = next(member['userId'] for member in workspace['members'] if member['caseId'] == case_id)

    def create(kind, title, body, parent=None, due='2026-11-02', owner_id=owner):
        return call(f'Create {kind}', 'POST', base + '/work', {
            'id': str(uuid.uuid4()), 'kind': kind, 'title': title, 'body': body, 'ownerId': owner_id, 'dueDate': due, 'parentId': parent})

    objective = create('objective', 'Establish what the supplied ownership records support', 'FICTIONAL: distinguish a source assertion from actual ownership or deception.')
    question = create('question', 'Do the supplied ownership records agree?', 'The older extract may predate a lawful ownership change.', objective['id'])
    hypothesis = create('hypothesis', 'Ownership changed between the two supplied records', 'A candidate explanation, requiring a dated transfer record.', question['id'])
    task = create('task', 'Request the missing dated transfer record', 'Confirm the date difference before reaching any conclusion.', question['id'])
    note = create('note', 'Initial source-review note', 'FICTIONAL: preserve uncertainty. Português £50 — العربية.', question['id'])
    handover = create('handover', 'Review the ownership discrepancy', 'Compare the two passages and record the remaining gap.', question['id'])
    claims = []
    for index, (filename, quote, source_time) in enumerate([
        ('fictional-declaration.txt', 'Atlas Demo Holdings owns 100% of FICTIONAL-SUP-001.', '2026-10-10T10:00:00+01:00'),
        ('fictional-older-register.txt', 'Atlas Demo Holdings owns 60%; Birch Demo Holdings owns 40%.', '2026-09-01T09:00:00Z'),
    ]):
        text = 'SYNTHETIC FIXTURE — FICTIONAL ONLY\n' + quote + '\nSupplied record; no external registry query.\n'
        evidence = call(f'Register original {index + 1}', 'POST', base + '/evidence', {
            'filename': filename, 'text': text, 'expectedSha256': hashlib.sha256(text.encode()).hexdigest(),
            'sourceTime': source_time, 'method': 'Fictional commissioning-party supplied text', 'idempotencyKey': str(uuid.uuid4())})
        claim = call(f'Propose exact-source claim {index + 1}', 'POST', base + '/claims', {
            'evidenceId': evidence['id'], 'text': 'The supplied fictional record states: ' + quote, 'quote': quote})
        claims.append(claim)
        call(f'Link {"supporting" if index == 0 else "contrary"} material', 'POST', base + f'/work/{question["id"]}/links', {
            'id': str(uuid.uuid4()), 'claimId': claim['id'], 'relation': 'supports' if index == 0 else 'contradicts',
            'reason': 'The supplied record makes a different ownership assertion; source dates differ.'})
        call(f'Review source assertion {index + 1}', 'POST', base + f'/claims/{claim["id"]}/review', {
            'accepted': True, 'reason': 'Exact passage reviewed. Finding concerns what this supplied fictional record states, not proof of actual ownership or deception.'})

    def revise(item, **overrides):
        return {'expectedVersion': item['version'], 'title': item['title'], 'body': item['body'], 'status': item['status'],
            'ownerId': item['ownerId'], 'dueDate': item['dueDate'], 'reason': 'Fictional investigator recorded the decision.', **overrides}

    invalid = {'id': str(uuid.uuid4()), 'kind': 'task', 'title': 'Invalid fictional calendar date', 'body': '', 'ownerId': owner, 'dueDate': '2026-02-30', 'parentId': None}
    call('Reject impossible calendar date', 'POST', base + '/work', invalid, expected=422)
    call('Reject blank question title', 'POST', base + '/work', {**invalid, 'id': str(uuid.uuid4()), 'title': '   ', 'dueDate': None}, expected=422)
    call('Reject client-supplied tenant context', 'POST', base + '/work', {**invalid, 'id': str(uuid.uuid4()), 'dueDate': None, 'tenantId': str(uuid.uuid4())}, expected=422)
    call('Reject unassigned task owner', 'POST', base + '/work', {**invalid, 'id': str(uuid.uuid4()), 'dueDate': None, 'ownerId': str(uuid.uuid4())}, expected=422)
    call('Reject unsupported hypothesis promotion', 'POST', base + f'/work/{hypothesis["id"]}/revise', revise(hypothesis, status='Supported'), expected=422)
    call('Record blocked next action', 'POST', base + f'/work/{task["id"]}/revise', revise(task, status='Blocked', reason='A dated transfer record has not been supplied.'))
    call('Preserve note correction as a revision', 'POST', base + f'/work/{note["id"]}/revise', revise(note, body=note['body'] + '\nThe register predates the declaration; record a gap instead of assuming misconduct.'))
    call('Reject stale note edit', 'POST', base + f'/work/{note["id"]}/revise', revise(note, body='A stale overwrite must fail.'), expected=409)
    call('Acknowledge assigned handover', 'POST', base + f'/work/{handover["id"]}/revise', revise(handover, status='Acknowledged', reason='Fictional recipient reviewed the outstanding checks.'))
    history = call('Read original and revised note history', 'GET', base + f'/work/{note["id"]}/history')
    assert [record['version'] for record in history] == [2, 1]
    assert history[1]['item']['body'] == note['body']
    draft = call('Export source-verified internal draft', 'GET', base + '/report')
    assert len(draft['findings']) == 2
    raw = json.dumps(draft, ensure_ascii=False, indent=2).encode()
    verified = verify(raw, hashlib.sha256(raw).hexdigest())
    results.append({'name': 'Verify draft independently without API access', 'passed': verified['originals'] == 2})
    damaged = json.loads(raw)
    damaged['findings'][0]['source']['contentBase64'] = base64.b64encode(b'Altered fictional source').decode()
    try:
        verify(json.dumps(damaged).encode())
    except ValueError:
        results.append({'name': 'Offline verifier rejects altered source', 'passed': True})
    else:
        raise AssertionError('Offline verifier accepted altered source')
    refreshed = call('Reload saved workspace', 'GET', '/workspace')
    assert len([w for w in refreshed['workItems'] if w['caseId'] == case_id]) == 6
    assert next(w for w in refreshed['workItems'] if w['id'] == task['id'])['status'] == 'Blocked'
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'draft.json').write_bytes(raw)
    (args.output / 'draft.sha256').write_text(verified['sha256'] + '\n')
    receipt = {'schema': 'inveos.casework.http-evaluation.v1', 'data': 'explicitly_fictional',
               'caseId': case_id, 'caseRef': case['ref'], 'results': results, 'report': verified}
    (args.output / 'results.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2))
    print(json.dumps({'checks': len(results), 'passed': sum(r['passed'] for r in results),
        'caseRef': case['ref'], 'artifacts': str(args.output), 'report_sha256': verified['sha256']}, indent=2))


if __name__ == '__main__':
    main()
