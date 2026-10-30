#!/usr/bin/env python3
"""Authenticate retained research archives through pinned signed Debian indexes.

No installation, maintainer-script execution, live APT update, licence approval
or production trust approval. Public source copies stay in an ignored cache.
"""
import argparse
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import hashlib
import json
import lzma
from pathlib import Path
import re
import tempfile
import time
import urllib.parse
import urllib.error
import urllib.request

if __package__:
    from . import ocr_package_archives as binary
    from . import ocr_source_archives as source
    from .bounded_process import run_bounded
else:
    import ocr_package_archives as binary
    import ocr_source_archives as source
    from bounded_process import run_bounded

ROOT = binary.ROOT
LOCK = ROOT / 'research/runtime_artifacts/tesseract-authentication.lock.json'
CACHE = ROOT / '.research-cache/ocr-authentication'
MAX_RELEASE = 2 * 1024 * 1024
MAX_INDEX = 32 * 1024 * 1024
MAX_EXPANDED = 128 * 1024 * 1024
KEYS = {
    'archive-key-11-security': 'AC530D520F2F3269F5E98313A48449044AAD5C5D',
    'archive-key-12': 'B8B80B5B623EAB6AD8775C45B7C5D7D6350947F8',
    'archive-key-12-security': '05AB90340C0C5E797F44A8C8254CF3B5AEC0A8F0',
    'archive-key-13': '04B54C3CDCA79751B16BC6B5225629DF75B188BD',
    'release-12': '4D64FEC119C2029067D6E791F8D2585B8783D481',
}
require, sha = binary.require, binary.sha


def safe_cache(path):
    require(not any(p.is_symlink() for p in [path, *path.parents]), 'Symlinked authentication cache')


def artifact(record, *, offline=True, cache=CACHE, key=False):
    require(type(record.get('bytes')) is int and 0 < record['bytes'] <= (131072 if key else MAX_INDEX)
            and re.fullmatch(r'[0-9a-f]{64}', record.get('sha256', '')), 'Invalid authentication artifact')
    path = cache.absolute() / record['sha256']
    safe_cache(path)
    cache.mkdir(parents=True, exist_ok=True)
    if path.exists():
        data = binary.cached_bytes(path, record['bytes'])
    else:
        require(not offline, 'Missing authentication artifact: ' + record['sha256'])
        if not key:
            require(re.fullmatch(r'[0-9a-f]{40}', record.get('snapshotSha1', '')), 'Invalid snapshot identity')
            data = binary.download('/file/' + record['snapshotSha1'], record['bytes'])
        else:
            name = record.get('name')
            require(name in KEYS and record.get('url') == 'https://ftp-master.debian.org/keys/' + name + '.asc', 'Unexpected public key URL')
            data = fetch_public_key(record['url'], record['bytes'])
        require(len(data) == record['bytes'] and sha(data) == record['sha256'], 'Authentication artifact fingerprint mismatch')
        safe_cache(path)
        binary.save_cache(path, data)
    require(len(data) == record['bytes'] and sha(data) == record['sha256'], 'Authentication artifact fingerprint mismatch')
    if not key:
        require(hashlib.sha1(data).hexdigest() == record['snapshotSha1'], 'Snapshot artifact identity mismatch')
    return data


def fetch_public_key(url, length):
    # Retry only transport failures, inside the same overall acquisition bound.
    class FixedKeyOrigin(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, message, headers, newurl):
            require(urllib.parse.urlsplit(newurl)[:2] == ('https', 'ftp-master.debian.org'), 'Unexpected public key redirect')
            return super().redirect_request(request, fp, code, message, headers, newurl)
    opener = urllib.request.build_opener(FixedKeyOrigin())
    deadline = time.monotonic() + 30
    for attempt in range(3):
        require(time.monotonic() < deadline, 'Public key download deadline')
        try:
            with opener.open(url, timeout=min(10, deadline - time.monotonic())) as response:
                output = bytearray()
                while True:
                    require(time.monotonic() < deadline, 'Public key download deadline')
                    chunk = response.read1(min(16384, length + 1 - len(output)))
                    if not chunk:
                        return bytes(output)
                    output.extend(chunk)
                    require(len(output) <= length, 'Public key byte limit')
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
            require(time.monotonic() + attempt + 1 < deadline, 'Public key download deadline')
            time.sleep(attempt + 1)
    raise ValueError('Public key acquisition failed')


def command(args):
    result = run_bounded(args, timeout=20, max_output=131072)
    require(result.returncode == 0, 'OpenPGP command failed; no publication authentication claimed')
    return result.stdout.decode('utf-8', errors='strict')


def keyring(data, expected, directory, number):
    path = directory / ('key-' + str(number) + '.asc')
    path.write_bytes(data)
    prefix = ['gpg', '--batch', '--no-options', '--homedir', str(directory)]
    listing = command(prefix + ['--with-colons', '--show-keys', str(path)])
    fingerprints = [line.split(':')[9] for line in listing.splitlines() if line.startswith('fpr:')]
    require(sum(line.startswith('pub:') for line in listing.splitlines()) == 1 and fingerprints
            and fingerprints[0] == expected, 'Public key fingerprint mismatch')
    output = directory / ('key-' + str(number) + '.gpg')
    command(prefix + ['--dearmor', '--output', str(output), str(path)])
    return output


def signed_release(data, keyrings, expected_signers, directory):
    require(0 < len(data) <= MAX_RELEASE, 'Signed release byte limit')
    path, output = directory / 'InRelease', directory / 'Release'
    path.write_bytes(data)
    args = ['gpgv', '--homedir', str(directory), '--status-fd', '1', '--output', str(output)]
    for key in keyrings:
        args += ['--keyring', str(key)]
    status = command(args + [str(path)])
    signatures = []
    for line in status.splitlines():
        fields = line.split()
        if len(fields) > 1 and fields[1] == 'VALIDSIG':
            require(len(fields) == 12 and re.fullmatch(r'[A-F0-9]{40}', fields[2])
                    and fields[9] == '8' and fields[10] == '01'
                    and re.fullmatch(r'[A-F0-9]{40}', fields[11]), 'Unsupported release signature profile')
            signatures.append({'signingFingerprint': fields[2], 'primaryFingerprint': fields[11],
                               'signedAt': int(fields[4]), 'hashAlgorithm': 'SHA256'})
    require(len(signatures) == len(expected_signers) and
            {s['primaryFingerprint'] for s in signatures} == set(expected_signers), 'Release signer mismatch')
    return binary.control_fields(binary.cached_bytes(output, MAX_RELEASE)), signatures


def checksum_table(text):
    result = {}
    for line in text.splitlines():
        if not line.strip():
            continue
        fields = line.split()
        require(len(fields) == 3, 'Invalid index checksum row')
        digest, size, name = fields
        require(re.fullmatch(r'[a-f0-9]{64}', digest) and re.fullmatch(r'[0-9]+', size)
                and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._+~/-]*', name)
                and '..' not in name.split('/') and name not in result, 'Invalid or duplicate index checksum')
        result[name] = (digest, int(size))
    require(result, 'Empty checksum table')
    return result


def index_records(compressed):
    require(0 < len(compressed) <= MAX_INDEX, 'Compressed index byte limit')
    decoder = lzma.LZMADecompressor(memlimit=64 * 1024 * 1024)
    data = decoder.decompress(compressed, max_length=MAX_EXPANDED + 1)
    require(len(data) <= MAX_EXPANDED and decoder.eof and not decoder.unused_data, 'Expanded index limit or trailing data')
    for paragraph in data.split(b'\n\n'):
        if paragraph.strip():
            require(len(paragraph) <= 1024 * 1024, 'Index paragraph byte limit')
            yield binary.control_fields(paragraph)


def match_index(data, kind, binaries, sources, witness, found_binaries, found_sources):
    for row in index_records(data):
        if kind == 'binary':
            key = (row.get('package'), row.get('version'), row.get('architecture'))
            if key not in binaries:
                continue
            item = binaries[key]
            require(row.get('sha256') == item['sha256'] and row.get('size') == str(item['bytes']), 'Published binary bytes differ from retained lock')
            require(row.get('source') == item['source'], 'Published binary source identity differs')
            found_binaries.setdefault(key, witness)
        else:
            key = (row.get('package'), row.get('version'))
            if key not in sources:
                continue
            item = sources[key]
            table = checksum_table(row.get('checksums-sha256', ''))
            entries = [item['descriptor'], *item['files']]
            require(set(table) == {f['name'] for f in entries}, 'Published source component closure differs')
            for file in entries:
                require(table[file['name']] == (file['sha256'], file['bytes']), 'Published source bytes differ from retained lock')
            found_sources.setdefault(key, witness)


def validate_publication(fields, signatures, suite, snapshot):
    require(fields.get('origin') == 'Debian' and fields.get('codename') == suite, 'Signed release scope mismatch')
    publication = parsedate_to_datetime(fields['date'])
    require(publication.tzinfo is not None and publication <= snapshot
            and all(s['signedAt'] <= snapshot.timestamp() for s in signatures), 'Release postdates snapshot')
    valid_until = fields.get('valid-until')
    if valid_until:
        expiry = parsedate_to_datetime(valid_until)
        require(expiry.tzinfo is not None and expiry >= snapshot, 'Release was expired at retained snapshot')
    return valid_until


def authenticate(lock_path=LOCK, *, offline=True, cache=CACHE):
    raw = binary.cached_bytes(lock_path, 131072)
    lock = json.loads(raw)
    binary_raw, source_raw = binary.LOCK.read_bytes(), source.LOCK.read_bytes()
    require(lock.get('format') == 'inveos.ocr_archive_authentication.v1'
            and lock.get('binaryArchiveLockSha256') == sha(binary_raw)
            and lock.get('sourceArchiveLockSha256') == sha(source_raw), 'Authentication lock correspondence mismatch')
    binary_lock, source_lock = json.loads(binary_raw), json.loads(source_raw)
    require(source_lock['binaryArchiveLockSha256'] == sha(binary_raw), 'Source/binary lock mismatch')
    binaries = {(r['package'], r['version'], r['architecture']): r for r in binary_lock['archives']}
    sources = {(r['source'], r['version']): r for r in source_lock['sources']}
    require(len(binaries) == len(binary_lock['archives']) and len(sources) == len(source_lock['sources']), 'Duplicate archive identities')
    require(re.fullmatch(r'[0-9]{8}T[0-9]{6}Z', lock.get('snapshot', '')), 'Invalid snapshot time')
    snapshot = datetime.strptime(lock['snapshot'], '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
    keys, releases = lock['keys'], lock['releases']
    require(len(keys) == len(KEYS) and {k['name']: k['primaryFingerprint'] for k in keys} == KEYS, 'Trusted public key selection changed')
    require(len(releases) == 3 and {r['suite'] for r in releases} == {'bookworm', 'bookworm-updates', 'bookworm-security'}, 'Release set mismatch')
    found_binaries, found_sources, receipts = {}, {}, []
    with tempfile.TemporaryDirectory(prefix='inveos-archive-auth-') as temporary:
        home = Path(temporary)
        rings = [keyring(artifact(k, offline=offline, cache=cache, key=True), k['primaryFingerprint'], home, i) for i, k in enumerate(keys)]
        for release in releases:
            require(release.get('archive') == ('debian-security' if release['suite'] == 'bookworm-security' else 'debian'), 'Release archive origin mismatch')
            directory = home / release['suite']
            directory.mkdir(mode=0o700)
            fields, signatures = signed_release(artifact(release['inRelease'], offline=offline, cache=cache), rings, release['primarySigners'], directory)
            valid_until = validate_publication(fields, signatures, release['suite'], snapshot)
            table = checksum_table(fields['sha256'])
            indexes = release['indexes']
            require(len(indexes) == 2 and {i['path'] for i in indexes} == {'main/binary-amd64/Packages.xz', 'main/source/Sources.xz'}, 'Signed index selection mismatch')
            for index in indexes:
                require(table.get(index['path']) == (index['sha256'], index['bytes']), 'Index is not bound by signed release')
                data = artifact(index, offline=offline, cache=cache)
                witness = {'suite': release['suite'], 'inReleaseSha256': release['inRelease']['sha256'], 'indexSha256': index['sha256']}
                match_index(data, 'binary' if 'binary-amd64' in index['path'] else 'source', binaries, sources, witness, found_binaries, found_sources)
            receipts.append({'suite': release['suite'], 'date': fields['date'], 'validUntil': valid_until, 'signatures': signatures})
    require(set(found_binaries) == set(binaries), 'Some retained binaries lack signed-index correspondence')
    require(set(found_sources) == set(sources), 'Some retained sources lack signed-index correspondence')
    return {'status': 'retained_archives_match_signed_indexes', 'authenticationLockSha256': sha(raw),
            'binaryArchiveLockSha256': sha(binary_raw), 'sourceArchiveLockSha256': sha(source_raw),
            'hostVerificationTools': {'gpg': command(['gpg', '--version']).splitlines()[:3], 'gpgv': command(['gpgv', '--version']).splitlines()[:3]},
            'snapshot': lock['snapshot'], 'binaryCount': len(found_binaries), 'sourceCount': len(found_sources),
            'releases': receipts, 'binaries': [{'package': k[0], 'version': k[1], 'architecture': k[2], **v} for k, v in sorted(found_binaries.items())],
            'sources': [{'source': k[0], 'version': k[1], **v} for k, v in sorted(found_sources.items())],
            'limitation': 'Publication correspondence at the retained snapshot, not current repository freshness, individual maintainer-signature authentication, complete image/source closure, security or licence approval. Public-key trust is the explicitly pinned HTTPS bootstrap.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fetch', action='store_true', help='Fetch exact pinned metadata into the ignored cache; default is offline')
    args = parser.parse_args()
    print(json.dumps(authenticate(offline=not args.fetch), indent=2))
