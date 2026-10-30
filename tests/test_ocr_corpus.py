import base64
import subprocess
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'tools'))
from run_ocr_corpus import CASES, distance, measure, observed_text, source, tokens


class OcrCorpusDefinitionTests(unittest.TestCase):
    def test_metrics_expose_numeric_loss_insertions_and_blank_hallucinations(self):
        self.assertEqual(distance(['A','B'],['A','C']),1)
        changed=measure('Fictional owner 60 percent','fictional owner 80 percent extra')
        self.assertEqual(changed['wordErrors'],2)
        self.assertEqual(changed['missingNumericTokens'],{'60':1})
        self.assertEqual(changed['unexpectedNumericTokens'],{'80':1})
        self.assertFalse(changed['normalisedExact'])
        blank=measure('','invented 40')
        self.assertEqual(blank['referenceWords'],0)
        self.assertEqual(blank['wordErrors'],2)
        self.assertEqual(blank['wordErrorRate'],2)
        self.assertEqual(blank['unexpectedNumericTokens'],{'40':1})
        self.assertTrue(measure('Fictional 60%','FICTIONAL 60')['normalisedExact'])

    def test_definitions_are_deterministic_and_explicitly_fictional(self):
        self.assertEqual(len(CASES),len(set(CASES)))
        self.assertGreaterEqual(len(CASES),10)
        for case in CASES:
            a,expected=source(case);b,_=source(case)
            self.assertEqual(a,b)
            self.assertTrue(a.startswith(b'%PDF-'))
            if case=='blank':self.assertEqual(expected,'')
            else:self.assertIn('FICTIONAL',expected)
        with self.assertRaises(ValueError):source('outside')
        with self.assertRaises(ValueError):tokens('x'*20001)

    def test_definition_and_metric_checks_do_not_import_native_runtimes(self):
        code="import sys;sys.path.insert(0,"+repr(str(ROOT/'tools'))+");import run_ocr_corpus;assert 'pypdfium2' not in sys.modules;assert 'PIL.Image' not in sys.modules"
        subprocess.run([sys.executable,'-I','-c',code],capture_output=True,check=True,timeout=10)

    def test_tsv_quotes_are_literal_tokens_not_csv_record_delimiters(self):
        from run_tesseract_supplier import words
        header='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'
        raw=(header+'5\t1\t1\t1\t1\t1\t1\t1\t2\t2\t50\t"\n'+'5\t1\t1\t1\t1\t2\t4\t1\t20\t2\t95\tATLAS\n'+'5\t1\t1\t1\t1\t3\t26\t1\t10\t2\t94\t60\n').encode()
        actual=observed_text({'pages':[{'tsvBase64':base64.b64encode(raw).decode()}]})
        self.assertEqual(actual,'" ATLAS 60')
        self.assertTrue(measure('ATLAS 60',actual)['normalisedExact'])
        self.assertEqual([word['text'] for word in words(raw,64,64)],['"','ATLAS','60'])

class ExpandedOcrBoundaryTests(unittest.TestCase):
    def test_unknown_profiles_and_oversized_originals_fail_before_native_import(self):
        from run_ocr_document import extract
        for version in (0,3,True,'2'):
            with self.assertRaisesRegex(ValueError,'Unknown OCR profile'):
                extract(b'%PDF-fictional',version)
        for version,maximum in ((1,65536),(2,262144)):
            with self.assertRaisesRegex(ValueError,'Original exceeds'):
                extract(b'%PDF-'+b' '*(maximum-4),version)
