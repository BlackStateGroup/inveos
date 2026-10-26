#!/usr/bin/env python3
"""Validate repository sources; optionally verify the original archive manifest."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
REQUIRED = [
    'README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'DELIVERY_STATUS.md',
    'docs/INDEX.md', 'docs/01_VISION.md', 'docs/02_PRODUCT_REQUIREMENTS.md',
    'docs/06_ARCHITECTURE.md', 'docs/07_DATA_MODEL.md', 'docs/08_EVIDENCE_INTEGRITY.md',
    'docs/09_AI_ANALYST.md', 'docs/11_SECURITY_LEGAL.md', 'docs/13_ROADMAP.md',
    'docs/14_TEST_PLAN.md', 'docs/21_ENGINEERING_WORKPACKAGES.md',
    'research/CATALOGUE.md', 'research/ACQUISITION.md', 'research/LICENCE_REVIEW.md',
    'research/projects.json', 'research/locked_revisions.json',
    'specs/claim.schema.json', 'specs/evidence_receipt.schema.json',
    'specs/openapi.yaml', 'tools/mine_sources.py', 'examples/evidence_flow_demo.py',
    'examples/README.md', 'tests/test_evidence_flow_demo.py', 'MANIFEST.sha256',
]
IGNORED_DIRS = {
    '.git', '.research-cache', '__pycache__', 'node_modules', '.venv',
    '.pytest_cache', 'dist', 'build', 'coverage', '.local-data',
    'secrets', 'private-data',
}


def source_files(root: pathlib.Path) -> list[pathlib.Path]:
    if (root / '.git').exists():
        result = subprocess.run(
            ['git', '-C', str(root), 'ls-files', '--cached', '--others',
             '--exclude-standard', '-z'], check=True, capture_output=True,
        )
        paths = {root / os.fsdecode(name) for name in result.stdout.split(b'\0') if name}
    else:
        paths = set()
        for directory, children, files in os.walk(root):
            children[:] = [name for name in children if name not in IGNORED_DIRS]
            paths.update(pathlib.Path(directory) / name for name in files
                         if not name.startswith('.env') or name == '.env.example')
    return sorted(path for path in paths if path.is_file() and not path.is_symlink()
                  and path.suffix not in ('.pyc', '.pyo'))


def manifest_errors(root: pathlib.Path, files: list[pathlib.Path], verify: bool) -> list[str]:
    errors = []
    expected = {}
    for line in (root / 'MANIFEST.sha256').read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        parts = line.split('  ', 1)
        if len(parts) != 2:
            errors.append('Malformed manifest line')
            continue
        digest, rel = parts
        path = pathlib.PurePosixPath(rel)
        if (not re.fullmatch('[0-9a-f]{64}', digest) or rel in expected
                or path.is_absolute() or '..' in path.parts):
            errors.append('Malformed or repeated manifest entry: ' + rel)
            continue
        expected[rel] = digest
        if not (root / rel).is_file():
            errors.append('Missing original foundation file: ' + rel)
    if verify:
        observed = {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                    for path in files if path.name != 'MANIFEST.sha256'}
        if observed != expected:
            missing = sorted(set(expected) - set(observed))
            extra = sorted(set(observed) - set(expected))
            changed = sorted(key for key in expected.keys() & observed.keys()
                             if expected[key] != observed[key])
            errors.append(f'Archive manifest mismatch: missing={missing}, unlisted={extra}, modified={changed}')
    return errors


def validate(root: pathlib.Path, verify_archive: bool = False) -> list[str]:
    errors = []
    for rel in REQUIRED:
        path = root / rel
        if not path.is_file() or not path.stat().st_size:
            errors.append(f'Missing or empty: {rel}')
    files = source_files(root)
    for path in files:
        if path.suffix == '.json':
            try:
                json.loads(path.read_text(encoding='utf-8'))
            except (ValueError, UnicodeError) as error:
                errors.append(f'Invalid JSON {path.relative_to(root)}: {error}')
    try:
        catalogue = json.loads((root / 'research/projects.json').read_text())['records']
        locks = json.loads((root / 'research/locked_revisions.json').read_text())['repositories']
    except (OSError, ValueError, KeyError):
        errors.append('Catalogue or pin ledger missing or invalid')
        return errors
    seen = set()
    for item in catalogue:
        name = item.get('repository', '')
        if name in seen:
            errors.append('Duplicate catalogue item ' + name)
        seen.add(name)
        if item.get('url') != 'https://github.com/' + name:
            errors.append('URL mismatch ' + name)
        if item.get('github_spdx_metadata') == 'NOASSERTION' and item.get('disposition') == 'candidate':
            errors.append('Inconclusive licence marked candidate ' + name)
    for item in locks:
        if item['repository'] not in seen:
            errors.append('Pinned repo missing catalogue ' + item['repository'])
        if not re.fullmatch('[a-f0-9]{40}', item['commit']):
            errors.append('Bad SHA for ' + item['repository'])
    if len(catalogue) < 50:
        errors.append('Catalogue unexpectedly small')
    if len(locks) < 15:
        errors.append('Pin ledger unexpectedly small')
    for path in files:
        if path.suffix != '.md':
            continue
        for raw in re.findall(r'\]\(([^)]+)\)', path.read_text(encoding='utf-8')):
            target = raw.split('#', 1)[0]
            if not target or '://' in target or target.startswith(('mailto:', '/')):
                continue
            destination = (path.parent / target).resolve()
            if not destination.is_relative_to(root) or not destination.exists():
                errors.append(f'Broken link in {path.relative_to(root)} -> {target}')
    if (root / 'MANIFEST.sha256').is_file():
        errors.extend(manifest_errors(root, files, verify_archive))
    return errors


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-archive', action='store_true',
                        help='Require exact original archive hashes; expected to fail on developed sources.')
    args = parser.parse_args()
    failures = validate(ROOT, args.verify_archive)
    if failures:
        print('FOUNDATION CHECK FAILED')
        for failure in failures:
            print(' -', failure)
        raise SystemExit(1)
    mode = 'original archive hashes verified' if args.verify_archive else 'source validation; original archive hashes NOT verified'
    print(f'FOUNDATION CHECK OK: {len(REQUIRED)} essential files, catalogue, pins, JSON and local Markdown links; {mode}')
