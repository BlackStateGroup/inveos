#!/usr/bin/env python3
"""Explicit host isolation probe for an already present locked JDK image. No parser runs."""
import json
from datetime import datetime, timezone
from build_tika_research import ROOT, IMAGE, CONFIG
from probe_worker_isolation import run_probe


def main():
    receipt = run_probe(IMAGE, runtime=True)
    if receipt['imageId'] != CONFIG:
        raise ValueError('Locked Tika JDK configuration differs')
    receipt['checkedAt'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    receipt['runtimeLockSha256'] = '7dd4b380c2deed19c9086f8b398df2b2fc13fe7a92c53af5b9172a8e1e12b581'
    path = ROOT / '.research-cache/tika-worker-qualification.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError('Qualification receipt cannot be a symlink')
    path.write_text(json.dumps(receipt, indent=2) + '\n')
    path.chmod(0o600)
    print(json.dumps({'status': receipt['status'], 'receipt': str(path), 'parserExecuted': False}))


if __name__ == '__main__':
    main()
