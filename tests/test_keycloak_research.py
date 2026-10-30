"""First-party acquisition boundaries only; not actual provider/MFA evidence."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tools import qualify_keycloak as keycloak


class KeycloakAcquisitionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='inveos-fictional-provider-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cache = self.root / 'cache'
        self.cache.mkdir()
        patcher = patch.object(keycloak, 'CACHE', self.cache)
        patcher.start()
        self.addCleanup(patcher.stop)

    def acquire(self, fetch=False):
        return keycloak.acquire('fixture', 'https://fictional.invalid/unused', keycloak.sha(b'fictional'), 9, fetch)

    def test_exact_cached_bytes_work_offline_but_changed_bytes_fail(self):
        path = self.cache / 'fixture'
        path.write_bytes(b'fictional')
        with patch('urllib.request.urlopen', side_effect=AssertionError('No network allowed')):
            self.assertEqual(self.acquire(), b'fictional')
            path.write_bytes(b'Fictional')
            with self.assertRaisesRegex(ValueError, 'digest changed'):
                self.acquire()
            path.write_bytes(b'fictional oversized')
            with self.assertRaisesRegex(ValueError, 'Missing/unsafe'):
                self.acquire()

    def test_missing_offline_artifact_does_not_fetch(self):
        with patch('urllib.request.urlopen', side_effect=AssertionError('No network allowed')):
            with self.assertRaisesRegex(ValueError, 'Missing/unsafe'):
                self.acquire()

    def test_broken_file_and_parent_symlinks_never_write_outside_cache(self):
        victim = self.root / 'must-not-be-created'
        (self.cache / 'fixture').symlink_to(victim)
        with patch('urllib.request.urlopen', side_effect=AssertionError('Symlink must fail before acquisition')):
            with self.assertRaisesRegex(ValueError, 'Symlinked artifact'):
                self.acquire(True)
        self.assertFalse(victim.exists())
        (self.cache / 'fixture').unlink()
        self.cache.rmdir()
        self.cache.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'Symlinked research cache'):
            self.acquire(True)
