import copy
import unittest
import subprocess
import sys
import json
from tools.probe_worker_isolation import container_args, check_configuration, volume_overrides, SCRATCH


class WorkerIsolationPolicyTests(unittest.TestCase):
    def setUp(self):
        self.info = {'Config': {'User': '65534:65534'}, 'HostConfig': {
            'NetworkMode': 'none', 'ReadonlyRootfs': True, 'CapDrop': ['ALL'],
            'LogConfig': {'Type': 'none'},
            'Privileged': False, 'SecurityOpt': ['no-new-privileges:true'],
            'Tmpfs': {'/scratch': SCRATCH, '/output': SCRATCH},
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
                with self.assertRaises(ValueError):
                    check_configuration(info)
        info = copy.deepcopy(self.info)
        info['HostConfig']['LogConfig']['Type'] = 'json-file'
        with self.assertRaises(ValueError):
            check_configuration(info)

    def test_rejects_root_and_writable_original(self):
        check_configuration(self.info)
        self.info['Config']['User'] = '0'
        with self.assertRaises(ValueError):
            check_configuration(self.info)
        self.info['Config']['User'] = '65534:65534'
        self.info['Mounts'][0]['RW'] = True
        with self.assertRaises(ValueError):
            check_configuration(self.info)

    def test_no_tag_or_shell_interpolation(self):
        for image in ['postgres:15', '--privileged', 'sha256:short']:
            with self.assertRaises(ValueError):
                container_args('test', image, '/fixture')
        args = container_args('test', 'sha256:' + 'a' * 64,
                              '/fictional path/$(no-execution)')
        self.assertIn('--pull=never', args)
        self.assertIn('--log-driver=none', args)
        self.assertIn('type=bind,src=/fictional path/$(no-execution),dst=/original,readonly', args)
        self.assertNotIn('--privileged', args)

    def test_optimised_python_still_rejects_root(self):
        self.info['Config']['User'] = '0'
        result = subprocess.run([sys.executable, '-O', '-c',
            'import json,sys; from tools.probe_worker_isolation import check_configuration; check_configuration(json.loads(sys.argv[1]))',
            json.dumps(self.info)], capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('ValueError', result.stderr)

    def test_image_volumes_are_read_only_and_paths_restricted(self):
        self.assertIn('ro,', volume_overrides(['/var/lib/postgresql/data'])['/var/lib/postgresql/data'])
        for paths in [['/'], ['/output'], ['/scratch/nested'], ['/proc'], ['/var/../escape'], ['/var;echo'], ['/var', '/var/lib'], ['/v'+str(i) for i in range(9)]]:
            with self.subTest(paths=paths), self.assertRaises(ValueError):
                volume_overrides(paths)

    def test_unbounded_output_and_extra_mounts_are_rejected(self):
        for mount in [{'Destination':'/output','RW':True,'Type':'bind'},
                      {'Destination':'/other','RW':False,'Type':'bind'}]:
            info=copy.deepcopy(self.info)
            info['Mounts'].append(mount)
            with self.assertRaises(ValueError):
                check_configuration(info)
        self.info['HostConfig']['Tmpfs']['/output']='rw'
        with self.assertRaises(ValueError):
            check_configuration(self.info)


if __name__ == '__main__':
    unittest.main()
