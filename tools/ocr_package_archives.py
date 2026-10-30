#!/usr/bin/env python3
"""Acquire/audit the existing research image's Debian archives as inert data.

Discovery is an explicit proposal, never a lock refresh during normal builds.
No archive is installed or extracted here; maintainer scripts are not executed.
"""
import argparse
import hashlib
import io
import json
import lzma
from pathlib import Path, PurePosixPath
import posixpath
import re
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request
import zlib

ROOT = Path(__file__).resolve().parent.parent
INVENTORY = ROOT / 'research/runtime_artifacts/tesseract-baseline.lock.json'
LOCK = ROOT / 'research/runtime_artifacts/tesseract-archives.lock.json'
CACHE = ROOT / '.research-cache/ocr-archives'
ORIGIN = 'https://snapshot.debian.org'
MAX_ARCHIVE = 64 * 1024 * 1024
MAX_TAR = 128 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
BASE = 'python@sha256:623674a14ef93d052bb9b0de4dbf5f28eb578a35263838941cc8aa43213c1487'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


class SameOriginRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        require(urllib.parse.urlsplit(newurl)[:2] == ('https', 'snapshot.debian.org'), 'Unexpected archive redirect')
        return super().redirect_request(request, fp, code, message, headers, newurl)


def download(path, limit):
    require(path.startswith('/') and not path.startswith('//'), 'Archive path required')
    started = time.monotonic()
    request = urllib.request.Request(ORIGIN + path, headers={'User-Agent': 'INVEOS-research-archive-audit/1'})
    with urllib.request.build_opener(SameOriginRedirect()).open(request, timeout=30) as response:
        result = bytearray()
        while True:
            require(time.monotonic() - started < 90, 'Archive download deadline')
            chunk = response.read(min(65536, limit + 1 - len(result)))
            if not chunk:
                return bytes(result)
            result.extend(chunk)
            require(len(result) <= limit, 'Archive download byte limit')


def metadata(path):
    value = json.loads(download(path, 1024 * 1024))
    require(isinstance(value, dict) and isinstance(value.get('result'), list), 'Invalid archive metadata')
    return value


def members(data):
    require(len(data) <= MAX_ARCHIVE and data.startswith(b'!<arch>\n'), 'Invalid Debian archive')
    result = []
    offset = 8
    while offset < len(data):
        header = data[offset:offset + 60]
        require(len(header) == 60 and header[58:] == b'`\n', 'Truncated archive header')
        name = header[:16].decode('ascii').strip().removesuffix('/')
        size_text = header[48:58].decode('ascii').strip()
        require(re.fullmatch(r'[0-9]+', size_text) is not None, 'Invalid archive member size')
        size = int(size_text)
        offset += 60
        require(size <= MAX_ARCHIVE and offset + size <= len(data), 'Truncated archive member')
        result.append((name, data[offset:offset + size]))
        offset += size
        if size % 2:
            require(data[offset:offset + 1] == b'\n', 'Invalid archive padding')
            offset += 1
        require(len(result) <= 3, 'Unexpected Debian archive members')
    require(len(result) == 3 and result[0] == ('debian-binary', b'2.0\n'), 'Unsupported Debian archive format')
    require(result[1][0] in ('control.tar', 'control.tar.gz', 'control.tar.xz') and
            result[2][0] in ('data.tar', 'data.tar.gz', 'data.tar.xz'), 'Unsupported archive compression/order')
    return result[1:]


def unpack(name, compressed):
    if name.endswith('.xz'):
        decoder = lzma.LZMADecompressor(memlimit=64 * 1024 * 1024)
        data = decoder.decompress(compressed, max_length=MAX_TAR + 1)
        require(decoder.eof and not decoder.unused_data, 'Incomplete or oversized xz archive')
    elif name.endswith('.gz'):
        decoder = zlib.decompressobj(31)
        data = decoder.decompress(compressed, MAX_TAR + 1)
        require(decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail, 'Incomplete or oversized gzip archive')
    else:
        data = compressed
    require(len(data) <= MAX_TAR, 'Expanded archive byte limit')
    return data


def safe_name(name):
    require(not name.startswith('/') and '\\' not in name and '..' not in PurePosixPath(name).parts, 'Unsafe archive member path')
    return str(PurePosixPath(name))


def control_fields(data):
    fields = {}
    key = None
    for line in data.decode('utf-8').strip().splitlines():
        if line.startswith((' ', '\t')):
            require(key is not None, 'Orphan control continuation')
            fields[key] += '\n' + line
        else:
            key, separator, value = line.partition(':')
            key = key.lower()
            require(separator and re.fullmatch(r'[a-z][a-z0-9-]*', key) and key not in fields, 'Invalid or duplicate control field')
            fields[key] = value.strip()
    return fields


def audit(data):
    fields = None
    notices = []
    for archive_name, compressed in members(data):
        with tarfile.open(fileobj=io.BytesIO(unpack(archive_name, compressed)), mode='r:') as archive:
            seen = set()
            for entry in archive:
                name = safe_name(entry.name)
                require(name not in seen and len(seen) < 40000 and 0 <= entry.size <= MAX_TAR, 'Duplicate/excessive archive members')
                seen.add(name)
                require(entry.isfile() or entry.isdir() or entry.issym() or entry.islnk(), 'Unexpected archive member type')
                selected_control = archive_name.startswith('control.') and name == 'control'
                doc_link = name.startswith('usr/share/doc/') and len(PurePosixPath(name).parts) == 4 and (entry.issym() or entry.islnk())
                selected_notice = archive_name.startswith('data.') and name.startswith('usr/share/doc/') and (name.endswith('/copyright') or doc_link)
                if not (selected_control or selected_notice):
                    continue
                require(entry.size <= 2 * 1024 * 1024, 'Control/notice byte limit')
                if selected_notice and (entry.issym() or entry.islnk()):
                    # Record the link; never follow it into the host filesystem.
                    notices.append({'path': name, 'link': entry.linkname, 'kind': 'symlink' if entry.issym() else 'hardlink'})
                    continue
                require(entry.isfile(), 'Control/notice must be a regular file')
                stream = archive.extractfile(entry)
                require(stream is not None, 'Missing selected archive bytes')
                content = stream.read(entry.size + 1)
                require(len(content) == entry.size, 'Truncated selected archive bytes')
                if selected_control:
                    fields = control_fields(content)
                else:
                    notices.append({'path': name, 'bytes': len(content), 'sha256': sha(content),
                                    'declaredLicences': sorted(set(re.findall(r'^License: (.+)$', content.decode('utf-8', errors='replace'), re.M)))})
    require(fields is not None and all(fields.get(k) for k in ('package', 'version', 'architecture')), 'Missing package identity')
    require(notices, 'Missing package copyright record')
    return {'package': fields['package'], 'version': fields['version'], 'architecture': fields['architecture'],
            'source': fields.get('source'), 'depends': fields.get('depends'), 'preDepends': fields.get('pre-depends'),
            'builtUsing': fields.get('built-using'), 'notices': notices}


def check_identity(record, package, installed):
    require(record['package'] == package.split(':')[0] and record['version'] == installed['version'] and
            record['architecture'] == installed['architecture'], 'Archive package/version/architecture mismatch')


def resolve_notices(records):
    entries = {}
    for record in records:
        for notice in record['notices']:
            old = entries.get(notice['path'])
            require(old is None or old == notice, 'Conflicting package copyright paths')
            entries[notice['path']] = notice
    resolved = {}
    for record in records:
        path = 'usr/share/doc/' + record['package'] + '/copyright'
        seen = set()
        for _ in range(16):
            require(path not in seen and path.startswith('usr/share/doc/'), 'Unsafe/cyclic copyright link')
            seen.add(path)
            notice = entries.get(path)
            if notice and 'sha256' in notice:
                resolved[record['installedName']] = {'path': path, 'sha256': notice['sha256'], 'bytes': notice['bytes']}
                break
            prefix = path if notice else posixpath.dirname(path)
            notice = notice or entries.get(prefix)
            require(notice is not None and 'link' in notice, 'Unresolved package copyright link: ' + record['installedName'])
            target = notice['link']
            require('\\' not in target, 'Unsafe copyright link')
            if target.startswith('/') or notice['kind'] == 'hardlink':
                target = target.lstrip('/')
            else:
                target = posixpath.join(posixpath.dirname(prefix), target)
            path = posixpath.normpath(target + path[len(prefix):])
        else:
            raise ValueError('Copyright link depth limit')
    return resolved


def check_runtime_notices(resolved, inventory):
    for artifact in inventory.get('artifacts', []):
        notice = resolved[artifact['package']]
        expected = artifact['copyright']
        require(notice['path'] == expected['resolvedPath'].lstrip('/') and notice['sha256'] == expected['sha256'] and
                notice['bytes'] == expected['bytes'], 'Archive notice differs from qualified runtime')


def cached_bytes(path, limit):
    require(not path.is_symlink() and path.is_file() and path.stat().st_size <= limit, 'Invalid cached archive')
    with path.open('rb') as stream:
        data = stream.read(limit + 1)
    require(len(data) <= limit, 'Cached archive grew past limit')
    return data


def save_cache(path, data):
    # No partially downloaded archive becomes a successful cache entry.
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.download-', delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(data)
            stream.close()
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)


def discover():
    inventory_bytes = INVENTORY.read_bytes()
    inventory = json.loads(inventory_bytes)
    CACHE.mkdir(parents=True, exist_ok=True)
    records = []
    total = 0
    for package, installed in sorted(inventory['packages'].items()):
        query = '/mr/binary/' + urllib.parse.quote(package.split(':')[0], safe='') + '/' + urllib.parse.quote(installed['version'], safe='') + '/binfiles'
        found = metadata(query)
        require(found.get('binary') == package.split(':')[0] and found.get('binary_version') == installed['version'], 'Mismatched discovery metadata')
        hashes = {r['hash'] for r in found['result'] if r['architecture'] == installed['architecture']}
        require(len(hashes) == 1, 'Missing or ambiguous archive identity: ' + package)
        snapshot_hash = next(iter(hashes))
        require(re.fullmatch(r'[0-9a-f]{40}', snapshot_hash), 'Invalid snapshot identity')
        # Discovery caches use the snapshot identity; normal builds use SHA-256.
        cache = CACHE / (snapshot_hash + '.deb')
        data = cached_bytes(cache, MAX_ARCHIVE) if cache.exists() else download('/file/' + snapshot_hash, MAX_ARCHIVE)
        require(hashlib.sha1(data).hexdigest() == snapshot_hash, 'Snapshot identity mismatch')
        details = audit(data)
        check_identity(details, package, installed)
        total += len(data)
        require(total <= MAX_TOTAL, 'Package closure byte limit')
        save_cache(cache, data)
        digest = sha(data)
        save_cache(CACHE / (digest + '.deb'), data)
        records.append({'installedName': package, 'snapshotSha1': snapshot_hash, 'sha256': digest, 'bytes': len(data), **details})
        print('Audited ' + package + ' ' + installed['version'], flush=True)
    resolved = resolve_notices(records)
    check_runtime_notices(resolved, inventory)
    return {'format': 'inveos.ocr_package_archives.v1', 'baseImage': BASE,
            'installedInventorySha256': sha(inventory_bytes), 'origin': ORIGIN,
            'approval': 'research_only_no_distribution_or_licence_approval',
            'authentication': 'Initial discovery used official HTTPS snapshot metadata and SHA-1 file identities; SHA-256 computed locally. Signed Release/index verification is not claimed.',
            'archives': records, 'resolvedNotices': resolved}


def acquire(lock_path=LOCK, offline=False):
    lock_bytes = lock_path.read_bytes()
    require(len(lock_bytes) <= 2 * 1024 * 1024, 'Archive lock byte limit')
    lock = json.loads(lock_bytes)
    require(lock['format'] == 'inveos.ocr_package_archives.v1' and lock['baseImage'] == BASE and lock['origin'] == ORIGIN and
            lock['installedInventorySha256'] == sha(INVENTORY.read_bytes()), 'Archive lock/inventory mismatch')
    inventory = json.loads(INVENTORY.read_bytes())
    packages = inventory['packages']
    records = lock['archives']
    require(isinstance(records, list) and len(records) == len(packages) and len({r['installedName'] for r in records}) == len(records) and
            {r['installedName'] for r in records} == set(packages), 'Incomplete or duplicate package closure')
    require(lock.get('resolvedNotices') == resolve_notices(records), 'Resolved copyright lock mismatch')
    check_runtime_notices(lock['resolvedNotices'], inventory)
    CACHE.mkdir(parents=True, exist_ok=True)
    total = 0
    paths = []
    for record in records:
        require(re.fullmatch(r'[0-9a-f]{64}', record['sha256']) and re.fullmatch(r'[0-9a-f]{40}', record['snapshotSha1']) and
                type(record['bytes']) is int and 0 < record['bytes'] <= MAX_ARCHIVE, 'Invalid locked archive identity')
        total += record['bytes']
        require(total <= MAX_TOTAL, 'Package closure byte limit')
        path = CACHE / (record['sha256'] + '.deb')
        if path.exists():
            data = cached_bytes(path, record['bytes'])
        else:
            require(not offline, 'Missing locked archive: ' + record['installedName'])
            data = download('/file/' + record['snapshotSha1'], record['bytes'])
        require(len(data) == record['bytes'] and sha(data) == record['sha256'] and hashlib.sha1(data).hexdigest() == record['snapshotSha1'], 'Locked archive fingerprint mismatch')
        details = audit(data)
        check_identity(details, record['installedName'], packages[record['installedName']])
        require(all(record.get(k) == v for k, v in details.items()), 'Locked archive metadata/notice mismatch')
        if not path.exists():
            save_cache(path, data)
        paths.append(path)
    return {'lockSha256': sha(lock_bytes), 'archives': len(paths), 'bytes': total, 'paths': paths}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--discover', type=Path, help='Write a new proposed lock; never overwrite an existing lock')
    parser.add_argument('--offline', action='store_true', help='Verify cached archives without network')
    args = parser.parse_args()
    if args.discover:
        require(not args.offline and not args.discover.exists(), 'A new discovery destination is required')
        proposal = discover()
        with args.discover.open('x') as stream:
            stream.write(json.dumps(proposal, indent=2) + '\n')
    else:
        result = acquire(offline=args.offline)
        print(json.dumps({k: v for k, v in result.items() if k != 'paths'}))
