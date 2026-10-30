import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ProcessingBatch,ProcessingBatchInput,ProcessingCancelReceipt,ProcessingProfile} from '@inveos/contracts';
import {processingBatchCanonical,processingCancelCanonical} from '@inveos/contracts';
import {createPool,runMigrations} from '../src/db.js';
import {createApp} from '../src/app.js';
import {claimIntegrityJob,finishIntegrityJob,runIntegrityJob} from '../src/integrity-jobs.js';
import {confirmProcessingReceipt,retainProcessing,pendingProcessing,processingRequestKey} from '../../web/src/batchRequest.js';
const tenant='00000000-0000-4000-8000-000000000001',user='00000000-0000-4000-8000-000000000002',origin='http://localhost:5173';
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
async function fixture(){
 const database=process.env.INVEOS_TEST_DATABASE_URL,adminUrl=process.env.INVEOS_TEST_ADMIN_DATABASE_URL;assert.ok(database&&adminUrl,'Disposable restricted PostgreSQL required');assert.match(database,/\/inveos_test(?:\?|$)/);assert.match(adminUrl,/\/inveos_test(?:\?|$)/);
 const schema='batch_'+randomUUID().replaceAll('-',''),admin=createPool(adminUrl,schema,2),pool=createPool(database,schema,4),root=await mkdtemp(join(tmpdir(),'inveos-batches-'));
 await runMigrations(admin,schema);const app=await createApp({pool,storageRoot:root,allowedOrigins:[origin],demoTenantId:tenant,demoUserId:user,sessionTtlSeconds:3600,documentLab:true,speechLab:true});await app.ready();
 const login=await app.inject({method:'POST',url:'/api/session/start',headers:{origin},payload:{}});assert.equal(login.statusCode,200,login.body);const headers=login.headers['set-cookie'],cookie=(Array.isArray(headers)?headers:[headers]).filter(Boolean).map(v=>v!.split(';')[0]).join('; '),session={cookie,csrf:login.json().csrf as string};
 const req=(method:'GET'|'POST',url:string,payload?:object,auth=session)=>app.inject({method,url,headers:{cookie:auth.cookie,origin,'x-csrf-token':auth.csrf},...(payload?{payload}:{})});
 const created=await req('POST','/api/cases',{title:'Fictional bulk processing case',client:'Fictional Paperworks',scope:'Inspect supplied fictional records only.',jurisdiction:'England'});assert.equal(created.statusCode,200,created.body);const caseId=created.json().id as string,base='/api/cases/'+caseId;
 const approve=()=>req('POST',base+'/authority',{purpose:'Fictional batch intake exercise',lawfulBasis:'Fictional supplied records only; no personal data.',scope:'Process supplied fictional originals within existing profiles.',retentionDays:30,minimisation:'Retain the minimum fictional records needed for this exercise.'});assert.equal((await approve()).statusCode,200);
 const profiles=(await req('GET',base+'/processing-profiles')).json().profiles as ProcessingProfile[];
 const upload=async(text:string,binary=false)=>{const content=Buffer.from(text);const r=await req('POST',base+'/evidence'+(binary?'/binary':''),{filename:binary?'fictional-original.bin':'fictional-original.txt',expectedSha256:hash(content),sourceTime:'2026-10-01T09:00:00+01:00',method:'Fictional commissioning-party supplied original',idempotencyKey:randomUUID(),...(binary?{contentBase64:content.toString('base64')}:{text})});assert.equal(r.statusCode,200,r.body);return r.json() as {id:string;digest:string};};
 const input=(kind:ProcessingBatchInput['kind'],sources:{id:string;digest:string}[]):ProcessingBatchInput=>({id:randomUUID(),kind,profileDigest:profiles.find(p=>p.kind===kind)!.profileDigest,expectedAuthorityVersion:1,items:sources.map(v=>({evidenceId:v.id,expectedDigest:v.digest})),reason:'Explicit fictional batch selection for controlled acceptance'});
 const member=async(role:'investigator'|'client')=>{const id=randomUUID(),token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');await admin.query('INSERT INTO users(id,display_name) VALUES($1,$2)',[id,'Fictional batch boundary account']);await admin.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenant,id,role]);await admin.query("INSERT INTO sessions(token_hash,id,csrf_hash,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 hour')",[hash(token),randomUUID(),hash(csrf),tenant,id]);return {id,cookie:'inveos_session='+token+'; inveos_csrf='+csrf,csrf};};
 return {app,pool,admin,root,req,caseId,base,profiles,upload,input,approve,member,async close(){await app.close();await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();await rm(root,{recursive:true,force:true});}};
}
test('batch partial receipts survive retries and worker completion without replacing the queued selection',async()=>{
 const f=await fixture();try{
  const text=await f.upload('Clearly fictional original line.\n'),binary=await f.upload('Fictional opaque record',true),input=f.input('utf8_line_index_v1',[text,binary]);
  const response=await f.req('POST',f.base+'/processing-batches',input);assert.equal(response.statusCode,200,response.body);const receipt=response.json() as ProcessingBatch;assert.deepEqual(receipt.items.map(i=>i.outcome),['queued','rejected']);assert.equal(receipt.items[1]!.code,'original_kind');assert.equal(receipt.requestSha256,hash(processingBatchCanonical(input)));
  await confirmProcessingReceipt({operation:'queue',input},receipt,f.caseId,user);assert.deepEqual((await f.req('POST',f.base+'/processing-batches',input)).json(),receipt);
  const job=receipt.items[0]!.job!;await runIntegrityJob(f.pool,f.root,{tenantId:tenant,caseId:f.caseId,jobId:job.id});const current=(await f.req('GET',f.base+'/processing-batches/'+receipt.id)).json() as ProcessingBatch;assert.equal(current.items[0]!.job!.status,'queued');assert.equal(current.items[0]!.currentJob!.status,'succeeded');await confirmProcessingReceipt({operation:'queue',input},current,f.caseId,user);
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM integrity_jobs WHERE case_id=$1',[f.caseId])).rows[0].n,1);assert.equal((await f.req('POST',f.base+'/processing-batches',{...input,reason:'Another fictional batch intent'})).statusCode,409);
  await assert.rejects(f.admin.query("UPDATE processing_batch_items SET message='fictional mutation' WHERE case_id=$1",[f.caseId]),/append|immutable/i);
  const health=(await f.req('GET',f.base+'/processing-health')).json();assert.equal(health.total,1);assert.equal(health.statuses[0].status,'succeeded');assert.equal(health.interpretation,'persisted_case_jobs_not_worker_liveness');
 }finally{await f.close();}
});
test('request resolution fences late queue arrival and recovers a committed receipt',async()=>{
 const f=await fixture();try{
  const original=await f.upload('Fictional pending request bytes.'),input=f.input('original_sha256_v1',[original]),resolve={id:input.id,operation:'queue',requestSha256:hash(processingBatchCanonical(input))};
  const withdrawn=await f.req('POST',f.base+'/processing-requests/resolve',resolve);assert.equal(withdrawn.statusCode,200,withdrawn.body);assert.equal(withdrawn.json().state,'withdrawn');assert.equal((await f.req('POST',f.base+'/processing-batches',input)).statusCode,409);assert.equal((await f.pool.query('SELECT count(*)::int n FROM integrity_jobs WHERE case_id=$1',[f.caseId])).rows[0].n,0);
  const fresh={...input,id:randomUUID()},both=await Promise.all([f.req('POST',f.base+'/processing-batches',fresh),f.req('POST',f.base+'/processing-requests/resolve',{...resolve,id:fresh.id,requestSha256:hash(processingBatchCanonical(fresh))})]);
  if(both[0].statusCode===200){assert.equal(both[1].json().state,'recorded');assert.equal(both[1].json().receipt.id,fresh.id);}else{assert.equal(both[0].statusCode,409,both[0].body);assert.equal(both[1].json().state,'withdrawn');}
 }finally{await f.close();}
});
test('batch cancellation fences exact attempt, retains receipts, and retries create separate jobs',async()=>{
 const f=await fixture();try{
  const original=await f.upload('Fictional cancelled original remains intact.'),input=f.input('original_sha256_v1',[original]),response=await f.req('POST',f.base+'/processing-batches',input);assert.equal(response.statusCode,200,response.body);const b=response.json() as ProcessingBatch,job=b.items[0]!.job!,scope={tenantId:tenant,caseId:f.caseId,jobId:job.id};
  const lease=await claimIntegrityJob(f.pool,scope);assert.ok(lease);const stale={id:randomUUID(),reason:'Explicit fictional cancellation while worker changed',items:[{jobId:job.id,expectedStatus:'queued' as const,expectedAttempt:0}]};
  const rejected=await f.req('POST',f.base+'/processing-batches/'+b.id+'/cancellations',stale);assert.equal(rejected.statusCode,200,rejected.body);assert.equal(rejected.json().items[0].outcome,'conflict');
  const cancel={...stale,id:randomUUID(),items:[{jobId:job.id,expectedStatus:'running' as const,expectedAttempt:1}]},r=await f.req('POST',f.base+'/processing-batches/'+b.id+'/cancellations',cancel);assert.equal(r.statusCode,200,r.body);const cancelled=r.json() as ProcessingCancelReceipt;assert.equal(cancelled.items[0]!.outcome,'cancelled');assert.equal(cancelled.requestSha256,hash(processingCancelCanonical(b.id,cancel)));assert.deepEqual((await f.req('POST',f.base+'/processing-batches/'+b.id+'/cancellations',cancel)).json(),cancelled);assert.equal(await finishIntegrityJob(f.pool,scope,lease.token,null),null);
  const retry={...input,id:randomUUID(),parentId:b.id,items:[{...input.items[0]!,retryOf:job.id}],reason:'Explicit fictional retry after confirmed cancellation'},next=await f.req('POST',f.base+'/processing-batches',retry);assert.equal(next.statusCode,200,next.body);assert.notEqual(next.json().items[0].job.id,job.id);assert.equal(next.json().items[0].retryOf,job.id);assert.equal((await f.req('GET',f.base+'/evidence/'+original.id+'/original')).body,'Fictional cancelled original remains intact.');
 }finally{await f.close();}
});
test('batch bounds and current case authority deny unsupported or unrelated selections',async()=>{
 const f=await fixture();try{
  const original=await f.upload('Fictional file which is not a PDF.',true),input=f.input('native_pdf_lab_v1',[original]);const preview=await f.req('POST',f.base+'/processing-preview',{kind:input.kind,profileDigest:input.profileDigest,expectedAuthorityVersion:1,items:input.items});assert.equal(preview.statusCode,200,preview.body);assert.equal(preview.json().items[0].code,'unsupported_media');
  const response=await f.req('POST',f.base+'/processing-batches',input);assert.equal(response.statusCode,200,response.body);assert.equal(response.json().items[0].outcome,'rejected');assert.equal((await f.pool.query('SELECT count(*)::int n FROM integrity_jobs WHERE case_id=$1',[f.caseId])).rows[0].n,0);
  const unknown=f.input('original_sha256_v1',[{id:randomUUID(),digest:'a'.repeat(64)}]);const scoped=await f.req('POST',f.base+'/processing-batches',unknown);assert.equal(scoped.statusCode,200,scoped.body);assert.equal(scoped.json().items[0].code,'source_unavailable');
  assert.equal((await f.req('POST',f.base+'/processing-batches',{...input,id:randomUUID(),items:[...input.items,...input.items]})).statusCode,422);assert.equal((await f.req('POST',f.base+'/processing-batches',{...input,id:randomUUID(),expectedAuthorityVersion:'1'})).statusCode,422);
  const client=await f.member('client'),unassigned=await f.member('investigator');assert.equal((await f.req('GET',f.base+'/processing-health',undefined,client)).statusCode,403);assert.equal((await f.req('GET',f.base+'/processing-batches/'+input.id,undefined,unassigned)).statusCode,404);
  assert.equal((await f.approve()).statusCode,200);assert.equal((await f.req('POST',f.base+'/processing-batches',{...input,id:randomUUID()})).statusCode,409);assert.equal((await f.req('GET',f.base+'/processing-batches/'+input.id)).statusCode,200);
 }finally{await f.close();}
});
test('batch queue audit failure rolls back every job/item and preserves stable request retry',async()=>{
 const f=await fixture();try{
  const original=await f.upload('Fictional transactional batch original.'),input=f.input('original_sha256_v1',[original]);await f.admin.query(`CREATE FUNCTION reject_batch_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='processing_batch.recorded' THEN RAISE EXCEPTION 'fictional batch audit failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_batch_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_batch_audit()`);
  try{assert.equal((await f.req('POST',f.base+'/processing-batches',input)).statusCode,500);for(const table of ['processing_batches','processing_batch_items','integrity_jobs'])assert.equal((await f.pool.query(`SELECT count(*)::int n FROM ${table} WHERE case_id=$1`,[f.caseId])).rows[0].n,0);}finally{await f.admin.query('DROP TRIGGER reject_batch_audit ON audit_events;DROP FUNCTION reject_batch_audit()');}
  assert.equal((await f.req('POST',f.base+'/processing-batches',input)).statusCode,200);assert.equal((await f.req('GET',f.base+'/evidence/'+original.id+'/original')).body,'Fictional transactional batch original.');
 }finally{await f.close();}
});
test('client retains unknown batch request and rejects a forged receipt without touching its identity',async()=>{
 const values=new Map<string,string>(),store={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}},caseId=randomUUID(),key=processingRequestKey(tenant,user,caseId),input:ProcessingBatchInput={id:randomUUID(),kind:'original_sha256_v1',profileDigest:'a'.repeat(64),expectedAuthorityVersion:1,reason:'Fictional receipt recovery request',items:[{evidenceId:randomUUID(),expectedDigest:'b'.repeat(64)}]};retainProcessing(store,key,{operation:'queue',input});assert.deepEqual(pendingProcessing(store,key),{operation:'queue',input});await assert.rejects(confirmProcessingReceipt({operation:'queue',input},{id:input.id,caseId,requestedBy:user,requestSha256:'0'.repeat(64),reason:input.reason,items:[]} as unknown as ProcessingBatch,caseId,user),/receipt/);assert.equal(pendingProcessing(store,key)?.input.id,input.id);
});
