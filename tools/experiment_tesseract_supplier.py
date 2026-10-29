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
from experiment_native_pdf import prepare_bundle
from probe_worker_isolation import command,container_args,check_configuration,require,run_probe

ROOT=Path(__file__).resolve().parent.parent


def experiment():
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
            bundle=Path(directory).resolve();bundle.chmod(0o755);prepare_bundle(bundle)
            for name in ['run_tesseract_supplier.py','supplier_scan_fixture.py','bounded_process.py']:
                shutil.copyfile(ROOT/'tools'/name,bundle/name)
            results=[]
            for mode in ['--inventory','']:
                name='inveos-ocr-supplier-'+uuid.uuid4().hex
                try:
                    script=f'export HOME=/scratch TMPDIR=/scratch PYTHONDONTWRITEBYTECODE=1 OMP_THREAD_LIMIT=1 OPENBLAS_NUM_THREADS=1\nexport PYTHONPATH=/original/runtime:/original\npython /original/run_tesseract_supplier.py {mode}\n'
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
        return dict(status='isolated_scanned_supplier_baseline_measured',imageId=image_id,qualification=qualification,
                    inventory=results[0],experiment=results[1],approval='research_only_not_product_or_licence_approval',
                    remaining='Pinned-source Tesseract comparison, Tika/OCRmyPDF comparisons, noise/skew/multilingual/table corpus and durable OCR lineage/API acceptance remain open')
    finally:
        command('image','rm',tag,check=False)


if __name__=='__main__':print(json.dumps(experiment(),indent=2))
