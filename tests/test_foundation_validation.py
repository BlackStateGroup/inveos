import hashlib
import pathlib
import tempfile
import unittest

from tools.validate_foundation import manifest_errors, source_files


class FoundationValidationTests(unittest.TestCase):
    def test_source_inventory_excludes_local_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / 'source.json').write_text('{}')
            (root / 'node_modules').mkdir()
            (root / 'node_modules/broken.json').write_text('not JSON')
            (root / '.local-data').mkdir()
            (root / '.local-data/original.txt').write_text('synthetic source')
            (root / '.env').write_text('LOCAL_CONFIGURATION=not-distributed')
            self.assertEqual([root / 'source.json'], source_files(root))

    def test_archive_check_detects_modified_and_added_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source = root / 'source.txt'
            source.write_bytes(b'original')
            digest = hashlib.sha256(b'original').hexdigest()
            (root / 'MANIFEST.sha256').write_text(f'{digest}  source.txt\n')
            self.assertEqual([], manifest_errors(root, source_files(root), True))
            source.write_bytes(b'changed')
            (root / 'new.txt').write_bytes(b'new')
            self.assertEqual([], manifest_errors(root, source_files(root), False))
            errors = manifest_errors(root, source_files(root), True)
            self.assertIn("unlisted=['new.txt']", errors[0])
            self.assertIn("modified=['source.txt']", errors[0])

    def test_source_mode_still_rejects_missing_original_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / 'MANIFEST.sha256').write_text(f'{"0" * 64}  missing.txt\n')
            self.assertEqual(['Missing original foundation file: missing.txt'],
                             manifest_errors(root, source_files(root), False))


if __name__ == '__main__':
    unittest.main()
