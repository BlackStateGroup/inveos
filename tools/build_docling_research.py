#!/usr/bin/env python3
"""Offline isolated exact-pin wheel experiment, never a parser or shipping build.

Acquire the pinned source/build wheels separately. No source or wheel is emitted
outside the ignored cache. Requires an already-present digest-pinned image.
"""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import tempfile
import tomllib
import uuid
import zipfile

if __package__:
    from .audit_runtime_wheels import audit_wheel
    from .bounded_process import run_bounded
    from .probe_worker_isolation import command, container_args, check_configuration, require, run_probe
else:
    from audit_runtime_wheels import audit_wheel
    from bounded_process import run_bounded
    from probe_worker_isolation import command, container_args, check_configuration, require, run_probe

ROOT = Path(__file__).resolve().parent.parent
PIN = '90234a71b16785d08fd2f46ec62668dd2396db76'
IMAGE = 'python@sha256:623674a14ef93d052bb9b0de4dbf5f28eb578a35263838941cc8aa43213c1487'
SUPPORT = {'pyproject.toml', 'README.md', 'LICENSE', '.gitignore', 'packages/docling-slim/README.md'}
MAX_SOURCE = 8 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_path(name):
    return (isinstance(name, str) and bool(name) and not name.startswith('/')
            and '\\' not in name and all(p not in ('', '.', '..') for p in name.split('/')))


def validate_project(content):
    data = tomllib.loads(content.decode('utf-8'))
    require(data['build-system'] == {'requires': ['hatchling'], 'build-backend': 'hatchling.build'}, 'Unexpected build backend')
    require(data['project']['name'] == 'docling-slim' and data['project']['version'] == '2.142.1', 'Unexpected package identity')
    require(data['tool']['hatch'] == {'build': {'targets': {
        'wheel': {'packages': ['docling']},
        'sdist': {'only-include': ['docling', 'pyproject.toml', 'README.md', 'LICENSE']}}}}, 'Unexpected build configuration or hooks')


def snapshot_source(repository, destination):
    # Read immutable Git objects, never execute or copy working-tree content.
    result = run_bounded(['git', '-C', str(repository), 'ls-tree', '-r', '-z', PIN,
                          '--', 'docling', *sorted(SUPPORT)], max_output=256 * 1024)
    require(result.returncode == 0, 'Pinned source tree unavailable')
    entries = result.stdout.rstrip(b'\0').split(b'\0')
    require(1 <= len(entries) <= 1000, 'Source entry budget exceeded')
    manifest = {}
    total = 0
    for entry in entries:
        header, raw_path = entry.split(b'\t', 1)
        mode, kind, oid = header.decode('ascii').split(' ')
        path = raw_path.decode('utf-8')
        require(mode in ('100644', '100755') and kind == 'blob' and safe_path(path), 'Non-regular or unsafe source entry')
        require(path.startswith('docling/') or path in SUPPORT, 'Unexpected source path')
        blob = run_bounded(['git', '-C', str(repository), 'cat-file', 'blob', oid], max_output=1024 * 1024)
        require(blob.returncode == 0, 'Source blob unavailable')
        total += len(blob.stdout)
        require(total <= MAX_SOURCE, 'Source byte budget exceeded')
        target = destination / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(blob.stdout)
        target.chmod(0o444)
        manifest[path] = {'sha256': digest(blob.stdout), 'bytes': len(blob.stdout)}
    require(SUPPORT.issubset(manifest), 'Missing build support file')
    validate_project((destination / 'pyproject.toml').read_bytes())
    return manifest


def verify_built_wheel(data, manifest):
    require(len(data) <= 2 * 1024 * 1024, 'Built wheel byte budget exceeded')
    expected = {p: m for p, m in manifest.items() if p.startswith('docling/')}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        names = [e.filename for e in entries]
        require(len(names) <= 1100 and len(names) == len(set(names)), 'Duplicate or excessive wheel entries')
        require(all(safe_path(n) for n in names), 'Unsafe wheel path')
        require(sum(e.file_size for e in entries) <= MAX_SOURCE + 1024 * 1024, 'Wheel expansion budget exceeded')
        require({n for n in names if n.startswith('docling/')} == set(expected), 'Wheel package file set differs from pin')
        require(all(n in expected or n.startswith('docling_slim-2.142.1.dist-info/') for n in names), 'Unexpected wheel payload')
        for name, item in expected.items():
            require(archive.getinfo(name).file_size == item['bytes'] and digest(archive.read(name)) == item['sha256'], 'Wheel source differs from pin: '+name)
        licences = [n for n in names if PurePosixPath(n).name == 'LICENSE']
        require(len(licences) == 1 and digest(archive.read(licences[0])) == manifest['LICENSE']['sha256'], 'Built licence does not match source')
    return {'wheelSha256': digest(data), 'wheelBytes': len(data), 'matchedPackageFiles': len(expected)}


BUILD_SCRIPT = r'''
export HOME=/scratch TMPDIR=/scratch PIP_CONFIG_FILE=/dev/null PIP_NO_INDEX=1
export PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONDONTWRITEBYTECODE=1 SOURCE_DATE_EPOCH=315532800
python -m pip install --no-index --no-deps --no-compile --require-hashes --find-links /original/wheels --target /scratch/deps -r /original/build.lock >&2
export PYTHONPATH=/scratch/deps
cd /original/source
python -c 'from hatchling.build import build_wheel; build_wheel("/output")' >&2
python -c 'import base64,pathlib,sys; files=list(pathlib.Path("/output").glob("*.whl")); assert len(files)==1; sys.stdout.buffer.write(base64.b64encode(files[0].read_bytes()))'
'''


def experiment(repository, wheels, *, retain_wheel=False):
    inventory_path = ROOT / 'research/runtime_artifacts/docling-build.json'
    lock_path = ROOT / 'research/runtime_artifacts/docling-build.lock'
    inventory = json.loads(inventory_path.read_text())['artifacts']
    require({p.name for p in wheels.iterdir()} == {a['filename'] for a in inventory}, 'Build wheel set mismatch')
    for item in inventory:
        path = wheels / item['filename']
        require(not path.is_symlink() and path.stat().st_size == item['bytes'] and digest(path.read_bytes()) == item['sha256'], 'Build wheel hash mismatch')
        require(item['filename'].endswith('-py3-none-any.whl'), 'Only reviewed pure-Python build tools allowed')
    host = run_probe(IMAGE)  # Qualify this actual image, not a different service image.
    image_id = host['imageId']
    receipts = []
    cache = ROOT / '.research-cache'
    cache.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='docling-build-', dir=cache) as directory:
        bundle = Path(directory).resolve()
        bundle.chmod(0o755)
        manifest = snapshot_source(repository, bundle / 'source')
        (bundle / 'wheels').mkdir()
        for item in inventory:
            shutil.copyfile(wheels / item['filename'], bundle / 'wheels' / item['filename'])
        shutil.copyfile(lock_path, bundle / 'build.lock')
        for attempt in range(2):
            name = 'inveos-docling-build-' + uuid.uuid4().hex
            try:
                command(*container_args(name, image_id, bundle), BUILD_SCRIPT)
                check_configuration(json.loads(command('inspect', name).stdout)[0])
                result = run_bounded(['docker', 'start', '-a', name], timeout=45, max_output=4 * 1024 * 1024)
                require(result.returncode == 0, 'Isolated build failed')
                data = base64.b64decode(result.stdout, validate=True)
                receipts.append(verify_built_wheel(data, manifest))
                wheel_path = bundle / f'attempt-{attempt}.whl'
                wheel_path.write_bytes(data)
                audit = audit_wheel(wheel_path)
                require(audit['name'] == 'docling-slim' and audit['version'] == '2.142.1', 'Built metadata identity mismatch')
            finally:
                command('rm', '-f', '-v', name)
                require(command('inspect', name, check=False).returncode != 0, 'Builder cleanup failed')
        require(receipts[0] == receipts[1], 'Repeated builds differ')
        # Re-read all mounted files after both runs; none may have changed.
        for path, item in manifest.items():
            require(digest((bundle/'source'/path).read_bytes()) == item['sha256'], 'Source changed during build')
        if retain_wheel:
            retained=cache/'docling-exact'
            retained.mkdir(exist_ok=True)
            target=retained/'docling_slim-2.142.1-py3-none-any.whl'
            if target.exists():
                require(digest(target.read_bytes())==digest(data),'Refusing to replace a different retained wheel')
            else:
                with target.open('xb') as stream:stream.write(data)

    return {'status': 'pinned_source_wheel_built_twice', 'sourcePin': PIN,
            'sourceManifestSha256': digest(json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode()),
            'buildInventorySha256': digest(inventory_path.read_bytes()),
            'buildLockSha256': digest(lock_path.read_bytes()), 'image': IMAGE,
            'hostQualification': host, 'builds': receipts,
            'parserExecuted': False, 'runtimeDependenciesInstalled': False,
            'approval': 'isolated_research_build_only_not_incorporation'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--wheels', type=Path, required=True)
    parser.add_argument('--retain-wheel', action='store_true', help='Keep verified wheel only in ignored research cache')
    args = parser.parse_args()
    print(json.dumps(experiment(args.source.resolve(), args.wheels.resolve(), retain_wheel=args.retain_wheel), indent=2))


if __name__ == '__main__':
    main()
