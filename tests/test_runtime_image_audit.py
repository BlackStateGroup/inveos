import copy
import unittest
from tools.audit_runtime_image import validate_receipt

class ImageAuditTests(unittest.TestCase):
    def setUp(self):
        self.package={'name':'fictional:amd64','version':'1','architecture':'amd64'}
        self.file={'path':'/lib/fictional.so','resolvedPath':'/usr/lib/fictional.so','bytes':100,'sha256':'a'*64}
        self.row={'name':'fictional.so',**self.file,'package':self.package,'copyrightFile':{**self.file,'path':'/usr/share/doc/fictional/copyright','resolvedPath':'/usr/share/doc/fictional/copyright'}}
        self.report={'libraries':[self.row],'missingNames':[],'packages':[self.package],'parserExecuted':False,'libraryLoadingTested':False}

    def test_candidate_is_not_loader_success(self):
        self.assertEqual(validate_receipt(self.report,['fictional.so']),'all_names_have_image_candidates')
        self.report['libraries']=[];self.report['missingNames']=['fictional.so']
        self.assertEqual(validate_receipt(self.report,['fictional.so']),'image_candidates_missing')

    def test_missing_duplicate_or_invented_coverage_rejected(self):
        for names in [[],['fictional.so','missing.so'],['other.so']]:
            with self.assertRaises(ValueError):validate_receipt(self.report,names)
        self.report['missingNames']=['fictional.so']
        with self.assertRaises(ValueError):validate_receipt(self.report,['fictional.so'])

    def test_invalid_provenance_rejected(self):
        for key,value in [('sha256','bad'),('bytes',0),('resolvedPath','/tmp/escape'),('path','/lib/../escape')]:
            report=copy.deepcopy(self.report);report['libraries'][0][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):validate_receipt(report,['fictional.so'])
        self.report['packages']=[]
        with self.assertRaises(ValueError):validate_receipt(self.report,['fictional.so'])

    def test_execution_claim_or_architecture_mismatch_rejected(self):
        for key in ['parserExecuted','libraryLoadingTested']:
            report=copy.deepcopy(self.report);report[key]=True
            with self.assertRaises(ValueError):validate_receipt(report,['fictional.so'])
        self.package['architecture']='arm64'
        with self.assertRaises(ValueError):validate_receipt(self.report,['fictional.so'])
