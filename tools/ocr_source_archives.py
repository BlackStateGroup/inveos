#!/usr/bin/env python3
"""Retain corresponding Debian sources for the already locked research runtime.

Sources remain inert in an ignored cache. No extraction, installation, build,
signature authentication or licence approval is performed by this tool.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import tempfile
import time
import urllib.parse
import urllib.request

try:
    from . import ocr_package_archives as binary
except ImportError:
    import ocr_package_archives as binary

ROOT = binary.ROOT
LOCK = ROOT / 'research/runtime_artifacts/tesseract-sources.lock.json'
CACHE = ROOT / '.research-cache/ocr-sources'
MAX_FILE = 384 * 1024 * 1024
MAX_TOTAL = 2 * 1024 * 1024 * 1024
MAX_DSC = 256 * 1024
DOWNLOAD_SECONDS = 180
require = binary.require
sha = binary.sha
PACKAGE = r'[a-z0-9][a-z0-9+.-]*'
VERSION = r'[0-9][A-Za-z0-9.+:~\-]*'
NAME = r'[A-Za-z0-9][A-Za-z0-9.+_~\-]*'


def source_set(archive_lock):
    """Do not guess source versions by stripping suffixes from binary versions."""
    result = {}
    for item in archive_lock['archives']:
        text = item['source'] or item['package']
        matched = re.fullmatch(r'(' + PACKAGE + r')(?: \((' + VERSION + r')\))?', text)
        require(matched is not None, 'Invalid binary Source field')
        version = matched[2] or item['version']
        require(re.fullmatch(VERSION, version), 'Invalid source version')
        key = (matched[1], version)
        result.setdefault(key, set()).add(item['installedName'])
        # Built-Using names extra exact sources; never silently omit them.
        for text in (item.get('builtUsing') or '').split(','):
            if not text.strip():
                continue
            matched = re.fullmatch(r'(' + PACKAGE + r') \(= (' + VERSION + r')\)', text.strip())
            require(matched is not None, 'Unsupported Built-Using source')
            result.setdefault((matched[1], matched[2]), set()).add(item['installedName'])
    require(0 < len(result) <= 512, 'Source count limit')
    return {key: sorted(value) for key, value in sorted(result.items())}


def descriptor(data, package, version):
    require(0 < len(data) <= MAX_DSC, 'Source descriptor byte limit')
    text = data.decode('utf-8').replace('\r\n', '\n')
    require('\r' not in text and '\0' not in text, 'Invalid source descriptor text')
    signed = text.startswith('-----BEGIN PGP SIGNED MESSAGE-----\n')
    if signed:
        header, separator, content = text.partition('\n\n')
        require(separator and re.fullmatch(r'-----BEGIN PGP SIGNED MESSAGE-----\nHash: [A-Za-z0-9, -]+', header), 'Invalid cleartext signature envelope')
        body, separator, signature = content.partition('\n-----BEGIN PGP SIGNATURE-----\n')
        require(separator and signature.rstrip().endswith('-----END PGP SIGNATURE-----') and
                '-----BEGIN PGP' not in signature, 'Incomplete source signature envelope')
        lines = body.split('\n')
        require(all(not line.startswith('-') or line.startswith('- ') for line in lines), 'Invalid cleartext dash escaping')
        text = '\n'.join(line[2:] if line.startswith('- ') else line for line in lines)
    fields = binary.control_fields(text.encode())
    require(fields.get('source') == package and fields.get('version') == version, 'Source descriptor identity mismatch')
    require(fields.get('format') in ('1.0', '3.0 (native)', '3.0 (quilt)'), 'Unsupported source format')
    tables = {}
    for field, length in [('checksums-sha256', 64), ('checksums-sha1', 40), ('files', 32)]:
        table = {}
        require(field in fields, 'Missing source checksum table')
        for line in fields[field].splitlines():
            if not line.strip():
                continue
            parts = line.split()
            require(len(parts) == 3, 'Malformed source checksum entry')
            digest, size, name = parts
            require(re.fullmatch(r'[0-9a-f]{' + str(length) + '}', digest) and re.fullmatch(r'[0-9]+', size) and
                    re.fullmatch(NAME, name) and not name.endswith('.dsc') and name not in table and
                    0 < int(size) <= MAX_FILE, 'Invalid source file identity/size')
            table[name] = {'digest': digest, 'bytes': int(size)}
        require(0 < len(table) <= 64, 'Source component count limit')
        tables[field] = table
    files = []
    reference = tables['checksums-sha256']
    for table in tables.values():
        require(set(table) == set(reference) and all(table[n]['bytes'] == reference[n]['bytes'] for n in table), 'Inconsistent source checksum tables')
    for name, entry in sorted(reference.items()):
        files.append({'name': name, 'bytes': entry['bytes'], 'sha256': entry['digest'],
                      'snapshotSha1': tables['checksums-sha1'][name]['digest'], 'md5': tables['files'][name]['digest']})
    return {'format': fields['format'], 'cleartextSigned': signed, 'binary': fields.get('binary'),
            'buildDepends': fields.get('build-depends'), 'buildDependsArch': fields.get('build-depends-arch'),
            'buildDependsIndep': fields.get('build-depends-indep'), 'buildConflicts': fields.get('build-conflicts'),
            'files': files}


def identity(record):
    require(re.fullmatch(NAME, record['name']) and re.fullmatch(r'[0-9a-f]{64}', record['sha256']) and
            re.fullmatch(r'[0-9a-f]{40}', record['snapshotSha1']) and type(record['bytes']) is int and
            0 < record['bytes'] <= (MAX_DSC if record['name'].endswith('.dsc') else MAX_FILE), 'Invalid locked source file')
    if 'md5' in record:
        require(re.fullmatch(r'[0-9a-f]{32}', record['md5']), 'Invalid locked source MD5')


def fingerprint(stream, size, deadline=None):
    hashes = [hashlib.sha256(), hashlib.sha1(), hashlib.md5()]
    count = 0
    while True:
        require(deadline is None or time.monotonic() < deadline, 'Source download deadline')
        read = getattr(stream, 'read1', stream.read)
        chunk = read(min(65536, size + 1 - count))
        if not chunk:
            break
        count += len(chunk)
        require(count <= size, 'Source file byte limit')
        for value in hashes:
            value.update(chunk)
        yield chunk
    require(count == size, 'Truncated source file')
    return [value.hexdigest() for value in hashes]


def copy_checked(stream, record, output=None, deadline=None):
    chunks = fingerprint(stream, record['bytes'], deadline)
    while True:
        try:
            chunk = next(chunks)
        except StopIteration as end:
            values = end.value
            break
        if output is not None:
            output.write(chunk)
    require(values[0] == record['sha256'] and values[1] == record['snapshotSha1'] and
            ('md5' not in record or values[2] == record['md5']), 'Source fingerprint mismatch')


def acquire_file(record, offline):
    identity(record)
    CACHE.mkdir(parents=True, exist_ok=True)
    require(not CACHE.is_symlink(), 'Source cache cannot be a symlink')
    path = CACHE / record['sha256']
    require(not path.is_symlink(), 'Cached source cannot be a symlink')
    if path.exists():
        require(path.is_file() and path.stat().st_size == record['bytes'], 'Invalid cached source size/type')
        with path.open('rb') as stream:
            copy_checked(stream, record)
        return path
    require(not offline, 'Missing locked source: ' + record['name'])
    request = urllib.request.Request(binary.ORIGIN + '/file/' + record['snapshotSha1'], headers={'User-Agent': 'INVEOS-research-source-audit/1'})
    deadline = time.monotonic() + DOWNLOAD_SECONDS
    temporary = None
    try:
        with urllib.request.build_opener(binary.SameOriginRedirect()).open(request, timeout=min(30, DOWNLOAD_SECONDS)) as response, tempfile.NamedTemporaryFile(dir=CACHE, prefix='.download-', delete=False) as output:
            temporary = Path(output.name)
            copy_checked(response, record, output, deadline)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return path


def binary_lock():
    data = binary.LOCK.read_bytes()
    require(len(data) <= 2 * 1024 * 1024, 'Binary archive lock byte limit')
    lock = json.loads(data)
    require(lock['format'] == 'inveos.ocr_package_archives.v1' and lock['origin'] == binary.ORIGIN and
            lock['baseImage'] == binary.BASE and lock['installedInventorySha256'] == sha(binary.INVENTORY.read_bytes()), 'Binary archive lock/inventory mismatch')
    packages = json.loads(binary.INVENTORY.read_bytes())['packages']
    records = lock['archives']
    require(len(records) == len(packages) and len({r['installedName'] for r in records}) == len(records) and
            {r['installedName'] for r in records} == set(packages), 'Incomplete binary inventory correspondence')
    for record in records:
        binary.check_identity(record, record['installedName'], packages[record['installedName']])
    return data, lock


def discover():
    binary_bytes, archive_lock = binary_lock()
    sources = []
    total = 0
    for (package, version), binaries in source_set(archive_lock).items():
        query = '/mr/package/' + urllib.parse.quote(package, safe='') + '/' + urllib.parse.quote(version, safe='') + '/srcfiles'
        found = binary.metadata(query)
        require(found.get('package') == package and found.get('version') == version and 0 < len(found['result']) <= 65, 'Source discovery identity/count mismatch')
        hashes = {item['hash'] for item in found['result']}
        require(len(hashes) == len(found['result']) and all(re.fullmatch(r'[0-9a-f]{40}', value) for value in hashes), 'Invalid/duplicate source discovery hash')
        descriptions = []
        for value in sorted(hashes):
            info = binary.metadata('/mr/file/' + value + '/info')
            require(info.get('hash') == value, 'Source file metadata mismatch')
            candidates = {(item['name'], item['size']) for item in info['result'] if item['name'].endswith('.dsc')}
            descriptions.extend((name, size, value) for name, size in sorted(candidates))
        require(len(descriptions) == 1, 'Missing or ambiguous source descriptor')
        name, size, value = descriptions[0]
        require(re.fullmatch(NAME, name) and type(size) is int and 0 < size <= MAX_DSC, 'Invalid descriptor metadata')
        raw = binary.download('/file/' + value, MAX_DSC)
        require(len(raw) == size and hashlib.sha1(raw).hexdigest() == value, 'Source descriptor snapshot mismatch')
        parsed = descriptor(raw, package, version)
        require({v['snapshotSha1'] for v in parsed['files']} | {value} == hashes, 'Source component closure mismatch')
        dsc = {'name': name, 'bytes': size, 'sha256': sha(raw), 'snapshotSha1': value}
        total += size + sum(v['bytes'] for v in parsed['files'])
        require(total <= MAX_TOTAL, 'Source closure byte limit')
        CACHE.mkdir(parents=True, exist_ok=True)
        require(not CACHE.is_symlink(), 'Source cache cannot be a symlink')
        binary.save_cache(CACHE / dsc['sha256'], raw)
        for entry in parsed['files']:
            acquire_file(entry, offline=False)
        sources.append({'source': package, 'version': version, 'installedBinaries': binaries, 'descriptor': dsc, **parsed})
        print('Retained ' + package + ' ' + version, flush=True)
    return {'format': 'inveos.ocr_source_archives.v1', 'binaryArchiveLockSha256': sha(binary_bytes),
            'origin': binary.ORIGIN, 'approval': 'research_only_no_distribution_or_licence_approval',
            'authentication': 'Official HTTPS snapshot discovery; locally pinned SHA-256 and descriptor component hashes. Descriptor signatures and signed Release/index verification are not authenticated.',
            'sources': sources}


def acquire(lock_path=LOCK, offline=False):
    data = lock_path.read_bytes()
    require(len(data) <= 2 * 1024 * 1024, 'Source lock byte limit')
    lock = json.loads(data)
    binary_bytes, archive_lock = binary_lock()
    require(lock['format'] == 'inveos.ocr_source_archives.v1' and lock['origin'] == binary.ORIGIN and
            lock['binaryArchiveLockSha256'] == sha(binary_bytes), 'Source/binary lock mismatch')
    expected = source_set(archive_lock)
    sources = lock['sources']
    require(isinstance(sources, list) and len(sources) == len(expected) and len({(s['source'], s['version']) for s in sources}) == len(sources) and
            {(s['source'], s['version']) for s in sources} == set(expected), 'Incomplete or duplicate source closure')
    total = 0
    files = set()
    for source in sources:
        require(source['installedBinaries'] == expected[(source['source'], source['version'])] and source['descriptor']['name'].endswith('.dsc'), 'Source binary correspondence mismatch')
        entries = [source['descriptor'], *source['files']]
        require(1 < len(entries) <= 65, 'Source component count limit')
        for entry in entries:
            identity(entry)
            total += entry['bytes']
        require(total <= MAX_TOTAL, 'Source closure byte limit')
        path = acquire_file(source['descriptor'], offline)
        parsed = descriptor(binary.cached_bytes(path, MAX_DSC), source['source'], source['version'])
        require(all(source.get(k) == v for k, v in parsed.items()), 'Locked source descriptor/component mismatch')
        for entry in source['files']:
            acquire_file(entry, offline)
        files.update(entry['sha256'] for entry in entries)
    return {'lockSha256': sha(data), 'binaryArchiveLockSha256': sha(binary_bytes), 'sources': len(sources),
            'files': len(files), 'declaredBytes': total, 'authentication': lock['authentication']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--discover', type=Path, help='Write a new proposed lock, never overwrite an existing lock')
    parser.add_argument('--offline', action='store_true', help='Reverify all cached source bytes without network')
    args = parser.parse_args()
    if args.discover:
        require(not args.offline and not args.discover.exists(), 'A new discovery destination is required')
        proposal = discover()
        with args.discover.open('x') as stream:
            stream.write(json.dumps(proposal, indent=2) + '\n')
    else:
        print(json.dumps(acquire(offline=args.offline)))
