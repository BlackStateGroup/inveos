#!/usr/bin/env python3
"""Qualify a disposable Docker host, not a parser or production security boundary.

Uses an already-present image by immutable local ID; never pulls or builds one.
Only first-party shell probes and fictional bytes are executed.
"""
import argparse
import hashlib
import json
import re
import socket
import subprocess
import tempfile
import uuid
from pathlib import Path


def command(*args, timeout=20, check=True):
    return subprocess.run(['docker', *args], capture_output=True, text=True,
                          timeout=timeout, check=check)


def require(condition, message='Isolation policy rejected'):
    if not condition:
        raise ValueError(message)


SCRATCH = 'rw,noexec,nosuid,nodev,size=16m,mode=1777'
READONLY_VOLUME = 'ro,noexec,nosuid,nodev,size=1m,mode=0555'


def volume_overrides(volumes):
    require(len(volumes) <= 8, 'Too many image volumes')
    paths = sorted(volumes)
    for path in paths:
        require(bool(re.fullmatch(r'/[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*', path)), 'Unsafe image volume')
        for protected in ['/original', '/output', '/scratch', '/proc', '/sys', '/dev']:
            require(not (path == protected or path.startswith(protected+'/') or protected.startswith(path+'/')), 'Conflicting image volume')
        require(not any(other != path and path.startswith(other+'/') for other in paths), 'Nested image volumes')
    return {path: READONLY_VOLUME for path in paths}


def container_args(name, image_id, original, volumes=()):
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', image_id):
        raise ValueError('An immutable local image ID is required')
    overrides = volume_overrides(volumes)
    return ['create', '--pull=never', '--name', name, '--network=none',
            '--user=65534:65534', '--read-only', '--cap-drop=ALL',
            '--security-opt=no-new-privileges:true', '--memory=128m',
            '--memory-swap=128m', '--cpus=0.5', '--pids-limit=32',
            f'--tmpfs=/scratch:{SCRATCH}', f'--tmpfs=/output:{SCRATCH}',
            *[f'--tmpfs={path}:{options}' for path, options in overrides.items()],
            '--mount', f'type=bind,src={original},dst=/original,readonly',
            '--entrypoint=/bin/bash', image_id, '-ceu']


def check_configuration(info, volumes=()):
    host = info['HostConfig']
    require(info['Config']['User'] == '65534:65534')
    require(host['NetworkMode'] == 'none' and host['ReadonlyRootfs'])
    require(host['CapDrop'] == ['ALL'] and (not host['Privileged']))
    require('no-new-privileges:true' in host['SecurityOpt'])
    require(host['Memory'] == 128 * 1024 * 1024)
    require(host['MemorySwap'] == host['Memory'])
    require(host['NanoCpus'] == 500000000 and host['PidsLimit'] == 32)
    require(host['Tmpfs'] == {'/scratch': SCRATCH, '/output': SCRATCH, **volume_overrides(volumes)})
    for mount in info['Mounts']:
        require(mount['Destination'] in ['/original', '/scratch', '/output', *volumes])
        require(not mount['RW'] or (mount['Destination'] in ['/scratch', '/output'] and mount['Type'] == 'tmpfs'))
    originals = [m for m in info['Mounts'] if m['Destination'] == '/original']
    require(len(originals) == 1 and originals[0]['RW'] is False)


def run_probe(image):
    # Resolving a tag is allowed only for the existing CI image. Every run below
    # uses the captured content ID and records it; this is not a runtime lock.
    image_info = json.loads(command('image', 'inspect', image).stdout)[0]
    image_id = image_info['Id']
    volumes = image_info['Config'].get('Volumes') or {}
    volume_overrides(volumes)
    receipts = []
    with tempfile.TemporaryDirectory(prefix='inveos-isolation-') as directory:
        root = Path(directory)
        root.chmod(0o755)
        original = root / 'original.txt'
        original.write_bytes(b'FICTIONAL INVEOS isolation fixture\n')
        original.chmod(0o444)
        expected = hashlib.sha256(original.read_bytes()).hexdigest()
        # A host loopback listener proves that a denied connect is not merely
        # an absent service. No public endpoint or investigative data is used.
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen(1)
            port = listener.getsockname()[1]
            with socket.create_connection(('127.0.0.1', port), timeout=2):
                connection, _ = listener.accept()
                connection.close()
            checks = f'''
[ "$(id -u)" = 65534 ]
grep -Eq '^CapEff:[[:space:]]+0+$' /proc/self/status
grep -Eq '^NoNewPrivs:[[:space:]]+1$' /proc/self/status
[ "$(cat /sys/fs/cgroup/memory.max)" = 134217728 ]
[ "$(cat /sys/fs/cgroup/pids.max)" = 32 ]
[ "$(cat /sys/fs/cgroup/cpu.max)" = '50000 100000' ]
if (echo changed >> /original) 2>/dev/null; then exit 41; fi
if (echo changed > /etc/inveos-write-probe) 2>/dev/null; then exit 42; fi
[ ! -e /var/run/docker.sock ]
if timeout 2 bash -c 'echo test > /dev/tcp/127.0.0.1/{port}' 2>/dev/null; then exit 43; fi
# No default route exists in the network namespace.
if awk 'NR>1 && $2=="00000000" {{found=1}} END {{exit !found}}' /proc/net/route; then exit 44; fi
cp /original /output/copy.txt
cmp /original /output/copy.txt
if dd if=/dev/zero of=/output/overflow bs=1048576 count=20 status=none 2>/dev/null; then exit 46; fi
rm -f /output/overflow

if dd if=/dev/zero of=/scratch/overflow bs=1048576 count=20 status=none 2>/dev/null; then exit 45; fi
rm -f /scratch/overflow
printf 'ISOLATION_PROBE_OK\\n'
'''
            for volume in volumes:
                checks = f'if (echo changed > {volume}/write-probe) 2>/dev/null; then exit 47; fi\n' + checks
            for label, script, deadline in [('boundaries', checks, 20),
                                             ('timeout', 'sleep 30', 1)]:
                name = 'inveos-probe-' + uuid.uuid4().hex
                try:
                    command(*container_args(name, image_id, original, volumes), script)
                    info = json.loads(command('inspect', name).stdout)[0]
                    check_configuration(info, volumes)
                    timed_out = False
                    try:
                        result = command('start', '-a', name, timeout=deadline)
                    except subprocess.TimeoutExpired:
                        timed_out = True
                    if label == 'timeout':
                        require(timed_out, 'Timeout probe unexpectedly completed')
                    else:
                        require(not timed_out and result.stdout.strip() == 'ISOLATION_PROBE_OK')
                    receipts.append(label)
                finally:
                    command('rm', '-f', '-v', name)
                    require(command('inspect', name, check=False).returncode != 0)
        require(hashlib.sha256(original.read_bytes()).hexdigest() == expected)
    return {'status': 'host_probe_passed', 'imageId': image_id,
            'repoDigests': image_info.get('RepoDigests', []), 'checks': receipts,
            'originalSha256': expected, 'parserExecuted': False, 'imageVolumeOverrides': list(volumes),
            'limits': 'Configured/cgroup-visible CPU, RAM and PID caps; actual scratch/output exhaustion, image-volume write denial and timeout cleanup. No exploit resistance certification.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', default='postgres:15', help='Already-present test image; never pulled')
    args = parser.parse_args()
    try:
        print(json.dumps(run_probe(args.image), indent=2))
    except (OSError, subprocess.SubprocessError, ValueError, AssertionError, KeyError) as error:
        print(json.dumps({'status': 'host_probe_failed', 'errorType': type(error).__name__,
                          'parserExecuted': False}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
