#!/usr/bin/env python3
"""Build the selected pinned Tika modules in qualified networkless isolation, never in the API."""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile
import tempfile
import uuid
import zipfile

if __package__:
    from .bounded_process import run_bounded
    from .probe_worker_isolation import command, container_args, check_configuration, require, run_probe
    from .tika_runtime_artifacts import MODULES, PIN, verify
else:
    from bounded_process import run_bounded
    from probe_worker_isolation import command, container_args, check_configuration, require, run_probe
    from tika_runtime_artifacts import MODULES, PIN, verify

ROOT = Path(__file__).resolve().parents[1]
IMAGE = 'eclipse-temurin@sha256:1d4fdea2c842d8830bfb34fe4f0faf9bdad8432f79c7d1a117f1f3ee4ad46e5b'
CONFIG = 'sha256:afe7545835fa902a51fb04410ff9834250b314666516dbdef649942dd6ab0034'
JAVA_FLAGS = ['-XX:ActiveProcessorCount=1', '-XX:+UseSerialGC', '-Xmx256m', '-XX:MaxMetaspaceSize=128m', '-Djava.io.tmpdir=/scratch', '-Duser.home=/scratch', '-Djava.awt.headless=true']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def source_entries(source):
    paths = ['LICENSE.txt', 'NOTICE.txt', *[module + '/src/main' for module in MODULES]]
    result = run_bounded(['git', '-C', str(source), 'ls-tree', '-r', '-z', PIN, '--', *paths], max_output=1024 * 1024)
    require(result.returncode == 0, 'Pinned Tika source tree unavailable')
    entries, total = {}, 0
    for raw in result.stdout.rstrip(b'\0').split(b'\0'):
        header, path_bytes = raw.split(b'\t', 1)
        mode, kind, oid = header.decode().split(' ')
        path = path_bytes.decode('utf-8')
        require(mode in ('100644', '100755') and kind == 'blob' and re.fullmatch(r'[A-Za-z0-9_.$/-]+', path) and '..' not in path and not path.startswith('/'), 'Unsupported source entry')
        if path.endswith('/module-info.java'):
            raise ValueError('Explicit module compilation needs a separately reviewed profile')
        value = run_bounded(['git', '-C', str(source), 'cat-file', 'blob', oid], max_output=8 * 1024 * 1024)
        require(value.returncode == 0, 'Pinned source blob unavailable')
        total += len(value.stdout)
        require(total <= 32 * 1024 * 1024 and len(entries) < 2000, 'Source snapshot byte/file bound')
        entries[path] = value.stdout
    require('LICENSE.txt' in entries and 'NOTICE.txt' in entries, 'Missing upstream terms')
    return entries


def bundle(source, cache, lock, target):
    verify(lock, cache, source)
    entries = source_entries(source)
    manifest = {name: {'sha256': sha(data), 'bytes': len(data)} for name, data in entries.items()}
    parts, resource_paths = {}, set()
    for name, data in entries.items():
        if name in ('LICENSE.txt', 'NOTICE.txt'):
            parts['resources/META-INF/tika-research/' + name] = data
        elif '/src/main/java/' in name:
            require(name.endswith('.java'), 'Unexpected Java source payload')
            parts['source/' + name] = data
        elif '/src/main/resources/' in name:
            relative = name.split('/src/main/resources/', 1)[1]
            require(relative not in resource_paths, 'Conflicting resource paths across selected modules')
            resource_paths.add(relative)
            parts['resources/' + relative] = data
        elif '/src/main/appended-resources/' in name:
            parts['resources/META-INF/tika-research/' + name] = data
        elif name == 'tika-core/src/main/assembly/test-jar-with-dependencies.xml':
            parts['audit-only/' + name] = data  # Retained as input; Maven assembly is never run.
        else:
            raise ValueError('Unexpected source layout: ' + name)
    parts['source/inveos/research/TikaPdfProbe.java'] = (ROOT / 'research/tika/TikaPdfProbe.java').read_bytes()
    for artifact in lock['artifacts']:
        name = Path(artifact['jar']).name
        require('artifacts/' + name not in parts, 'Ambiguous classpath basename')
        parts['artifacts/' + name] = (cache / artifact['jar']).read_bytes()
    parts['sources.list'] = ('\n'.join('/scratch/' + path for path in sorted(parts) if path.startswith('source/') and path.endswith('.java')) + '\n').encode()
    with tarfile.open(target, 'w') as archive:
        for name, data in sorted(parts.items()):
            info = tarfile.TarInfo(name)
            info.size, info.mode, info.mtime = len(data), 0o444, 0
            archive.addfile(info, io.BytesIO(data))
    require(target.stat().st_size <= 96 * 1024 * 1024, 'Build bundle bound')
    return {'sourceFiles': manifest, 'bundleSha256': sha(target.read_bytes()), 'wrapperSha256': sha(parts['source/inveos/research/TikaPdfProbe.java']), 'runtimeLockSha256': sha((ROOT / 'research/runtime_artifacts/tika-research-artifacts.json').read_bytes())}


BUILD = r'''
export TMPDIR=/scratch
cd /scratch
tar -xf /original
mkdir classes
javac -J-XX:ActiveProcessorCount=1 -J-XX:+UseSerialGC -J-Xmx512m -J-Djava.io.tmpdir=/scratch -J-Duser.home=/scratch --release 17 -proc:none -encoding UTF-8 -cp '/scratch/artifacts/*' -d /scratch/classes @/scratch/sources.list
cp -R resources/. classes/
jar --create --file /output/reduced-tika.jar --date=2026-01-01T00:00:00Z -C /scratch/classes .
printf 'INVEOS_TIKA_BUILD='
base64 -w0 /output/reduced-tika.jar
printf '\n'
'''


def build(source, cache, lock, output):
    info = json.loads(command('image', 'inspect', IMAGE).stdout)[0]
    require(info['Id'] == CONFIG, 'JDK image configuration differs from resolved manifest')
    probe = run_probe(IMAGE, runtime=True)
    output.mkdir(parents=True, exist_ok=True)
    built = []
    with tempfile.TemporaryDirectory(prefix='inveos-tika-build-') as directory:
        root = Path(directory)
        root.chmod(0o755)
        original = root / 'inputs.tar'
        inputs = bundle(source, cache, lock, original)
        original.chmod(0o444)
        for attempt in range(2):
            name = 'inveos-tika-build-' + uuid.uuid4().hex
            try:
                command(*container_args(name, info['Id'], original, info['Config'].get('Volumes') or {}, runtime=True), BUILD)
                inspected = json.loads(command('inspect', name).stdout)[0]
                check_configuration(inspected, info['Config'].get('Volumes') or {}, runtime=True)
                result = command('start', '--attach', name, timeout=240, max_output=16 * 1024 * 1024, check=False)
                require(result.returncode == 0, 'Isolated compiler failed: ' + result.stderr[-6000:])
                marker = 'INVEOS_TIKA_BUILD='
                require(result.stdout.startswith(marker) and result.stdout.count(marker) == 1, 'Unexpected compiler output framing')
                data = base64.b64decode(result.stdout[len(marker):].strip(), validate=True)
                require(0 < len(data) <= 8 * 1024 * 1024, 'Compiled artifact byte bound')
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    require(sha(archive.read('META-INF/tika-research/LICENSE.txt')) == inputs['sourceFiles']['LICENSE.txt']['sha256'], 'Upstream licence not preserved in build')
                    require('inveos/research/TikaPdfProbe.class' in archive.namelist(), 'Missing first-party probe')
                built.append(data)
            finally:
                command('rm', '--force', name, check=False)
                require(command('inspect', name, check=False).returncode != 0, 'Build container cleanup failed')
        require(built[0] == built[1], 'Repeated source builds differ')
        require(sha(original.read_bytes()) == inputs['bundleSha256'], 'Read-only build input changed')
    (output / 'reduced-tika.jar').write_bytes(built[0])
    receipt = {'format': 'inveos.tika_research_build.v1', 'image': IMAGE, 'imageId': info['Id'], 'sourceRevision': PIN, **inputs, 'compiledJarSha256': sha(built[0]), 'compiledJarBytes': len(built[0]), 'repeatedBuildsIdentical': True, 'isolation': probe, 'limitation': 'Reduced Java classpath, no Maven plugins or annotation processors executed. No parser benchmark, shipping/runtime or licence approval follows from compilation.'}
    (output / 'build-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return {key: value for key, value in receipt.items() if key not in ['sourceFiles', 'isolation']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--cache', type=Path, default=ROOT / '.research-cache/tika-runtime')
    parser.add_argument('--output', type=Path, default=ROOT / '.research-cache/tika-built')
    args = parser.parse_args()
    lock = json.loads((ROOT / 'research/runtime_artifacts/tika-research-artifacts.json').read_text())
    print(json.dumps(build(args.source.resolve(), args.cache.resolve(), lock, args.output.resolve()), indent=2))


if __name__ == '__main__':
    main()
