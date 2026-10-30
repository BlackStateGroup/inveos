"""Validate historical Field declarations in a report; no device/actor attestation."""
import base64
from datetime import datetime
import hashlib
import json
import re


def require(ok, message):
    if not ok:
        raise ValueError(message)


def fields(value, names):
    require(isinstance(value, dict) and set(value) == set(names.split()), 'Field provenance fields differ')


def digest(value, ordered=False):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=not ordered, separators=(',', ':'), allow_nan=False).encode('utf-8')).hexdigest()


def identifier(value):
    require(isinstance(value, str) and re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', value), 'Invalid Field identity')


def stamp(value):
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})', value), 'Invalid Field time')
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


SYNC = 'deviceId deviceVersion grantId grantVersion authorityId authorityVersion caseAccessVersion'.split()
MANIFEST = 'id deviceId authorityId authorityVersion filename sourceTime capturedAt clockUncertaintySeconds method expectedSha256 byteLength kind scopeConfirmed'.split()


def sync(value):
    fields(value, ' '.join(SYNC))
    for key in ('deviceId', 'grantId', 'authorityId'):
        identifier(value[key])
    for key in ('deviceVersion', 'grantVersion', 'authorityVersion', 'caseAccessVersion'):
        require(type(value[key]) is int and value[key] > 0, 'Invalid Field authority version')
    return {k: value[k] for k in SYNC}


def verify(report, original_lengths=None):
    proofs = report.get('fieldProvenance', [])
    require(isinstance(proofs, list) and len(proofs) <= 1000, 'Invalid Field provenance list')
    sources, lengths = {}, dict(original_lengths or {})
    for finding in report.get('findings', []):
        source = finding['source']; sources[source['id']] = source
        lengths[source['id']] = len(base64.b64decode(source['contentBase64'], validate=True))
    for finding in report.get('documentFindings', []) + report.get('tikaFindings', []):
        sources[finding['source']['id']] = finding['source']
    for finding in report.get('transcriptFindings', []):
        source = finding['claim']['source']; sources[source['id']] = source
        lengths[source['id']] = len(base64.b64decode(finding['originalBase64'], validate=True))
    for finding in report.get('speechFindings', []):
        source = finding['source']; sources[source['id']] = source
        lengths[source['id']] = len(base64.b64decode(finding['claim']['context']['payload']['source']['originalBase64'], validate=True))
    seen = set()
    for proof in proofs:
        fields(proof, 'sha256 payload'); p = proof['payload']
        fields(p, 'format caseId evidenceId userId manifest manifestSha256 receivedAt originalReceivedAt acceptedAuthority captureGrant acceptance acceptanceGrant recovery interpretation')
        require(p['format'] == 'inveos.field_provenance.v1' and p['interpretation'] == 'historical_capture_and_acceptance_not_device_attestation' and digest(p) == proof['sha256'], 'Field provenance digest or format differs')
        for key in ('caseId', 'evidenceId', 'userId'):
            identifier(p[key])
        require(p['caseId'] == report['case']['id'] and p['evidenceId'] in sources and p['evidenceId'] not in seen, 'Field provenance source/case mismatch')
        seen.add(p['evidenceId']); source = sources[p['evidenceId']]; m = p['manifest']
        require(isinstance(m, dict) and set(m) in (set(MANIFEST), set(MANIFEST + ['sync'])), 'Field manifest fields differ')
        for key in ('id', 'deviceId', 'authorityId'):
            identifier(m[key])
        require(type(m['authorityVersion']) is int and m['authorityVersion'] > 0 and type(m['byteLength']) is int and 0 < m['byteLength'] <= 262144, 'Invalid Field manifest size/version')
        require(m['clockUncertaintySeconds'] is None or type(m['clockUncertaintySeconds']) is int and 0 <= m['clockUncertaintySeconds'] <= 86400, 'Invalid Field clock uncertainty')
        require(m['scopeConfirmed'] is True and m['kind'] in ('supplied_file', 'field_note') and isinstance(m['method'], str) and 5 <= len(m['method'].strip()) <= 500, 'Invalid Field capture declaration')
        stamp(m['capturedAt']); stamp(m['sourceTime'])
        ordered = {k: m[k] for k in MANIFEST}
        if 'sync' in m:
            ordered['sync'] = sync(m['sync'])
            require(all(m['sync'][k] == m[k] for k in ('deviceId', 'authorityId', 'authorityVersion')), 'Capture grant differs from original authority')
        require(digest(ordered, ordered=True) == p['manifestSha256'], 'Field manifest fingerprint differs')
        require(m['filename'] == source['filename'] and m['expectedSha256'] == source['sha256'] and m['sourceTime'] == source['sourceTime'], 'Field manifest differs from cited original')
        require(p['evidenceId'] in lengths and m['byteLength'] == lengths[p['evidenceId']], 'Field original length differs')
        require(stamp(p['originalReceivedAt']) == stamp(source['receivedTime']) <= stamp(p['receivedAt']), 'Field original/capture receipt times differ')
        fields(p['acceptedAuthority'], 'id version'); policy = source.get('policy', source)
        require(p['acceptedAuthority'] == {'id': policy['authorityId'], 'version': policy['authorityVersion']}, 'Field acceptance differs from original authority')

        def grant(value, authority):
            if authority is None:
                require(value is None, 'Unexpected Field grant'); return
            fields(value, 'authority userId state recordedAt expiresAt')
            require(sync(value['authority']) == sync(authority) and value['userId'] == p['userId'] and value['state'] == 'granted', 'Historical Field grant differs')
            require(stamp(value['recordedAt']) < stamp(value['expiresAt']), 'Invalid Field grant lifetime')

        grant(p['captureGrant'], m.get('sync'))
        a, recovery = p['acceptance'], p['recovery']
        if a is None:
            require('sync' not in m and p['acceptanceGrant'] is None and recovery is None, 'Missing versioned Field receipt')
        else:
            fields(a, 'authority recoveryId reviewerId receivedAt'); require(a['receivedAt'] == p['receivedAt'], 'Field acceptance time differs')
            grant(p['acceptanceGrant'], a['authority'])
            if a['authority'] is not None:
                require(p['acceptedAuthority'] == {'id': a['authority']['authorityId'], 'version': a['authority']['authorityVersion']}, 'Target acceptance authority differs')
                require(stamp(p['acceptanceGrant']['recordedAt']) <= stamp(p['receivedAt']) < stamp(p['acceptanceGrant']['expiresAt']), 'Acceptance outside declared grant lifetime')
            if a['recoveryId'] is None:
                require(recovery is None and a['reviewerId'] is None and a['authority'] == m.get('sync'), 'Unrecovered receipt changed authority')
            else:
                fields(recovery, 'id userId captureId manifestSha256 target recordedAt review'); review = recovery['review']; fields(review, 'id decision reviewerId recordedAt')
                for value in (recovery['id'], review['id'], review['reviewerId']): identifier(value)
                require(recovery['id'] == a['recoveryId'] and recovery['userId'] == p['userId'] and recovery['captureId'] == m['id'] and recovery['manifestSha256'] == p['manifestSha256'], 'Recovery refers to a different capture')
                require(sync(recovery['target']) == sync(a['authority']) and review['decision'] == 'approve' and review['reviewerId'] == a['reviewerId'] != p['userId'], 'Recovery approval is not independent or targets another grant')
                require(stamp(recovery['recordedAt']) <= stamp(review['recordedAt']) <= stamp(p['originalReceivedAt']), 'Recovery review chronology differs')
        if recovery is None:
            require(p['acceptedAuthority'] == {'id': m['authorityId'], 'version': m['authorityVersion']}, 'Unrecovered original authority changed')
    return len(proofs)
