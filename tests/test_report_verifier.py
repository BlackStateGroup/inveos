import base64
import copy
import hashlib
import json
import unittest

from tools.verify_report import verify


class ReportVerifierTests(unittest.TestCase):
    def setUp(self):
        text = 'SYNTHETIC ONLY\nPortuguês £50 — العربية\nSame quote\nSame quote'
        raw = text.encode()
        quote = 'Português £50 — العربية'
        start = raw.index(quote.encode())
        self.report = {
            'status': 'draft_not_released',
            'case': {'id': '00000000-0000-4000-8000-000000000001', 'ref': 'FICTIONAL-001',
                     'title': 'Fictional supplier review', 'client': 'Fictional client',
                     'scope': 'Synthetic supplied documents only.', 'jurisdiction': 'Synthetic exercise'},
            'findings': [{'id': '00000000-0000-4000-8000-000000000002', 'text': 'The fictional source records an amount.',
                'reviewer': 'Fictional reviewer', 'reviewedAt': '2026-10-27T09:00:00Z', 'source': {
                    'id': '00000000-0000-4000-8000-000000000003', 'filename': 'fictional.txt',
                    'contentBase64': base64.b64encode(raw).decode(), 'sha256': hashlib.sha256(raw).hexdigest(),
                    'quote': quote, 'startByte': start, 'endByte': start + len(quote.encode()),
                    'sourceTime': '2026-10-26T10:30:00+01:30', 'receivedTime': '2026-10-27T08:00:00Z',
                    'policy': {'authorityId': '00000000-0000-4000-8000-000000000004', 'authorityVersion': 1,
                        'retentionDays': 30, 'purpose': 'Fictional supplied-record comparison', 'lawfulBasis': 'Synthetic exercise only',
                        'scope': 'Fictional records', 'minimisation': 'No real personal data'}}}],
        }

    def raw(self):
        return json.dumps(self.report, ensure_ascii=False).encode()

    def test_unicode_bytes_and_trusted_fingerprint(self):
        raw = self.raw()
        result = verify(raw, hashlib.sha256(raw).hexdigest())
        self.assertEqual(result['originals'], 1)
        self.assertTrue(result['trusted_fingerprint_checked'])

    def test_modified_original_and_span_fail(self):
        source = self.report['findings'][0]['source']
        original = copy.deepcopy(source)
        source['contentBase64'] = base64.b64encode(b'mutated fictional text').decode()
        with self.assertRaisesRegex(ValueError, 'digest mismatch'): verify(self.raw())
        self.report['findings'][0]['source'] = original
        original['endByte'] -= 1
        with self.assertRaisesRegex(ValueError, 'quoted passage'): verify(self.raw())

    def test_untrusted_replacement_requires_external_fingerprint(self):
        trusted = hashlib.sha256(self.raw()).hexdigest()
        self.report['findings'][0]['text'] = 'A different unsupported assertion'
        self.assertFalse(verify(self.raw())['trusted_fingerprint_checked'])
        with self.assertRaisesRegex(ValueError, 'trusted SHA-256'): verify(self.raw(), trusted)

    def test_invalid_ranges_identities_policies_and_timestamps(self):
        original = copy.deepcopy(self.report)
        for key, value in [('startByte', True), ('endByte', 999999), ('startByte', -1), ('sourceTime', '2026-02-30T00:00:00Z')]:
            self.report = copy.deepcopy(original)
            self.report['findings'][0]['source'][key] = value
            with self.assertRaises(ValueError): verify(self.raw())
        self.report = copy.deepcopy(original)
        self.report['findings'][0]['source']['policy']['authorityVersion'] = False
        with self.assertRaises(ValueError): verify(self.raw())
        self.report = copy.deepcopy(original)
        self.report['findings'].append(copy.deepcopy(self.report['findings'][0]))
        with self.assertRaisesRegex(ValueError, 'duplicate finding'): verify(self.raw())

    def test_duplicate_keys_release_status_and_empty_findings_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate JSON'): verify(b'{"status":"one","status":"two"}')
        self.report['status'] = 'released'
        with self.assertRaises(ValueError): verify(self.raw())
        self.report['status'] = 'draft_not_released'
        self.report['findings'] = []
        with self.assertRaises(ValueError): verify(self.raw())


if __name__ == '__main__':
    unittest.main()
