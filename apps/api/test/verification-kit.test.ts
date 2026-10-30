// Authored for the combined acceptance phase; compiler success is not execution.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {buildVerificationKit} from '../src/verification-kit.js';

test('offline kit extracts independently, imports its helper closure and verifies Unicode source spans without the checkout',{timeout:30000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'inveos-copied-kit-'));
 try{
  const kit=await buildVerificationKit(),again=await buildVerificationKit();assert.deepEqual(kit.bytes,again.bytes);assert.equal(createHash('sha256').update(kit.bytes).digest('hex'),kit.sha256);
  await writeFile(join(root,'kit.zip'),kit.bytes);
  const options={cwd:root,env:{...process.env,PYTHONPATH:'',PYTHONNOUSERSITE:'1'},timeout:20000,encoding:'utf8' as const};
  const inventory=JSON.parse(execFileSync('python3',['-c',`
import hashlib, importlib, json, pathlib, zipfile
with zipfile.ZipFile('kit.zip') as archive:
    assert archive.testzip() is None
    names=archive.namelist()
    assert len(names)==len(set(names)) and 3<len(names)<=32
    assert all('/' not in name and chr(92) not in name and name not in ('.','..') for name in names)
    manifest_bytes=archive.read('manifest.json')
    manifest=json.loads(manifest_bytes)
    assert manifest['format']=='inveos_verification_kit_v1'
    assert set(names)=={'manifest.json'}|{item['path'] for item in manifest['files']}
    for item in manifest['files']:
        raw=archive.read(item['path'])
        assert len(raw)==item['byteLength']
        assert hashlib.sha256(raw).hexdigest()==item['sha256']
        pathlib.Path(item['path']).write_bytes(raw)
    assert all(name.endswith('.py') or name in ('manifest.json','README.txt') for name in names)
    # Import from this extracted directory only; no tools package is supplied.
    for name in names:
        if name.endswith('.py'):
            loaded=importlib.import_module(name[:-3])
            assert pathlib.Path(loaded.__file__).resolve().parent==pathlib.Path.cwd()
    print(json.dumps({'count':len(names),'manifestSha256':hashlib.sha256(manifest_bytes).hexdigest(),'names':names}))
`],options));
  assert.equal(inventory.count,kit.fileCount);assert.equal(inventory.manifestSha256,kit.manifestSha256);
  for(const name of ['verify_field_provenance.py','verify_report_composition.py','verify_research_context.py','verify_tika_context.py'])assert.ok(inventory.names.includes(name));
  const original=Buffer.from('FICTIONAL: Café £42. Preserved source only.'),quote='Café £42',start=original.indexOf(Buffer.from(quote)),hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
  const report={status:'draft_not_released',case:{id:'synthetic-case',ref:'SYN-KIT',title:'Fictional kit supplier',client:'Fictional client',scope:'Fictional fixture only',jurisdiction:'Synthetic'},limitations:'Fictional independent verifier fixture; no parser execution.',findings:[{id:'f1',text:'Fictional source assertion',reviewer:'Fictional reviewer',reviewedAt:'2026-10-27T09:00:00Z',source:{id:'e1',filename:'fictional-kit.txt',sha256:hash(original),sourceTime:'2026-10-25T09:00:00Z',receivedTime:'2026-10-26T09:00:00Z',quote,startByte:start,endByte:start+Buffer.byteLength(quote),contentBase64:original.toString('base64'),policy:{authorityId:'a1',authorityVersion:1,purpose:'Fictional source reading',lawfulBasis:'Synthetic only',scope:'Fictional fixture only',retentionDays:30,minimisation:'No real personal data'}}}]};
  const bytes=Buffer.from(JSON.stringify(report));await writeFile(join(root,'fictional.json'),bytes);
  const verified=JSON.parse(execFileSync('python3',['verify_report.py','fictional.json','--expected-sha256',hash(bytes),'--expected-case-id','synthetic-case'],options));assert.equal(verified.status,'integrity_checks_passed');assert.equal(verified.trustedReportDigestMatched,true);
  report.findings[0]!.source.startByte++;const changed=Buffer.from(JSON.stringify(report));await writeFile(join(root,'changed.json'),changed);
  const bad=spawnSync('python3',['verify_report.py','changed.json','--expected-sha256',hash(changed)],options);assert.notEqual(bad.status,0,'Rehashed invalid span must fail independent correspondence verification');
  // Actual retained first-party DOCX bytes, verified from the copied kit directory.
  await copyFile(fileURLToPath(new URL('../../../tests/fixtures/fictional-editable-report.docx',import.meta.url)),join(root,'fictional.docx'));
  const docx=JSON.parse(execFileSync('python3',['verify_report_docx.py','fictional.docx'],options));assert.equal(docx.format,'inveos_report_docx_v1');assert.equal(docx.paragraphsMatched,true);assert.ok(docx.paragraphCount>0);
 }finally{await rm(root,{recursive:true,force:true});}
});
