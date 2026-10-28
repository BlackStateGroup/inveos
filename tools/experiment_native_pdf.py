#!/usr/bin/env python3
"""Bounded research execution, not product incorporation or licence clearance."""
import json,hashlib,shutil,tempfile,uuid,zipfile,stat
from pathlib import Path
from build_docling_research import IMAGE,PIN,snapshot_source,verify_built_wheel
from audit_runtime_wheels import audit_directory
from probe_worker_isolation import run_probe,command,container_args,check_configuration,require
from synthetic_pdf import digital_pdf,coverage_pdf
ROOT=Path(__file__).resolve().parent.parent


def experiment():
    wheels=ROOT/'.research-cache/docling-locked-cp312'
    expected=json.loads((ROOT/'research/runtime_artifacts/docling-native-cp312.json').read_text())['artifacts']
    actual=audit_directory(wheels)
    require({r['filename']:r['sha256'] for r in actual}=={r['filename']:r['sha256'] for r in expected},'Runtime inventory mismatch')
    qualification=run_probe(IMAGE,runtime=True)
    with tempfile.TemporaryDirectory(dir=ROOT/'.research-cache',prefix='native-pdf-') as directory:
        bundle=Path(directory).resolve();bundle.chmod(0o755)
        manifest=snapshot_source(ROOT/'.research-cache/sources/docling-project/docling',bundle/'source')
        # Expand already hash-verified wheels as data, never install/import on
        # the host. The private tree is mounted read-only into the container.
        exact=ROOT/'.research-cache/docling-exact/docling_slim-2.142.1-py3-none-any.whl'
        receipt=json.loads((ROOT/'research/runtime_artifacts/docling-build-receipt.json').read_text())
        require(hashlib.sha256(exact.read_bytes()).hexdigest()==receipt['builds'][0]['wheelSha256'],'Exact-source wheel digest mismatch')
        verify_built_wheel(exact.read_bytes(),manifest)
        runtime=bundle/'runtime';runtime.mkdir()
        total=0
        for r in actual:
            selected=exact if r['name']=='docling-slim' else wheels/r['filename']
            with zipfile.ZipFile(selected) as archive:
                for member in archive.infolist():
                    if member.is_dir():continue
                    require('.data/' not in member.filename and not member.filename.endswith('.pth'),'Unsupported wheel install mapping')
                    require(not stat.S_ISLNK(member.external_attr>>16),'Wheel symlink rejected')
                    total+=member.file_size
                    require(member.file_size<=128*1024*1024 and total<=512*1024*1024,'Runtime expansion bound exceeded')
                    target=runtime/member.filename
                    target.parent.mkdir(parents=True,exist_ok=True)
                    with target.open('xb') as stream:stream.write(archive.read(member))
                    target.chmod(0o444)
        (bundle/'digital.pdf').write_bytes(digital_pdf());(bundle/'malformed.pdf').write_bytes(b'%PDF-1.4\nFICTIONAL malformed\n')
        for name,kinds in {'mixed':['text','raster'],'blank':['blank','text'],'raster':['raster'],'overpages':['text']*3}.items():
            (bundle/(name+'.pdf')).write_bytes(coverage_pdf(kinds))
        (bundle/'oversize.pdf').write_bytes(digital_pdf()+b' '*65536)
        shutil.copyfile(ROOT/'tools/pdf_text_coverage.py',bundle/'pdf_text_coverage.py')
        shutil.copyfile(ROOT/'tools/run_native_pdf_fixture.py',bundle/'run.py')
        reports=[]
        for attempt in range(2):
            name='inveos-native-pdf-'+uuid.uuid4().hex
            try:
                script='''export HOME=/scratch TMPDIR=/scratch PYTHONDONTWRITEBYTECODE=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
export PYTHONPATH=/original/source:/original/runtime
python /original/run.py
'''
                command(*container_args(name,qualification['imageId'],bundle,runtime=True),script)
                check_configuration(json.loads(command('inspect',name).stdout)[0],runtime=True)
                # Retain bounded diagnostics on research failure; fixtures are fictional.
                result=command('start','-a',name,timeout=90,check=False)
                if result.returncode:raise ValueError('Isolated experiment failed: '+result.stderr[-4000:])
                reports.append(json.loads(result.stdout))
            finally:
                command('rm','-f','-v',name)
                require(command('inspect',name,check=False).returncode!=0,'Cleanup failed')
        require(reports[0]['rows']==reports[1]['rows'],'Repeated source references differ')
        require(reports[0]['coverageCases']==reports[1]['coverageCases'],'Coverage results differ')
        for path,item in manifest.items():require(hashlib.sha256((bundle/'source'/path).read_bytes()).hexdigest()==item['sha256'],'Pinned source changed')
    return {'status':'synthetic_native_pdf_passed','sourcePin':PIN,'image':IMAGE,'qualification':qualification,'runs':reports,'approval':'research_only_not_product_or_licence_approval'}

if __name__=='__main__':print(json.dumps(experiment(),indent=2))
