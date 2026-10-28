"""First-party collector executed inside the already-qualified research image.

Reads ldconfig/dpkg metadata and files; performs no candidate loader test or wheel import.
"""
import hashlib
import json
from pathlib import Path
import re
import struct
from bounded_process import run_bounded


def command(argv):
    result = run_bounded(argv, timeout=10, max_output=1024*1024)
    if result.returncode:
        raise ValueError('Image metadata command failed')
    return result.stdout.decode('utf-8')


def fingerprint(path):
    resolved = path.resolve(strict=True)
    size = resolved.stat().st_size
    if not resolved.is_file() or size > 16*1024*1024:
        raise ValueError('Invalid image file')
    data = resolved.read_bytes()
    return {'path': str(path), 'resolvedPath': str(resolved), 'bytes': size,
            'sha256': hashlib.sha256(data).hexdigest()}, data


def collect(names):
    packages = []
    for line in command(['dpkg-query','-W','-f=${binary:Package}\t${Version}\t${Architecture}\n']).splitlines():
        name, version, arch = line.split('\t')
        packages.append({'name':name, 'version':version, 'architecture':arch})
    cache = command(['/sbin/ldconfig','-p'])
    libraries, missing = [], []
    for name in names:
        paths = sorted(set(re.findall(r'^\s*'+re.escape(name)+r' \(libc6,x86-64[^)]*\) => (/[\S]+)$', cache, re.M)))
        if not paths:
            missing.append(name)
            continue
        if len(paths) != 1:
            raise ValueError('Ambiguous image library candidate')
        path = Path(paths[0])
        record, data = fingerprint(path)
        if len(data)<20 or data[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H',data,18)[0] != 62:
            raise ValueError('Unexpected image ELF architecture')
        owners = set()
        for candidate in {str(path), str(path.resolve()), str(path).replace('/usr/lib/', '/lib/', 1)}:
            result=run_bounded(['dpkg-query','-S',candidate], timeout=10, max_output=65536)
            if result.returncode == 0:
                owners.update(line.split(': ',1)[0] for line in result.stdout.decode().splitlines())
        if len(owners)!=1:
            raise ValueError('Missing or ambiguous package owner')
        owner=owners.pop()
        package=next(p for p in packages if p['name']==owner)
        notice, _ = fingerprint(Path('/usr/share/doc')/owner.split(':')[0]/'copyright')
        libraries.append({'name':name, **record, 'package':package, 'copyrightFile':notice})
    return {'libraries':libraries, 'missingNames':missing, 'packages':packages,
            'parserExecuted':False, 'libraryLoadingTested':False}


if __name__=='__main__':
    print(json.dumps(collect(json.loads(Path('/original/needed.json').read_text())),sort_keys=True))
