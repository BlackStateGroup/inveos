#!/usr/bin/env python3
"""Disposable, loopback-only actual Keycloak qualification; never a deployment tool."""
import argparse
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import threading
import time
import urllib.request
import uuid
import zipfile

if __package__:
    from .probe_worker_isolation import command, require, run_probe
else:
    from probe_worker_isolation import command, require, run_probe

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.research-cache/keycloak-runtime'
SOURCE = '24ed1dadf3f246a555adb6d3d4a99e9b3003fb3b'
DIGEST = 'sha256:3e1ac632e743660017b1e6bb4c3ffc800fd02c82cdd0db858cd03456a98a8dfc'
CONFIG = 'sha256:b55801be6ce15109868bd056dc18d62d47106bfaad7ffbd1a5d804192ec98257'
IMAGE = 'quay.io/keycloak/keycloak@' + DIGEST
LAYER = 'sha256:b069ba8c51be9f5f7fdcd2056de21e6ff389b0dfab8e5575a573dd997daa7788'
NOTICE_SHA = '14c17647c43f27315d148812a0be6b97b3cc9585463588ebbe67f7282cfe661d'
ISSUER = 'http://127.0.0.1:58992/realms/inveos-fictional'
ORIGIN = 'http://127.0.0.1:58991'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def acquire(name, url, digest, size, fetch):
    path = CACHE / name
    require(not any(parent.is_symlink() for parent in [CACHE, *CACHE.parents]), 'Symlinked research cache')
    require(not path.is_symlink(), 'Symlinked artifact')
    if not path.exists() and fetch:
        CACHE.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(urllib.request.Request(url, headers={'Accept': 'application/vnd.oci.image.manifest.v1+json'}), timeout=30) as response:
            data = response.read(size + 1)
        require(len(data) == size and sha(data) == digest.removeprefix('sha256:'), 'Acquired artifact mismatch')
        path.write_bytes(data)
    require(path.is_file() and not path.is_symlink() and path.stat().st_size == size, 'Missing/unsafe artifact: ' + name)
    data = path.read_bytes()
    require(sha(data) == digest.removeprefix('sha256:'), 'Artifact digest changed: ' + name)
    return data


def audit(fetch=False):
    source = ROOT / '.research-cache/sources/keycloak/keycloak'
    actual = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], timeout=10, text=True).strip()
    require(actual == SOURCE, 'Source pin mismatch')
    require(not subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain'], timeout=10), 'Source edits require review')
    source_licence = (source / 'LICENSE.txt').read_bytes()
    require(b'Apache License' in source_licence and b'Version 2.0' in source_licence)
    manifest = json.loads(acquire('manifest.json', 'https://quay.io/v2/keycloak/keycloak/manifests/' + DIGEST, DIGEST, 1056, fetch))
    config = json.loads(acquire('config.json', 'https://quay.io/v2/keycloak/keycloak/blobs/' + CONFIG, CONFIG, 9685, fetch))
    require(manifest['config']['digest'] == CONFIG and config['config']['User'] == '1000')
    require(manifest['layers'][2] == {'mediaType': 'application/vnd.oci.image.layer.v1.tar+gzip', 'digest': LAYER, 'size': 173795291})
    acquire('third-party-notice-keycloak.html', 'https://github.com/keycloak/keycloak/releases/download/26.8.1/third-party-notice-keycloak.html', NOTICE_SHA, 7523238, fetch)
    layer = acquire('keycloak-layer.tar.gz', 'https://quay.io/v2/keycloak/keycloak/blobs/' + LAYER, LAYER, 173795291, fetch)
    jars, licences, total = [], [], 0
    with tarfile.open(fileobj=io.BytesIO(layer), mode='r:gz') as archive:
        for item in archive:
            total += item.size
            require(total <= 512 * 1024 * 1024 and item.size <= 64 * 1024 * 1024, 'Layer inspection bound')
            if not item.isfile():
                continue
            if item.name == 'opt/keycloak/LICENSE.txt':
                data = archive.extractfile(item).read()
                require(b'Apache License' in data and b'Version 2.0' in data)
                licences.append({'path': item.name, 'sha256': sha(data)})
            if not item.name.endswith('.jar'):
                continue
            data = archive.extractfile(item).read()
            entries = []
            with zipfile.ZipFile(io.BytesIO(data)) as jar:
                require(len(jar.infolist()) < 100000, 'JAR entry bound')
                for entry in jar.infolist():
                    lower = entry.filename.lower()
                    if any(part in lower for part in ['license', 'licence', 'notice']) and entry.file_size <= 2 * 1024 * 1024:
                        content = jar.read(entry)
                        entries.append({'path': entry.filename, 'sha256': sha(content)})
            jars.append({'path': item.name, 'sha256': sha(data), 'bytes': len(data), 'embeddedNotices': entries})
    require(len(licences) == 1 and len(jars) > 300, 'Missing runtime inventory')
    result = {'format': 'inveos_keycloak_research_inventory_v1', 'source': SOURCE, 'sourceLicenceSha256': sha(source_licence), 'image': IMAGE, 'config': CONFIG,
              'imageLabels': config['config']['Labels'], 'layers': manifest['layers'], 'noticeSha256': NOTICE_SHA,
              'licences': licences, 'jars': jars, 'limits': 'Digest inventory and published notices; not a source rebuild, authenticated release signature, vulnerability clearance or shipping approval. UBI/JDK base closure remains open.'}
    output = ROOT / 'output/evals/keycloak'; output.mkdir(parents=True, exist_ok=True)
    (output / 'runtime-inventory.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def realm():
    def execution(authenticator, priority, config=None, requirement='REQUIRED', flow=False):
        result = {'authenticator': authenticator, 'priority': priority, 'requirement': requirement, 'authenticatorFlow': flow}
        if config:
            result['authenticatorConfig'] = config
        if flow:
            result.pop('authenticator'); result['flowAlias'] = authenticator
        return result
    def mapper(name, provider):
        return {'name': name, 'protocol': 'openid-connect', 'protocolMapper': provider, 'config': {'id.token.claim': 'true', 'access.token.claim': 'true'}}
    users = []
    for number, name in enumerate(['reviewer', 'client', 'outsider', 'unbound'], 1):
        users.append({'id': f'10000000-0000-4000-8000-{number:012d}', 'username': 'fictional-' + name, 'enabled': True,
                      'credentials': [{'type': 'password', 'value': 'Fictional-test-only-2026!', 'temporary': False},
                                      {'type': 'otp', 'secretData': json.dumps({'value': 'FictionalOtpSeedOnly' + name}),
                                       'credentialData': json.dumps({'digits': 6, 'counter': 0, 'period': 30, 'algorithm': 'HmacSHA1', 'subType': 'totp'})}]})
    return {'realm': 'inveos-fictional', 'enabled': True, 'sslRequired': 'none', 'registrationAllowed': False,
            'resetPasswordAllowed': False, 'rememberMe': False, 'loginWithEmailAllowed': False, 'editUsernameAllowed': False,
            'accessTokenLifespan': 300, 'ssoSessionIdleTimeout': 600, 'ssoSessionMaxLifespan': 900,
            'otpPolicyType': 'totp', 'otpPolicyAlgorithm': 'HmacSHA1', 'otpPolicyDigits': 6, 'otpPolicyPeriod': 30,
            'browserFlow': 'inveos-required-mfa', 'users': users,
            'authenticatorConfig': [
                {'alias': 'password-reference', 'config': {'default.reference.value': 'pwd', 'default.reference.maxAge': '300'}},
                {'alias': 'otp-reference', 'config': {'default.reference.value': 'otp', 'default.reference.maxAge': '300'}},
                {'alias': 'level-two', 'config': {'loa-condition-level': '2', 'loa-max-age': '0'}}],
            'authenticationFlows': [
                {'alias': 'inveos-required-mfa', 'providerId': 'basic-flow', 'topLevel': True, 'builtIn': False,
                 'authenticationExecutions': [execution('auth-username-password-form', 10, 'password-reference'), execution('inveos-second-factor', 20, requirement='CONDITIONAL', flow=True)]},
                {'alias': 'inveos-second-factor', 'providerId': 'basic-flow', 'topLevel': False, 'builtIn': False,
                 'authenticationExecutions': [execution('conditional-level-of-authentication', 10, 'level-two'), execution('auth-otp-form', 20, 'otp-reference')]}],
            'clients': [{'clientId': 'inveos-fictional', 'enabled': True, 'publicClient': True, 'protocol': 'openid-connect',
                         'standardFlowEnabled': True, 'directAccessGrantsEnabled': False, 'implicitFlowEnabled': False,
                         'serviceAccountsEnabled': False, 'redirectUris': [ORIGIN + '/api/auth/callback'], 'webOrigins': [ORIGIN],
                         'attributes': {'pkce.code.challenge.method': 'S256', 'default.acr.values': '2', 'minimum.acr.value': '2'},
                         'protocolMappers': [mapper('completed authentication methods', 'oidc-amr-mapper'), mapper('completed assurance level', 'oidc-acr-mapper')]}]}


def provider_proxy(address):
    """Loopback test ingress to an internal network; never an arbitrary URL proxy."""
    require(ipaddress.ip_address(address).version == 4 and ipaddress.ip_address(address).is_private)
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Callback/query/cookie contents must never enter logs.

        def forward(self):
            if not self.path.startswith(('/realms/inveos-fictional/', '/resources/')):
                self.send_error(404); return
            try:
                size = int(self.headers.get('Content-Length', '0'))
                require(0 <= size <= 16384 and not self.headers.get('Transfer-Encoding'), 'Provider request bound')
                body = self.rfile.read(size)
                require(len(body) == size, 'Incomplete provider request')
                connection = http.client.HTTPConnection(address, 8080, timeout=10)
                try:
                    headers = {k: v for k, v in self.headers.items() if k.lower() not in ['connection', 'transfer-encoding', 'expect']}
                    connection.request(self.command, self.path, body=body, headers=headers)
                    response = connection.getresponse()
                    data = response.read(8 * 1024 * 1024 + 1)
                    require(len(data) <= 8 * 1024 * 1024, 'Provider response bound')
                    self.send_response(response.status)
                    for key, value in response.getheaders():
                        if key.lower() not in ['connection', 'transfer-encoding', 'content-length']:
                            self.send_header(key, value)
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers(); self.wfile.write(data)
                finally:
                    connection.close()
            except (OSError, ValueError, http.client.HTTPException):
                self.send_error(502, 'Disposable provider unavailable')
        do_GET = forward
        do_POST = forward
    server = ThreadingHTTPServer(('127.0.0.1', 58992), Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def qualify():
    inventory = audit()
    info = json.loads(command('image', 'inspect', IMAGE).stdout)[0]
    require(info['Id'] == CONFIG and not info['Config'].get('Volumes'), 'Image configuration mismatch')
    # Reuse the already-running disposable PostgreSQL image for destructive host probes.
    # The provider has separate configuration and live boundary checks below.
    probes = run_probe('postgres:15', runtime=True)
    token = uuid.uuid4().hex
    name, network = 'inveos-keycloak-' + token, 'inveos-keycloak-network-' + token
    with tempfile.TemporaryDirectory(prefix='inveos-keycloak-') as directory:
        root = Path(directory); root.chmod(0o755)
        fixture = root / 'realm.json'; fixture.write_text(json.dumps(realm())); fixture.chmod(0o444)
        command('network', 'create', '--internal', network)
        proxy = None
        try:
            script = 'exec > /scratch/startup.log 2>&1; status=0; (set -e; cp -R /opt/keycloak /scratch/keycloak; mkdir -p /scratch/keycloak/data/import; cp /fixture /scratch/keycloak/data/import/inveos-fictional-realm.json; exec /bin/bash /scratch/keycloak/bin/kc.sh start-dev --import-realm --http-port=8080 --hostname=http://127.0.0.1:58992 --hostname-strict=true --cache=local) || status=$?; printf "Provider exited: %s\\n" "$status"; echo "$status" > /scratch/provider.exit; sleep 120; exit "$status"'
            command('create', '--pull=never', '--name', name, '--network', network,
                    '--user=1000:1000', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true',
                    '--memory=2g', '--memory-swap=2g', '--cpus=2', '--pids-limit=128', '--log-driver=none',
                    '--tmpfs=/scratch:rw,noexec,nosuid,nodev,size=1g,mode=1777', '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=128m,mode=1777',
                    '--mount', f'type=bind,src={fixture},dst=/fixture,readonly', '--env', 'JAVA_OPTS_APPEND=-XX:ActiveProcessorCount=2 -Xmx768m -Djava.io.tmpdir=/tmp',
                    '--entrypoint=/bin/bash', CONFIG, '-ceu', script)
            detail = json.loads(command('inspect', name).stdout)[0]
            host = detail['HostConfig']
            require(host['ReadonlyRootfs'] and host['NetworkMode'] == network and host['CapDrop'] == ['ALL'] and not host['Privileged'])
            require(host['Memory'] == 2147483648 and host['MemorySwap'] == host['Memory'] and host['PidsLimit'] == 128 and host['NanoCpus'] == 2000000000)
            require('no-new-privileges:true' in host['SecurityOpt'] and host['LogConfig']['Type'] == 'none')
            require(json.loads(command('network', 'inspect', network).stdout)[0]['Internal'])
            require(detail['Config']['User'] == '1000:1000' and not host['PortBindings'])
            command('start', name)
            address = json.loads(command('inspect', name).stdout)[0]['NetworkSettings']['Networks'][network]['IPAddress']
            proxy, proxy_thread = provider_proxy(address)
            deadline = time.monotonic() + 100
            while True:
                try:
                    with urllib.request.urlopen(ISSUER + '/.well-known/openid-configuration', timeout=2) as response:
                        require(json.loads(response.read(65537))['issuer'] == ISSUER)
                    break
                except (OSError, ValueError):
                    if time.monotonic() >= deadline or command('exec', name, '/bin/bash', '-c', 'test -f /scratch/provider.exit', check=False).returncode == 0:
                        diagnostic = command('exec', name, '/bin/bash', '-c', 'tail -c 12000 /scratch/startup.log', check=False, max_output=16384)
                        print(diagnostic.stdout)
                        print(json.dumps(json.loads(command('inspect', name).stdout)[0]['State']))
                        raise ValueError('Actual Keycloak did not become ready')
                    time.sleep(1)
            # Actual provider process: cannot write root, fixture or reach the public network.
            command('exec', name, '/bin/bash', '-ceu', 'test "$(id -u)" = 1000; test "$(cat /sys/fs/cgroup/memory.max)" = 2147483648; test "$(cat /sys/fs/cgroup/pids.max)" = 128; ! touch /root-write; ! echo changed >> /fixture; ! timeout 3 bash -c "echo > /dev/tcp/1.1.1.1/443"', timeout=10)
            result = subprocess.run(['node', '--import', 'tsx', '--test', '--test-concurrency=1', 'apps/api/test/keycloak.integration.ts'], cwd=ROOT, timeout=180)
            require(result.returncode == 0, 'Actual provider/browser qualification failed')
            (ROOT / 'output/evals/keycloak/host-receipt.json').write_text(json.dumps({'image': inventory['image'], 'config': CONFIG, 'hostProbes': probes, 'internalNetwork': True, 'loopbackOnly': True, 'rootAndFixtureReadOnly': True, 'publicEgressDenied': True, 'actualBrowserPassed': True}, indent=2) + '\n')
        finally:
            if proxy:
                proxy.shutdown(); proxy.server_close(); proxy_thread.join(timeout=5)
            command('rm', '-f', name, check=False)
            command('network', 'rm', network)
            require(command('inspect', name, check=False).returncode != 0, 'Provider container retained')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fetch', action='store_true', help='Acquire pinned research artifacts; no execution')
    parser.add_argument('--run', action='store_true', help='Require already-pulled pinned image and a qualified disposable Docker/browser/PostgreSQL host')
    args = parser.parse_args()
    result = audit(args.fetch)
    print(json.dumps({'image': IMAGE, 'jars': len(result['jars']), 'noticeSha256': NOTICE_SHA}))
    if args.run:
        qualify()
