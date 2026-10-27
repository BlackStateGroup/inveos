import base64
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from tools.verify_report import InvalidReport, verify_report


def fixture():
    original = 'FICTIONAL: Café £42. Second fictional statement.'.encode()
    quote = 'Café £42'
    start = original.index(quote.encode())
    return {'status': 'draft_not_released', 'case': {'id': 'synthetic-case', 'ref': 'SYN-001',
        'title': 'Fictional supplier', 'client': 'Synthetic client', 'scope': 'Fixture only', 'jurisdiction': 'Test'},
        'limitations': 'Synthetic fixture, not an API capture.', 'findings': [{'id': 'f1', 'text': 'Fictional claim',
        'reviewer': 'Synthetic reviewer', 'reviewedAt': '2026-10-27T09:00:00Z', 'source': {
        'id': 'e1', 'filename': 'synthetic.txt', 'sha256': hashlib.sha256(original).hexdigest(),
        'sourceTime': '2026-10-25T09:00:00Z', 'receivedTime': '2026-10-26T09:00:00Z',
        'quote': quote, 'startByte': start, 'endByte': start + len(quote.encode()),
        'contentBase64': base64.b64encode(original).decode(), 'policy': {'authorityId': 'a1', 'authorityVersion': 1,
        'purpose': 'Synthetic', 'lawfulBasis': 'Synthetic', 'scope': 'Fixture only', 'retentionDays': 30, 'minimisation': 'Fiction only'}}}]}


def encode(report):
    return json.dumps(report, ensure_ascii=False).encode()


class ReportVerifierTests(unittest.TestCase):
    def test_valid_unanchored_and_anchored(self):
        raw = encode(fixture())
        self.assertFalse(verify_report(raw)['trustedReportDigestMatched'])
        self.assertTrue(verify_report(raw, hashlib.sha256(raw).hexdigest(), 'synthetic-case')['trustedReportDigestMatched'])

    def test_metadata_tamper_requires_external_anchor(self):
        r = fixture(); raw = encode(r)
        r['findings'][0]['text'] = 'Changed narrative'
        self.assertEqual(verify_report(encode(r))['status'], 'integrity_checks_passed')
        with self.assertRaises(InvalidReport): verify_report(encode(r), hashlib.sha256(raw).hexdigest())

    def test_multiple_quotes_same_original(self):
        r = fixture(); f = copy.deepcopy(r['findings'][0]); f['id'] = 'f2'
        s = f['source']; s.update(quote='Second', startByte=23, endByte=29)
        original = base64.b64decode(s['contentBase64']); s['startByte'] = original.index(b'Second'); s['endByte'] = s['startByte'] + 6
        r['findings'].append(f)
        result = verify_report(encode(r))
        self.assertEqual((result['findingsChecked'], result['originalsChecked']), (2, 1))

    def test_conflicting_identity(self):
        r = fixture(); f = copy.deepcopy(r['findings'][0]); f['id'] = 'f2'; f['source']['sourceTime'] = 'changed'
        r['findings'].append(f)
        with self.assertRaises(InvalidReport): verify_report(encode(r))

    def test_corrupt_sources(self):
        for key, value in [('sha256', '0'*64), ('contentBase64', '!!'), ('startByte', -1), ('startByte', True),
                           ('endByte', 99999), ('quote', 'Invented'), ('endByte', 19)]:
            r = fixture(); r['findings'][0]['source'][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(InvalidReport): verify_report(encode(r))

    def test_invalid_policy(self):
        for key, value in [('authorityVersion', 0), ('retentionDays', True), ('lawfulBasis', '')]:
            r = fixture(); r['findings'][0]['source']['policy'][key] = value
            with self.assertRaises(InvalidReport): verify_report(encode(r))

    def test_empty_duplicate_unreleased_and_case(self):
        for mutate in [lambda r:r.update(findings=[]), lambda r:r.update(status='released'),
                       lambda r:r['findings'].append(copy.deepcopy(r['findings'][0]))]:
            r = fixture(); mutate(r)
            with self.assertRaises(InvalidReport): verify_report(encode(r))
        with self.assertRaises(InvalidReport): verify_report(encode(fixture()), expected_case_id='other-case')

    def test_malformed_json(self):
        for raw in [b'', b'[]', b'\xff', b'{"x":1,"x":2}', b'{"x":NaN}', b'['*2000]:
            with self.subTest(raw=raw[:20]), self.assertRaises(InvalidReport): verify_report(raw)

    def test_cli_has_no_application_dependency(self):
        script = Path(__file__).resolve().parents[1] / 'tools/verify_report.py'
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / 'draft.json'; report.write_bytes(encode(fixture()))
            result = subprocess.run([sys.executable, str(script), str(report)], cwd=directory, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)['findingsChecked'], 1)
            report.write_bytes(b'{}')
            result = subprocess.run([sys.executable, str(script), str(report)], cwd=directory, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stderr)['status'], 'verification_failed')


if __name__ == '__main__': unittest.main()
