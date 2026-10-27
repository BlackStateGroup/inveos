#!/usr/bin/env python3
"""Offline integrity checks for an internal INVEOS UTF-8 JSON report draft.

This checks supplied bytes and source spans. It cannot establish authenticity,
truth, lawful collection, reviewer identity or release approval. A trusted
fingerprint must arrive independently to detect replacement of the whole draft.
"""
from __future__ import annotations

import argparse
import base64
import binascii
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import sys
import uuid


def _text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'{label}: expected non-empty text')
    return value


def _identifier(value, label):
    try:
        uuid.UUID(value)
    except (ValueError, TypeError, AttributeError):
        raise ValueError(f'{label}: invalid identifier') from None


def _timestamp(value, label):
    _text(value, label)
    try:
        timestamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if timestamp.tzinfo is None:
            raise ValueError()
    except ValueError:
        raise ValueError(f'{label}: expected timestamp with timezone') from None


def _unique_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f'Duplicate JSON property: {key}')
        result[key] = value
    return result


def verify(raw: bytes, expected_sha256: str | None = None) -> dict:
    if len(raw) > 32 * 1024 * 1024:
        raise ValueError('Draft exceeds the 32 MiB verifier input limit')
    report_digest = hashlib.sha256(raw).hexdigest()
    if expected_sha256 is not None:
        if not re.fullmatch('[a-fA-F0-9]{64}', expected_sha256) or report_digest != expected_sha256.lower():
            raise ValueError('Draft does not match the supplied trusted SHA-256')
    try:
        report = json.loads(raw, object_pairs_hook=_unique_keys)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ValueError('Invalid UTF-8 JSON draft') from error
    if not isinstance(report, dict) or report.get('status') != 'draft_not_released':
        raise ValueError('Expected a persistent-lab internal draft; no release is certified')
    case = report.get('case')
    if not isinstance(case, dict):
        raise ValueError('Missing case record')
    _identifier(case.get('id'), 'Case')
    for key in ('ref', 'title', 'client', 'scope', 'jurisdiction'):
        _text(case.get(key), f'Case {key}')
    findings = report.get('findings')
    if not isinstance(findings, list) or not findings:
        raise ValueError('Draft requires reviewed findings')
    originals, finding_ids = {}, set()
    for index, finding in enumerate(findings, 1):
        label = f'Finding {index}'
        if not isinstance(finding, dict):
            raise ValueError(f'{label}: invalid finding')
        _identifier(finding.get('id'), label)
        if finding['id'] in finding_ids:
            raise ValueError(f'{label}: duplicate finding identity')
        finding_ids.add(finding['id'])
        _text(finding.get('text'), label)
        _text(finding.get('reviewer'), f'{label} reviewer')
        _timestamp(finding.get('reviewedAt'), f'{label} review time')
        source = finding.get('source')
        if not isinstance(source, dict):
            raise ValueError(f'{label}: missing cited original')
        _identifier(source.get('id'), f'{label} source')
        _text(source.get('filename'), f'{label} filename')
        digest = source.get('sha256')
        if not isinstance(digest, str) or not re.fullmatch('[a-f0-9]{64}', digest):
            raise ValueError(f'{label}: invalid source digest')
        try:
            content = base64.b64decode(source['contentBase64'], validate=True)
            content.decode('utf-8', errors='strict')
        except (KeyError, TypeError, ValueError, binascii.Error, UnicodeError):
            raise ValueError(f'{label}: invalid original byte encoding') from None
        if not content or hashlib.sha256(content).hexdigest() != digest:
            raise ValueError(f'{label}: cited original digest mismatch')
        start, end = source.get('startByte'), source.get('endByte')
        if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(content):
            raise ValueError(f'{label}: citation byte range is invalid')
        quote = _text(source.get('quote'), f'{label} quote')
        if content[start:end] != quote.encode('utf-8'):
            raise ValueError(f'{label}: quoted passage does not match the original span')
        for key in ('sourceTime', 'receivedTime'):
            _timestamp(source.get(key), f'{label} {key}')
        policy = source.get('policy')
        if not isinstance(policy, dict):
            raise ValueError(f'{label}: missing authority snapshot')
        _identifier(policy.get('authorityId'), f'{label} authority')
        if type(policy.get('authorityVersion')) is not int or policy['authorityVersion'] < 1:
            raise ValueError(f'{label}: invalid authority version')
        if type(policy.get('retentionDays')) is not int or not 1 <= policy['retentionDays'] <= 3650:
            raise ValueError(f'{label}: invalid recorded retention decision')
        for key in ('purpose', 'lawfulBasis', 'scope', 'minimisation'):
            _text(policy.get(key), f'{label} authority {key}')
        identity = (digest, source['filename'], source['sourceTime'], source['receivedTime'], json.dumps(policy, sort_keys=True))
        if source['id'] in originals and originals[source['id']] != identity:
            raise ValueError(f'{label}: conflicting identity for the same original')
        originals[source['id']] = identity
    return {'status': 'internal_draft_integrity_checked', 'sha256': report_digest,
            'findings': len(findings), 'originals': len(originals),
            'trusted_fingerprint_checked': expected_sha256 is not None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('draft', type=Path)
    parser.add_argument('--expected-sha256', help='Fingerprint received through an independently trusted channel')
    args = parser.parse_args()
    try:
        with args.draft.open('rb') as source:
            raw = source.read(32 * 1024 * 1024 + 1)
        result = verify(raw, args.expected_sha256)
    except (OSError, ValueError, RecursionError) as error:
        print(f'VERIFICATION FAILED: {error}', file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    print('Integrity only: this internal draft does not certify authenticity, truth, legal compliance or client release.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
