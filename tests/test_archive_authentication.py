"""Fictional OpenPGP/index adversarial checks, not Debian or parser benchmarks."""
import hashlib
from datetime import datetime, timezone
import lzma
import io
import urllib.error
from unittest.mock import Mock
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tools import ocr_archive_authentication as auth


class ArchiveAuthenticationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='inveos-fictional-signature-')
        cls.home = Path(cls.temporary.name)
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.addClassCleanup(lambda: auth.command(['gpgconf', '--homedir', str(cls.home), '--kill', 'gpg-agent']))
        cls.prefix = ['gpg', '--batch', '--no-options', '--homedir', str(cls.home), '--pinentry-mode', 'loopback', '--passphrase', '']
        auth.command(cls.prefix + ['--quick-generate-key', 'INVEOS fictional signature fixture <signature@example.invalid>', 'rsa2048', 'sign', '0'])
        listed = auth.command(cls.prefix + ['--with-colons', '--list-keys'])
        cls.fingerprint = next(line.split(':')[9] for line in listed.splitlines() if line.startswith('fpr:'))
        cls.public = auth.command(cls.prefix + ['--armor', '--export', cls.fingerprint]).encode()
        cls.text = b'Origin: INVEOS fictional fixture\nCodename: fictional\nSHA256:\n ' + b'a' * 64 + b' 123 main/fictional.xz\n'
        source, target = cls.home / 'fictional.txt', cls.home / 'fictional.asc'
        source.write_bytes(cls.text)
        auth.command(cls.prefix + ['--digest-algo', 'SHA256', '--local-user', cls.fingerprint, '--output', str(target), '--clearsign', str(source)])
        cls.signed = target.read_bytes()

    def test_actual_signature_requires_expected_key_and_unchanged_content(self):
        for data, expected, success in [(self.signed, self.fingerprint, True),
                (self.signed.replace(b'Codename: fictional', b'Codename: tampered'), self.fingerprint, False),
                (self.signed, 'F' * 40, False), (self.text, self.fingerprint, False)]:
            with tempfile.TemporaryDirectory() as directory:
                home = Path(directory)
                ring = auth.keyring(self.public, self.fingerprint, home, 1)
                if success:
                    fields, signatures = auth.signed_release(data, [ring], [expected], home)
                    self.assertEqual(fields['origin'], 'INVEOS fictional fixture')
                    self.assertEqual(signatures[0]['primaryFingerprint'], expected)
                    self.assertEqual(auth.checksum_table(fields['sha256'])['main/fictional.xz'], ('a' * 64, 123))
                else:
                    with self.assertRaises(ValueError):
                        auth.signed_release(data, [ring], [expected], home)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'fingerprint'):
                auth.keyring(self.public, 'F' * 40, Path(directory), 1)

    def test_public_key_transport_retry_stays_bounded_and_does_not_retry_bad_content(self):
        data = b'Fictional public metadata.'
        opener = Mock()
        opener.open.side_effect = [urllib.error.URLError('fictional timeout'), io.BytesIO(data)]
        with patch.object(auth.urllib.request, 'build_opener', return_value=opener), patch.object(auth.time, 'sleep') as sleep:
            self.assertEqual(auth.fetch_public_key('https://ftp-master.debian.org/keys/fictional.asc', len(data)), data)
            self.assertEqual(opener.open.call_count, 2)
            sleep.assert_called_once_with(1)
        opener.open.reset_mock(side_effect=True)
        opener.open.side_effect = urllib.error.URLError('fictional persistent timeout')
        with patch.object(auth.urllib.request, 'build_opener', return_value=opener), patch.object(auth.time, 'sleep'):
            with self.assertRaises(urllib.error.URLError):
                auth.fetch_public_key('https://ftp-master.debian.org/keys/fictional.asc', len(data))
            self.assertEqual(opener.open.call_count, 3)
        opener.open.reset_mock(side_effect=True)
        opener.open.return_value = io.BytesIO(data + b'overflow')
        with patch.object(auth.urllib.request, 'build_opener', return_value=opener):
            with self.assertRaisesRegex(ValueError, 'byte limit'):
                auth.fetch_public_key('https://ftp-master.debian.org/keys/fictional.asc', len(data))
            self.assertEqual(opener.open.call_count, 1)

    def test_publication_scope_and_validity_are_bound_to_retained_snapshot(self):
        snapshot = datetime(2026, 10, 28, tzinfo=timezone.utc)
        fields = {'origin': 'Debian', 'codename': 'bookworm', 'date': 'Tue, 27 Oct 2026 20:00:00 UTC',
                  'valid-until': 'Tue, 03 Nov 2026 20:00:00 UTC'}
        signatures = [{'signedAt': int(snapshot.timestamp()) - 100}]
        self.assertEqual(auth.validate_publication(fields, signatures, 'bookworm', snapshot), fields['valid-until'])
        stable = {key: value for key, value in fields.items() if key != 'valid-until'}
        self.assertIsNone(auth.validate_publication(stable, signatures, 'bookworm', snapshot))
        for key, value in [('origin', 'Fictional other publisher'), ('codename', 'different-suite'),
                ('date', 'Thu, 29 Oct 2026 20:00:00 UTC'), ('date', 'Tue, 27 Oct 2026 20:00:00'),
                ('valid-until', 'Tue, 27 Oct 2026 23:00:00 UTC'), ('valid-until', 'Tue, 03 Nov 2026 20:00:00')]:
            with self.assertRaises(ValueError):
                auth.validate_publication({**fields, key: value}, signatures, 'bookworm', snapshot)
        with self.assertRaisesRegex(ValueError, 'postdates'):
            auth.validate_publication(fields, [{'signedAt': int(snapshot.timestamp()) + 1}], 'bookworm', snapshot)

    def test_missing_or_changed_cached_artifacts_fail_without_network(self):
        data = b'Fictional publication artifact.'
        record = {'bytes': len(data), 'sha256': auth.sha(data), 'snapshotSha1': hashlib.sha1(data).hexdigest()}
        with tempfile.TemporaryDirectory() as directory, patch.object(auth.binary, 'download', side_effect=AssertionError('No network')):
            cache = Path(directory)
            with self.assertRaisesRegex(ValueError, 'Missing authentication artifact'):
                auth.artifact(record, cache=cache)
            path = cache / record['sha256']
            path.write_bytes(data)
            self.assertEqual(auth.artifact(record, cache=cache), data)
            path.write_bytes(b'X' + data[1:])
            with self.assertRaisesRegex(ValueError, 'fingerprint'):
                auth.artifact(record, cache=cache)

    def test_cache_symlinks_never_read_or_write_outside_the_cache(self):
        data = b'Fictional bounded bytes'
        record = {'bytes': len(data), 'sha256': auth.sha(data), 'snapshotSha1': hashlib.sha1(data).hexdigest()}
        with tempfile.TemporaryDirectory() as directory, patch.object(auth.binary, 'download', side_effect=AssertionError('No download through a link')):
            root = Path(directory)
            outside = root / 'outside'
            outside.mkdir()
            cache = root / 'cache'
            cache.symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, 'Symlinked'):
                auth.artifact(record, cache=cache / 'nested', offline=False)
            self.assertEqual(list(outside.iterdir()), [])
            cache.unlink()
            cache.mkdir()
            (cache / record['sha256']).symlink_to(outside / 'missing')
            with self.assertRaisesRegex(ValueError, 'Symlinked'):
                auth.artifact(record, cache=cache, offline=False)
            self.assertEqual(list(outside.iterdir()), [])

    def test_binary_index_binds_exact_bytes_size_architecture_and_source_version(self):
        row = b'Package: fictional\nVersion: 1.0\nArchitecture: amd64\nSize: 12\nSHA256: ' + b'a' * 64 + b'\nSource: fictional-source (1.0)\n'
        wanted = {('fictional', '1.0', 'amd64'): {'bytes': 12, 'sha256': 'a' * 64, 'source': 'fictional-source (1.0)'}}
        found = {}
        auth.match_index(lzma.compress(row), 'binary', wanted, {}, {'suite': 'fictional'}, found, {})
        self.assertEqual(set(found), set(wanted))
        for old, new in [(b'Size: 12', b'Size: 13'), (b'a' * 64, b'b' * 64), (b'fictional-source (1.0)', b'fictional-source (2.0)')]:
            with self.assertRaisesRegex(ValueError, 'Published binary'):
                auth.match_index(lzma.compress(row.replace(old, new)), 'binary', wanted, {}, {}, {}, {})
        found = {}
        auth.match_index(lzma.compress(row.replace(b'amd64', b'arm64')), 'binary', wanted, {}, {}, found, {})
        self.assertEqual(found, {})

    def test_source_index_requires_the_whole_locked_component_set(self):
        row = b'Package: fictional\nVersion: 1\nChecksums-Sha256:\n ' + b'a' * 64 + b' 12 fictional.dsc\n ' + b'b' * 64 + b' 23 fictional.tar.xz\n'
        wanted = {('fictional', '1'): {'descriptor': {'name': 'fictional.dsc', 'bytes': 12, 'sha256': 'a' * 64}, 'files': [{'name': 'fictional.tar.xz', 'bytes': 23, 'sha256': 'b' * 64}]}}
        found = {}
        auth.match_index(lzma.compress(row), 'source', {}, wanted, {}, {}, found)
        self.assertEqual(set(found), set(wanted))
        for changed in [row.replace(b'23 fictional', b'24 fictional'), row.replace(b'b' * 64, b'c' * 64), row + b' ' + b'c' * 64 + b' 9 extra.tar.xz\n', row.split(b' ' + b'b' * 64)[0]]:
            with self.assertRaisesRegex(ValueError, 'Published source'):
                auth.match_index(lzma.compress(changed), 'source', {}, wanted, {}, {}, {})

    def test_compressed_indexes_reject_trailing_truncation_and_expansion_overflow(self):
        data = lzma.compress(b'Package: fictional\nVersion: 1\n')
        self.assertEqual(len(list(auth.index_records(data))), 1)
        for changed in [data + b'trailing', data[:-8], data + data]:
            with self.assertRaises((ValueError, lzma.LZMAError)):
                list(auth.index_records(changed))
        with patch.object(auth, 'MAX_EXPANDED', 10), self.assertRaisesRegex(ValueError, 'Expanded index'):
            list(auth.index_records(data))

    def test_checksum_tables_reject_duplicates_and_unsafe_paths(self):
        line = 'a' * 64 + ' 12 main/fictional.xz'
        for value in ['', line + '\n' + line, line.replace('main/', '../'), line.replace('main/', '/absolute/'), line.replace('12 ', '-1 '), 'invalid']:
            with self.assertRaises(ValueError):
                auth.checksum_table(value)


if __name__ == '__main__':
    unittest.main()
