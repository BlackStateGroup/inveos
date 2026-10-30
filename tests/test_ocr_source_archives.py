import copy
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
import ocr_source_archives as sources


def entry(data=b'Fictional inert source archive; never executed', name='fictional_1.0.orig.tar.gz'):
    return {'name': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
            'snapshotSha1': hashlib.sha1(data).hexdigest(), 'md5': hashlib.md5(data).hexdigest()}


def dsc(files=None, signed=True):
    files = files or [entry()]
    text = 'Format: 3.0 (quilt)\nSource: fictional\nVersion: 1.0-1\nBinary: fictional-bin\nBuild-Depends: fictional-build-tool\n'
    for field, key in [('Checksums-Sha256', 'sha256'), ('Checksums-Sha1', 'snapshotSha1'), ('Files', 'md5')]:
        text += field + ':\n' + ''.join(' {0} {1} {2}\n'.format(f[key], f['bytes'], f['name']) for f in files)
    if signed:
        text = '-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\n' + text + '-----BEGIN PGP SIGNATURE-----\nFictional unauthenticated envelope\n-----END PGP SIGNATURE-----\n'
    return text.encode()


class SourceArchiveTests(unittest.TestCase):
    def test_binary_source_and_built_using_versions_remain_exact(self):
        items = [{'package': 'fictional-bin', 'installedName': 'fictional-bin:amd64', 'version': '2:1.0-1+b2',
                  'source': 'fictional (2:1.0-1)', 'builtUsing': 'other (\u003d 3.0-1), another (= 1:1.2)'},
                 {'package': 'fictional-extra', 'installedName': 'fictional-extra', 'version': '2:1.0-1', 'source': 'fictional'}]
        expected = sources.source_set({'archives': items})
        self.assertEqual(expected[('fictional', '2:1.0-1')], ['fictional-bin:amd64', 'fictional-extra'])
        self.assertIn(('another', '1:1.2'), expected)
        items[0]['builtUsing'] = 'other (>= 1)'
        with self.assertRaisesRegex(ValueError, 'Unsupported Built-Using'):
            sources.source_set({'archives': items})
        items[0]['source'] = '../fictional'
        with self.assertRaisesRegex(ValueError, 'Invalid binary Source'):
            sources.source_set({'archives': items})

    def test_descriptor_records_signed_envelope_without_authenticating_it(self):
        for signed in (False, True):
            result = sources.descriptor(dsc(signed=signed), 'fictional', '1.0-1')
            self.assertEqual(result['cleartextSigned'], signed)
            self.assertEqual(result['files'], [entry()])
            self.assertEqual(result['buildDepends'], 'fictional-build-tool')
        for change in (lambda x: x.replace(b'Source: fictional', b'Source: other'),
                       lambda x: x.replace(b'Version: 1.0-1', b'Version: 1.0-2'),
                       lambda x: x.replace(b'Format: 3.0 (quilt)', b'Format: custom'),
                       lambda x: x.replace(b'-----END PGP SIGNATURE-----', b'')):
            with self.assertRaises(ValueError):
                sources.descriptor(change(dsc()), 'fictional', '1.0-1')

    def test_descriptor_paths_duplicates_budget_and_cross_table_drift_fail_closed(self):
        for name in ('../host', '/absolute', 'back\\slash', 'file name', 'component.dsc', 'two\nfields'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                sources.descriptor(dsc([entry(name=name)]), 'fictional', '1.0-1')
        for value in (dsc([entry(), entry()]), dsc().replace(b'Files:', b'Checksums-Sha1:'),
                      dsc().replace(b'Checksums-Sha1:', b'Source: fictional\nChecksums-Sha1:'),
                      dsc().replace(b'Checksums-Sha1:\n ', b'Checksums-Sha1:\n bad '),
                      dsc().replace(b'Files:\n ', b'Files:\n ' + b'0' * 32 + b' 1 another.tar.gz\n ')):
            with self.assertRaises(ValueError):
                sources.descriptor(value, 'fictional', '1.0-1')
        with patch.object(sources, 'MAX_FILE', 1), self.assertRaises(ValueError):
            sources.descriptor(dsc(), 'fictional', '1.0-1')
        with patch.object(sources, 'MAX_DSC', 1), self.assertRaises(ValueError):
            sources.descriptor(dsc(), 'fictional', '1.0-1')

    def test_streaming_checks_exact_size_hashes_and_deadline(self):
        data = b'Fictional inert source archive; never executed'
        out = io.BytesIO()
        sources.copy_checked(io.BytesIO(data), entry(data), out)
        self.assertEqual(out.getvalue(), data)
        for bad in (data[:-1], data + b'!', b'x' + data[1:]):
            with self.assertRaises(ValueError):
                sources.copy_checked(io.BytesIO(bad), entry(data))
        with self.assertRaisesRegex(ValueError, 'deadline'):
            sources.copy_checked(io.BytesIO(data), entry(data), deadline=time.monotonic() - 1)
        for key in ('sha256', 'snapshotSha1', 'md5'):
            bad = entry(data);bad[key] = '0' * len(bad[key])
            with self.assertRaisesRegex(ValueError, 'fingerprint mismatch'):
                sources.copy_checked(io.BytesIO(data), bad)

    def test_offline_closure_requires_every_source_component_and_exact_binary_lock(self):
        data = b'Fictional inert source archive; never executed'
        raw = dsc();dsc_entry = entry(raw, 'fictional_1.0-1.dsc');dsc_entry.pop('md5')
        inventory = {'archives': [{'source': None, 'package': 'fictional', 'installedName': 'fictional', 'version': '1.0-1'}]}
        source = {'source': 'fictional', 'version': '1.0-1', 'installedBinaries': ['fictional'], 'descriptor': dsc_entry, **sources.descriptor(raw, 'fictional', '1.0-1')}
        lock = {'format': 'inveos.ocr_source_archives.v1', 'origin': sources.binary.ORIGIN,
                'binaryArchiveLockSha256': sources.sha(b'fictional binary lock'), 'authentication': 'Fictional, unauthenticated test', 'sources': [source]}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory);lock_path = root / 'lock.json'
            lock_path.write_text(json.dumps(lock))
            with patch.object(sources, 'CACHE', root), patch.object(sources, 'binary_lock', return_value=(b'fictional binary lock', inventory)), patch.object(sources.urllib.request, 'build_opener', side_effect=AssertionError('Offline must not use network')):
                with self.assertRaisesRegex(ValueError, 'Missing locked source'):
                    sources.acquire(lock_path, offline=True)
                (root / dsc_entry['sha256']).write_bytes(raw)
                with self.assertRaisesRegex(ValueError, 'Missing locked source'):
                    sources.acquire(lock_path, offline=True)
                target = root / entry(data)['sha256'];target.write_bytes(data)
                result = sources.acquire(lock_path, offline=True)
                self.assertEqual((result['sources'], result['files']), (1, 2))
                self.assertEqual(result['declaredBytes'], len(data) + len(raw))
                target.write_bytes(b'x' + data[1:])
                with self.assertRaisesRegex(ValueError, 'fingerprint mismatch'):
                    sources.acquire(lock_path, offline=True)
                target.write_bytes(data)
                for change in (lambda v: v.update(binaryArchiveLockSha256='0' * 64),
                               lambda v: v.update(sources=[]),
                               lambda v: v['sources'].append(copy.deepcopy(source)),
                               lambda v: v['sources'][0].update(installedBinaries=['another']),
                               lambda v: v['sources'][0].update(buildDepends='substituted'),
                               lambda v: v['sources'][0]['files'][0].update(sha256='0' * 64)):
                    changed = copy.deepcopy(lock);change(changed);lock_path.write_text(json.dumps(changed))
                    with self.assertRaises(ValueError):
                        sources.acquire(lock_path, offline=True)
                lock_path.write_text(json.dumps(lock))
                with patch.object(sources, 'MAX_TOTAL', 1), self.assertRaisesRegex(ValueError, 'closure byte limit'):
                    sources.acquire(lock_path, offline=True)
                target.unlink();target.symlink_to(root / 'outside')
                with self.assertRaisesRegex(ValueError, 'symlink'):
                    sources.acquire(lock_path, offline=True)

    def test_actual_http_acquisition_recovers_failures_and_leaves_no_partial_cache(self):
        data = b'Fictional inert source archive; never executed'
        mode = ['good'];stop = threading.Event()
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200);self.send_header('Content-Length', str(len(data)));self.end_headers()
                try:
                    body = b'x' + data[1:] if mode[0] == 'corrupt' else data
                    for value in body:
                        self.wfile.write(bytes([value]));self.wfile.flush()
                        if mode[0] == 'slow' and stop.wait(0.02): break
                except (BrokenPipeError, ConnectionResetError): pass
            def log_message(self, *_): pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True);thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory, patch.object(sources.binary, 'ORIGIN', 'http://127.0.0.1:' + str(server.server_port)), patch.object(sources, 'CACHE', Path(directory)):
                for mode[0] in ('corrupt', 'slow'):
                    with patch.object(sources, 'DOWNLOAD_SECONDS', 0.1), self.assertRaises(ValueError):
                        sources.acquire_file(entry(data), offline=False)
                    self.assertEqual(list(Path(directory).iterdir()), [])
                stop.set();mode[0] = 'good'
                path = sources.acquire_file(entry(data), offline=False)
                self.assertEqual(path.read_bytes(), data)
                self.assertEqual(sources.acquire_file(entry(data), offline=True), path)
        finally:
            stop.set();server.shutdown();server.server_close();thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main()
