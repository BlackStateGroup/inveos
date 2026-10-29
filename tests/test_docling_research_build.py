import io
import unittest
import zipfile

from tools.build_docling_research import digest, safe_path, validate_project, verify_built_wheel


class DoclingResearchBuildTests(unittest.TestCase):
    def setUp(self):
        self.files = {'docling/example.py': b'# FICTIONAL source\n',
                      'docling/py.typed': b'', 'LICENSE': b'FICTIONAL notice\n'}
        self.manifest = {p: {'sha256': digest(b), 'bytes': len(b)} for p, b in self.files.items()}

    def wheel(self, change=None):
        files = {p if p.startswith('docling/') else 'docling_slim-2.142.1.dist-info/licenses/'+p: b for p, b in self.files.items()}
        if change:
            change(files)
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            for path, data in files.items():
                archive.writestr(path, data)
        return stream.getvalue()

    def test_exact_source_set_and_licence_preserved(self):
        result = verify_built_wheel(self.wheel(), self.manifest)
        self.assertEqual(result['matchedPackageFiles'], 2)
        self.assertEqual(result['wheelSha256'], digest(self.wheel()))

    def test_changed_missing_extra_and_escaping_files_rejected(self):
        for mutate in [lambda f: f.update({'docling/example.py': b'# altered\n'}),
                       lambda f: f.pop('docling/py.typed'),
                       lambda f: f.update({'docling/extra.py': b'pass'}),
                       lambda f: f.update({'other.py': b'pass'}),
                       lambda f: f.update({'../outside': b'pass'}),
                       lambda f: f.update({'docling_slim-2.142.1.dist-info/licenses/LICENSE': b'changed'})]:
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                verify_built_wheel(self.wheel(mutate), self.manifest)

    def test_size_budget_and_paths(self):
        with self.assertRaises(ValueError):
            verify_built_wheel(b'x'*(2*1024*1024+1), self.manifest)
        for path in ['', '/tmp/file', '../file', 'a/../b', 'a//b', 'a\\b', 'a/./b']:
            self.assertFalse(safe_path(path))
        self.assertTrue(safe_path('docling/py.typed'))

    def test_only_audited_backend_configuration_allowed(self):
        project = b'''[build-system]
requires=["hatchling"]
build-backend="hatchling.build"
[project]
name="docling-slim"
version="2.142.1"
[tool.hatch.build.targets.wheel]
packages=["docling"]
[tool.hatch.build.targets.sdist]
only-include=["docling","pyproject.toml","README.md","LICENSE"]
'''
        validate_project(project)
        for changed in [project.replace(b'hatchling.build', b'evil.build'),
                        project.replace(b'2.142.1', b'2.142.2'),
                        project+b'[tool.hatch.build.hooks.custom]\npath="hook.py"\n']:
            with self.assertRaises(ValueError):
                validate_project(changed)


if __name__ == '__main__':
    unittest.main()
