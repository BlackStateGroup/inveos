"""Fictional package fixtures; these are not substituted for API/DB evidence."""
import base64
import copy
import hashlib
import io
import json
from pathlib import Path
import stat
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

from test_report_verifier import fixture, encode
from tools.report_package import (InvalidReport, MANIFEST_PATH, REPORT_PATH, build_package,
                                  verify_package, canonical_json, publish_new)

STAMP = '2026-10-27T10:00:00Z'


def unpack(raw):
    # Test-side decoding uses public ZIP/JSON contracts, not production readers.
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        return {entry.filename: archive.read(entry) for entry in archive.infolist()}


def repack(members, compression=zipfile.ZIP_STORED):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=compression) as archive:
        for path, data in members.items():
            archive.writestr(path, data)
    return buffer.getvalue()


def manifest_hash(raw):
    return hashlib.sha256(unpack(raw)[MANIFEST_PATH]).hexdigest()


class ReportPackageTests(unittest.TestCase):
    def setUp(self):
        self.report = fixture()
        self.report_raw = encode(self.report)
        self.package = build_package(self.report_raw, STAMP)

    def test_exact_originals_manifest_citations_and_reproducibility(self):
        self.assertEqual(self.package, build_package(self.report_raw, STAMP))
        members = unpack(self.package)
        manifest = json.loads(members[MANIFEST_PATH])
        self.assertEqual(set(members), {MANIFEST_PATH, REPORT_PATH, 'exhibits/EXH-0001.bin'})
        self.assertEqual(members[REPORT_PATH], self.report_raw)
        self.assertEqual(members['exhibits/EXH-0001.bin'], base64.b64decode(self.report['findings'][0]['source']['contentBase64']))
        self.assertEqual(manifest['schemaVersion'], 'inveos.internal-exhibit-package.v1')
        self.assertEqual(manifest['status'], 'draft_not_released')
        self.assertEqual(manifest['exportedAt'], STAMP)
        self.assertEqual(manifest['exhibits'][0]['sourceTime'], '2026-10-25T09:00:00Z')
        self.assertEqual(manifest['exhibits'][0]['receivedTime'], '2026-10-26T09:00:00Z')
        for item in manifest['files']:
            self.assertEqual(item['byteLength'], len(members[item['path']]))
            self.assertEqual(item['sha256'], hashlib.sha256(members[item['path']]).hexdigest())
        citation = manifest['citations'][0]
        self.assertEqual(members['exhibits/EXH-0001.bin'][citation['startByte']:citation['endByte']], citation['quote'].encode())
        self.assertIn('Custody and access event history', manifest['omissions'])
        checked = verify_package(self.package, manifest_hash(self.package), 'synthetic-case')
        self.assertTrue(checked['trustedManifestDigestMatched'])
        self.assertEqual(checked['originalsChecked'], 1)
        self.assertFalse(verify_package(self.package)['trustedManifestDigestMatched'])

    def test_repeated_quotes_deduplicate_evidence_but_not_distinct_acquisitions(self):
        another_quote = copy.deepcopy(self.report['findings'][0]); another_quote['id'] = 'f2'
        original = base64.b64decode(another_quote['source']['contentBase64'])
        start = original.index(b'Second')
        another_quote['source'].update(quote='Second', startByte=start, endByte=start + 6)
        separate_acquisition = copy.deepcopy(another_quote)
        separate_acquisition['id'] = 'f3'
        separate_acquisition['source'].update(id='e2', sourceTime='2026-10-25T10:00:00Z')
        self.report['findings'].extend([another_quote, separate_acquisition])
        raw = build_package(encode(self.report), STAMP)
        manifest = json.loads(unpack(raw)[MANIFEST_PATH])
        self.assertEqual([e['evidenceId'] for e in manifest['exhibits']], ['e1', 'e2'])
        self.assertEqual([c['exhibitId'] for c in manifest['citations']], ['EXH-0001', 'EXH-0001', 'EXH-0002'])
        self.assertEqual(verify_package(raw)['originalsChecked'], 2)

    def test_source_names_are_only_metadata(self):
        self.report['findings'][0]['source'].update(filename='../../private/évil.txt', id='../../outside')
        raw = build_package(encode(self.report), STAMP)
        members = unpack(raw)
        self.assertEqual(set(members), {MANIFEST_PATH, REPORT_PATH, 'exhibits/EXH-0001.bin'})
        self.assertEqual(json.loads(members[MANIFEST_PATH])['exhibits'][0]['filename'], '../../private/évil.txt')
        verify_package(raw)

    def test_source_tampering_is_rejected_before_packaging(self):
        self.report['findings'][0]['source']['sha256'] = '0' * 64
        with self.assertRaises(InvalidReport): build_package(encode(self.report), STAMP)

    def test_rejects_replaced_report_original_manifest_and_citation(self):
        for target in ['original', 'report', 'policy', 'citation', 'time', 'omission', 'algorithm', 'version']:
            members = unpack(self.package)
            manifest = json.loads(members[MANIFEST_PATH])
            if target == 'original': members['exhibits/EXH-0001.bin'] = b'Altered fictional source'
            elif target == 'report':
                changed = copy.deepcopy(self.report); changed['findings'][0]['text'] = 'Altered claim'
                members[REPORT_PATH] = encode(changed)
            else:
                if target == 'policy': manifest['exhibits'][0]['policy']['authorityVersion'] = 2
                elif target == 'citation': manifest['citations'][0]['endByte'] += 1
                elif target == 'time': manifest['exhibits'][0]['receivedTime'] = STAMP
                elif target == 'omission': manifest['omissions'] = []
                elif target == 'algorithm': manifest['digestAlgorithm'] = 'md5'
                else: manifest['schemaVersion'] = 'future'
                members[MANIFEST_PATH] = canonical_json(manifest)
            with self.subTest(target=target), self.assertRaises(InvalidReport): verify_package(repack(members))

    def test_complete_rewrite_requires_separate_trusted_digest(self):
        self.report['findings'][0]['text'] = 'Changed narrative and recomputed manifest'
        changed = build_package(encode(self.report), STAMP)
        self.assertEqual(verify_package(changed)['status'], 'integrity_checks_passed')
        with self.assertRaisesRegex(InvalidReport, 'Manifest digest mismatch'):
            verify_package(changed, manifest_hash(self.package))
        with self.assertRaisesRegex(InvalidReport, 'Case identity mismatch'):
            verify_package(self.package, expected_case_id='other-case')

    def test_missing_and_extra_files_fail_closed(self):
        for path in [MANIFEST_PATH, REPORT_PATH, 'exhibits/EXH-0001.bin']:
            members = unpack(self.package); del members[path]
            with self.subTest(path=path), self.assertRaises(InvalidReport): verify_package(repack(members))
        for path in ['../escape', '/absolute', 'exhibits/../escape', 'exhibits\\EXH-0002.bin',
                     'exhibits/EXH-0002.bin', 'unlisted.txt']:
            members = unpack(self.package); members[path] = b'Unlisted'
            with self.subTest(path=path), self.assertRaises(InvalidReport): verify_package(repack(members))

    def test_compressed_members_and_duplicate_names_are_rejected(self):
        with self.assertRaises(InvalidReport): verify_package(repack(unpack(self.package), zipfile.ZIP_DEFLATED))
        buffer = io.BytesIO(self.package)
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(buffer, 'a') as archive:
                archive.writestr(MANIFEST_PATH, unpack(self.package)[MANIFEST_PATH])
        with self.assertRaisesRegex(InvalidReport, 'Duplicate'): verify_package(buffer.getvalue())

    def test_links_are_rejected(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            for path, raw in unpack(self.package).items():
                entry = zipfile.ZipInfo(path)
                entry.create_system = 3
                entry.external_attr = ((stat.S_IFLNK if path.startswith('exhibits/') else stat.S_IFREG) | 0o600) << 16
                archive.writestr(entry, raw)
        with self.assertRaisesRegex(InvalidReport, 'Non-regular'): verify_package(buffer.getvalue())

    def test_bounded_directory_size_member_count_and_uncompressed_size(self):
        raw = bytearray(self.package)
        struct.pack_into('<H', raw, len(raw) - 12, 1003)  # total member count
        with self.assertRaises(InvalidReport): verify_package(bytes(raw))
        raw = bytearray(self.package)
        struct.pack_into('<I', raw, len(raw) - 10, 999999999)  # directory size
        with self.assertRaises(InvalidReport): verify_package(bytes(raw))
        raw = bytearray(self.package)
        central = raw.index(b'PK\x01\x02')
        struct.pack_into('<I', raw, central + 24, 999999999)  # expanded member size
        with self.assertRaises(InvalidReport): verify_package(bytes(raw))
        with patch('tools.report_package.MAX_PACKAGE_BYTES', 10):
            with self.assertRaises(InvalidReport): verify_package(self.package)
        with patch('tools.report_package.MAX_MANIFEST_BYTES', 10):
            with self.assertRaises(InvalidReport): build_package(self.report_raw, STAMP)

    def test_corrupt_crc_truncation_trailing_junk_and_comments(self):
        damaged = bytearray(self.package)
        index = damaged.index(b'FICTIONAL:')
        damaged[index] ^= 1
        for raw in [b'', b'not zip', bytes(damaged), self.package[:-1], self.package + b'extra', b'prefix' + self.package]:
            with self.subTest(raw=raw[:10]), self.assertRaises(InvalidReport): verify_package(raw)
        buffer = io.BytesIO(self.package)
        with zipfile.ZipFile(buffer, 'a') as archive: archive.comment = b'comment'
        with self.assertRaises(InvalidReport): verify_package(buffer.getvalue())

    def test_hidden_local_bytes_extra_fields_and_mismatched_names(self):
        raw = bytearray(self.package)
        # An unlisted payload hidden before the central directory is rejected
        # even after correcting the directory offset so ZipFile can open it.
        offset = struct.unpack_from('<I', raw, len(raw) - 6)[0]
        hidden = b'Hidden unlisted fictional material'
        raw[offset:offset] = hidden
        struct.pack_into('<I', raw, len(raw) - 6, offset + len(hidden))
        with self.assertRaises(InvalidReport): verify_package(bytes(raw))
        raw = bytearray(self.package)
        raw[30] ^= 1  # local filename disagrees with central directory
        with self.assertRaises(InvalidReport): verify_package(bytes(raw))
        raw = bytearray(self.package)
        struct.pack_into('<H', raw, 28, 1)  # unsupported local extra field
        with self.assertRaises(InvalidReport): verify_package(bytes(raw))

    def test_manifest_duplicate_keys_noncanonical_and_invalid_time(self):
        for raw in [b'{"schemaVersion":"x","schemaVersion":"y"}', b'{"x":NaN}', b'[]',
                    unpack(self.package)[MANIFEST_PATH].replace(b'\n', b'\r\n')]:
            members = unpack(self.package); members[MANIFEST_PATH] = raw
            with self.assertRaises(InvalidReport): verify_package(repack(members))
        for stamp in ['2026-02-30T00:00:00Z', '2026-10-27', '2026-10-27T00:00:00+01:00', None]:
            with self.assertRaises(InvalidReport): build_package(self.report_raw, stamp)

    def test_atomic_no_overwrite_and_private_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'export.zip'
            publish_new(path, self.package)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            with self.assertRaises(FileExistsError): publish_new(path, b'replacement')
            self.assertEqual(path.read_bytes(), self.package)
            link = Path(directory) / 'link.zip'; link.symlink_to(path)
            with self.assertRaises(FileExistsError): publish_new(link, b'replacement')
            self.assertEqual(set(Path(directory).iterdir()), {path, link})
            with patch('tools.report_package.os.link', side_effect=OSError('synthetic failure')):
                with self.assertRaises(OSError): publish_new(Path(directory) / 'failed.zip', self.package)
            self.assertEqual(set(Path(directory).iterdir()), {path, link})

    def test_standalone_cli_roundtrip_receipt_and_safe_failures(self):
        script = Path(__file__).resolve().parents[1] / 'tools/report_package.py'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); report = root / 'private-report.json'; package = root / 'internal.zip'
            report.write_bytes(self.report_raw)
            build = [sys.executable, str(script), 'build', str(report), str(package), '--exported-at', STAMP]
            result = subprocess.run(build, cwd=directory, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            receipt = json.loads(result.stdout)
            self.assertEqual(receipt['status'], 'package_created')
            verify = [sys.executable, str(script), 'verify', str(package), '--expected-manifest-sha256', receipt['manifestSha256']]
            result = subprocess.run(verify, cwd=directory, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(json.loads(result.stdout)['trustedManifestDigestMatched'])
            self.assertEqual(report.read_bytes(), self.report_raw)
            result = subprocess.run(build, cwd=directory, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertNotIn(directory, result.stderr)
            self.assertNotIn('Traceback', result.stderr)
            self.assertEqual(len(list(root.iterdir())), 2)  # verifier extracts nothing


if __name__ == '__main__': unittest.main()
