/** Actual locked Tika application worker acceptance. Run explicitly on the qualified Ubuntu host.
 * No replay, synthetic runtime receipts, mocked process runner or finishTikaJob injection.
 * The existing research workflow must acquire/build/probe first; this test never does so. */
import assert from 'node:assert/strict';
import {before,after,test,type TestContext} from 'node:test';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp,mkdir,cp,rm,readdir,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {TikaInspection} from '@inveos/contracts';
import {sourceDatabase,sourceScenario,hash,type SourceDatabase} from './support/source-family.js';
import {runTikaJob,validateTikaQualification} from '../src/tika-worker.js';
import {claimIntegrityJob,renewIntegrityJob} from '../src/integrity-jobs.js';
import {tikaKind,tikaProfileDigest} from '../src/tika-derivative.js';
import {WorkerStopped} from '../src/leased-worker.js';
const root=fileURLToPath(new URL('../../../',import.meta.url)),exec=promisify(execFile),passage='FICTIONAL INVEOS repeated passage';
let db:SourceDatabase,qualification:Record<string,unknown>,original:Buffer,baselineBundles:Set<string>,baselineContainers:Set<string>;
const options=()=>({researchOnly:true as const,repositoryRoot:root,qualification});
async function containers(){const result=await exec('/usr/bin/docker',['--host=unix:///var/run/docker.sock','container','ls','-aq','--filter','label=inveos.research-worker=true'],{timeout:15000});return new Set(result.stdout.trim().split('\n').filter(Boolean));}
async function cleaned(){
 const current=await containers();assert.deepEqual([...current].filter(id=>!baselineContainers.has(id)),[],'This test left a daemon-owned container');
 assert.deepEqual((await readdir(join(root,'.research-cache'))).filter(name=>name.startsWith('leased-tika-')&&!baselineBundles.has(name)),[],'This test left a staged original/runtime bundle');
}
before(async()=>{
 assert.equal(process.env.INVEOS_DEV_LAB,'1','Explicit fictional lab required');assert.equal(process.env.INVEOS_RESEARCH_TIKA,'1','Explicit Tika research mode required');assert.notEqual(process.env.NODE_ENV,'production');
 qualification=JSON.parse(await readFile(join(root,'.research-cache/tika-worker-qualification.json'),'utf8'));validateTikaQualification(qualification);assert.equal(qualification.syntheticContractOnly,undefined);assert.notEqual(qualification.actualHostProbeExecuted,false);
 baselineContainers=await containers();baselineBundles=new Set((await readdir(join(root,'.research-cache'))).filter(name=>name.startsWith('leased-tika-')));
 original=(await exec('/usr/bin/python3',['-c','import sys;from tools.synthetic_pdf import digital_pdf;sys.stdout.buffer.write(digital_pdf())'],{cwd:root,encoding:'buffer'})).stdout as Buffer;
 db=await sourceDatabase();
});
after(async()=>{if(db)await db.close();});
async function fixture(t:TestContext){
 const f=await sourceScenario(db);t.after(()=>f.app.close());const jobs=`/api/cases/${f.caseId}/integrity-jobs`;
 const upload=async(bytes=original)=>{const r=await f.post(`/api/cases/${f.caseId}/evidence/binary`,{filename:'fictional-actual-tika-worker.pdf',contentBase64:bytes.toString('base64'),expectedSha256:hash(bytes),sourceTime:'2026-01-03T12:00:00+01:00',method:'Fictional supplied PDF for actual locked Tika application worker acceptance',idempotencyKey:randomUUID()});assert.equal(r.statusCode,200,r.body);return r.json();};
 const queue=async(bytes=original)=>{const evidence=await upload(bytes),r=await f.post(jobs,{evidenceId:evidence.id,idempotencyKey:randomUUID(),kind:tikaKind});assert.equal(r.statusCode,200,r.body);return {evidence,scope:{tenantId:f.tenantId,caseId:f.caseId,jobId:r.json().id as string}};};
 const row=async(jobId:string)=>(await db.pool.query('SELECT * FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[f.tenantId,f.caseId,jobId])).rows[0];
 const noDerivative=async(jobId:string)=>assert.equal((await db.pool.query('SELECT count(*)::int n FROM tika_derivatives WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3',[f.tenantId,f.caseId,jobId])).rows[0].n,0);
 return {...f,jobs,upload,queue,row,noDerivative};
}
async function running(f:Awaited<ReturnType<typeof fixture>>,jobId:string){
 const deadline=Date.now()+15000;
 while(Date.now()<deadline){const r=await f.row(jobId);if(r.status==='running'){assert.ok(r.lease_token);assert.ok(new Date(r.lease_until).getTime()>Date.now());return r;}assert.equal(r.status,'queued','Worker finished before live-lease action; do not claim cancellation coverage');await new Promise(resolve=>setTimeout(resolve,10));}
 assert.fail('Actual application worker did not claim its live lease');
}

test('actual Tika worker and scoped CLI parse preserved PDF twice, persist output and pass copied context verification',{timeout:300000},async t=>{
 const f=await fixture(t),receipts=[];
 for(const invocation of ['worker','cli'] as const){
  const {evidence,scope}=await f.queue();let status:string;
  if(invocation==='worker'){
   const controller=new AbortController(),pending=runTikaJob(db.pool,db.storage,scope,{...options(),signal:controller.signal}).then(value=>({value,error:undefined}),error=>({value:null,error}));t.after(async()=>{controller.abort();await pending;});
   const lease=await running(f,scope.jobId);assert.equal(await claimIntegrityJob(db.pool,scope),null,'Another worker stole a live lease');assert.ok(await renewIntegrityJob(db.pool,scope,lease.lease_token));
   const outcome=await pending;if(outcome.error)throw outcome.error;status=outcome.value?.status??'missing';
  }else{
   const cli=await exec(process.execPath,['--import','tsx','apps/api/src/run-tika-job.ts',scope.tenantId,scope.caseId,scope.jobId],{cwd:root,timeout:180000,maxBuffer:65536,env:{...process.env,INVEOS_DATABASE_URL:process.env.INVEOS_TEST_DATABASE_URL!,INVEOS_STORAGE_ROOT:db.storage,INVEOS_WORKER_SCHEMA:db.schema,INVEOS_DEV_LAB:'1',INVEOS_RESEARCH_TIKA:'1',NODE_ENV:'test'}});const receipt=JSON.parse(cli.stdout);assert.equal(receipt.productionApproved,false);status=receipt.result.status;
  }
  assert.equal(status,'succeeded',JSON.stringify({invocation,status,failureCode:(await f.row(scope.jobId)).failure_code}));assert.equal(await runTikaJob(db.pool,db.storage,scope,options()),null,'Completed worker rerun must not reparse');
  const base=f.jobs+'/'+scope.jobId+'/tika',response=await f.get(base);assert.equal(response.statusCode,200,response.body);const view=response.json<TikaInspection>();assert.equal(view.profileDigest,tikaProfileDigest);assert.deepEqual(view.derivative.pages.map((p:{page:number;text:string})=>[p.page,p.text]),[[1,passage],[2,passage]]);assert.equal(view.source.sha256,hash(original));
  const originalResponse=await f.get(`/api/cases/${f.caseId}/evidence/${evidence.id}/original`);assert.equal(originalResponse.statusCode,200);assert.deepEqual(originalResponse.rawPayload,original);assert.equal((await db.pool.query('SELECT status FROM evidence WHERE id=$1',[evidence.id])).rows[0].status,'Quarantined');
  const citationId=randomUUID(),selected=await f.post(base+'/citations/'+citationId,{derivativeDigest:view.derivativeDigest,page:2,startByte:0,endByte:Buffer.byteLength(passage),quote:passage});assert.equal(selected.statusCode,200,selected.body);
  const review=await f.post(base+'/citations/'+citationId+'/reviews',{id:randomUUID(),citationDigest:selected.json().digest,previousDigest:null,decision:'accepted',reason:'Independent fictional original-to-page-text comparison after actual worker execution',originalCompared:true},f.reviewer);assert.equal(review.statusCode,200,review.body);
  const exported=await f.get(base+'/export');assert.equal(exported.statusCode,200,exported.body);const envelope=exported.json(),p=envelope.payload;
  assert.deepEqual(Buffer.from(p.originalBase64,'base64'),original);assert.equal(p.runtime.qualification.syntheticContractOnly,undefined);assert.equal(p.runtime.preparation.syntheticContractOnly,undefined);assert.equal(p.runtime.preparation.status,'verified_locked_tika_bundle');assert.equal(p.job.attempt,1);
  const persisted=(await db.pool.query('SELECT raw_bytes,raw_digest,output_bytes,output_digest,profile,profile_digest FROM tika_derivatives WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3',[f.tenantId,f.caseId,scope.jobId])).rows[0];
  assert.deepEqual(Buffer.from(p.rawBase64,'base64'),persisted.raw_bytes);assert.deepEqual(Buffer.from(p.derivativeBase64,'base64'),persisted.output_bytes);assert.equal(hash(persisted.raw_bytes),persisted.raw_digest.trim());assert.equal(hash(persisted.output_bytes),persisted.output_digest.trim());assert.equal(hash(persisted.profile),persisted.profile_digest.trim());
  await assert.rejects(db.pool.query('UPDATE tika_derivatives SET raw_bytes=$1 WHERE job_id=$2',[Buffer.from('mutated'),scope.jobId]));
  const dir=await mkdtemp('/tmp/inveos-actual-tika-verifier-');try{
   await cp(join(root,'tools/verify_tika_context.py'),join(dir,'verify_tika_context.py'));await writeFile(join(dir,'context.json'),exported.body);
   const verification=await exec('/usr/bin/python3',['verify_tika_context.py','context.json','--expected-sha256',envelope.sha256],{cwd:dir,env:{...process.env,PYTHONPATH:''}});const checked=JSON.parse(verification.stdout);assert.equal(checked.actualParserExecutionVerified,false,'Offline consistency is not execution attestation');
   for(const key of ['originalBase64','rawBase64','derivativeBase64']){const changed=structuredClone(envelope);changed.payload[key]=Buffer.from('Fictional changed bytes').toString('base64');await writeFile(join(dir,'changed.json'),JSON.stringify(changed));await exec('/usr/bin/python3',['-c',"import json;from pathlib import Path;from verify_tika_context import digest;p=Path('changed.json');e=json.loads(p.read_text());e['sha256']=digest(e['payload']);p.write_text(json.dumps(e))"],{cwd:dir});await assert.rejects(exec('/usr/bin/python3',['verify_tika_context.py','changed.json'],{cwd:dir}));}
   const artifacts=join(root,'output/evals/tika-application',invocation);await mkdir(artifacts,{recursive:true});await writeFile(join(artifacts,'context.json'),exported.body);await writeFile(join(artifacts,'original.pdf'),original);await writeFile(join(artifacts,'raw.json'),persisted.raw_bytes);await writeFile(join(artifacts,'derivative.json'),persisted.output_bytes);await writeFile(join(artifacts,'verifier.json'),verification.stdout);
   receipts.push({invocation,jobId:scope.jobId,originalSha256:hash(original),rawSha256:hash(persisted.raw_bytes),derivativeSha256:hash(persisted.output_bytes),profileSha256:tikaProfileDigest,checkedPages:2,copiedVerifierPassed:true});
  }finally{await rm(dir,{recursive:true,force:true});}
  await cleaned();
 }
 const receipt={actualApplicationParserRunsCompleted:2,fixture:'fictional digital_pdf only',noOutputReplay:true,noSyntheticRuntimeReceipt:true,results:receipts,productionApproved:false,limitation:'Actual execution of this supplied fixture only; not representative extraction quality or production qualification.'};await writeFile(join(root,'output/evals/tika-application/receipt.json'),JSON.stringify(receipt,null,2)+'\n');t.diagnostic(JSON.stringify(receipt));
});

test('actual Tika dispatch rejects malformed and corrupt originals without attaching output',{timeout:240000},async t=>{
 const f=await fixture(t),malformed=await f.queue(Buffer.from('%PDF-1.4\nFICTIONAL malformed supplied PDF\n'));
 const rejected=await runTikaJob(db.pool,db.storage,malformed.scope,options());assert.equal(rejected?.status,'failed');assert.equal(rejected?.failureCode,'tika_parser_rejected_or_failed');await f.noDerivative(malformed.scope.jobId);await cleaned();
 const corrupt=await f.queue(),source=(await db.pool.query('SELECT object_path FROM evidence WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[f.tenantId,f.caseId,corrupt.evidence.id])).rows[0],path=join(db.storage,source.object_path);
 // Deliberate storage corruption in this disposable fixture only; application writes remain immutable.
 await chmod(path,0o600);await writeFile(path,Buffer.from('%PDF-1.4\nFictional changed immutable original\n'));
 const unavailable=await runTikaJob(db.pool,db.storage,corrupt.scope,options());assert.equal(unavailable?.status,'failed');assert.equal(unavailable?.failureCode,'original_unavailable');await f.noDerivative(corrupt.scope.jobId);await cleaned();
});

test('actual Tika application dispatch fences live-lease cancellation, authority changes and expired-lease recovery',{timeout:240000},async t=>{
 for(const mode of ['cancel','authority','expire'] as const){
  const f=await fixture(t),{scope}=await f.queue(),controller=new AbortController(),pending=runTikaJob(db.pool,db.storage,scope,{...options(),signal:controller.signal}).then(value=>({value,error:undefined}),error=>({value:null,error}));t.after(async()=>{controller.abort();await pending;});
  const lease=await running(f,scope.jobId);assert.equal(await claimIntegrityJob(db.pool,scope),null);
  if(mode==='cancel'){const cancelled=await f.post(f.jobs+'/'+scope.jobId+'/cancel',{});assert.equal(cancelled.statusCode,200,cancelled.body);}
  else if(mode==='authority'){const revised=await f.post(`/api/cases/${f.caseId}/authority`,{...f.authorityInput,scope:'New fictional scope supersedes this running application job'},f.owner);assert.equal(revised.statusCode,200,revised.body);}
  else await db.admin.query("UPDATE integrity_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND case_id=$2 AND id=$3",[f.tenantId,f.caseId,scope.jobId]);
  const outcome=await pending;assert.ok(outcome.value?.status!=='succeeded');if(outcome.error)assert.ok(outcome.error instanceof WorkerStopped&&outcome.error.code==='lease_lost',String(outcome.error));
  assert.equal(await renewIntegrityJob(db.pool,scope,lease.lease_token),null);await f.noDerivative(scope.jobId);await cleaned();
  if(mode==='expire'){const recovery=await f.post(f.jobs+'/'+scope.jobId+'/tika/recover',{reason:'Explicit fictional expired actual worker lease recovery'});assert.equal(recovery.statusCode,200,recovery.body);assert.equal(recovery.json().failureCode,'lease_expired_unknown_outcome');assert.equal((await f.row(scope.jobId)).status,'failed');}
  else {const current=await f.row(scope.jobId);assert.equal(current.status,'cancelled');if(mode==='authority')assert.equal(current.failure_code,'scope_changed');}
 }
});

test('current authority and stale qualification prevent actual Tika claim without parsing',{timeout:30000},async t=>{
 const f=await fixture(t),{scope}=await f.queue();await assert.rejects(runTikaJob(db.pool,db.storage,scope,{...options(),qualification:{...qualification,checkedAt:'2000-01-01T00:00:00Z'}}),(error:unknown)=>error instanceof WorkerStopped&&error.code==='host_not_qualified');assert.equal((await f.row(scope.jobId)).attempt,0);
 const revised=await f.post(`/api/cases/${f.caseId}/authority`,f.authorityInput,f.owner);assert.equal(revised.statusCode,200,revised.body);assert.equal(await runTikaJob(db.pool,db.storage,scope,options()),null);const row=await f.row(scope.jobId);assert.equal(row.status,'cancelled');assert.equal(row.failure_code,'scope_changed');assert.equal(row.attempt,0);await f.noDerivative(scope.jobId);await cleaned();
});
