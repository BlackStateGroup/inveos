"""Adversarial inputs for the independent PDF verifier; fictional data only."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from tools import verify_report_pdf as pdf


class ReportPdfInputTests(unittest.TestCase):
    def model(self):
        return dict(format='inveos_report_pdf_model_v1', profile='inveos_report_pdf_v1',
                    profileDigest=pdf.sha(json.dumps(pdf.PROFILE, separators=(',', ':')).encode()),
                    sourceReportSha256='a'*64,
                    redaction=dict(digest='b'*64, count=0, reason=''),
                    visibleLines=['Fictional report'], pageCount=1)

    def encode(self, model):
        data=json.dumps(model, separators=(',', ':')).encode()
        return pdf.canonical_pdf(data, model, 'a'*64, 'b'*64, pdf.sha(data))

    def test_canonical_fixture_and_boolean_counts(self):
        self.assertTrue(pdf.verify(self.encode(self.model()))['semanticStreamsMatched'])
        for field in ('pageCount', 'count'):
            model=self.model()
            if field=='pageCount':model[field]=True
            else:model['redaction'][field]=False
            with self.assertRaises(pdf.VerificationError):pdf.verify(self.encode(model))

    def test_non_object_and_deep_model_fail_as_verification_errors(self):
        for data in (b'null', b'42', b'[]', b'['*2000+b'0'+b']'*2000):
            raw=(b'%PDF-1.4\n%INVEOS-PROFILE inveos_report_pdf_v1\n'
                 b'%INVEOS-SOURCE-SHA256 '+b'a'*64+b'\n%INVEOS-REDACTION-SHA256 '+b'b'*64+
                 b'\n%INVEOS-MODEL-SHA256 '+pdf.sha(data).encode()+
                 b'\n/Filter /ASCIIHexDecode >>\nstream\n'+data.hex().upper().encode()+b'>\nendstream\n%%EOF\n')
            with self.assertRaises(pdf.VerificationError):pdf.verify(raw)

    def test_reader_enforces_limit_before_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'fictional.pdf'
            path.write_bytes(b'x'*17)
            with patch.object(pdf, 'MAX_PDF_BYTES', 16):
                with self.assertRaises(pdf.VerificationError):pdf.read_pdf(path)
                path.write_bytes(b'x'*16)
                self.assertEqual(pdf.read_pdf(path), b'x'*16)


if __name__=='__main__':unittest.main()
