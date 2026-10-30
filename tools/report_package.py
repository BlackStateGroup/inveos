#!/usr/bin/env python3
"""Build or verify a bounded internal INVEOS exhibit ZIP, entirely offline.

Use trusted copies of this script and verify_report.py. Never execute code from
an untrusted export. No extraction, network, database or third-party packages.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import struct
import sys
import tempfile
import zipfile

if __package__:
    from .verify_report import (InvalidReport, MAX_REPORT_BYTES, unique_object,
                                reject_constant, require, verify_report)
else:
    from verify_report import (InvalidReport, MAX_REPORT_BYTES, unique_object,
                               reject_constant, require, verify_report)

SCHEMA = 'inveos.internal-exhibit-package.v1'
TRANSCRIPT_SCHEMA = 'inveos.internal-exhibit-package.v2'
MAX_PACKAGE_BYTES = 64 * 1024 * 1024
MAX_MANIFEST_BYTES = 4 * 1024 * 1024
MAX_ENTRIES = 1002  # report, manifest and up to 1,000 distinct cited originals
MAX_DIRECTORY_BYTES = 256 * 1024
REPORT_PATH = 'report/draft.json'
MANIFEST_PATH = 'manifest.json'
OMISSIONS = ['Full case inventory and uncited evidence', 'Custody and access event history',
             'Derivatives, PDF/DOCX renditions and redactions',
             'Digital signatures and external ledger anchors', 'Client release approval']
LIMITATIONS = ('Internal synthetic-lab draft only. Hashes establish byte consistency, not '
              'authenticity, factual truth, reviewer identity, lawful authority or admissibility. '
              'Keep a manifest digest separately in a trusted record. No custody history or '
              'client release is represented.')


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical_json(value):
    # ASCII escaping gives a single cross-platform representation, even for
    # filenames or quoted text. Original and report bytes are never re-encoded.
    return (json.dumps(value, sort_keys=True, ensure_ascii=True, indent=2,
                       allow_nan=False) + '\n').encode('ascii')


def load_json(raw):
    try:
        return json.loads(raw.decode('utf-8'), object_pairs_hook=unique_object,
                          parse_constant=reject_constant)
    except (UnicodeError, ValueError, RecursionError) as exc:
        raise InvalidReport('Malformed package JSON') from exc


def export_time(value):
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', value),
            'Invalid export timestamp')
    try:
        datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ')
    except ValueError as exc:
        raise InvalidReport('Invalid export timestamp') from exc
    return value


def package_payloads(report_raw, exported_at):
    """Validate first; derive a deterministic package without mutating originals."""
    checked = verify_report(report_raw)
    report = load_json(report_raw)
    exported_at = export_time(exported_at)
    sources = {finding['source']['id']: finding['source'] for finding in report['findings']}
    transcripts = report.get('transcriptFindings', [])
    for finding in transcripts:
        source = {**finding['claim']['source'], 'contentBase64': finding['originalBase64']}
        sources[source['id']] = source
    payloads = {REPORT_PATH: report_raw}
    exhibits, exhibit_ids = [], {}
    for number, evidence_id in enumerate(sorted(sources), 1):
        source = sources[evidence_id]
        exhibit_id = f'EXH-{number:04d}'
        path = f'exhibits/{exhibit_id}.bin'
        original = base64.b64decode(source['contentBase64'], validate=True)
        payloads[path] = original
        exhibit_ids[evidence_id] = exhibit_id
        exhibits.append({
            'exhibitId': exhibit_id, 'evidenceId': evidence_id, 'path': path,
            'representation': 'original_utf8', 'byteLength': len(original),
            **{key: source[key] for key in ('filename', 'sha256', 'sourceTime', 'receivedTime', 'policy')},
        })
    citations = [{
        'findingId': finding['id'], 'exhibitId': exhibit_ids[finding['source']['id']],
        'kind': 'original_utf8', **{key: finding['source'][key] for key in ('startByte', 'endByte', 'quote')},
    } for finding in report['findings']]
    citations.extend({'findingId': finding['id'], 'exhibitId': exhibit_ids[finding['claim']['source']['id']],
                      'kind': 'selected_transcript_utf8_not_original_media',
                      'transcriptId': finding['claim']['transcript']['id'],
                      'segmentId': finding['claim']['transcript']['segmentId'],
                      'sourcePointer': finding['claim']['transcript']['sourcePointer'],
                      'version': finding['claim']['transcript']['version'],
                      **{key: finding['claim']['reference'][key] for key in ('startByte', 'endByte', 'quote', 'startMs', 'endMs', 'speakerLabel', 'speakerUncertain')}}
                     for finding in transcripts)
    manifest = {
        'schemaVersion': TRANSCRIPT_SCHEMA if transcripts else SCHEMA, 'digestAlgorithm': 'sha256',
        'status': 'draft_not_released', 'caseId': checked['caseId'],
        'exportedAt': exported_at, 'reportPath': REPORT_PATH,
        'reportFormat': 'inveos.internal-report.transcript-v1' if transcripts else 'inveos.internal-report.legacy-utf8',
        'exhibits': exhibits, 'citations': citations,
        'files': [{'path': path, 'byteLength': len(raw), 'sha256': sha256(raw)}
                  for path, raw in sorted(payloads.items())],
        'omissions': OMISSIONS, 'limitations': LIMITATIONS,
    }
    manifest_raw = canonical_json(manifest)
    require(len(manifest_raw) <= MAX_MANIFEST_BYTES, 'Manifest size limit')
    payloads[MANIFEST_PATH] = manifest_raw
    # Leave space for bounded local/central ZIP metadata.
    require(sum(map(len, payloads.values())) <= MAX_PACKAGE_BYTES - MAX_DIRECTORY_BYTES * 2,
            'Package size limit')
    return payloads


def build_package(report_raw, exported_at):
    payloads = package_payloads(report_raw, exported_at)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_STORED, allowZip64=False) as archive:
        for path, raw in sorted(payloads.items()):
            entry = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = (stat.S_IFREG | 0o600) << 16
            archive.writestr(entry, raw)
    result = buffer.getvalue()
    require(len(result) <= MAX_PACKAGE_BYTES, 'Package size limit')
    return result


def bounded_members(raw):
    """Reject compressed, ambiguous or oversized archives without extracting."""
    require(22 <= len(raw) <= MAX_PACKAGE_BYTES, 'Package size limit')
    # Preflight the fixed EOCD before ZipFile allocates its member list. This
    # v1 format deliberately excludes comments, ZIP64, spanning and prefixes.
    try:
        signature, disk, start_disk, disk_count, count, directory_size, offset, comment_size = struct.unpack(
            '<4s4H2IH', raw[-22:])
    except struct.error as exc:
        raise InvalidReport('Malformed ZIP directory') from exc
    require(signature == b'PK\x05\x06' and disk == start_disk == comment_size == 0,
            'Unsupported ZIP directory')
    require(disk_count == count and 2 <= count <= MAX_ENTRIES, 'Archive member count limit')
    require(0 < directory_size <= MAX_DIRECTORY_BYTES and offset + directory_size == len(raw) - 22,
            'Archive directory size limit')
    require(raw[:4] == b'PK\x03\x04' and raw[offset:offset + 4] == b'PK\x01\x02',
            'Unsupported ZIP layout')
    try:
        with zipfile.ZipFile(io.BytesIO(raw), 'r') as archive:
            entries = archive.infolist()
            require(len(entries) == count, 'Archive member count mismatch')
            result, total = {}, 0
            cursor = 0
            for entry in sorted(entries, key=lambda item: item.header_offset):
                require(entry.header_offset == cursor and cursor + 30 <= offset, 'Unexpected local ZIP layout')
                header = struct.unpack('<4s5H3I2H', raw[cursor:cursor + 30])
                require(header[0] == b'PK\x03\x04' and header[2] == 0 and header[3] == 0
                        and header[6] == entry.CRC and header[7] == entry.compress_size
                        and header[8] == entry.file_size and header[10] == 0,
                        'Inconsistent local ZIP header')
                name_start = cursor + 30
                cursor = name_start + header[9] + entry.file_size
                require(cursor <= offset, 'Overlapping ZIP members')
                require(raw[name_start:name_start + header[9]] == entry.filename.encode('ascii'),
                        'Inconsistent local ZIP filename')
                path = entry.filename
                require(path not in result, 'Duplicate archive member')
                require(entry.orig_filename == path and (path in (MANIFEST_PATH, REPORT_PATH)
                        or re.fullmatch(r'exhibits/EXH-\d{4}\.bin', path)), 'Unexpected archive path')
                require(entry.compress_type == zipfile.ZIP_STORED and entry.flag_bits == 0
                        and not entry.extra and not entry.comment, 'Unsupported archive member encoding')
                require(stat.S_IFMT(entry.external_attr >> 16) in (0, stat.S_IFREG),
                        'Non-regular archive member')
                maximum = MAX_MANIFEST_BYTES if path == MANIFEST_PATH else MAX_REPORT_BYTES
                if path.startswith('exhibits/'):
                    maximum = 2 * 1024 * 1024
                require(0 < entry.file_size <= maximum and entry.compress_size == entry.file_size,
                        'Archive member size limit')
                total += entry.file_size
                require(total <= MAX_PACKAGE_BYTES, 'Expanded archive size limit')
                with archive.open(entry) as stream:
                    data = stream.read(maximum + 1)
                require(len(data) == entry.file_size, 'Archive member length mismatch')
                result[path] = data
            require(cursor == offset, 'Unexpected bytes before ZIP directory')
            return result
    except (zipfile.BadZipFile, NotImplementedError, RuntimeError, EOFError, OSError, ValueError) as exc:
        if isinstance(exc, InvalidReport):
            raise
        raise InvalidReport('Malformed or corrupt ZIP member') from exc


def verify_package(raw, expected_manifest_sha256=None, expected_case_id=None):
    members = bounded_members(raw)
    require(MANIFEST_PATH in members and REPORT_PATH in members, 'Missing required package member')
    manifest_raw = members[MANIFEST_PATH]
    actual = sha256(manifest_raw)
    if expected_manifest_sha256 is not None:
        require(isinstance(expected_manifest_sha256, str)
                and re.fullmatch('[0-9a-f]{64}', expected_manifest_sha256), 'Invalid trusted manifest digest')
        require(actual == expected_manifest_sha256, 'Manifest digest mismatch')
    manifest = load_json(manifest_raw)
    require(isinstance(manifest, dict) and manifest.get('schemaVersion') in (SCHEMA, TRANSCRIPT_SCHEMA),
            'Unsupported manifest schema')
    checked = verify_report(members[REPORT_PATH], expected_case_id=expected_case_id)
    expected = package_payloads(members[REPORT_PATH], manifest.get('exportedAt'))
    # Exact canonical manifest equality also binds source mapping, citation
    # offsets, all original hashes, omissions and metadata to the report.
    require(manifest_raw == expected[MANIFEST_PATH], 'Manifest does not match report and exhibits')
    require(set(members) == set(expected), 'Missing or unexpected package member')
    for path, original in expected.items():
        require(members[path] == original, 'Package member content mismatch')
    return {'status': 'integrity_checks_passed', 'schemaVersion': manifest['schemaVersion'],
            'manifestSha256': actual, 'packageSha256': sha256(raw),
            'trustedManifestDigestMatched': expected_manifest_sha256 is not None,
            'caseId': checked['caseId'], 'findingsChecked': checked['findingsChecked'],
            'originalsChecked': checked['originalsChecked'],
            'releaseStatus': 'draft_not_released', 'limitations': LIMITATIONS}


def read_bounded(path, maximum):
    with path.open('rb') as handle:
        raw = handle.read(maximum + 1)
    require(len(raw) <= maximum, 'Input size limit')
    return raw


def publish_new(path, raw):
    """Complete private file, then atomic no-clobber install on same filesystem."""
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.inveos-export-', delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        # Hard-link creation fails atomically if destination exists, including
        # a symlink. No partial final file and no original can be overwritten.
        os.link(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    build = commands.add_parser('build', help='Package a verified internal JSON draft')
    build.add_argument('report', type=Path)
    build.add_argument('output', type=Path)
    build.add_argument('--exported-at', help='UTC YYYY-MM-DDTHH:MM:SSZ; default is current UTC')
    build.add_argument('--expected-report-sha256')
    build.add_argument('--expected-case-id')
    verify = commands.add_parser('verify', help='Check package without extracting or running its contents')
    verify.add_argument('package', type=Path)
    verify.add_argument('--expected-manifest-sha256')
    verify.add_argument('--expected-case-id')
    args = parser.parse_args(argv)
    try:
        if args.command == 'build':
            raw = read_bounded(args.report, MAX_REPORT_BYTES)
            verify_report(raw, args.expected_report_sha256, args.expected_case_id)
            timestamp = args.exported_at or datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
            packaged = build_package(raw, timestamp)
            result = verify_package(packaged, expected_case_id=args.expected_case_id)
            publish_new(args.output, packaged)
            result['status'] = 'package_created'
            result['instruction'] = 'Retain manifestSha256 separately in a trusted record before distributing this internal draft.'
        else:
            result = verify_package(read_bounded(args.package, MAX_PACKAGE_BYTES),
                                    args.expected_manifest_sha256, args.expected_case_id)
    except (InvalidReport, OSError) as exc:
        message = str(exc) if isinstance(exc, InvalidReport) else 'Cannot read input or create new output'
        print(json.dumps({'status': 'package_operation_failed', 'error': message}), file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
