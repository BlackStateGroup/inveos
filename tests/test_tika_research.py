"""Boundary tests only; these are not parser benchmarks or licence approvals."""
import base64
import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
import warnings
import zipfile

from tools.experiment_tika_pdf import analyse, PHRASE
from tools.tika_runtime_artifacts import MODULES, ORIGIN, PIN, inspect_jar, records, relative, sha, verify, xml


def jar(entries):
    result = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', UserWarning)
        with zipfile.ZipFile(result, 'w') as output:
            for name, value in entries:
                output.writestr(name, value)
    return result.getvalue()


class TikaResearchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='inveos-fictional-tika-')
        self.addCleanup(self.temp.cleanup)
        self.cache = Path(self.temp.name)
        coords = ('fictional.example', 'fixture', '1.0')
        contents = {'.pom': b'<project><modelVersion>4.0.0</modelVersion></project>', '.jar': jar([('META-INF/LICENSE.txt', 'FICTIONAL licence fixture')]), '-sources.jar': jar([('Fixture.java', '// FICTIONAL source fixture')])}
        files = []
        for suffix, data in contents.items():
            name = relative(coords, suffix)
            path = self.cache / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            files.append({'path': name, 'bytes': len(data), 'sha256': sha(data)})
        self.lock = {'format': 'inveos.tika_research_artifacts.v1', 'sourceRevision': PIN, 'origin': ORIGIN, 'modules': MODULES, 'files': files, 'artifacts': [{'coordinates': ':'.join(coords), 'jar': relative(coords, '.jar'), 'sources': relative(coords, '-sources.jar'), 'jarInspection': inspect_jar(contents['.jar']), 'sourceInspection': inspect_jar(contents['-sources.jar'])}]}

    def test_offline_bytes_and_notices_verified_without_runtime(self):
        receipt = verify(self.lock, self.cache)
        self.assertEqual(receipt['jarPairsVerified'], 1)
        self.assertFalse(receipt['runtimeExecuted'])
        self.assertFalse(receipt['licenceApproved'])

    def test_changed_cached_bytes_or_symlink_rejected(self):
        path = self.cache / self.lock['files'][0]['path']
        path.write_bytes(path.read_bytes().replace(b'project', b'projecX'))
        with self.assertRaises(ValueError): verify(self.lock, self.cache)
        path.unlink()
        path.symlink_to('/dev/null')
        with self.assertRaises(ValueError): verify(self.lock, self.cache)

    def test_missing_source_jar_or_duplicate_coordinate_rejected(self):
        for change in ['source', 'duplicate', 'empty', 'identity']:
            lock = copy.deepcopy(self.lock)
            if change == 'source': lock['files'].pop()
            elif change == 'duplicate': lock['artifacts'].append(lock['artifacts'][0])
            elif change == 'empty': lock['artifacts'] = []
            else: lock['artifacts'][0]['coordinates'] = 'fictional.example:foreign:1.0'
            with self.subTest(change=change), self.assertRaises(ValueError): records(lock)

    def test_inventory_paths_sizes_and_duplicates_rejected(self):
        for value in ['../escape.jar', '/tmp/escape.jar', 'fictional/example//fixture.jar', 'fictional/example/fixture/1.0/wrong.jar']:
            lock = copy.deepcopy(self.lock)
            lock['files'][0]['path'] = value
            with self.subTest(value=value), self.assertRaises(ValueError): records(lock)
        lock = copy.deepcopy(self.lock)
        lock['files'].append(lock['files'][0])
        with self.assertRaises(ValueError): records(lock)
        lock = copy.deepcopy(self.lock)
        lock['files'][0]['bytes'] = True
        with self.assertRaises(ValueError): records(lock)

    def test_changed_notice_inventory_rejected(self):
        self.lock['artifacts'][0]['jarInspection']['notices'] = []
        with self.assertRaises(ValueError): verify(self.lock, self.cache)

    def test_pom_entities_and_mixed_namespaces_rejected(self):
        for raw in [b'<!DOCTYPE project [<!ENTITY x SYSTEM "file:///etc/passwd">]><project/>', b'<project><x:modelVersion xmlns:x="fictional">4.0.0</x:modelVersion></project>']:
            with self.assertRaises(ValueError): xml(raw)
        self.assertIsNotNone(xml(b'<project><modelVersion> 4.0.0 </modelVersion></project>'))

    def test_jar_native_traversal_and_duplicate_entries_rejected(self):
        for entries in [[('../outside', '')], [('native.so', '')], [('a', ''), ('a', '')], [('/absolute', '')]]:
            with self.subTest(entries=entries), self.assertRaises(ValueError): inspect_jar(jar(entries))

    def probe(self, page_texts):
        original = b'FICTIONAL source bytes'
        xhtml = ('<html xmlns="http://www.w3.org/1999/xhtml"><body>' + ''.join('<div class="page"><p>' + p + '</p></div>' for p in page_texts) + '</body></html>').encode()
        report = {'format': 'inveos_tika_research_probe_v1', 'state': 'unreviewed_research_derivative', 'sourceSha256': sha(original), 'xhtmlSha256': sha(xhtml), 'xhtmlBase64': base64.b64encode(xhtml).decode(), 'metadata': {}, 'parseNanos': 1, 'processCpuNanos': 1, 'peakRssKiB': 1}
        return original, report

    def test_empty_page_is_visible_and_repeat_has_distinct_page_reference(self):
        original, report = self.probe([PHRASE, '', PHRASE])
        result, _ = analyse(json.dumps(report).encode(), original, [True, False, True])
        self.assertFalse(result['allPagesHaveText'])
        self.assertIsNone(result['pages'][1]['citation'])
        self.assertEqual([p['page'] for p in result['pages']], [1, 2, 3])

    def test_probe_source_hash_xhtml_hash_page_count_and_resource_bounds(self):
        original, report = self.probe([PHRASE])
        for key, value in [('sourceSha256', '0' * 64), ('xhtmlSha256', '0' * 64), ('peakRssKiB', 0), ('parseNanos', -1)]:
            changed = report | {key: value}
            with self.subTest(key=key), self.assertRaises(ValueError): analyse(json.dumps(changed).encode(), original, [True])
        with self.assertRaises(ValueError): analyse(json.dumps(report).encode(), original, [True, True])


if __name__ == '__main__':
    unittest.main()
