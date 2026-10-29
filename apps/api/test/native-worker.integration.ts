/** Actual Docker + PostgreSQL + upstream native parser acceptance. Explicit research workflow only. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,readdir,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createPool,runMigrations} from '../src/db.js';
import {createApp} from '../src/app.js';
import {runNativeDocumentJob} from '../src/native-document-worker.js';
import {runResearchContainer} from '../src/container-worker.js';
import {documentProfile} from '../src/document-derivative.js';
import {claimIntegrityJob,renewIntegrityJob} from '../src/integrity-jobs.js';
import {superviseWorker,WorkerStopped} from '../src/leased-worker.js';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const origin='http://localhost:5173',tenant='00000000-0000-4000-8000-000000000001',user='00000000-0000-4000-8000-000000000002';
const image='sha256:'+JSON.parse(documentProfile).imageId;
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function docker(args:string[]){return (await superviseWorker({command:'/usr/bin/docker',args:['--host=unix:///var/run/docker.sock',...args],cwd:root,timeoutMs:15000},async()=>true)).toString();}
async function containers(){return (await docker(['container','ls','-aq','--filter','label=inveos.research-worker=true'])).trim();}
async function fixture(){
  const database=process.env.INVEOS_TEST_DATABASE_URL,adminUrl=process.env.INVEOS_TEST_ADMIN_DATABASE_URL;assert.ok(database&&adminUrl);assert.match(database,/\/inveos_test$/);assert.match(adminUrl,/\/inveos_test$/);
  const schema='native_test_'+randomUUID().replaceAll('-','');const admin=createPool(adminUrl,'public',2);await runMigrations(admin,schema);
  const pool=createPool(database,schema,6),owner=createPool(adminUrl,schema,2);const storage=await mkdtemp('/tmp/inveos-native-originals-');
  const app=await createApp({pool,storageRoot:storage,allowedOrigins:[origin],demoTenantId:tenant,demoUserId:user,sessionTtlSeconds:3600,documentLab:true});await app.ready();
  const session=await app.inject({method:'POST',url:'/api/session/start',headers:{origin},payload:{}});assert.equal(session.statusCode,200,session.body);
  const cookies=session.headers['set-cookie'];const cookie=(Array.isArray(cookies)?cookies:[cookies]).filter(Boolean).map(c=>c!.split(';')[0]).join('; ');const csrf=JSON.parse(session.body).csrf;
  const request=(method:'GET'|'POST',url:string,payload?:object)=>app.inject({method,url,headers:{cookie,origin,'x-csrf-token':csrf},...(payload?{payload}:{})});
  const created=await request('POST','/api/cases',{title:'Fictional actual native worker case',client:'Fictional supplier',scope:'Supplied fictional PDF only',jurisdiction:'England and Wales'});assert.equal(created.statusCode,200,created.body);const caseId=JSON.parse(created.body).id;
  const authority=()=>request('POST',`/api/cases/${caseId}/authority`,{purpose:'Fictional document worker acceptance',lawfulBasis:'Synthetic no-personal-data exercise',scope:'Supplied fictional PDF only',retentionDays:30,minimisation:'Fictional test passages only'});
  assert.equal((await authority()).statusCode,200);
  async function queue(bytes:Buffer){
    const intake=await request('POST',`/api/cases/${caseId}/evidence/binary`,{filename:'fictional.pdf',contentBase64:bytes.toString('base64'),expectedSha256:sha(bytes),sourceTime:'2026-01-01T00:00:00Z',method:'Fictional native worker input',idempotencyKey:randomUUID()});assert.equal(intake.statusCode,200,intake.body);
    const e=JSON.parse(intake.body);const queued=await request('POST',`/api/cases/${caseId}/integrity-jobs`,{evidenceId:e.id,idempotencyKey:randomUUID(),kind:'native_pdf_lab_v1'});assert.equal(queued.statusCode,200,queued.body);return {tenantId:tenant,caseId,jobId:JSON.parse(queued.body).id};
  }
  return {pool,owner,storage,request,queue,authority,close:async()=>{await app.close();await pool.end();await owner.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();await rm(storage,{recursive:true,force:true});}};
}
function pdf(){const r=spawnSync('/usr/bin/python3',['-c','import sys;from tools.synthetic_pdf import digital_pdf;sys.stdout.buffer.write(digital_pdf())'],{cwd:root});assert.equal(r.status,0,r.stderr.toString());return r.stdout;}

test('actual isolated pinned parser completes durable document jobs twice and rejects malformed originals',{timeout:240000},async t=>{
  const f=await fixture();try{
    const qualification=JSON.parse(await readFile(join(root,'.research-cache/worker-qualification.json'),'utf8'));
    const results=[];
    for(let i=0;i<2;i++){
      const scope=await f.queue(pdf());const result=await runNativeDocumentJob(f.pool,f.storage,scope,{researchOnly:true,repositoryRoot:root,qualification});assert.equal(result?.status,'succeeded');
      const response=await f.request('GET',`/api/cases/${scope.caseId}/integrity-jobs/${scope.jobId}/document-derivative`);assert.equal(response.statusCode,200,response.body);const body=JSON.parse(response.body);
      assert.equal(body.derivative.references[1].page,2);assert.equal(body.derivative.references[1].startByte,34);assert.equal(body.derivative.text,'FICTIONAL INVEOS repeated passage\nFICTIONAL INVEOS repeated passage');
      assert.equal(body.derivative.coverage.completeExtractionVerified,false);assert.equal(body.sourceDigest,sha(pdf()));assert.equal(await containers(),'');
      results.push({sourceDigest:body.sourceDigest,rawDigest:body.rawDigest,profileDigest:body.profileDigest,references:body.derivative.references});
    }
    assert.deepEqual(results[0],results[1]);t.diagnostic('Actual native job evidence: '+JSON.stringify(results[0]));
    const malformed=await f.queue(Buffer.from('%PDF-1.4\nFICTIONAL malformed\n'));
    const rejected=await runNativeDocumentJob(f.pool,f.storage,malformed,{researchOnly:true,repositoryRoot:root,qualification});assert.equal(rejected?.status,'failed');assert.equal(rejected?.failureCode,'worker_execution_failed');
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM document_derivatives WHERE job_id=$1',[malformed.jobId])).rows[0].n,0);assert.equal(await containers(),'');
    assert.deepEqual((await readdir(join(root,'.research-cache'))).filter(n=>n.startsWith('leased-document-')),[]);
  }finally{await f.close();}
});

test('actual daemon containers stop and disappear on lease loss, abort, output overflow and timeout',{timeout:90000},async()=>{
  const bundle=await mkdtemp('/tmp/inveos-container-stop-');await chmod(bundle,0o755);
  try{
    for(const mode of ['lease','abort','output','timeout','exit'] as const){
      const controller=new AbortController();let checks=0,sawRunning=false;
      const script=mode==='output'?'while :; do printf "%65536s" x; done':mode==='exit'?'exit 9':'sleep 30';
      let timer:ReturnType<typeof setTimeout>|undefined;
      const promise=runResearchContainer({bundle,imageId:image,script,signal:controller.signal,timeoutMs:mode==='timeout'?2000:15000,heartbeatMs:100,outputLimit:mode==='output'?1024:1048576},async()=>{
        checks++; // Wait until the workload is really running before revoking its lease.
        const active=JSON.parse(await docker(['container','ls','--filter','label=inveos.research-worker=true','--format','json']).then(s=>'['+s.trim().split('\n').filter(Boolean).join(',')+']'));
        if(active.length)sawRunning=true;
        if(active.length&&mode==='abort'&&!timer)timer=setTimeout(()=>controller.abort(),20);
        return !(active.length&&mode==='lease');
      });
      await assert.rejects(promise,(error:unknown)=>error instanceof WorkerStopped&&error.code===({lease:'lease_lost',abort:'aborted',output:'output_limit',timeout:'timeout',exit:'exit_failed'}[mode]));
      clearTimeout(timer);assert.ok(checks>0);if(['lease','abort','timeout'].includes(mode))assert.equal(sawRunning,true);assert.equal(await containers(),'');
    }
  }finally{await rm(bundle,{recursive:true,force:true});}
});

test('actual PostgreSQL cancellation and authority change stop a running daemon worker before attachment',{timeout:90000},async()=>{
  const f=await fixture();const bundle=await mkdtemp('/tmp/inveos-scoped-container-');await chmod(bundle,0o755);
  try{for(const mode of ['cancel','authority'] as const){
    const scope=await f.queue(pdf());const lease=await claimIntegrityJob(f.pool,scope);assert.ok(lease);let changed=false;
    await assert.rejects(runResearchContainer({bundle,imageId:image,script:'sleep 30',heartbeatMs:100,timeoutMs:15000},async()=>{
      const running=(await docker(['container','ls','-q','--filter','label=inveos.research-worker=true'])).trim();
      if(running&&!changed){changed=true;if(mode==='cancel')assert.equal((await f.request('POST',`/api/cases/${scope.caseId}/integrity-jobs/${scope.jobId}/cancel`,{})).statusCode,200);else assert.equal((await f.authority()).statusCode,200);}
      return Boolean(await renewIntegrityJob(f.pool,scope,lease.token));
    }),(e:unknown)=>e instanceof WorkerStopped&&e.code==='lease_lost');
    assert.equal(changed,true);assert.equal(await containers(),'');assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM document_derivatives WHERE job_id=$1',[scope.jobId])).rows[0].n,0);
  }}finally{await f.close();await rm(bundle,{recursive:true,force:true});}
});
