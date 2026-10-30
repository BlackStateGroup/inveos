#!/usr/bin/env python3
"""Fresh destructive qualification of an already-built, exact research speech runtime."""
from datetime import datetime, timezone
import json
from .build_whisper_research import runtime_inventory
from .probe_worker_isolation import run_probe
from .whisper_research_inputs import ROOT, require, sha, safe_path


def qualify():
    receipt_path = ROOT / '.research-cache/whisper-built/build-receipt.json'
    safe_path(receipt_path); require(receipt_path.stat().st_size <= 2 * 1024 * 1024, 'Build receipt bound')
    build = json.loads(receipt_path.read_text())
    lock_bytes = (ROOT / 'research/runtime_artifacts/whisper-runtime.lock.json').read_bytes()
    lock = json.loads(lock_bytes)
    require(build['sourceRevision'] == lock['sourceRevision'] and build['baseConfig'] == lock['baseConfig'] and build['repeatedBuildsIdentical'] is True, 'Speech build provenance differs')
    require(build['binarySha256'] == lock['files'][0]['sha256'] and build['binaryBytes'] == lock['files'][0]['bytes'], 'Speech binary changed')
    image = build['runtimeImageId']
    # Actually repeat boundaries/OOM/PID/CPU/deadline/output/cleanup probes now.
    # A timestamp is never added to a stale historical result.
    probe = run_probe(image, runtime=True)
    inventory = runtime_inventory(image)
    files = {lock['files'][0]['path']: {k: build[n] for k, n in [('bytes', 'binaryBytes'), ('sha256', 'binarySha256')]}}
    for library in inventory['libraries']:
        for item in [library, *library['notices']]:
            files[item['path']] = {k: item[k] for k in ('bytes', 'sha256')}
    require(files == {x['path']: {k: x[k] for k in ('bytes', 'sha256')} for x in lock['files']}, 'Measured runtime files differ from application lock')
    result = {**probe, 'runtimeLock': sha(lock_bytes), 'checkedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')}
    output = ROOT / '.research-cache/speech-worker-qualification.json'; safe_path(output)
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    qualify()
