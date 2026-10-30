#!/usr/bin/env python3
"""Verify/acquire pinned speech research bytes and a source snapshot; never execute upstream code."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile
import time
import urllib.parse
import urllib.request
from .bounded_process import run_bounded

ROOT = Path(__file__).resolve().parents[1]
PIN = '231638a0717b7822784297e5980965ffcec05810'
LOCK = ROOT / 'research/runtime_artifacts/whisper-research-inputs.json'
SOURCE_PATHS = ['LICENSE', 'CMakeLists.txt', 'include', 'src', 'cmake', 'ggml/CMakeLists.txt', 'ggml/cmake', 'ggml/include', 'ggml/src']


def require(ok, message):
    if not ok:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def safe_url(value):
    url = urllib.parse.urlsplit(value)
    require(url.scheme == 'https' and not url.username and not url.password and url.port in (None, 443), 'HTTPS artifact origin required')
    host = url.hostname or ''
    require(host in ('github.com', 'raw.githubusercontent.com', 'release-assets.githubusercontent.com', 'huggingface.co') or host.endswith('.hf.co'), 'Unexpected artifact redirect origin')
    return value


class Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safe_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def safe_path(path):
    require(not any(p.is_symlink() for p in (path, *path.parents)), 'Symlink in research cache')


def artifact(item, cache, fetch=False):
    name = item['name']
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,100}', name) and '..' not in name, 'Unsafe artifact name')
    require(isinstance(item['bytes'], int) and 0 < item['bytes'] <= 100 * 1024 * 1024 and re.fullmatch('[a-f0-9]{64}', item['sha256']), 'Invalid artifact byte/hash lock')
    safe_url(item['url'])
    target = cache / name
    safe_path(target)
    if target.exists():
        require(target.is_file() and target.stat().st_size == item['bytes'], 'Cached artifact size/type differs')
        data = target.read_bytes()
    else:
        require(fetch, 'Artifact absent from offline cache: ' + name)
        start = time.monotonic()
        with urllib.request.build_opener(Redirects()).open(item['url'], timeout=20) as response:
            require(response.status == 200, 'Artifact HTTP response failed')
            chunks, size = [], 0
            while True:
                block = response.read(min(65536, item['bytes'] - size + 1))
                if not block:
                    break
                size += len(block)
                require(size <= item['bytes'] and time.monotonic() - start <= 120, 'Artifact byte/deadline bound')
                chunks.append(block)
            data = b''.join(chunks)
    require(len(data) == item['bytes'] and sha(data) == item['sha256'], 'Artifact content differs from lock')
    if not target.exists():
        cache.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + '.partial')
        safe_path(temporary)
        with temporary.open('xb') as handle:
            handle.write(data)
        temporary.replace(target)
    return data


def tar_entries(data, maximum=128 * 1024 * 1024):
    entries, total, names = {}, 0, set()
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:*') as archive:
        for item in archive:
            name = item.name.rstrip('/')
            require(name and '\\' not in name and not name.startswith('/') and all(p not in ('', '.', '..') for p in name.split('/')), 'Unsafe archive path')
            require(name not in names and len(names) < 12000, 'Duplicate/oversized archive inventory')
            names.add(name)
            require(item.isdir() or item.isfile(), 'Links/devices in archive are not supported')
            if item.isdir():
                continue
            total += item.size
            require(0 <= item.size <= 32 * 1024 * 1024 and total <= maximum, 'Archive expansion bound')
            entries[name] = archive.extractfile(item).read()
    require(entries, 'Empty research archive')
    return entries


def source_snapshot(source, lock):
    require(lock['sourceRevision'] == PIN, 'Unexpected source revision')
    result = run_bounded(['git', '-C', str(source), 'ls-tree', '-r', '-z', PIN, '--', *SOURCE_PATHS], max_output=1024 * 1024)
    require(result.returncode == 0, 'Pinned source objects unavailable')
    entries, total = {}, 0
    for row in result.stdout.rstrip(b'\0').split(b'\0'):
        header, raw_name = row.split(b'\t', 1)
        mode, kind, oid = header.decode().split(' ')
        name = raw_name.decode('utf-8')
        require(mode in ('100644', '100755') and kind == 'blob' and re.fullmatch(r'[A-Za-z0-9_.$/-]+', name) and '..' not in name and not name.startswith('/'), 'Unsafe source entry')
        # Only the CPU backend is built. Exclude other backends entirely.
        if name.startswith('ggml/src/') and '/' in name[len('ggml/src/'):] and not name.startswith('ggml/src/ggml-cpu/'):
            continue
        blob = run_bounded(['git', '-C', str(source), 'cat-file', 'blob', oid], max_output=16 * 1024 * 1024)
        require(blob.returncode == 0, 'Source blob unavailable')
        total += len(blob.stdout)
        require(total <= 64 * 1024 * 1024 and len(entries) < 2000, 'Source snapshot bounds')
        entries[name] = blob.stdout
    require(sha(entries['LICENSE']) == lock['sourceLicenceSha256'], 'Source licence differs from lock')
    return entries


def cmake_entries(data):
    entries = tar_entries(data, 256 * 1024 * 1024)
    prefix = 'cmake-3.31.8-linux-x86_64/'
    require(all(n.startswith(prefix) for n in entries), 'Unexpected CMake archive root')
    result = {n[len(prefix):]: b for n, b in entries.items()}
    require('bin/cmake' in result and any(n.endswith('Copyright.txt') for n in result), 'CMake binary/notices absent')
    return result


def verify(source, cache, lock, fetch=False):
    require(lock['format'] == 'inveos.whisper_research_inputs.v1' and len(lock['artifacts']) <= 12, 'Unexpected input lock')
    names = [a['name'] for a in lock['artifacts']]
    require(len(set(names)) == len(names) and sum(a['bytes'] for a in lock['artifacts']) <= 150 * 1024 * 1024, 'Duplicate/oversized input lock')
    payloads = {a['name']: artifact(a, cache, fetch) for a in lock['artifacts']}
    compiler = cmake_entries(payloads['cmake-3.31.8-linux-x86_64.tar.gz'])
    source_files = source_snapshot(source, lock)
    manifest = lambda entries: {n: {'bytes': len(b), 'sha256': sha(b)} for n, b in sorted(entries.items())}
    notices = {n: b for n, b in compiler.items() if re.search(r'/(Copyright|LICENSE|NOTICE|LICENCE|COPYING)', n, re.I)}
    require(any(sha(b) == sha(payloads['cmake-Copyright.txt']) for b in notices.values()), 'Bundled CMake root terms differ')
    require(payloads['cmake-3.31.8-SHA-256.txt'].decode().split('cmake-3.31.8-linux-x86_64.tar.gz')[0].rstrip().endswith(sha(payloads['cmake-3.31.8-linux-x86_64.tar.gz'])), 'Published CMake checksum differs')
    return {'format': 'inveos.whisper_research_inputs_receipt.v1', 'sourceRevision': PIN, 'sourceFiles': manifest(source_files), 'artifacts': [{k: a[k] for k in ('name', 'sha256', 'bytes')} for a in lock['artifacts']], 'cmakeNotices': manifest(notices), 'cmakeFiles': len(compiler), 'cmakeExpandedBytes': sum(map(len, compiler.values())), 'limitation': lock['limitation']}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--fetch', action='store_true')
    p.add_argument('--source', type=Path, default=ROOT / '.research-cache/sources/ggml-org/whisper.cpp')
    p.add_argument('--cache', type=Path, default=ROOT / '.research-cache/whisper-inputs')
    p.add_argument('--output', type=Path)
    a = p.parse_args()
    receipt = verify(a.source, a.cache, json.loads(LOCK.read_text()), a.fetch)
    text = json.dumps(receipt, indent=2) + '\n'
    if a.output:
        a.output.parent.mkdir(parents=True, exist_ok=True)
        a.output.write_text(text)
    print(json.dumps({k: v for k, v in receipt.items() if k not in ('sourceFiles', 'cmakeNotices')}, indent=2))


if __name__ == '__main__':
    main()
