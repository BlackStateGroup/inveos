#!/usr/bin/env python3
"""Prepare verified research artifacts as data; do not execute them on the host."""
import argparse,hashlib,json,shutil
from pathlib import Path
from experiment_native_pdf import ROOT,prepare_bundle
from prepare_ocr_worker import prepare_ocr_bundle

def prepare(destination, kind="document"):
    if kind not in ("document", "raster", "ocr"):raise ValueError("Unknown worker kind")
    destination=Path(destination).resolve()
    if destination.parent!=ROOT/'.research-cache' or not destination.name.startswith('leased-document-') or not destination.is_dir() or any(destination.iterdir()):
        raise ValueError('Expected an empty private research destination')
    destination.chmod(0o755)
    if kind=='ocr':prepare_ocr_bundle(destination)
    else:prepare_bundle(destination)
    shutil.copyfile(ROOT/'tools'/({'document':'run_native_document.py','raster':'run_raster_document.py','ocr':'run_ocr_document.py'}[kind]),destination/'run.py')
    if kind=='ocr':
        for name in ('run_tesseract_supplier.py','supplier_scan_fixture.py','bounded_process.py','pdf_render_limits.py'):
            shutil.copyfile(ROOT/'tools'/name,destination/name)
            (destination/name).chmod(0o444)
    if kind=='raster':
        for name in ('pdf_render.py','pdf_render_limits.py'):
            shutil.copyfile(ROOT/'tools'/name,destination/name)
            (destination/name).chmod(0o444)
    (destination/'run.py').chmod(0o444)
    return {'status':'verified_research_bundle','runnerSha256':hashlib.sha256((destination/'run.py').read_bytes()).hexdigest()}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--bundle',required=True)
    parser.add_argument('--kind',choices=['document','raster','ocr'],default='document')
    args=parser.parse_args();print(json.dumps(prepare(args.bundle,args.kind)))
