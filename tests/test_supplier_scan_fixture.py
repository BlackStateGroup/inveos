"""First-party fixture/TSV contract checks; these do not execute OCR."""
import sys
from pathlib import Path
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from supplier_scan_fixture import PAGES,digital_supplier_pdf,scanned_supplier_pdf
from run_tesseract_supplier import words


class SupplierScanFixtureTests(unittest.TestCase):
    def test_fictional_digital_and_raster_sources_are_separate_and_deterministic(self):
        source=digital_supplier_pdf();self.assertEqual(source,digital_supplier_pdf());self.assertIn(b'100 PERCENT',source);self.assertIn(b'60 PERCENT',source);self.assertIn(b'40 PERCENT',source)
        images=[(2,2,b'\x00\xff\x00'*4),(2,2,b'\xff\x00\xff'*4)]
        scan=scanned_supplier_pdf(images);self.assertEqual(scan,scanned_supplier_pdf(images));self.assertNotEqual(source,scan)
        self.assertNotIn(b'/Font',scan);self.assertNotIn(b'Tj',scan);self.assertEqual(scan.count(b'/Subtype /Image'),2);self.assertEqual(len(PAGES),2)
        for invalid in [[],[(0,2,b'')]*2,[(2,2,b'bad')]*2,[(True,2,b'\x00'*6)]*2]:
            with self.assertRaises(ValueError):scanned_supplier_pdf(invalid)

    def tsv(self,**changes):
        row=dict(level='5',page_num='1',block_num='1',par_num='1',line_num='1',word_num='1',left='20',top='30',width='40',height='10',conf='95.5',text='FICTIONAL');row.update(changes)
        return ('\t'.join(row)+'\n'+'\t'.join(row.values())+'\n').encode()

    def test_case_records_are_distinct_and_do_not_repeat_both_sources(self):
        declaration=digital_supplier_pdf(0);register=digital_supplier_pdf(1)
        self.assertIn(b'100 PERCENT',declaration);self.assertNotIn(b'60 PERCENT',declaration)
        self.assertIn(b'60 PERCENT',register);self.assertNotIn(b'100 PERCENT',register)
        self.assertIn(b'/Count 1',declaration);self.assertIn(b'/Count 1',register)
        scan=scanned_supplier_pdf([(2,2,b'\xff'*12)])
        self.assertEqual(scan.count(b'/Subtype /Image'),1);self.assertNotIn(b'/Font',scan)
        for invalid in (-1,2,True,'1'):
            with self.assertRaises(ValueError):digital_supplier_pdf(invalid)

    def test_word_regions_map_explicit_render_scale_and_reject_invalid_output(self):
        result=words(self.tsv(),1224,1584);self.assertEqual(result[0]['pdfBox'],[10,15,30,20]);self.assertEqual(result[0]['origin'],'TOPLEFT')
        for change in [dict(left='-1'),dict(width='0'),dict(top='1583'),dict(conf='nan'),dict(conf='101'),dict(text='')]:
            with self.assertRaises(ValueError):words(self.tsv(**change),1224,1584)
        self.assertEqual(words(self.tsv(level='4'),1224,1584),[])


if __name__=='__main__':unittest.main()
