"""Research-only isolated rendering with existing hash-locked runtime artifacts."""
import hashlib,json,shutil,tempfile,uuid
from pathlib import Path
from experiment_native_pdf import prepare_bundle,ROOT
from build_docling_research import IMAGE
from probe_worker_isolation import run_probe,command,container_args,check_configuration,require
from synthetic_pdf import digital_pdf,coverage_pdf

def experiment():
    qualification=run_probe(IMAGE,runtime=True)
    with tempfile.TemporaryDirectory(dir=ROOT/'.research-cache',prefix='render-pdf-') as directory:
        bundle=Path(directory).resolve();bundle.chmod(0o755);prepare_bundle(bundle)
        fixtures={'digital':digital_pdf(),'mixed':coverage_pdf(['text','raster']),'blank':coverage_pdf(['blank','text']),
                  'raster':coverage_pdf(['raster']),'overpages':coverage_pdf(['text']*3),
                  'oversize':digital_pdf()+b' '*65536,'malformed':b'%PDF-1.4\nFICTIONAL malformed'}
        for name,data in fixtures.items():(bundle/(name+'.pdf')).write_bytes(data)
        for source,target in [('run_pdf_render_fixture.py','run.py'),('pdf_render_limits.py','pdf_render_limits.py')]:
            shutil.copyfile(ROOT/'tools'/source,bundle/target)
        runs=[]
        for _ in range(2):
            name='inveos-render-'+uuid.uuid4().hex
            try:
                script='export HOME=/scratch TMPDIR=/scratch PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/original/runtime; exec timeout --signal=KILL 30s python /original/run.py'
                command(*container_args(name,qualification['imageId'],bundle,runtime=True),script)
                check_configuration(json.loads(command('inspect',name).stdout)[0],runtime=True)
                result=command('start','-a',name,timeout=60,check=False)
                if result.returncode:raise ValueError('Fictional render experiment failed: '+result.stderr[-3000:])
                report=json.loads(result.stdout)
                for key,value in report['cases'].items():
                    require(value['originalSha256']==hashlib.sha256(fixtures[key]).hexdigest(),'Original identity mismatch')
                runs.append(report)
            finally:
                command('rm','-f','-v',name)
                require(command('inspect',name,check=False).returncode!=0,'Cleanup failed')
        require(runs[0]==runs[1],'Render repeatability mismatch')
        for name,data in fixtures.items():require((bundle/(name+'.pdf')).read_bytes()==data,'Original changed')
    return {'status':'isolated_render_passed','image':IMAGE,'qualification':qualification,'runs':runs}
if __name__=='__main__':print(json.dumps(experiment()))
