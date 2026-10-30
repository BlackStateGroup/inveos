#!/usr/bin/env python3
"""Compile pinned CPU Whisper twice inside qualified, networkless, non-root isolation."""
import base64
import io
import json
import re
from pathlib import Path
import tarfile
import tempfile
import uuid
from .probe_worker_isolation import command, container_args, check_configuration, run_probe
from .whisper_research_inputs import ROOT, LOCK, PIN, require, sha, verify, source_snapshot, cmake_entries, safe_path


def write_tar(path, entries):
    require(sum(map(len, entries.values())) <= 64 * 1024 * 1024 and len(entries) <= 2000, 'Source bundle bounds')
    require(all(re.fullmatch(r'[A-Za-z0-9_.$/+-]+', n) and not n.startswith('/') and '..' not in n for n in entries), 'Unsafe source bundle path')
    with tarfile.open(path, 'w') as archive:
        for name, data in sorted(entries.items()):
            item = tarfile.TarInfo(name)
            item.mode, item.size, item.mtime = 0o444, len(data), 1
            archive.addfile(item, io.BytesIO(data))


def copy_image(base, entries):
    # Image assembly only. No RUN, installer, build script or model executes in
    # Docker build; execution is confined to separately inspected containers.
    require(re.fullmatch(r'(python@)?sha256:[a-f0-9]{64}', base), 'Pinned research base required')
    with tempfile.TemporaryDirectory(prefix='inveos-whisper-image-') as directory:
        root = Path(directory)
        for name, (data, executable) in entries.items():
            require(re.fullmatch(r'[A-Za-z0-9_.$/+ -]+', name) and not name.startswith('/') and '..' not in name, 'Unsafe image payload')
            path = root / 'payload' / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            path.chmod(0o755 if executable else 0o444)
        (root / 'Dockerfile').write_text('FROM ' + base + '\nCOPY payload/ /opt/inveos/\n')
        identity = root / 'image-id'
        command('build', '--network=none', '--pull=false', '--iidfile', str(identity), str(root), timeout=180, max_output=1024 * 1024)
        image = identity.read_text().strip()
        require(image.startswith('sha256:') and len(image) == 71, 'Image identity missing')
        return image


BUILD = r'''
export SOURCE_DATE_EPOCH=1 TZ=UTC LC_ALL=C TMPDIR=/scratch
mkdir -p /scratch/project /scratch/build
tar -xf /original -C /scratch/project --no-same-owner
/opt/inveos/cmake/bin/cmake -S /scratch/project -B /scratch/build -DCMAKE_SKIP_RPATH=ON >/scratch/configure.log 2>&1 || { tail -50 /scratch/configure.log >&2; exit 1; }
/opt/inveos/cmake/bin/cmake --build /scratch/build --target inveos-whisper --parallel 1 >/scratch/build.log 2>&1 || { tail -50 /scratch/build.log >&2; exit 1; }
python3 - <<'PYCODE'
import base64,hashlib,json,pathlib,subprocess
binary=pathlib.Path('/scratch/build/inveos-whisper').read_bytes()
assert 0<len(binary)<=8*1024*1024
# Base image package names/versions, compiler and linkage are evidence, not an
# assertion that the image's complete source/licence closure was approved.
commands=[['gcc','--version'],['g++','--version'],['readelf','-d','/scratch/build/inveos-whisper'],['dpkg-query','-W','-f=${binary:Package}\t${Version}\n']]
receipt={'binary':base64.b64encode(binary).decode(),'commands':[]}
for argv in commands:
 r=subprocess.run(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10,check=True)
 assert len(r.stdout)<131072 and len(r.stderr)<65536
 receipt['commands'].append({'argv':argv,'stdout':r.stdout.decode(),'stderr':r.stderr.decode()})
print('INVEOS_WHISPER_BUILD='+json.dumps(receipt,separators=(',',':')))
PYCODE
'''


INVENTORY = r"""python3 - <<'PYCODE'
import hashlib,json,pathlib,re,subprocess
r=subprocess.run(['ldd','/opt/inveos/inveos-whisper'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10,check=True)
assert len(r.stdout)<65536 and b'not found' not in r.stdout
files=[]
for path in sorted(set(re.findall(r'(/[^\s()]+)',r.stdout.decode()))):
 p=pathlib.Path(path);assert p.is_file() and p.stat().st_size<32*1024*1024
 packages=[]
 for candidate in [str(p),str(p.resolve()),str(p).replace('/lib/','/usr/lib/',1)]:
  owner=subprocess.run(['dpkg-query','-S',candidate],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5)
  if owner.returncode==0:
   packages=sorted(set(line.split(': ',1)[0] for line in owner.stdout.decode().splitlines()));break
 notices=[]
 for package in packages:
  notice=pathlib.Path('/usr/share/doc')/package.split(':')[0]/'copyright'
  if notice.is_file():
   b=notice.read_bytes();assert len(b)<1024*1024
   notices.append({'package':package,'path':str(notice),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)})
 files.append({'path':path,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size,'packages':packages,'notices':notices})
print(json.dumps({'ldd':r.stdout.decode(),'libraries':files}))
PYCODE
"""


def runtime_inventory(image):
    info = json.loads(command('image', 'inspect', image).stdout)[0]
    with tempfile.TemporaryDirectory(prefix='inveos-whisper-inventory-') as directory:
        root = Path(directory)
        root.chmod(0o755)
        original = root / 'fixture'
        original.write_bytes(b'Fictional runtime inventory marker')
        original.chmod(0o444)
        name = 'inveos-whisper-inventory-' + uuid.uuid4().hex
        try:
            command(*container_args(name, image, original, info['Config'].get('Volumes') or {}, runtime=True), INVENTORY)
            check_configuration(json.loads(command('inspect', name).stdout)[0], info['Config'].get('Volumes') or {}, runtime=True)
            result = command('start', '--attach', name, timeout=30, max_output=1024 * 1024)
            return json.loads(result.stdout)
        finally:
            command('rm', '--force', name, check=False)
            require(command('inspect', name, check=False).returncode != 0, 'Inventory container cleanup failed')


def build(source, cache, output):
    lock = json.loads(LOCK.read_text())
    inputs = verify(source, cache, lock)
    base = json.loads(command('image', 'inspect', lock['baseImage']).stdout)[0]
    require(base['Id'] == lock['baseConfig'] and base['Architecture'] == 'amd64', 'Resolved build base differs from pinned amd64 manifest')
    entries = cmake_entries((cache / 'cmake-3.31.8-linux-x86_64.tar.gz').read_bytes())
    image = copy_image(lock['baseImage'], {'cmake/' + n: (b, n.startswith('bin/')) for n, b in entries.items()})
    compiled, evidence = [], []
    output.mkdir(parents=True, exist_ok=True)
    safe_path(output)
    try:
        probe = run_probe(image, runtime=True)
        (output / 'builder-probe.json').write_text(json.dumps(probe, indent=2) + '\n')
        info = json.loads(command('image', 'inspect', image).stdout)[0]
        with tempfile.TemporaryDirectory(prefix='inveos-whisper-build-') as directory:
            root = Path(directory)
            root.chmod(0o755)
            bundle = root / 'source.tar'
            sources = source_snapshot(source, lock)
            harness = {n: (ROOT / 'research/whisper' / n).read_bytes() for n in ('CMakeLists.txt', 'runner.cpp')}
            write_tar(bundle, {'source/' + n: b for n, b in sources.items()} | harness)
            bundle.chmod(0o444)
            bundle_digest = sha(bundle.read_bytes())
            for _ in range(2):
                name = 'inveos-whisper-build-' + uuid.uuid4().hex
                try:
                    command(*container_args(name, image, bundle, info['Config'].get('Volumes') or {}, runtime=True), BUILD)
                    check_configuration(json.loads(command('inspect', name).stdout)[0], info['Config'].get('Volumes') or {}, runtime=True)
                    result = command('start', '--attach', name, timeout=300, max_output=16 * 1024 * 1024, check=False)
                    require(result.returncode == 0, 'Isolated compiler failed: ' + result.stderr[-6000:])
                    marker = 'INVEOS_WHISPER_BUILD='
                    require(result.stdout.startswith(marker) and result.stdout.count(marker) == 1, 'Unexpected build output framing')
                    payload = json.loads(result.stdout[len(marker):])
                    binary = base64.b64decode(payload.pop('binary'), validate=True)
                    require(0 < len(binary) <= 8 * 1024 * 1024 and binary.startswith(b'\x7fELF'), 'Unexpected compiled artifact')
                    compiled.append(binary)
                    evidence.append(payload)
                finally:
                    command('rm', '--force', name, check=False)
                    require(command('inspect', name, check=False).returncode != 0, 'Build container cleanup failed')
            require(compiled[0] == compiled[1], 'Repeated native builds differ')
            require(sha(bundle.read_bytes()) == bundle_digest, 'Read-only source bundle changed')
        (output / 'inveos-whisper').write_bytes(compiled[0])
        notices = {'whisper-LICENSE': sources['LICENSE'], 'openai-LICENSE': (cache / 'openai-LICENSE').read_bytes(), 'ggml-llamafile-MIT': sources['ggml/src/ggml-cpu/llamafile/sgemm.cpp'].split(b'\n\n', 1)[0] + b'\n'}
        yarn = b'// YaRN algorithm based on LlamaYaRNScaledRotaryEmbedding.py from https://github.com/jquesnelle/yarn\n// MIT licensed. Copyright (c) 2023 Jeffrey Quesnelle and Bowen Peng.'
        require(yarn in sources['ggml/src/ggml-cpu/ops.cpp'], 'Embedded GGML attribution changed')
        notices['ggml-YaRN-MIT'] = yarn + b'\n\n' + sources['LICENSE']
        runtime = copy_image(lock['baseImage'], {'inveos-whisper': (compiled[0], True)} | {'notices/' + n: (b, False) for n, b in notices.items()})
        runtime_probe = run_probe(runtime, runtime=True)
        (output / 'runtime-probe.json').write_text(json.dumps(runtime_probe, indent=2) + '\n')
        receipt = {'format': 'inveos.whisper_research_build.v1', 'sourceRevision': PIN, 'inputLockSha256': sha(LOCK.read_bytes()), 'inputs': inputs, 'baseImage': lock['baseImage'], 'baseConfig': lock['baseConfig'], 'builderImageId': image, 'runtimeImageId': runtime, 'binarySha256': sha(compiled[0]), 'binaryBytes': len(compiled[0]), 'harness': {n: sha(b) for n, b in harness.items()}, 'sourceBundleSha256': bundle_digest, 'repeatedBuildsIdentical': True, 'builds': evidence, 'runtimeNotices': {n: sha(b) for n, b in notices.items()}, 'runtimeInventory': runtime_inventory(runtime), 'builderIsolation': probe, 'runtimeIsolation': runtime_probe, 'limitation': 'Research-only CPU build. No production/model/data/licence/security approval. Complete base-image source closure and individual bundled obligations remain open.'}
        (output / 'build-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
        return {k: receipt[k] for k in ('runtimeImageId', 'binarySha256', 'binaryBytes', 'repeatedBuildsIdentical')}
    finally:
        command('image', 'rm', image, check=False)


def main():
    import argparse
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, default=ROOT / '.research-cache/sources/ggml-org/whisper.cpp')
    p.add_argument('--cache', type=Path, default=ROOT / '.research-cache/whisper-inputs')
    p.add_argument('--output', type=Path, default=ROOT / '.research-cache/whisper-built')
    a = p.parse_args()
    print(json.dumps(build(a.source, a.cache, a.output), indent=2))


if __name__ == '__main__':
    main()
