import unittest
from tools.pdf_text_coverage import text_coverage
from tools.synthetic_pdf import coverage_pdf

class CoverageTests(unittest.TestCase):
    def test_missing_pages_are_not_successful_completeness(self):
        result=text_coverage(2,[{'page':1,'text':'FICTIONAL'}],True)
        self.assertEqual(result['pagesWithoutText'],[2])
        self.assertEqual(result['disposition'],'needs_page_review')
        self.assertFalse(result['completeExtractionVerified'])
        self.assertEqual(text_coverage(1,[],True)['pagesWithoutText'],[1])

    def test_all_text_still_unreviewed_and_failure_retained(self):
        rows=[{'page':1,'text':'FICTIONAL'},{'page':2,'text':'FICTIONAL'}]
        self.assertEqual(text_coverage(2,rows,True)['disposition'],'unreviewed_text')
        self.assertFalse(text_coverage(2,rows,True)['completeExtractionVerified'])
        self.assertEqual(text_coverage(2,rows,False)['disposition'],'needs_page_review')

    def test_invalid_pages_and_empty_rows_rejected(self):
        for page in [True,0,3,1.5,'1',None]:
            with self.subTest(page=page),self.assertRaises(ValueError):text_coverage(2,[{'page':page,'text':'x'}],True)
        for count in [False,0,1001,1.5]:
            with self.assertRaises(ValueError):text_coverage(count,[],True)
        for text in ['', '  ', None, 1]:
            with self.assertRaises(ValueError):text_coverage(2,[{'page':1,'text':text}],True)
        with self.assertRaises(ValueError):text_coverage(2,[],1)

    def test_fixture_offsets_and_raster_has_no_text_layer(self):
        for kinds in [('text','raster'),('blank','text'),('raster',),('text',)*3]:
            data=coverage_pdf(kinds)
            self.assertEqual(data,coverage_pdf(kinds))
            self.assertEqual(data.count(b'(FICTIONAL INVEOS repeated passage)'),kinds.count('text'))
            self.assertIn(b'/Subtype /Image',data)
            xref=int(data.split(b'startxref\n')[1].splitlines()[0])
            lines=data[xref:].splitlines();count=int(lines[1].split()[1])-1
            for n,line in enumerate(lines[3:3+count],1):
                self.assertTrue(data[int(line[:10]):].startswith(f'{n} 0 obj'.encode()))
        for kinds in [[],['unknown'],['text']*4]:
            with self.assertRaises(ValueError):coverage_pdf(kinds)
