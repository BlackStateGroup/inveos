#!/usr/bin/env python3
"""Read-only inventory of three pinned research checkouts; no upstream execution.

Outputs INVEOS-authored metadata and hashes, not third-party source. This is a
source/dependency inventory, not a resolved SBOM or vulnerability clearance.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import tomllib
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
TARGETS = {'docling-project/docling': ['LICENSE', 'pyproject.toml', 'packages/docling/pyproject.toml'],
           'ocrmypdf/OCRmyPDF': ['LICENSE', 'pyproject.toml', 'docs/installation.md', 'docs/cookbook.md'],
           'apache/tika': ['LICENSE.txt', 'NOTICE.txt', 'tika-parent/pom.xml',
              'tika-parsers/tika-parsers-standard/tika-parsers-standard-modules/tika-parser-pdf-module/pom.xml']}


def audit():
    locks = {r['repository']: r for r in json.loads((ROOT / 'research/locked_revisions.json').read_text())['repositories']}
    result = []
    for repo, paths in TARGETS.items():
        root = ROOT / '.research-cache/sources' / repo
        head = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
        if head != locks[repo]['commit']:
            raise ValueError('Pin mismatch: ' + repo)
        if subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain'], text=True).strip():
            raise ValueError('Dirty checkout: ' + repo)
        entry = {'repository': repo, 'commit': head, 'files': [],
                 'submodules_declared': (root / '.gitmodules').exists()}
        for path in paths:
            raw = (root / path).read_bytes()
            entry['files'].append({'path': path, 'sha256': hashlib.sha256(raw).hexdigest(),
                                  'url': f'https://github.com/{repo}/blob/{head}/{path}'})
        if (root / 'pyproject.toml').exists():
            project = tomllib.loads((root / 'pyproject.toml').read_text())['project']
            entry.update(package=project['name'], version=project['version'],
                         python=project['requires-python'], declared_dependencies=project['dependencies'],
                         optional_dependencies=project.get('optional-dependencies', {}))
        else:
            tree = ET.parse(root / 'tika-parent/pom.xml')
            ns = {'m': 'http://maven.apache.org/POM/4.0.0'}
            props = tree.find('m:properties', ns)
            entry['selected_build_properties'] = {x.tag.split('}')[1]: x.text for x in props
                if x.tag.split('}')[1] in ('javaVersion', 'pdfbox.version', 'poi.version')}
        result.append(entry)
    return {'schema': 'inveos.source-audit.v1', 'status': 'research_only_not_approved_dependencies',
            'resolved_sbom': False, 'vulnerability_scan': 'not_performed', 'repositories': result}


if __name__ == '__main__':
    print(json.dumps(audit(), indent=2, ensure_ascii=False))
