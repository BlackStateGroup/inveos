import subprocess
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'tools'))
from run_ocr_corpus import CASES, distance, measure, source, tokens


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
