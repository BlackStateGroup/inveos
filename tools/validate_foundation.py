#!/usr/bin/env python3
"""Static integrity checks for the INVEOS blueprint and synthetic reference."""
from __future__ import annotations
import json
import hashlib
import pathlib
import re
import sys

ROOT=pathlib.Path(__file__).resolve().parent.parent
required=[
    'README.md','AGENTS.md','CONTRIBUTING.md','DELIVERY_STATUS.md','docs/INDEX.md','docs/01_VISION.md',
    'docs/02_PRODUCT_REQUIREMENTS.md','docs/06_ARCHITECTURE.md','docs/07_DATA_MODEL.md',
    'docs/08_EVIDENCE_INTEGRITY.md','docs/09_AI_ANALYST.md','docs/11_SECURITY_LEGAL.md',
    'docs/13_ROADMAP.md','docs/14_TEST_PLAN.md','docs/21_ENGINEERING_WORKPACKAGES.md',
    'research/CATALOGUE.md','research/ACQUISITION.md','research/LICENCE_REVIEW.md',
    'research/projects.json','research/locked_revisions.json','specs/claim.schema.json',
    'specs/evidence_receipt.schema.json','specs/openapi.yaml','tools/mine_sources.py',
    'examples/evidence_flow_demo.py','examples/README.md','tests/test_evidence_flow_demo.py', 'MANIFEST.sha256']
errors=[]
for path in required:
    p=ROOT/path
    if not p.is_file() or not p.stat().st_size:errors.append(f'Missing or empty: {path}')
for p in ROOT.rglob('*.json'):
    try:json.loads(p.read_text(encoding='utf-8'))
    except Exception as e:errors.append(f'Invalid JSON {p.relative_to(ROOT)}: {e}')
cat=json.loads((ROOT/'research/projects.json').read_text())['records']
locks=json.loads((ROOT/'research/locked_revisions.json').read_text())['repositories']
seen=set()
for item in cat:
    name=item.get('repository','')
    if name in seen:errors.append('Duplicate catalogue item '+name)
    seen.add(name)
    if item.get('url') != 'https://github.com/'+name:errors.append('URL mismatch '+name)
    if item.get('github_spdx_metadata')=='NOASSERTION' and item.get('disposition')=='candidate':errors.append('Inconclusive licence marked candidate '+name)
for item in locks:
    if item['repository'] not in seen:errors.append('Pinned repo missing catalogue '+item['repository'])
    if not re.fullmatch('[a-f0-9]{40}',item['commit']):errors.append('Bad SHA for '+item['repository'])
if len(cat)<50:errors.append('Catalogue unexpectedly small')
if len(locks)<15:errors.append('Pin ledger unexpectedly small')
# Check relative Markdown links. External and in-document anchors excluded.
mdlink=re.compile(r'\]\(([^)]+)\)')
for p in ROOT.rglob('*.md'):
    txt=p.read_text(encoding='utf-8')
    for raw in mdlink.findall(txt):
        target=raw.split('#',1)[0]
        if not target or '://' in target or target.startswith(('mailto:', '/')):continue
        dest=(p.parent/target).resolve()
        if not dest.is_relative_to(ROOT) or not dest.exists():errors.append(f'Broken link in {p.relative_to(ROOT)} -> {target}')
# Independently verify included files. Deliberately omit .git, bytecode and local source mirrors.
manifest = ROOT / 'MANIFEST.sha256'
if manifest.is_file():
    expected = {}
    for line in manifest.read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        try:
            digest, rel = line.split('  ', 1)
        except ValueError:
            errors.append('Malformed manifest line')
            continue
        if not re.fullmatch('[0-9a-f]{64}', digest) or rel in expected:
            errors.append('Malformed or repeated manifest entry: ' + rel)
            continue
        expected[rel] = digest
    observed = {}
    for item in ROOT.rglob('*'):
        if not item.is_file():
            continue
        relative = item.relative_to(ROOT)
        if (item.name == 'MANIFEST.sha256' or '.git' in relative.parts or '.research-cache' in relative.parts
                or '__pycache__' in relative.parts or item.suffix in ('.pyc', '.pyo')):
            continue
        observed[relative.as_posix()] = hashlib.sha256(item.read_bytes()).hexdigest()
    if observed != expected:
        missing = sorted(set(expected) - set(observed))
        extra = sorted(set(observed) - set(expected))
        changed = sorted(k for k in set(expected)&set(observed) if expected[k] != observed[k])
        errors.append(f'Manifest mismatch: missing={missing}, unlisted={extra}, modified={changed}')
if errors:
    print('FOUNDATION CHECK FAILED')
    for e in errors:print(' -',e)
    sys.exit(1)
print(f'FOUNDATION CHECK OK: {len(required)} essential files, {len(cat)} GitHub candidates, {len(locks)} full commit locks, JSON and local Markdown links valid')
