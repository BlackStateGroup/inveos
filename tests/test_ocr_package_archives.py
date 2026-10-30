import gzip
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import hashlib
import io
import json
import lzma
from pathlib import Path
import sys
import tarfile
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
import ocr_package_archives as archives


def tar(entries):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w') as output:
        for name, content in entries:
            member = tarfile.TarInfo(name)
            if isinstance(content, str):
                member.type = tarfile.SYMTYPE
                member.linkname = content
                output.addfile(member)
            else:
                member.size = len(content)
                output.addfile(member, io.BytesIO(content))
    return stream.getvalue()


def deb(control=None, files=None, extra=False):
    control = control or [('control', b'Package: fictional\nVersion: 1.0-1\nArchitecture: all\nSource: fictional-source (1.0)\nDepends: fictional-base\nDescription: Fictional test only\n second line\n')]
    files = files or [('usr/share/doc/fictional/copyright', b'Fictional test notice\nLicense: MIT\n')]
    result = bytearray(b'!<arch>\n')
    entries = [('debian-binary', b'2.0\n'), ('control.tar.xz', lzma.compress(tar(control))), ('data.tar.gz', gzip.compress(tar(files)))]
    if extra:
        entries.append(('data.tar', tar(files)))
    for name, value in entries:
        result.extend(f'{name:<16}{0:<12}{0:<6}{0:<6}{100644:<8}{len(value):<10}`\n'.encode())
        result.extend(value)
        if len(value) % 2:
            result.extend(b'\n')
    return bytes(result)


class PackageArchiveTests(unittest.TestCase):
    def test_changed_cached_bytes_cannot_enter_the_build_context(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = deb()
            cached = root / (archives.sha(data) + '.deb')
            destination = root / 'build'
            destination.mkdir()
            cached.write_bytes(data[:-1] + b'!')
            with self.assertRaisesRegex(ValueError, 'changed before build staging'):
                archives.stage_archives([cached], destination)
            self.assertEqual(list(destination.iterdir()), [])
            cached.write_bytes(data)
            archives.stage_archives([cached], destination)
            self.assertEqual((destination / cached.name).read_bytes(), data)

    def test_actual_slow_http_body_cannot_hide_the_download_deadline(self):
        stop = threading.Event()
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header('Content-Length', '40')
                self.end_headers()
                try:
                    for _ in range(40):
                        self.wfile.write(b'x')
                        self.wfile.flush()
                        if stop.wait(0.02):
                            break
                except (BrokenPipeError, ConnectionResetError):
                    pass
            def log_message(self, *_):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.object(archives, 'ORIGIN', 'http://127.0.0.1:' + str(server.server_port)), patch.object(archives, 'DOWNLOAD_SECONDS', 0.1):
                started = time.monotonic()
                with self.assertRaisesRegex(ValueError, 'download deadline'):
                    archives.download('/fictional-slow-body', 100)
                self.assertLess(time.monotonic() - started, 0.6, 'A buffered read waited for the entire slow body')
        finally:
            stop.set()
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_static_identity_notices_and_links_without_installation(self):
        result = archives.audit(deb(files=[('usr/share/doc/fictional/copyright', b'Fictional notice\nLicense: MIT\n'),
                                         ('usr/share/doc/alias/copyright', '/do-not-read-host')]))
        self.assertEqual((result['package'], result['version'], result['architecture']), ('fictional', '1.0-1', 'all'))
        self.assertEqual(result['source'], 'fictional-source (1.0)')
        self.assertEqual(result['notices'][0]['declaredLicences'], ['MIT'])
        self.assertEqual(result['notices'][1]['link'], '/do-not-read-host')

    def test_malformed_truncated_and_extra_archive_members_fail(self):
        valid = deb()
        for value in (b'not deb', valid[:60], valid[:-10], deb(extra=True)):
            with self.subTest(length=len(value)), self.assertRaises(ValueError):
                archives.audit(value)

    def test_tar_path_duplicate_and_control_substitution_fail(self):
        for entries in ([('../outside', b'fictional')], [('/absolute', b'fictional')],
                        [('control', b'Package: fictional\npackage: another\n')],
                        [('control', b'first'), ('./control', b'second')], [('control', '/host/control')]):
            with self.subTest(entries=entries), self.assertRaises(ValueError):
                archives.audit(deb(control=entries))
        with self.assertRaisesRegex(ValueError, 'Missing package copyright'):
            archives.audit(deb(files=[('usr/bin/fictional', b'not executed')]))

    def test_decompression_and_notice_budgets_fail_closed(self):
        with patch.object(archives, 'MAX_TAR', 100):
            for name, data in [('data.tar.gz', gzip.compress(b'x' * 101)), ('data.tar.xz', lzma.compress(b'x' * 101)), ('data.tar', b'x' * 101)]:
                with self.subTest(name=name), self.assertRaises(ValueError):
                    archives.unpack(name, data)
        with self.assertRaisesRegex(ValueError, 'Control/notice byte limit'):
            archives.audit(deb(files=[('usr/share/doc/fictional/copyright', b'x' * (2 * 1024 * 1024 + 1))]))

    def test_package_version_architecture_and_duplicate_fields_rejected(self):
        result = archives.audit(deb())
        archives.check_identity(result, 'fictional', {'version': '1.0-1', 'architecture': 'all'})
        for package, version, architecture in [('other', '1.0-1', 'all'), ('fictional', '2', 'all'), ('fictional', '1.0-1', 'amd64')]:
            with self.assertRaisesRegex(ValueError, 'package/version/architecture mismatch'):
                archives.check_identity(result, package, {'version': version, 'architecture': architecture})
        with self.assertRaises(ValueError):
            archives.control_fields(b'Package: one\nPACKAGE: two\n')

    def test_offline_replay_corruption_missing_closure_and_metadata_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = deb()
            record = {'installedName': 'fictional', 'bytes': len(data), 'sha256': archives.sha(data),
                      'snapshotSha1': hashlib.sha1(data).hexdigest(), **archives.audit(data)}
            inventory = root / 'inventory.json'
            inventory.write_text(json.dumps({'packages': {'fictional': {'version': '1.0-1', 'architecture': 'all'}}}))
            lock = {'format': 'inveos.ocr_package_archives.v1', 'baseImage': archives.BASE, 'origin': archives.ORIGIN,
                    'installedInventorySha256': archives.sha(inventory.read_bytes()), 'archives': [record], 'resolvedNotices': archives.resolve_notices([record])}
            lock_path = root / 'lock.json'
            lock_path.write_text(json.dumps(lock))
            cached = root / (record['sha256'] + '.deb')
            with patch.object(archives, 'INVENTORY', inventory), patch.object(archives, 'CACHE', root), patch.object(archives, 'download', side_effect=AssertionError('unexpected network')):
                with self.assertRaisesRegex(ValueError, 'Missing locked archive'):
                    archives.acquire(lock_path, offline=True)
                cached.write_bytes(data)
                self.assertEqual(archives.acquire(lock_path, offline=True)['archives'], 1)
                cached.write_bytes(data[:-1] + b'!')
                with self.assertRaisesRegex(ValueError, 'fingerprint mismatch'):
                    archives.acquire(lock_path, offline=True)
                cached.write_bytes(data)
                record['notices'][0]['sha256'] = '0' * 64
                lock['resolvedNotices'] = archives.resolve_notices([record])
                lock_path.write_text(json.dumps(lock))
                with self.assertRaisesRegex(ValueError, 'metadata/notice mismatch'):
                    archives.acquire(lock_path, offline=True)
                lock['archives'] = []
                lock_path.write_text(json.dumps(lock))
                with self.assertRaisesRegex(ValueError, 'Incomplete or duplicate'):
                    archives.acquire(lock_path, offline=True)

    def test_shared_notice_resolution_is_confined_to_audited_archives(self):
        original = {'installedName': 'fictional', **archives.audit(deb())}
        alias = {'installedName': 'alias', 'package': 'alias', 'notices': [{'path': 'usr/share/doc/alias', 'link': 'fictional', 'kind': 'symlink'}]}
        resolved = archives.resolve_notices([original, alias])
        self.assertEqual(resolved['fictional'], resolved['alias'])
        for target in ('alias', '/etc', '../../etc', 'absent'):
            alias['notices'][0]['link'] = target
            with self.subTest(target=target), self.assertRaises(ValueError):
                archives.resolve_notices([original, alias])

    def test_qualified_runtime_copyright_must_match_acquired_bytes(self):
        resolved = {'fictional': {'path': 'usr/share/doc/fictional/copyright', 'sha256': 'a' * 64, 'bytes': 123}}
        inventory = {'artifacts': [{'package': 'fictional', 'copyright': {'resolvedPath': '/usr/share/doc/fictional/copyright', 'sha256': 'a' * 64, 'bytes': 123}}]}
        archives.check_runtime_notices(resolved, inventory)
        for field, value in [('path', 'usr/share/doc/other/copyright'), ('sha256', 'b' * 64), ('bytes', 124)]:
            changed = {'fictional': {**resolved['fictional'], field: value}}
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'differs from qualified runtime'):
                archives.check_runtime_notices(changed, inventory)

    def test_cached_symlink_and_unapproved_redirect_are_denied(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'archive.deb'
            path.symlink_to(Path(directory) / 'missing')
            with self.assertRaises(ValueError):
                archives.cached_bytes(path, 100)
        redirect = archives.SameOriginRedirect()
        for url in ('http://snapshot.debian.org/file/a', 'https://elsewhere.invalid/file/a', 'https://snapshot.debian.org@elsewhere.invalid/file/a'):
            with self.subTest(url=url), self.assertRaisesRegex(ValueError, 'Unexpected archive redirect'):
                redirect.redirect_request(None, None, 302, '', {}, url)


if __name__ == '__main__':
    unittest.main()
