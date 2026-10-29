#!/usr/bin/env python3
"""Prepare verified research artifacts as data; do not execute them on the host."""
import argparse,hashlib,json,shutil
from pathlib import Path
from experiment_native_pdf import ROOT,prepare_bundle

def prepare(destination, kind="document"):
    if kind not in ("document", "raster"):raise ValueError("Unknown worker kind")
    destination=Path(destination).resolve()
    if destination.parent!=ROOT/'.research-cache' or not destination.name.startswith('leased-document-') or not destination.is_dir() or any(destination.iterdir()):
        raise ValueError('Expected an empty private research destination')
    destination.chmod(0o755)
    prepare_bundle(destination)
    shutil.copyfile(ROOT/'tools'/('run_native_document.py' if kind=='document' else 'run_raster_document.py'),destination/'run.py')
    if kind=='raster':
        for name in ('pdf_render.py','pdf_render_limits.py'):
            shutil.copyfile(ROOT/'tools'/name,destination/name)
            (destination/name).chmod(0o444)
    (destination/'run.py').chmod(0o444)
    return {'status':'verified_research_bundle','runnerSha256':hashlib.sha256((destination/'run.py').read_bytes()).hexdigest()}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--bundle',required=True)
    parser.add_argument('--kind',choices=['document','raster'],default='document')
    args=parser.parse_args();print(json.dumps(prepare(args.bundle,args.kind)))
