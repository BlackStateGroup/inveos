#!/usr/bin/env python3
"""Inspect native library providers in the pinned isolated research image."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile
import uuid

if __package__:
    from .build_docling_research import IMAGE
    from .probe_worker_isolation import command, container_args, check_configuration, require, run_probe
else:
    from build_docling_research import IMAGE
    from probe_worker_isolation import command, container_args, check_configuration, require, run_probe

ROOT=Path(__file__).resolve().parent.parent


def validate_receipt(report, names):
    require(report['parserExecuted'] is False and report['libraryLoadingTested'] is False, 'Inspection cannot claim execution')
    libraries=report['libraries']
    observed=[r['name'] for r in libraries]+report['missingNames']
    require(len(observed)==len(set(observed)) and set(observed)==set(names), 'Library coverage mismatch')
    require(len(report['packages'])<=1000, 'Package inventory too large')
    for row in libraries:
        require(row['package'] in report['packages'], 'Unknown package owner')
        require(row['package']['architecture']=='amd64', 'Wrong provider architecture')
        for record in [row,row['copyrightFile']]:
            require(re.fullmatch('[a-f0-9]{64}',record['sha256']) is not None, 'Invalid digest')
            require(type(record['bytes']) is int and 0<record['bytes']<=16*1024*1024, 'Invalid file size')
            for key in ['path','resolvedPath']:
                value=record[key]
                require(value.startswith(('/lib/','/lib64/','/usr/lib/','/usr/share/doc/')) and '..' not in Path(value).parts, 'Unexpected image path')
    return 'all_names_have_image_candidates' if not report['missingNames'] else 'image_candidates_missing'


def audit():
    inventory=ROOT/'research/runtime_artifacts/docling-native-elf.json'
    names=json.loads(inventory.read_text())['unmatchedNeededNames']
    require(len(names)<=64 and all(re.fullmatch('[A-Za-z0-9_.+-]+',n) for n in names), 'Invalid dependency names')
    qualification=run_probe(IMAGE)
    cache=ROOT/'.research-cache'; cache.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='image-inspection-',dir=cache) as directory:
        bundle=Path(directory).resolve(); bundle.chmod(0o755)
        for filename in ['inspect_image_libraries.py','bounded_process.py']:
            shutil.copyfile(ROOT/'tools'/filename,bundle/filename)
        (bundle/'needed.json').write_text(json.dumps(names))
        name='inveos-image-audit-'+uuid.uuid4().hex
        try:
            command(*container_args(name,qualification['imageId'],bundle),
                    'PYTHONDONTWRITEBYTECODE=1 python /original/inspect_image_libraries.py')
            check_configuration(json.loads(command('inspect',name).stdout)[0])
            report=json.loads(command('start','-a',name,timeout=45,max_output=1024*1024).stdout)
            status=validate_receipt(report,names)
        finally:
            command('rm','-f','-v',name)
            require(command('inspect',name,check=False).returncode!=0,'Image inspection cleanup failed')
    return {'status':status,'image':IMAGE,'imageId':qualification['imageId'],
            'nativeInventorySha256':hashlib.sha256(inventory.read_bytes()).hexdigest(),
            'hostQualification':qualification,**report,
            'approval':'research_metadata_only_not_runtime_or_licence_approval'}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    result=audit()
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
