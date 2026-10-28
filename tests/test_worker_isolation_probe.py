import copy
import unittest
from tools.probe_worker_isolation import container_args, check_configuration


class WorkerIsolationPolicyTests(unittest.TestCase):
    def setUp(self):
        self.info = {'Config': {'User': '65534:65534'}, 'HostConfig': {
            'NetworkMode': 'none', 'ReadonlyRootfs': True, 'CapDrop': ['ALL'],
            'Privileged': False, 'SecurityOpt': ['no-new-privileges:true'],
            'Memory': 134217728, 'MemorySwap': 134217728,
            'NanoCpus': 500000000, 'PidsLimit': 32},
            'Mounts': [{'Destination': '/original', 'RW': False}]}

    def test_rejects_weakened_boundaries(self):
        for field, value in [('NetworkMode', 'host'), ('ReadonlyRootfs', False),
                             ('CapDrop', []), ('Privileged', True), ('SecurityOpt', []),
                             ('Memory', 0), ('MemorySwap', -1), ('NanoCpus', 0),
                             ('PidsLimit', 0)]:
            with self.subTest(field=field):
                info = copy.deepcopy(self.info)
                info['HostConfig'][field] = value
                with self.assertRaises(AssertionError):
                    check_configuration(info)

    def test_rejects_root_and_writable_original(self):
        check_configuration(self.info)
        self.info['Config']['User'] = '0'
        with self.assertRaises(AssertionError):
            check_configuration(self.info)
        self.info['Config']['User'] = '65534:65534'
        self.info['Mounts'][0]['RW'] = True
        with self.assertRaises(AssertionError):
            check_configuration(self.info)

    def test_no_tag_or_shell_interpolation(self):
        for image in ['postgres:15', '--privileged', 'sha256:short']:
            with self.assertRaises(ValueError):
                container_args('test', image, '/fixture', '/output')
        args = container_args('test', 'sha256:' + 'a' * 64,
                              '/fictional path/$(no-execution)', '/output')
        self.assertIn('--pull=never', args)
        self.assertIn('type=bind,src=/fictional path/$(no-execution),dst=/original,readonly', args)
        self.assertNotIn('--privileged', args)


if __name__ == '__main__':
    unittest.main()
