// Restricted PostgreSQL acceptance; execution receipts are recorded in the handoff.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../src/app.js';
import {createPool,runMigrations} from '../src/db.js';
import type {AnalysisRunRecord,CaseHandling,CaseSearchResult,DesktopIntakeBatch,Evidence,SavedCaseView,WorkItem} from '@inveos/contracts';

const tenant='00000000-0000-4000-8000-000000000001',owner='00000000-0000-4000-8000-000000000002',origin='http://localhost:5173';
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
type Session={cookie:string;'x-csrf-token':string;origin:string};
async function fixture(){
 const database=process.env.INVEOS_TEST_DATABASE_URL,adminUrl=process.env.INVEOS_TEST_ADMIN_DATABASE_URL;assert.ok(database&&adminUrl,'Disposable restricted PostgreSQL required');assert.match(database,/\/inveos_test(?:\?|$)/);assert.match(adminUrl,/\/inveos_test(?:\?|$)/);
 const schema='handling_'+randomUUID().replaceAll('-',''),admin=createPool(adminUrl,schema,2);await runMigrations(admin,schema);const pool=createPool(database,schema,4),root=await mkdtemp(join(tmpdir(),'inveos-handling-'));
 const app=await createApp({pool,storageRoot:root,allowedOrigins:[origin],demoTenantId:tenant,demoUserId:owner,sessionTtlSeconds:3600});
 async function session(id:string,tenantId=tenant):Promise<Session>{const token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');await admin.query("INSERT INTO sessions(token_hash,id,csrf_hash,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 hour')",[sha(token),randomUUID(),sha(csrf),tenantId,id]);return {cookie:`inveos_session=${token}; inveos_csrf=${csrf}`,'x-csrf-token':csrf,origin};}
 const maker=await session(owner),call=(url:string,payload?:object,actor=maker)=>app.inject({method:payload?'POST':'GET',url,headers:actor,...(payload?{payload}:{})});
 async function must<T=Record<string,unknown>>(url:string,payload?:object,actor=maker){const response=await call(url,payload,actor);assert.equal(response.statusCode,200,response.body);return response.json<T>();}
 const kase=await must<{id:string}>('/api/cases',{title:'Fictional handling exercise',client:'Fictional recipient',scope:'Supplied fictional material only',jurisdiction:'Synthetic exercise'}),caseId=kase.id,base='/api/cases/'+caseId;
 const authority={purpose:'Fictional handling workflow',lawfulBasis:'Synthetic fixture only; no real data processed.',scope:'Supplied fictional material only',retentionDays:30,minimisation:'Use fictional records and retain clear policy history.'};await must(base+'/authority',authority);
 async function member(role:string,assigned=false,tenantId=tenant){const id=randomUUID();await admin.query('INSERT INTO users(id,display_name) VALUES($1,$2)',[id,'Fictional handling account']);await admin.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenantId,id,role]);if(assigned)await admin.query('INSERT INTO case_memberships(tenant_id,case_id,user_id) VALUES($1,$2,$3)',[tenantId,caseId,id]);return {id,headers:await session(id,tenantId)};}
 const reviewer=await member('reviewer',true),investigator=await member('investigator',true),client=await member('client');
 async function finding(quote='Fictional supplier invoice amount GBP 100'){
  const evidence=await must<{id:string}>(base+'/evidence',{filename:'fictional-supplier.txt',text:quote,sourceTime:'2026-10-01T09:00:00+01:00',method:'Fictional supplied receipt for acceptance testing',expectedSha256:sha(quote),idempotencyKey:randomUUID()},investigator.headers);
  const claim=await must<{id:string}>(base+'/claims',{evidenceId:evidence.id,text:'The fictional supplied document records this literal amount.',quote},investigator.headers);
  const review=await must<{findingId:string}>(base+'/claims/'+claim.id+'/review',{accepted:true,reason:'Independent comparison of the exact fictional source occurrence.'},reviewer.headers);
  return {kind:'text_finding' as const,findingId:review.findingId};
 }
 const input={id:randomUUID(),expectedVersion:0,expectedAuthorityVersion:1,tier:'restricted',sharing:'internal_only',instructions:'Fictional internal handling instructions; no recipient access.',reason:'Fictional explicit reviewer decision to restrict sharing.'};
 return {admin,pool,app,root,caseId,base,maker,reviewer,investigator,client,call,must,member,finding,input,authority,async close(){await app.close();await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();await rm(root,{recursive:true,force:true});}};
}

test('case handling preserves explicit versions, current reviewer boundaries and concurrent decision history',{timeout:30000},async()=>{
 const f=await fixture();try{
  const empty=await f.must<CaseHandling>(f.base+'/handling');assert.equal(empty.current,null);assert.equal(empty.version,0);assert.equal(empty.sharingAllowed,true);
  assert.equal((await f.call(f.base+'/handling',f.input,f.investigator.headers)).statusCode,403);assert.equal((await f.call(f.base+'/handling',undefined,f.client.headers)).statusCode,403);
  const stranger=await f.member('reviewer');assert.equal((await f.call(f.base+'/handling',undefined,stranger.headers)).statusCode,404);
  const foreignTenant=randomUUID();await f.admin.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[foreignTenant,'Fictional other tenant']);const foreign=await f.member('reviewer',false,foreignTenant);assert.equal((await f.call(f.base+'/handling',undefined,foreign.headers)).statusCode,404);
  assert.equal((await f.call(f.base+'/handling',{...f.input,expectedAuthorityVersion:'1'})).statusCode,422);
  const first=await f.must<CaseHandling>(f.base+'/handling',f.input);assert.equal(first.version,1);assert.equal(first.sharingAllowed,false);assert.equal((await f.must<CaseHandling>(f.base+'/handling',f.input)).current!.sha256,first.current!.sha256);
  assert.equal((await f.call(f.base+'/handling',{...f.input,reason:'Changed fictional retry must not be adopted.'})).statusCode,409);
  assert.equal((await f.call(f.base+'/handling',f.input,f.reviewer.headers)).statusCode,409);
  const competing=await Promise.all([1,2].map(()=>f.call(f.base+'/handling',{...f.input,id:randomUUID(),expectedVersion:1,sharing:'existing_release_controls'})));assert.deepEqual(competing.map(r=>r.statusCode).sort(),[200,409]);
  const latest=await f.must<CaseHandling>(f.base+'/handling');assert.equal(latest.version,2);assert.equal(latest.history.length,2);assert.equal(latest.history[1]!.sha256,first.current!.sha256);
  const page=await f.must<CaseHandling>(f.base+'/handling?before=2');assert.equal(page.version,2);assert.deepEqual(page.history.map(r=>r.version),[1]);
  await assert.rejects(f.pool.query("UPDATE case_handling_events SET tier='standard' WHERE case_id=$1",[f.caseId]),/permission denied|append|immutable/i);
  await f.must(f.base+'/authority',f.authority);const changed=await f.must<CaseHandling>(f.base+'/handling');assert.equal(changed.authorityVersion,2);assert.equal(changed.sharingAllowed,false);
  assert.equal((await f.call(f.base+'/handling',{...f.input,id:randomUUID(),expectedVersion:2})).statusCode,409);
 }finally{await f.close();}
});

test('internal-only handling blocks actual release access and new grants without replacing frozen report bytes',{timeout:30000},async()=>{
 const f=await fixture();try{
  await f.finding();
  const revision=await f.must<{id:string;sha256:string}>(f.base+'/report-revisions',{idempotencyKey:randomUUID()}),path=f.base+'/report-revisions/'+revision.id;
  await f.must(path+'/reviews',{sha256:revision.sha256,decision:'accept_internal',reason:'Fictional independent review of the exact source-backed draft.'},f.reviewer.headers);
  const disclosureInput={sha256:revision.sha256,recipientId:f.client.id,idempotencyKey:randomUUID(),expiresAt:new Date(Date.now()+3600000).toISOString(),reason:'Fictional explicitly approved recipient disclosure.',confirmFullDisclosure:true};
  const disclosure=await f.must<{id:string}>(path+'/disclosures',disclosureInput),download='/api/portal/disclosures/'+disclosure.id;
  const original=await f.call(download,undefined,f.client.headers);assert.equal(original.statusCode,200,original.body);assert.equal(sha(original.rawPayload),revision.sha256);
  await f.must(f.base+'/handling',f.input);
  assert.equal((await f.must<{items:unknown[]}>('/api/portal/disclosures',undefined,f.client.headers)).items.length,0);
  assert.equal((await f.call(download,undefined,f.client.headers)).statusCode,404);
  assert.equal((await f.call(download+'/acknowledge',{sha256:revision.sha256,confirmReceipt:true},f.client.headers)).statusCode,404);
  assert.equal((await f.call(download+'/feedback',undefined,f.client.headers)).statusCode,404);
  assert.equal((await f.call(path+'/disclosures',{...disclosureInput,idempotencyKey:randomUUID()})).statusCode,409);
  const retained=await f.call(path);assert.equal(retained.statusCode,200,retained.body);assert.deepEqual(retained.rawPayload,original.rawPayload);
  await f.must(f.base+'/handling',{...f.input,id:randomUUID(),expectedVersion:1,sharing:'existing_release_controls'},f.reviewer.headers);
  assert.equal((await f.call(download,undefined,f.client.headers)).statusCode,200);
  await f.admin.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[tenant,f.caseId,f.reviewer.id]);
  assert.equal((await f.must<CaseHandling>(f.base+'/handling')).sharingAllowed,false);assert.equal((await f.call(download,undefined,f.client.headers)).statusCode,404);
 }finally{await f.close();}
});

test('handling and verifier-kit audit failures return no partial decision or unaudited download',{timeout:30000},async()=>{
 const f=await fixture();try{
  await f.admin.query(`CREATE FUNCTION reject_handling_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('case.handling_decided','verification_kit.downloaded') THEN RAISE EXCEPTION 'fictional handling audit failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_handling_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_handling_audit()`);
  try{assert.equal((await f.call(f.base+'/handling',f.input)).statusCode,500);assert.equal((await f.must<CaseHandling>(f.base+'/handling')).version,0);assert.equal((await f.call('/api/verification-kit',undefined,f.client.headers)).statusCode,500);}
  finally{await f.admin.query('DROP TRIGGER reject_handling_audit ON audit_events;DROP FUNCTION reject_handling_audit()');}
  await f.must(f.base+'/handling',f.input);const kit=await f.call('/api/verification-kit',undefined,f.client.headers);assert.equal(kit.statusCode,200,kit.body);assert.equal(kit.headers['content-type'],'application/zip');assert.equal(sha(kit.rawPayload),kit.headers['x-inveos-verifier-sha256']);
  assert.equal((await f.app.inject({method:'GET',url:'/api/verification-kit'})).statusCode,401);
  const audit=(await f.pool.query("SELECT metadata FROM audit_events WHERE action='verification_kit.downloaded'")).rows;assert.equal(audit.length,1);assert.equal(audit[0].metadata.sha256,sha(kit.rawPayload));assert.equal(JSON.stringify(audit).includes(f.input.instructions),false);
 }finally{await f.close();}
});


test('cited comparison creates no findings and freezes both contextual links in an explicitly requested question',{timeout:30000},async()=>{
 const f=await fixture();try{
  const sources=[await f.finding(),await f.finding('Fictional supplier invoice amount GBP 200')];
  const input={id:randomUUID(),mode:'comparison',question:'',sources},base=f.base+'/analysis',path=base+'/'+input.id;
  const saved=await f.must<AnalysisRunRecord>(base,input);assert.equal(saved.run.suggestions.length,1);assert.equal(saved.run.suggestions[0]!.kind,'amount_difference');
  assert.deepEqual((await f.must<AnalysisRunRecord>(base,input)).run,saved.run);
  assert.equal((await f.call(base,{...input,question:'Changed fictional retry'})).statusCode,409);
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM findings WHERE case_id=$1',[f.caseId])).rows[0].n,2);
  const decision={id:randomUUID(),expectedVersion:0,disposition:'request_check',reason:'Compare the fictional period and tax basis before drawing a conclusion.'},target=path+'/suggestions/0';
  assert.equal((await f.call(target+'/decisions',decision)).statusCode,403);
  await f.must(target+'/decisions',decision,f.reviewer.headers);
  const followup={id:randomUUID(),decisionVersion:1,title:'Clarify the fictional amount basis',body:'Retain both accounts and alternative explanations.',ownerId:f.investigator.id,dueDate:null};
  const work=await f.must<WorkItem>(target+'/followup',followup);assert.equal(work.kind,'question');assert.equal(work.id,followup.id);assert.equal(work.version,1);
  const history=(await f.pool.query('SELECT version,snapshot,source_links FROM case_work_revisions WHERE case_id=$1 AND item_id=$2',[f.caseId,work.id])).rows;assert.equal(history.length,1);assert.equal(history[0].source_links.length,2);assert.equal(history[0].snapshot.id,work.id);
  assert.deepEqual(await f.must<WorkItem>(target+'/followup',followup),work);
  assert.equal((await f.call(target+'/followup',{...followup,id:randomUUID()})).statusCode,409);
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM findings WHERE case_id=$1',[f.caseId])).rows[0].n,2);
  assert.equal((await f.call(path,undefined,f.client.headers)).statusCode,403);
  const outsider=await f.member('reviewer');assert.equal((await f.call(path,undefined,outsider.headers)).statusCode,404);
  await f.admin.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[tenant,f.caseId,f.reviewer.id]);assert.equal((await f.call(path,undefined,f.reviewer.headers)).statusCode,404);
  await f.must(f.base+'/authority',f.authority);assert.equal((await f.call(path)).statusCode,409);
 }finally{await f.close();}
});

test('analysis follow-up audit failure rolls back its work, both links, history and retry receipt atomically',{timeout:30000},async()=>{
 const f=await fixture();try{
  const sources=[await f.finding(),await f.finding('Fictional supplier invoice amount GBP 200')],id=randomUUID(),path=f.base+'/analysis/'+id+'/suggestions/0';
  await f.must(f.base+'/analysis',{id,mode:'comparison',question:'',sources});await f.must(path+'/decisions',{id:randomUUID(),expectedVersion:0,disposition:'request_check',reason:'Fictional independent request for further investigation.'},f.reviewer.headers);
  const input={id:randomUUID(),decisionVersion:1,title:'Fictional rollback check',body:'Compare the two exact source contexts.',ownerId:null,dueDate:null};
  await f.admin.query("CREATE FUNCTION reject_analysis_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='analysis.followup_created' THEN RAISE EXCEPTION 'fictional analysis audit failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_analysis_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_analysis_audit()");
  try{assert.equal((await f.call(path+'/followup',input)).statusCode,500);
   for(const [table,key] of [['case_work_items','id'],['case_work_links','item_id'],['case_work_revisions','item_id'],['case_analysis_followups','work_id']])assert.equal((await f.pool.query(`SELECT count(*)::int n FROM ${table} WHERE case_id=$1 AND ${key}=$2`,[f.caseId,input.id])).rows[0].n,0,table);
  }finally{await f.admin.query('DROP TRIGGER reject_analysis_audit ON audit_events;DROP FUNCTION reject_analysis_audit()');}
  await f.must(path+'/followup',input);assert.equal((await f.pool.query('SELECT count(*)::int n FROM case_work_links WHERE case_id=$1 AND item_id=$2',[f.caseId,input.id])).rows[0].n,2);
 }finally{await f.close();}
});


test('desktop batch intake over HTTP resumes exact chunks and retains independent completed, cancelled and pending originals',{timeout:30000},async()=>{
 const f=await fixture();try{
  const bytes=Buffer.alloc(32769,97);bytes.write('Fictional batch original.');
  const files=['first.bin','second.bin','third.bin'].map(filename=>({filename,sourceTime:'2020-01-02T09:00:00+01:00',method:'Fictional supplied binary original',expectedSha256:sha(bytes),byteLength:bytes.length})),input={id:randomUUID(),files},url=f.base+'/intake-batches';
  const batch=await f.must<DesktopIntakeBatch>(url,input);assert.deepEqual(await f.must(url,input),batch);assert.equal(new Set(batch.entries.map(e=>e.requestKey)).size,3);
  assert.equal((await f.call(url,{...input,files:[{...files[0]!,sourceTime:'2020-01-02T08:00:00Z'},...files.slice(1)]})).statusCode,409);
  const reserve=(ordinal:number)=>({...files[ordinal]!,idempotencyKey:batch.entries[ordinal]!.requestKey});
  assert.equal((await f.call(f.base+'/uploads',{...reserve(0),expectedSha256:'0'.repeat(64)})).statusCode,409);
  const first=await f.must<{id:string}>(f.base+'/uploads',reserve(0)),path=f.base+'/uploads/'+first.id;
  assert.equal((await f.must<{id:string}>(f.base+'/uploads',reserve(0))).id,first.id);
  assert.equal((await f.call(path+'/chunk',{ordinal:0,contentBase64:bytes.subarray(0,10).toString('base64')})).statusCode,422);
  for(const ordinal of [0,0,1])await f.must(path+'/chunk',{ordinal,contentBase64:bytes.subarray(ordinal*32768,Math.min((ordinal+1)*32768,bytes.length)).toString('base64')});
  assert.deepEqual((await f.must<{received:number[]}>(path)).received,[0,1]);
  const address=await f.app.listen({host:'127.0.0.1',port:0});
  const complete=async()=>{const response=await fetch(address+path+'/complete',{method:'POST',headers:{...f.maker,'content-type':'application/json'},body:'{}'});const body=await response.text();assert.equal(response.status,200,body);return JSON.parse(body) as Evidence;};
  const completions=await Promise.all([complete(),complete()]);const original=completions[0]!;assert.equal(completions[1]!.id,original.id);assert.equal(original.sourceTime,files[0]!.sourceTime);assert.equal(original.status,'Quarantined');assert.equal(original.digest,sha(bytes));
  const second=await f.must<{id:string}>(f.base+'/uploads',reserve(1));await f.must(f.base+'/uploads/'+second.id+'/chunk',{ordinal:0,contentBase64:bytes.subarray(0,32768).toString('base64')});await f.must(f.base+'/uploads/'+second.id+'/cancel',{});
  const retained=await f.must<DesktopIntakeBatch>(url+'/'+batch.id);assert.deepEqual(retained.entries.map(e=>e.state),['completed','cancelled','pending']);assert.equal((await f.pool.query('SELECT count(*)::int n FROM upload_chunks WHERE upload_id=$1',[second.id])).rows[0].n,0);
  assert.equal((await f.call(f.base+'/uploads/'+second.id+'/complete',{})).statusCode,409);
  await f.must(f.base+'/authority',f.authority);assert.equal((await f.must<DesktopIntakeBatch>(url+'/'+batch.id)).canTransfer,false);assert.equal((await f.call(f.base+'/uploads',reserve(2))).statusCode,409);
  assert.equal((await f.must<Evidence>(path+'/complete',{})).id,original.id);assert.equal((await f.pool.query('SELECT count(*)::int n FROM evidence WHERE case_id=$1',[f.caseId])).rows[0].n,1);
 }finally{await f.close();}
});

test('desktop manifests fail closed on scope, audit rollback and administrative corruption',{timeout:30000},async()=>{
 const f=await fixture();try{
  const input={id:randomUUID(),files:[{filename:'fictional.bin',sourceTime:'2020-01-02T09:00:00+01:00',method:'Fictional supplied original',expectedSha256:sha('fictional'),byteLength:9}]},url=f.base+'/intake-batches';
  assert.equal((await f.call(url,input,f.client.headers)).statusCode,403);
  await f.admin.query("CREATE FUNCTION reject_batch_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='intake.batch_registered' THEN RAISE EXCEPTION 'fictional batch audit failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_batch_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_batch_audit()");
  try{assert.equal((await f.call(url,input)).statusCode,500);assert.equal((await f.pool.query('SELECT count(*)::int n FROM desktop_intake_entries WHERE case_id=$1',[f.caseId])).rows[0].n,0);}finally{await f.admin.query('DROP TRIGGER reject_batch_audit ON audit_events;DROP FUNCTION reject_batch_audit()');}
  const saved=await f.must<DesktopIntakeBatch>(url,input);assert.equal((await f.call(url+'/'+saved.id,undefined,f.investigator.headers)).statusCode,404);const stranger=await f.member('reviewer');assert.equal((await f.call(url+'/'+saved.id,undefined,stranger.headers)).statusCode,404);
  await assert.rejects(f.pool.query("UPDATE desktop_intake_entries SET byte_length=10 WHERE case_id=$1",[f.caseId]),/permission denied|immutable/);
  await f.admin.query('ALTER TABLE desktop_intake_entries DISABLE TRIGGER desktop_intake_entries_immutable');try{await f.admin.query("UPDATE desktop_intake_entries SET metadata=jsonb_set(metadata,'{method}',to_jsonb('Altered fictional source context'::text)) WHERE case_id=$1",[f.caseId]);}finally{await f.admin.query('ALTER TABLE desktop_intake_entries ENABLE TRIGGER desktop_intake_entries_immutable');}
  assert.equal((await f.call(url+'/'+saved.id)).statusCode,409);assert.equal((await f.call(f.base+'/uploads',{...input.files[0]!,idempotencyKey:saved.entries[0]!.requestKey})).statusCode,409);
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM upload_reservations WHERE case_id=$1',[f.caseId])).rows[0].n,0);
 }finally{await f.close();}
});

test('search separates literal word modes, source instants, receipt instants and preserved saved-filter meaning',{timeout:30000},async()=>{
 const f=await fixture();try{
  async function original(method:string,sourceTime:string){return f.must<Evidence>(f.base+'/evidence',{filename:'fictional-source.txt',text:'Fictional original for search boundaries.',method,sourceTime,idempotencyKey:randomUUID(),expectedSha256:sha('Fictional original for search boundaries.')});}
  const first=await original('Fictional alpha beta delta 100% supplied note','2020-01-02T09:00:00+01:00'),second=await original('Fictional gamma delta supplied note','2021-01-02T08:00:00Z');
  const base={query:'alpha delta',kind:'original',status:''},search=(extra:object={})=>f.must<CaseSearchResult>(f.base+'/search',{...base,...extra});
  assert.equal((await search()).items.length,0);assert.deepEqual((await search({queryMode:'all_words'})).items.map(i=>i.id),[first.id]);assert.equal((await search({queryMode:'any_words'})).items.length,2);
  assert.deepEqual((await search({query:'%'})).items.map(i=>i.id),[first.id]);
  const bound=await search({query:'',sourceFrom:'2020-01-02T08:00:00Z',sourceTo:'2020-01-02T08:00:00Z'});assert.deepEqual(bound.items.map(i=>i.id),[first.id]);assert.equal(bound.items[0]!.sourceTime,first.sourceTime);assert.equal(bound.facets.find(i=>i.kind==='original')!.count,1);
  assert.equal((await search({query:'',receivedTo:'2025-01-01T00:00:00Z'})).items.length,0);assert.deepEqual((await search({query:'',evidenceId:second.id})).items.map(i=>i.id),[second.id]);
  for(const extra of [{sourceFrom:'2020-02-30T00:00:00Z'},{sourceTo:'2020-01-02T08:00:00-00:00'},{sourceFrom:'2021-01-01T00:00:00Z',sourceTo:'2020-01-01T00:00:00Z'},{queryMode:'all_words',query:Array.from({length:13},(_,i)=>'word'+i).join(' ')}])assert.equal((await f.call(f.base+'/search',{...base,...extra})).statusCode,422);
  const old={id:randomUUID(),name:'Fictional retained phrase view',filter:base,withdrawn:false},saved=await f.must<SavedCaseView>(f.base+'/saved-views',old);
  const expected=sha(JSON.stringify([old.name,base.query,base.kind,base.status,false]));assert.equal((await f.pool.query('SELECT request_hash FROM saved_case_views WHERE id=$1',[old.id])).rows[0].request_hash.trim(),expected);assert.deepEqual(await f.must(f.base+'/saved-views',old),saved);
  const filter={...base,queryMode:'all_words',evidenceId:first.id,sourceFrom:'2020-01-02T08:00:00Z'};await f.must(f.base+'/saved-views/'+old.id+'/revise',{expectedVersion:1,name:old.name,filter,withdrawn:false});const history=await f.must<{snapshot:SavedCaseView}[]>(f.base+'/saved-views/'+old.id+'/history');assert.deepEqual(history.map(v=>v.snapshot.filter),[filter,base]);
  assert.equal((await f.call(f.base+'/search',base,f.client.headers)).statusCode,403);
 }finally{await f.close();}
});
