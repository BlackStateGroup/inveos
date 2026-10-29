#!/usr/bin/env python3
"""Inspect acquired wheel metadata/notices without importing or extracting code."""
import argparse
from email.parser import BytesParser
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import zipfile

MAX_WHEEL = 256 * 1024 * 1024
MAX_ENTRY = 4 * 1024 * 1024


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def audit_wheel(path):
    if path.stat().st_size > MAX_WHEEL:
        raise ValueError('Wheel exceeds audit size limit')
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        names = [e.filename for e in entries]
        if len(names) > 20000 or len(set(names)) != len(names):
            raise ValueError('Duplicate or excessive archive entries')
        if any(n.startswith('/') or '\\' in n or '..' in PurePosixPath(n).parts for n in names):
            raise ValueError('Unsafe archive path')
        metadata = [n for n in names if n.endswith('.dist-info/METADATA')]
        if len(metadata) != 1:
            raise ValueError('Exactly one distribution metadata file required')
        selected = [n for n in names if n == metadata[0] or
                    (not n.endswith('/') and (re.search(r'(^|/)(licen[cs]e[^/]*|copying[^/]*|notice[^/]*)$', n, re.I) or any('license' in part.lower() or 'licence' in part.lower() for part in PurePosixPath(n).parts[:-1])))]
        if sum(archive.getinfo(n).file_size for n in selected) > 16 * 1024 * 1024:
            raise ValueError('Metadata/notice budget exceeded')
        def read(name):
            if archive.getinfo(name).file_size > MAX_ENTRY:
                raise ValueError('Metadata/notice entry too large')
            return archive.read(name)
        meta = BytesParser().parsebytes(read(metadata[0]))
        name, version = meta.get('Name'), meta.get('Version')
        if not name or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', name):
            raise ValueError('Invalid distribution name')
        if not version or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.!+_-]*', version):
            raise ValueError('Invalid distribution version')
        notices = [{'path': n, 'sha256': hashlib.sha256(read(n)).hexdigest(),
                    'bytes': archive.getinfo(n).file_size} for n in selected if n != metadata[0]]
        return {'name': name, 'version': version, 'filename': path.name,
                'sha256': sha256(path), 'bytes': path.stat().st_size,
                'requiresPython': meta.get('Requires-Python'),
                'requiresDist': meta.get_all('Requires-Dist', []),
                'providesExtra': meta.get_all('Provides-Extra', []),
                'licenceExpression': meta.get('License-Expression'),
                'licenceDeclaration': meta.get('License') if len(meta.get('License', '')) <= 200 else None,
                'licenceDeclarationSha256': hashlib.sha256(meta.get('License', '').encode()).hexdigest(),
                'licenceClassifiers': [c for c in meta.get_all('Classifier', []) if c.startswith('License ::')],
                'notices': notices, 'approval': 'unreviewed_runtime_artifact'}


def audit_directory(directory):
    paths = sorted(directory.glob('*.whl'))
    if not paths or len(paths) > 200:
        raise ValueError('Expected 1–200 wheels')
    result = [audit_wheel(p) for p in paths]
    names = [re.sub(r'[-_.]+', '-', r['name']).lower() for r in result]
    if len(set(names)) != len(names):
        raise ValueError('Multiple artifacts for one distribution; select one target')
    return sorted(result, key=lambda r: r['name'].lower())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--lock', type=Path, required=True)
    args = parser.parse_args()
    records = audit_directory(args.directory)
    args.output.write_text(json.dumps({'schemaVersion': 1, 'executed': False,
        'approval': 'research_only_not_incorporation', 'artifacts': records}, indent=2)+'\n')
    args.lock.write_text('# Research acquisition lock; not an approved runtime.\n'+''.join(
        f"{r['name']}=={r['version']} --hash=sha256:{r['sha256']}\n" for r in records))


if __name__ == '__main__':
    main()
