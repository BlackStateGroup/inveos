#!/usr/bin/env python3
"""Offline checks for supplied transcript bytes and explicit human corrections.

A self-contained integrity check does not authenticate actors, establish source
truth, confirm audio alignment or authorise client disclosure.
"""
import argparse
import base64
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path

MAX_BYTES = 2_097_152
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
HEX = re.compile(r'^[0-9a-f]{64}$')
CORE = {'id', 'startMs', 'endMs', 'speakerLabel', 'speakerUncertain', 'text'}
CORRECTION = CORE | {'version', 'reason', 'actorId', 'actorName', 'recordedAt'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, 'Duplicate JSON key')
        result[key] = value
    return result


def decode(data):
    return json.loads(data, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON number')))


def keys(value, expected):
    require(type(value) is dict and set(value) == expected, 'Unexpected transcript record fields')


def identifier(value):
    require(type(value) is str and UUID.fullmatch(value), 'Invalid record identity')


def string(value, maximum, empty=False, controls=False):
    require(type(value) is str, 'Expected text')
    value.encode('utf-8', errors='strict')
    require(len(value.encode('utf-16-le')) // 2 <= maximum, 'Text limit exceeded')
    require(empty or bool(value.strip()), 'Empty required text')
    require(controls or not re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', value), 'Invalid text control character')


def timestamp(value, utc=False):
    string(value, 64)
    require(not utc or value.endswith('Z'), 'Expected recorded UTC timestamp')
    require(re.search(r'(Z|[+-]\d\d:\d\d)$', value), 'Timestamp requires an explicit offset')
    require(datetime.fromisoformat(value.replace('Z', '+00:00')).tzinfo is not None, 'Missing timestamp offset')


def segment(value, supplied=False):
    keys(value, CORE)
    identifier(value['id'])
    start, end = value['startMs'], value['endMs']
    # JSON has one number type; supplied 1e3 and 1000.0 mean integer 1000.
    integral = lambda number: type(number) is int or (supplied and type(number) is float and number.is_integer())
    require(integral(start) and integral(end) and 0 <= start < end <= 86_400_000,
            'Invalid declared transcript interval')
    string(value['speakerLabel'], 120)
    require(type(value['speakerUncertain']) is bool, 'Speaker uncertainty must be explicit')
    string(value['text'], 10000)


def verify_bytes(data):
    require(len(data) <= MAX_BYTES, 'Transcript export exceeds two MiB')
    package = decode(data)
    keys(package, {'format', 'payload', 'sha256'})
    require(package['format'] == 'inveos.transcript_export.v1', 'Unknown transcript export format')
    payload = package['payload']
    canonical = json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
    require(type(package['sha256']) is str and HEX.fullmatch(package['sha256']) and
            hashlib.sha256(canonical).hexdigest() == package['sha256'], 'Transcript manifest fingerprint differs')
    keys(payload, {'caseId', 'transcriptId', 'title', 'createdBy', 'registeredAt', 'source',
                   'segments', 'exportedAt', 'interpretation'})
    for key in ('caseId', 'transcriptId', 'createdBy'):
        identifier(payload[key])
    string(payload['title'], 240)
    require(len(payload['title'].strip()) >= 3, 'Transcript title is too short')
    timestamp(payload['registeredAt'], utc=True)
    timestamp(payload['exportedAt'], utc=True)
    require(payload['interpretation'] == 'unreviewed_transcript_context_not_findings', 'Transcript status was promoted')
    source = payload['source']
    keys(source, {'evidenceId', 'digest', 'authorityVersion', 'sourceTime', 'receivedTime', 'filename', 'originalBase64'})
    identifier(source['evidenceId'])
    require(type(source['authorityVersion']) is int and source['authorityVersion'] >= 1, 'Invalid authority version')
    timestamp(source['sourceTime'])
    timestamp(source['receivedTime'], utc=True)
    string(source['filename'], 128)
    require(type(source['originalBase64']) is str, 'Missing preserved source bytes')
    original = base64.b64decode(source['originalBase64'], validate=True)
    require(0 < len(original) <= 262144 and base64.b64encode(original).decode() == source['originalBase64'], 'Invalid original byte encoding or size')
    require(type(source['digest']) is str and HEX.fullmatch(source['digest']) and hashlib.sha256(original).hexdigest() == source['digest'], 'Original fingerprint differs')
    raw = decode(original.decode('utf-8-sig'))
    keys(raw, {'format', 'segments'})
    require(raw['format'] == 'inveos.supplied_transcript.v1', 'Unknown supplied source format')
    require(type(raw['segments']) is list and 1 <= len(raw['segments']) <= 100, 'Invalid segment count')
    require(type(payload['segments']) is list and len(payload['segments']) == len(raw['segments']), 'Raw segment count differs')
    seen, corrections, total = set(), 0, 0
    for supplied, item in zip(raw['segments'], payload['segments']):
        segment(supplied, supplied=True)
        require(supplied['id'] not in seen, 'Duplicate source segment identity')
        seen.add(supplied['id'])
        keys(item, {'raw', 'corrections', 'current'})
        segment(item['raw'])
        require(item['raw'] == supplied, 'Raw segment differs from preserved source')
        require(type(item['corrections']) is list and len(item['corrections']) <= 100, 'Correction history limit exceeded')
        expected, ids = dict(supplied), set()
        for version, edit in enumerate(item['corrections'], 1):
            keys(edit, CORRECTION)
            segment({key: edit[key] for key in CORE})
            require(type(edit['version']) is int and edit['version'] == version, 'Correction history is not contiguous')
            require(edit['id'] not in ids, 'Duplicate correction request identity')
            ids.add(edit['id'])
            identifier(edit['actorId'])
            string(edit['actorName'], 1500000, empty=True, controls=True)
            string(edit['reason'], 3000)
            require(len(edit['reason'].strip()) >= 10, 'Correction reason is too short')
            timestamp(edit['recordedAt'], utc=True)
            expected = {key: edit[key] for key in CORE}
            expected['id'] = supplied['id']
            corrections += 1
        segment(item['current'])
        require(item['current'] == expected, 'Current transcript does not match the retained correction history')
        total += len(item['current']['text'].encode('utf-8'))
    require(total <= 262144, 'Corrected transcript exceeds the text byte limit')
    return {'verified': True, 'sourceSha256': source['digest'], 'segments': len(seen),
            'corrections': corrections, 'interpretation': payload['interpretation'],
            'audioAlignmentVerified': False, 'actorAuthenticityVerified': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', type=Path)
    args = parser.parse_args()
    try:
        with args.package.open('rb') as handle:
            result = verify_bytes(handle.read(MAX_BYTES + 1))
    except (ValueError, OSError, UnicodeError, RecursionError) as error:
        parser.exit(1, 'Verification failed: ' + str(error) + '\n')
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
