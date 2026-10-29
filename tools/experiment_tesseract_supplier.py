#!/usr/bin/env python3
"""Actual isolated clean-scan OCR baseline, not product/runtime approval.

Networked package preparation occurs in a disposable build with no evidence.
After preparation, every inspection and parser run uses an immutable image ID,
the existing qualified isolation policy, bounded capture and confirmed cleanup.
"""
import json
from pathlib import Path
import shutil
import tempfile
import uuid
import hashlib
import os
from datetime import datetime,timezone
from bounded_process import run_bounded
from prepare_ocr_worker import prepare_ocr_bundle
from probe_worker_isolation import command,container_args,check_configuration,require,run_probe

ROOT=Path(__file__).resolve().parent.parent


def experiment(case_acceptance=False):
    cache=ROOT/'.research-cache';cache.mkdir(exist_ok=True)
    tag='inveos-tesseract-research:'+uuid.uuid4().hex
    # Only the first-party Dockerfile enters build context; no private files,
    # original store, credentials or third-party checkout is sent to the daemon.
    with tempfile.TemporaryDirectory(dir=cache,prefix='ocr-build-') as directory:
        build=Path(directory);shutil.copyfile(ROOT/'research/runtime_artifacts/tesseract-baseline.Dockerfile',build/'Dockerfile')
        command('build','--pull=false','--tag',tag,str(build),timeout=240)
    try:
        qualification=run_probe(tag,runtime=True);image_id=qualification['imageId']
        with tempfile.TemporaryDirectory(dir=cache,prefix='ocr-supplier-') as directory:
            bundle=Path(directory).resolve();bundle.chmod(0o755);prepare_ocr_bundle(bundle)
            for name in ['run_tesseract_supplier.py','supplier_scan_fixture.py','bounded_process.py']:
                shutil.copyfile(ROOT/'tools'/name,bundle/name)
            # Start detached: no host attach process enforces this deadline.
            # A first-party sleeper must be killed by the container's own timer.
            name='inveos-ocr-deadline-'+uuid.uuid4().hex
            try:
                command(*container_args(name,image_id,bundle,runtime=True),"timeout --signal=KILL 1s python -c 'import time; time.sleep(30)'")
                check_configuration(json.loads(command('inspect',name).stdout)[0],runtime=True)
                command('start',name)
                require(command('wait',name,timeout=5).stdout.strip()=='137','Detached container deadline failed')
            finally:
                command('rm','-f','-v',name);require(command('inspect',name,check=False).returncode!=0,'Deadline container cleanup failed')
            results=[]
            for mode in ['--inventory','']:
                name='inveos-ocr-supplier-'+uuid.uuid4().hex
                try:
                    # The in-container deadline survives loss of the host attach
                    # process; exiting PID 1 also ends remaining child sessions.
                    script=f'export HOME=/scratch TMPDIR=/scratch PYTHONDONTWRITEBYTECODE=1 OMP_THREAD_LIMIT=1 OPENBLAS_NUM_THREADS=1\nexport PYTHONPATH=/original/runtime:/original\ntimeout --signal=KILL 165s python /original/run_tesseract_supplier.py {mode}\n'
                    command(*container_args(name,image_id,bundle,runtime=True),script)
                    check_configuration(json.loads(command('inspect',name).stdout)[0],runtime=True)
                    process=command('start','-a',name,timeout=180,check=False,max_output=2*1024*1024)
                    if process.returncode:raise ValueError('Isolated OCR experiment failed: '+process.stderr[-2000:])
                    report=json.loads(process.stdout)
                    if mode:
                        require(report.get('parserExecuted') is False and report.get('artifacts'),'Missing pre-execution artifact inventory')
                    results.append(report)
                finally:
                    command('rm','-f','-v',name);require(command('inspect',name,check=False).returncode!=0,'OCR container cleanup failed')
        # Fail closed on *all* installed versions and selected native/model/notice
        # bytes before enabling the fictional case worker. This is a content
        # acceptance lock, not a complete package-archive or legal clearance.
        lock_bytes=(ROOT/'research/runtime_artifacts/tesseract-baseline.lock.json').read_bytes()
        lock=json.loads(lock_bytes)
        require(lock['packages']==results[0]['packages'] and lock['artifacts']==results[0]['artifacts'],'OCR runtime artifact drift')
        acceptance=None
        if case_acceptance:
            require(os.environ.get('INVEOS_TEST_DATABASE_URL','').endswith('/inveos_test'),'Disposable test database required')
            (cache/'tesseract-worker-qualification.json').write_text(json.dumps({**qualification,'checkedAt':datetime.now(timezone.utc).isoformat(),'artifactLock':hashlib.sha256(lock_bytes).hexdigest()}))
            (cache/'tesseract-supplier-input.json').write_text(json.dumps(results[1]['supplierSources']))
            checked=run_bounded(['node','--import','tsx','--test','--test-concurrency=1','apps/api/test/ocr-worker.integration.ts'],timeout=300,max_output=1024*1024)
            if checked.returncode:raise ValueError('Actual OCR case acceptance failed: '+checked.stdout.decode()[-20000:]+'\n'+checked.stderr.decode()[-4000:])
            acceptance=checked.stdout.decode()
        return dict(status='isolated_scanned_supplier_baseline_measured',imageId=image_id,qualification=qualification,detachedDeadlineVerified=True,caseAcceptance=acceptance,
                    inventory=results[0],experiment=results[1],approval='research_only_not_product_or_licence_approval',
                    remaining='Pinned-source Tesseract comparison, Tika/OCRmyPDF comparisons, noise/skew/multilingual/table corpus and durable OCR lineage/API acceptance remain open')
    finally:
        command('image','rm',tag,check=False)


if __name__=='__main__':
    import sys
    print(json.dumps(experiment('--case-acceptance' in sys.argv),indent=2))
