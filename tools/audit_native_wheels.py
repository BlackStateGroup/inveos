#!/usr/bin/env python3
"""Inventory ELF dependencies without extracting, loading or executing wheel code."""
import argparse
import hashlib
import json
import re
import tempfile
from pathlib import Path
import struct
import zipfile

if __package__:
    from .audit_runtime_wheels import audit_directory
    from .bounded_process import run_bounded
else:
    from audit_runtime_wheels import audit_directory
    from bounded_process import run_bounded


def require(condition, message):
    if not condition:
        raise ValueError(message)


def elf_dependencies(data):
    """Narrow ELF64 little-endian reader. Unsupported formats fail closed.

    Reports declarations only: no loader resolution, symbol/version compatibility,
    dlopen discovery, licence inference or vulnerability determination.
    """
    require(len(data) >= 64 and data[:7] == b'\x7fELF\x02\x01\x01', 'Expected ELF64 little-endian version 1')
    def unpack(fmt, offset):
        size = struct.calcsize(fmt)
        require(0 <= offset <= len(data)-size, 'Truncated ELF structure')
        return struct.unpack_from(fmt, data, offset)
    kind, machine, version = unpack('<HHI', 16)
    require(kind in (2, 3) and machine == 62 and version == 1, 'Expected x86-64 executable/shared ELF')
    phoff, = unpack('<Q', 32)
    ehsize, phsize, count = unpack('<HHH', 52)
    require(ehsize == 64 and phsize == 56 and 1 <= count <= 256, 'Invalid program header table')
    require(phoff >= 64 and phoff + count*56 <= len(data), 'Truncated program header table')
    loads, dynamics = [], []
    for i in range(count):
        ptype, flags, offset, address, physical, size, memory, alignment = unpack('<IIQQQQQQ', phoff+i*56)
        require(offset <= len(data) and size <= len(data)-offset and size <= memory, 'Invalid segment range')
        if ptype == 1:
            loads.append((address, offset, size))
        if ptype == 2:
            dynamics.append((offset, size))
    require(len(dynamics) <= 1, 'Ambiguous dynamic tables')
    result = {'format': 'ELF64', 'machine': 'x86_64', 'needed': [], 'soname': None, 'rpath': None, 'runpath': None}
    if not dynamics:
        return result
    offset, size = dynamics[0]
    require(size % 16 == 0 and size <= 1024*1024, 'Invalid dynamic table size')
    tags = {}
    terminated = False
    for pos in range(offset, offset+size, 16):
        tag, value = unpack('<qQ', pos)
        if tag == 0:
            terminated = True
            break
        tags.setdefault(tag, []).append(value)
    require(terminated, 'Unterminated dynamic table')
    for tag in (5, 10, 14, 15, 29):
        require(len(tags.get(tag, [])) <= 1, 'Duplicate singleton dynamic tag')
    require(5 in tags and 10 in tags, 'Missing dynamic string table')
    address, size = tags[5][0], tags[10][0]
    require(0 < size <= 16*1024*1024, 'Dynamic string budget exceeded')
    matches = [off+address-start for start, off, length in loads if start <= address and address-start+size <= length]
    require(len(matches) == 1, 'Unmapped or ambiguous dynamic strings')
    strings = data[matches[0]:matches[0]+size]
    def string(index):
        require(index < len(strings), 'String offset outside table')
        end = strings.find(b'\0', index, min(len(strings), index+4097))
        require(end >= index, 'Unterminated or oversized dynamic string')
        value = strings[index:end].decode('ascii')
        require(value and all(32 <= ord(c) < 127 for c in value), 'Invalid dynamic string')
        return value
    result['needed'] = [string(v) for v in tags.get(1, [])]
    for tag, key in ((14, 'soname'), (15, 'rpath'), (29, 'runpath')):
        if tag in tags:
            result[key] = string(tags[tag][0])
    return result


def audit_native(directory, expected):
    records = audit_directory(directory)
    require({r['filename']: r['sha256'] for r in records} ==
            {r['filename']: r['sha256'] for r in expected['artifacts']}, 'Acquired artifacts differ from pinned inventory')
    binaries = []
    expanded = 0
    for record in records:
        with zipfile.ZipFile(directory / record['filename']) as archive:
            for member in archive.infolist():
                expanded += member.file_size
                require(expanded <= 1024*1024*1024 and member.file_size <= 128*1024*1024, 'Expansion budget exceeded')
                if member.is_dir():
                    continue
                with archive.open(member) as stream:
                    magic = stream.read(4)
                    if magic != b'\x7fELF':
                        continue
                    data = magic + stream.read(128*1024*1024)
                require(len(data) == member.file_size, 'Member size mismatch')
                binaries.append({'distribution': record['name'], 'wheelSha256': record['sha256'],
                    'path': member.filename, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                    **elf_dependencies(data)})
    providers = {}
    for b in binaries:
        for name in {Path(b['path']).name, b['soname']} - {None}:
            providers.setdefault(name, []).append({'distribution': b['distribution'], 'path': b['path']})
    for b in binaries:
        b['neededCandidates'] = [{'name': name, 'bundledCandidates': providers.get(name, [])} for name in b['needed']]
    return {'schemaVersion': 1, 'executed': False, 'status': 'static_declarations_not_loader_resolution',
            'wheelCount': len(records), 'expandedBytesInspected': expanded,
            'binaries': binaries,
            'unmatchedNeededNames': sorted({n for b in binaries for n in b['needed'] if n not in providers})}


def compare_readelf(directory, report, expected):
    """Independent static comparison; temporary binaries have no execute bit."""
    wheels = {a['name']: a['filename'] for a in expected['artifacts']}
    with tempfile.TemporaryDirectory(prefix='inveos-elf-', dir=directory.parent) as temporary:
        path = Path(temporary) / 'unexecuted.elf'
        for binary in report['binaries']:
            with zipfile.ZipFile(directory / wheels[binary['distribution']]) as archive:
                path.write_bytes(archive.read(binary['path']))
            path.chmod(0o600)
            result = run_bounded(['readelf', '--dynamic', '--wide', str(path)], timeout=5, max_output=256*1024)
            require(result.returncode == 0, 'readelf rejected binary')
            for tag, key in [('NEEDED','needed'), ('SONAME','soname'), ('RPATH','rpath'), ('RUNPATH','runpath')]:
                values = re.findall(r'\('+tag+r'\).*?\[(.*?)\]', result.stdout.decode('utf-8'))
                wanted = binary[key] if key == 'needed' else ([] if binary[key] is None else [binary[key]])
                require(values == wanted, 'Independent ELF comparison differs')
    version = run_bounded(['readelf', '--version'], max_output=4096)
    require(version.returncode == 0, 'readelf version unavailable')
    return {'matchedBinaries': len(report['binaries']), 'tool': version.stdout.decode().splitlines()[0]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--compare-readelf', action='store_true')
    args = parser.parse_args()
    expected = json.loads(args.inventory.read_text())
    report = audit_native(args.directory, expected)
    if args.compare_readelf:
        report['independentComparison'] = compare_readelf(args.directory, report, expected)
    args.output.write_text(json.dumps(report, indent=2)+'\n')


if __name__ == '__main__':
    main()
