#!/usr/bin/env python3
"""Offline integrity checks for INVEOS's current internal JSON report draft.

No network, database, credentials, third-party packages or original-file writes.
Consistency is not authenticity: use an independently retained report SHA-256 to
bind report text, reviewer labels, timestamps and policy metadata to an export.
"""
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
    case = object_field(report, 'case')
    case_id = text_field(case, 'id')
    for key in ('ref', 'title', 'client', 'scope', 'jurisdiction'):
        text_field(case, key)
    if expected_case_id is not None:
        require(case_id == expected_case_id, 'Case identity mismatch')
    text_field(report, 'limitations')
    findings = report.get('findings')
    require(isinstance(findings, list) and 0 < len(findings) <= MAX_FINDINGS, 'Finding count limit')
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
    return {'status': 'integrity_checks_passed', 'reportSha256': actual,
            'trustedReportDigestMatched': expected_sha256 is not None,
            'caseId': case_id, 'findingsChecked': len(findings),
            'originalsChecked': len(evidence), 'releaseStatus': 'draft_not_released',
            'limitations': 'No signature, reviewer authentication, lawful-authority validation, custody-chain verification or factual truth check. An unanchored result establishes internal consistency only.'}


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
