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


def container_args(name, image_id, original, output):
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', image_id):
        raise ValueError('An immutable local image ID is required')
    return ['create', '--pull=never', '--name', name, '--network=none',
            '--user=65534:65534', '--read-only', '--cap-drop=ALL',
            '--security-opt=no-new-privileges:true', '--memory=128m',
            '--memory-swap=128m', '--cpus=0.5', '--pids-limit=32',
            '--tmpfs=/scratch:rw,noexec,nosuid,nodev,size=16m,mode=1777',
            '--mount', f'type=bind,src={original},dst=/original,readonly',
            '--mount', f'type=bind,src={output},dst=/output',
            '--entrypoint=/bin/bash', image_id, '-ceu']


def check_configuration(info):
    host = info['HostConfig']
    assert info['Config']['User'] == '65534:65534'
    assert host['NetworkMode'] == 'none' and host['ReadonlyRootfs']
    assert host['CapDrop'] == ['ALL'] and not host['Privileged']
    assert 'no-new-privileges:true' in host['SecurityOpt']
    assert host['Memory'] == 128 * 1024 * 1024
    assert host['MemorySwap'] == host['Memory']
    assert host['NanoCpus'] == 500000000 and host['PidsLimit'] == 32
    originals = [m for m in info['Mounts'] if m['Destination'] == '/original']
    assert len(originals) == 1 and originals[0]['RW'] is False


def run_probe(image):
    # Resolving a tag is allowed only for the existing CI image. Every run below
    # uses the captured content ID and records it; this is not a runtime lock.
    image_info = json.loads(command('image', 'inspect', image).stdout)[0]
    image_id = image_info['Id']
    receipts = []
    with tempfile.TemporaryDirectory(prefix='inveos-isolation-') as directory:
        root = Path(directory)
        root.chmod(0o755)
        original = root / 'original.txt'
        original.write_bytes(b'FICTIONAL INVEOS isolation fixture\n')
        original.chmod(0o444)
        output = root / 'output'
        output.mkdir(mode=0o777)
        output.chmod(0o777)
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
if dd if=/dev/zero of=/scratch/overflow bs=1048576 count=20 status=none 2>/dev/null; then exit 45; fi
rm -f /scratch/overflow
printf 'ISOLATION_PROBE_OK\\n'
'''
            for label, script, deadline in [('boundaries', checks, 20),
                                             ('timeout', 'sleep 30', 1)]:
                name = 'inveos-probe-' + uuid.uuid4().hex
                try:
                    command(*container_args(name, image_id, original, output), script)
                    info = json.loads(command('inspect', name).stdout)[0]
                    check_configuration(info)
                    timed_out = False
                    try:
                        result = command('start', '-a', name, timeout=deadline)
                    except subprocess.TimeoutExpired:
                        timed_out = True
                    if label == 'timeout':
                        assert timed_out, 'Timeout probe unexpectedly completed'
                    else:
                        assert not timed_out and result.stdout.strip() == 'ISOLATION_PROBE_OK'
                    receipts.append(label)
                finally:
                    command('rm', '-f', '-v', name)
                    assert command('inspect', name, check=False).returncode != 0
        assert hashlib.sha256(original.read_bytes()).hexdigest() == expected
        assert (output / 'copy.txt').read_bytes() == original.read_bytes()
    return {'status': 'host_probe_passed', 'imageId': image_id,
            'repoDigests': image_info.get('RepoDigests', []), 'checks': receipts,
            'originalSha256': expected, 'parserExecuted': False,
            'limits': 'Configured/cgroup-visible CPU, RAM and PID caps; actual scratch exhaustion and timeout cleanup. No exploit resistance certification.'}


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
