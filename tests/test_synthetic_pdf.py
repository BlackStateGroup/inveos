import copy
import unittest
from tools.synthetic_pdf import digital_pdf
from tools.probe_worker_isolation import container_args,check_configuration,RUNTIME_SCRATCH
from tests import test_worker_isolation_probe as policy_tests

class SyntheticPdfTests(unittest.TestCase):
    def test_pdf_offsets_and_repeated_truth(self):
        data=digital_pdf()
        self.assertEqual(data,digital_pdf())
        self.assertEqual(data.count(b'(FICTIONAL INVEOS repeated passage)'),2)
        xref=int(data.split(b'startxref\n')[1].splitlines()[0])
        self.assertEqual(data[xref:xref+4],b'xref')
        for n,line in enumerate(data[xref:].splitlines()[3:10],1):
            offset=int(line[:10]);self.assertTrue(data[offset:].startswith(f'{n} 0 obj'.encode()))

    def test_runtime_profile_is_explicit_and_still_enforced(self):
        fixture=policy_tests.WorkerIsolationPolicyTests();fixture.setUp();info=copy.deepcopy(fixture.info)
        info['HostConfig']['Memory']=info['HostConfig']['MemorySwap']=1073741824
        info['HostConfig']['Tmpfs']['/scratch']=RUNTIME_SCRATCH
        check_configuration(info,runtime=True)
        with self.assertRaises(ValueError):check_configuration(info)
        info['HostConfig']['NetworkMode']='host'
        with self.assertRaises(ValueError):check_configuration(info,runtime=True)
        args=container_args('test','sha256:'+'a'*64,'/fixture',runtime=True)
        self.assertIn('--memory=1024m',args)
        self.assertIn('--network=none',args)
