"""Adversarial standalone DOCX verification using a first-party fictional Node export."""
import base64
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import warnings
import zipfile
from unittest.mock import patch
from tools import verify_report_docx as docx

FIXTURE = Path(__file__).parent / 'fixtures' / 'fictional-editable-report.docx'


class ReportDocxTests(unittest.TestCase):
    def setUp(self):
        self.data = FIXTURE.read_bytes()
        with zipfile.ZipFile(io.BytesIO(self.data)) as archive:
            self.parts = [archive.read(name).decode() for name in docx.NAMES]
        self.model = json.loads(base64.b64decode(self.parts[-1][len(docx.MODEL_PREFIX):-len(docx.MODEL_SUFFIX)]))

    def metadata(self, raw=None):
        self.parts[-1] = docx.MODEL_PREFIX + base64.b64encode(raw if raw is not None else docx.encoded(self.model)).decode() + docx.MODEL_SUFFIX
        return docx.package(self.parts)

    def test_actual_unicode_fixture_and_trusted_fingerprints(self):
        result = docx.verify(self.data, docx.digest(self.data), 'a' * 64)
        self.assertTrue(result['paragraphsMatched'])
        self.assertTrue(result['trustedDocxFingerprintMatched'])
        self.assertIn('日本語', self.parts[2])
        self.assertIn('<w:tab/>', self.parts[2])
        for args in [('0' * 64, None), (None, 'b' * 64), ('invalid', None)]:
            with self.assertRaises(ValueError):
                docx.verify(self.data, *args)

    def test_visible_edits_and_coherent_rewrites_need_a_trusted_fingerprint(self):
        self.parts[2] = self.parts[2].replace('Fictional Paperworks', 'Fictional replacement')
        with self.assertRaisesRegex(ValueError, 'Visible document'):
            docx.verify(docx.package(self.parts))
        self.model['paragraphs'] = [p.replace('Fictional Paperworks', 'Fictional replacement') for p in self.model['paragraphs']]
        rewritten = self.metadata()
        self.assertFalse(docx.verify(rewritten)['trustedDocxFingerprintMatched'])
        with self.assertRaisesRegex(ValueError, 'fingerprint mismatch'):
            docx.verify(rewritten, docx.digest(self.data))

    def test_extra_duplicate_traversal_compression_and_macro_parts_are_rejected(self):
        for extra, compression in [('word/vbaProject.bin', 0), ('../source.json', 0), ('word/document.xml', 0), (None, zipfile.ZIP_DEFLATED)]:
            stream = io.BytesIO()
            with warnings.catch_warnings():
                warnings.simplefilter('ignore', UserWarning)
                with zipfile.ZipFile(stream, 'w', compression=compression) as archive:
                    for name, part in zip(docx.NAMES, self.parts):
                        archive.writestr(name, part)
                    if extra:
                        archive.writestr(extra, 'Fictional unexpected content')
            with self.assertRaises(ValueError):
                docx.verify(stream.getvalue())

    def test_relationships_xml_entities_and_trailing_bytes_are_rejected(self):
        self.parts[3] = self.parts[3].replace('Target="../customXml/item1.xml"', 'Target="https://example.invalid" TargetMode="External"')
        with self.assertRaisesRegex(ValueError, 'relationships'):
            docx.verify(docx.package(self.parts))
        with self.assertRaises(ValueError):
            docx.verify(self.data + b'Fictional appended original')
        self.parts[2] = '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><x>&x;</x>'
        with self.assertRaises(ValueError):
            docx.verify(docx.package(self.parts))

    def test_invalid_models_duplicate_keys_and_control_characters_fail_closed(self):
        for raw in [b'null', b'[]', b'{"x":1,"x":2}', b'{"x":NaN}']:
            with self.assertRaises(ValueError):
                docx.verify(self.metadata(raw))
        for value in [True, -1, 1001, '1']:
            self.model['redaction']['count'] = value
            with self.assertRaises(ValueError):
                docx.verify(self.metadata())
        self.model['redaction']['count'] = 0
        self.model['paragraphs'].append('\x00fictional')
        with self.assertRaisesRegex(ValueError, 'XML character'):
            docx.verify(self.metadata())

    def test_byte_and_paragraph_limits_are_enforced(self):
        with patch.object(docx, 'MAX_BYTES', 128):
            with self.assertRaisesRegex(ValueError, 'byte limit'):
                docx.verify(self.data)
        self.model['paragraphs'] = ['x'] * 48001
        with self.assertRaisesRegex(ValueError, 'Paragraph limit'):
            docx.verify(self.metadata())

    def test_standalone_cli_rejects_malformed_files_without_tracebacks(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'fictional.docx'
            path.write_bytes(b'x' * 100)
            result = subprocess.run([sys.executable, str(Path(docx.__file__)), str(path)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn('Verification failed', result.stderr)
            self.assertNotIn('Traceback', result.stderr)


if __name__ == '__main__':
    unittest.main()
