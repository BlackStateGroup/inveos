#!/usr/bin/env python3
"""Research-only catalogue explorer and pinned, git-ignored source acquisition.

No third-party source is committed or executed. This script never runs a clone's own
build scripts. GitHub metadata is not evidence of full licence approval.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CATALOGUE = ROOT / 'research' / 'projects.json'
LOCKED = ROOT / 'research' / 'locked_revisions.json'
MIRRORS = ROOT / '.research-cache' / 'sources'
PERMISSIVE_METADATA = {'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'CC0-1.0'}


def load():
    catalog = json.loads(CATALOGUE.read_text(encoding='utf-8'))['records']
    locked = json.loads(LOCKED.read_text(encoding='utf-8'))['repositories']
    return {x['repository']: x for x in catalog}, {x['repository']: x for x in locked}


def run(argv, cwd=None):
    print('$', ' '.join(str(x) for x in argv))
    subprocess.run(argv, cwd=cwd, check=True)


def source_folder(name: str) -> pathlib.Path:
    # Prevent path traversal even if a future user edits a JSON file.
    parts = name.split('/')
    if len(parts) != 2 or any(not p or p in ('.', '..') or not all(c.isalnum() or c in '._-' for c in p) for p in parts):
        raise ValueError('Invalid owner/repository identifier')
    return MIRRORS.joinpath(*parts)


def fetch_one(name, catalogue, locks, allow_study=False):
    if name not in catalogue:
        raise ValueError(f'{name}: not present in catalogue')
    if name not in locks:
        raise ValueError(f'{name}: no pinned commit; add a verified 40-character SHA before fetching')
    data = catalogue[name]
    licence = data['github_spdx_metadata']
    if licence not in PERMISSIVE_METADATA and not allow_study:
        raise ValueError(f'{name}: GitHub-reported {licence}; pass --allow-study-only for a LOCAL licence investigation. Never incorporate unreviewed source.')
    sha = locks[name]['commit']
    if len(sha) != 40 or not all(c in '0123456789abcdef' for c in sha):
        raise ValueError('Invalid pinned SHA')
    dest = source_folder(name)
    if dest.exists() and not (dest / '.git').is_dir():
        raise ValueError(f'Refusing to overwrite non-git path: {dest}')
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        dest.mkdir()
        run(['git', 'init', '--quiet', str(dest)])
        run(['git', '-C', str(dest), 'remote', 'add', 'origin', data['url'] + '.git'])
    # Untrusted repositories are never run as part of checkout.
    run(['git', '-C', str(dest), 'fetch', '--no-tags', '--depth=1', 'origin', sha])
    run(['git', '-C', str(dest), '-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', '--force', sha])
    result = subprocess.check_output(['git', '-C', str(dest), 'rev-parse', 'HEAD'], text=True).strip()
    if result != sha:
        raise RuntimeError(f'Pinned SHA mismatch for {name}: {result}')
    licence_files = []
    for path in dest.iterdir():
        if path.is_file() and path.name.upper().startswith(('LICENSE', 'LICENCE', 'COPYING')):
            licence_files.append({'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    receipt = {'repository': name, 'url': data['url'], 'pinned_commit': sha,
               'checked_out_commit': result, 'github_spdx_metadata': licence,
               'licence_files': licence_files,
               'notice': 'LOCAL RESEARCH COPY ONLY. Licence/security/data terms are not approved.'}
    # Use an external receipt file rather than modifying the upstream checkout.
    receipt_dir = ROOT / '.research-cache' / 'receipts'
    receipt_dir.mkdir(parents=True, exist_ok=True)
    (receipt_dir / (name.replace('/', '__') + '.json')).write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    print(f'Pinned research checkout: {dest} @ {sha}')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument('--list', action='store_true')
    group.add_argument('--audit', action='store_true')
    group.add_argument('--fetch', metavar='OWNER/REPO')
    group.add_argument('--fetch-all-permissive', action='store_true')
    ap.add_argument('--priority', choices=['P0', 'P1', 'P2'])
    ap.add_argument('--limit', type=int, default=3, help='Maximum repos for batch fetch; 3 by default to limit storage')
    ap.add_argument('--allow-study-only', action='store_true', help='Permit LOCAL cloning of a pinned copyleft/unknown licence project for review only')
    args = ap.parse_args()
    catalogue, locks = load()
    if args.list:
        for x in catalogue.values():
            if args.priority and x['priority'] != args.priority:
                continue
            print(f"{x['priority']:2} {x['disposition']:9} {x['github_spdx_metadata']:13} {x['repository']}")
        return 0
    if args.audit:
        for name, x in sorted(locks.items()):
            dest = source_folder(name)
            if not dest.exists():
                print(f'NOT FETCHED: {name} @ {x["commit"]}')
                continue
            head = subprocess.check_output(['git','-C',str(dest),'rev-parse','HEAD'],text=True).strip()
            print(f'{"OK" if head == x["commit"] else "MISMATCH"}: {name} @ {head}')
            if head != x['commit']:
                return 2
        return 0
    if args.fetch:
        fetch_one(args.fetch, catalogue, locks, args.allow_study_only)
        return 0
    if args.limit < 1 or args.limit > 20:
        ap.error('--limit must be in 1..20')
    eligible = [r['repository'] for r in catalogue.values()
                if r['repository'] in locks and r['github_spdx_metadata'] in PERMISSIVE_METADATA
                and r['disposition'] == 'candidate'][:args.limit]
    print(f'Fetching {len(eligible)} PINNED permissive-metadata candidates for LOCAL research only')
    for name in eligible:
        fetch_one(name, catalogue, locks)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, subprocess.CalledProcessError, FileNotFoundError, RuntimeError) as exc:
        print(f'RESEARCH ACQUISITION FAILED: {exc}', file=sys.stderr)
        sys.exit(1)
