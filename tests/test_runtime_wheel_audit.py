import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path
from tools.audit_runtime_wheels import audit_wheel, audit_directory


class WheelAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'fictional-1-py3-none-any.whl'

    def wheel(self, extra=(), metadata=b'Name: fictional\nVersion: 1\nRequires-Dist: example>=2\nLicense-Expression: MIT\nProvides-Extra: native\n'):
        with warnings.catch_warnings(), zipfile.ZipFile(self.path, 'w') as archive:
            warnings.simplefilter('ignore', UserWarning)
            archive.writestr('fictional-1.dist-info/METADATA', metadata)
            archive.writestr('fictional-1.dist-info/licenses/LICENSE', 'Fictional test notice, not upstream software.')
            for name, data in extra:
                archive.writestr(name, data)

    def test_inventory_retains_requirements_and_notice_hashes_without_execution(self):
        self.wheel([('fictional/__init__.py', "raise RuntimeError('must never execute')"), ('fictional-1.dist-info/licenses/vendor/terms.txt', 'Fictional bundled terms')])
        result = audit_wheel(self.path)
        self.assertEqual(result['requiresDist'], ['example>=2'])
        self.assertEqual(result['providesExtra'], ['native'])
        self.assertEqual(result['approval'], 'unreviewed_runtime_artifact')
        self.assertEqual(len(result['notices'][0]['sha256']), 64)
        self.assertEqual(len(result['notices']), 2)
        self.assertFalse((self.path.parent/'fictional').exists())

    def test_rejects_paths_duplicates_and_ambiguous_metadata(self):
        for path in ['../escape', '/absolute', 'bad\\name', 'fictional-1.dist-info/METADATA', 'second.dist-info/METADATA']:
            with self.subTest(path=path):
                self.wheel([(path, b'')])
                with self.assertRaises(ValueError):
                    audit_wheel(self.path)

    def test_rejects_invalid_identity_and_expansion(self):
        for metadata in [b'Name: bad name\nVersion: 1\n', b'Name: fictional\n', b'x'*(4*1024*1024+1)]:
            self.wheel(metadata=metadata)
            with self.assertRaises(ValueError):
                audit_wheel(self.path)

    def test_rejects_empty_or_duplicate_target(self):
        with self.assertRaises(ValueError):
            audit_directory(self.path.parent)
        self.wheel()
        (self.path.parent/'another.whl').write_bytes(self.path.read_bytes())
        with self.assertRaises(ValueError):
            audit_directory(self.path.parent)
