#!/usr/bin/env python3
"""Stage existing hash-locked Tika artifacts as data. Never install, build or run a parser."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
from build_tika_research import ROOT, CONFIG, IMAGE, PIN, source_entries
from tika_runtime_artifacts import verify

LOCK = '7dd4b380c2deed19c9086f8b398df2b2fc13fe7a92c53af5b9172a8e1e12b581'
JAR = '9979f7381d200e057f5394e4de3a437932b7bdc7a59acdd98e11511d9adf4258'
WRAPPER = '8b9e117ebca5a6627770cca0215706e05db35f494b269cd9e474e6f50eb2893c'


def sha(value):
    return hashlib.sha256(value).hexdigest()


def bounded(path, maximum):
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= maximum:
        raise ValueError('Missing or unsupported locked artifact')
    return path.read_bytes()


def prepare(destination):
    path = Path(destination)
    if path.is_symlink() or path.resolve().parent != ROOT / '.research-cache' or not path.name.startswith('leased-tika-') or not path.is_dir() or any(path.iterdir()):
        raise ValueError('Expected an empty private Tika destination')
    source, cache, built = ROOT / '.research-cache/sources/apache/tika', ROOT / '.research-cache/tika-runtime', ROOT / '.research-cache/tika-built'
    lock_bytes = bounded(ROOT / 'research/runtime_artifacts/tika-research-artifacts.json', 262144)
    if sha(lock_bytes) != LOCK or sha(bounded(ROOT / 'research/tika/TikaPdfProbe.java', 32768)) != WRAPPER:
        raise ValueError('Runtime or wrapper profile changed')
    lock = json.loads(lock_bytes)
    verify(lock, cache, source)  # Offline POM/source/JAR/notice inspection only.
    entries = source_entries(source)
    manifest = {name: {'sha256': sha(data), 'bytes': len(data)} for name, data in entries.items()}
    receipt = json.loads(bounded(built / 'build-receipt.json', 2097152))
    jar = bounded(built / 'reduced-tika.jar', 8388608)
    if (receipt.get('format') != 'inveos.tika_research_build.v1' or receipt.get('image') != IMAGE or receipt.get('imageId') != CONFIG
            or receipt.get('sourceRevision') != PIN or receipt.get('runtimeLockSha256') != LOCK or receipt.get('wrapperSha256') != WRAPPER
            or receipt.get('compiledJarSha256') != JAR or sha(jar) != JAR or receipt.get('compiledJarBytes') != len(jar)
            or receipt.get('sourceFiles') != manifest or receipt.get('repeatedBuildsIdentical') is not True):
        raise ValueError('Existing build does not match the locked, inspected profile')
    path.chmod(0o755)
    (path / 'artifacts').mkdir(mode=0o755)
    (path / 'reduced-tika.jar').write_bytes(jar)
    (path / 'reduced-tika.jar').chmod(0o444)
    for artifact in lock['artifacts']:
        target = path / 'artifacts' / Path(artifact['jar']).name
        if target.exists():
            raise ValueError('Classpath basename collision')
        shutil.copyfile(cache / artifact['jar'], target)
        target.chmod(0o444)
    # Retain original source terms beside the runtime, as well as embedded JAR notices.
    (path / 'audit').mkdir(mode=0o755)
    for name in ('LICENSE.txt', 'NOTICE.txt'):
        (path / 'audit' / name).write_bytes(entries[name])
        (path / 'audit' / name).chmod(0o444)
    result = {'status': 'verified_locked_tika_bundle', 'sourceRevision': PIN, 'compiledJarSha256': JAR, 'runtimeLockSha256': LOCK, 'wrapperSha256': WRAPPER, 'parserExecuted': False}
    (path / 'audit' / 'runtime-lock.json').write_bytes(lock_bytes)
    (path / 'audit' / 'runtime-lock.json').chmod(0o444)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', required=True)
    print(json.dumps(prepare(parser.parse_args().bundle)))
