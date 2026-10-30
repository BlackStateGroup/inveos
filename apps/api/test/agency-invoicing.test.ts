import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../src/app.js';
import {createPool,runMigrations} from '../src/db.js';
import type {BillingDeclarationFields,InvoiceRevision,InvoiceExport} from '@inveos/contracts';

// These fixtures exercise the actual restricted PostgreSQL/API path. They are
// authored for the root's combined acceptance phase; no browser mock is implied.
const tenant='00000000-0000-4000-8000-000000000001',owner='00000000-0000-4000-8000-000000000002',origin='http://localhost:5173';
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
type Session={cookie:string;'x-csrf-token':string;origin:string};
async function setup(){
 const database=process.env.INVEOS_TEST_DATABASE_URL,adminUrl=process.env.INVEOS_TEST_ADMIN_DATABASE_URL;
 assert.ok(database&&adminUrl,'Disposable PostgreSQL required for agency invoice acceptance');assert.match(database,/\/inveos_test(?:\?|$)/);assert.match(adminUrl,/\/inveos_test(?:\?|$)/);
 const schema='invoice_'+randomUUID().replaceAll('-',''),admin=createPool(adminUrl,schema,2);await runMigrations(admin,schema);const pool=createPool(database,schema,4),root=await mkdtemp(join(tmpdir(),'inveos-invoice-'));
 const app=await createApp({pool,storageRoot:root,allowedOrigins:[origin],demoTenantId:tenant,demoUserId:owner,sessionTtlSeconds:3600});
 const session=async(id:string,tenantId=tenant):Promise<Session>=>{const token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');await admin.query("INSERT INTO sessions(token_hash,id,csrf_hash,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 hour')",[sha(token),randomUUID(),sha(csrf),tenantId,id]);return {cookie:`inveos_session=${token}; inveos_csrf=${csrf}`,'x-csrf-token':csrf,origin};};
 const member=async(role:string,name:string,tenantId=tenant)=>{const id=randomUUID();await admin.query('INSERT INTO users(id,display_name) VALUES($1,$2)',[id,name]);await admin.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenantId,id,role]);return id;};
 const maker=await session(owner),reviewerId=await member('reviewer','Fictional independent invoice reviewer'),recorderId=await member('investigator','Fictional work recorder'),clientId=await member('client','Fictional billing recipient');
 const reviewer=await session(reviewerId),recorder=await session(recorderId),client=await session(clientId);
 const call=(url:string,payload?:object,actor=maker)=>app.inject({method:payload?'POST':'GET',url,headers:actor,...(payload?{payload}:{})});
 const must=async<T=Record<string,unknown>>(url:string,payload?:object,actor=maker)=>{const response=await call(url,payload,actor);assert.equal(response.statusCode,200,response.body);return response.json<T>();};
 const kase=await must<{id:string}>('/api/cases',{title:'Fictional agency invoicing exercise',client:'Fictional recipient organisation',scope:'Only supplied fictional work and receipt records',jurisdiction:'Fictional exercise'}),caseId=kase.id,caseBase='/api/cases/'+caseId,base=caseBase+'/agency';
 const authority={purpose:'Fictional billing workflow exercise',lawfulBasis:'Synthetic demonstration only; no real data processed.',scope:'Only supplied fictional work and receipt records',retentionDays:30,minimisation:'Use fictional records only; no personal or live investigation data.'};await must(caseBase+'/authority',authority);
 for(const id of [reviewerId,recorderId])await admin.query('INSERT INTO case_memberships(tenant_id,case_id,user_id) VALUES($1,$2,$3)',[tenant,caseId,id]);
 const text='Fictional receipt: 10.01 GBP. No real transaction.',evidence=await must<{id:string}>(caseBase+'/evidence',{filename:'fictional-invoice-receipt.txt',text,expectedSha256:sha(text),sourceTime:'2026-10-20T14:15:00Z',method:'Fictional supplied billing receipt only',idempotencyKey:randomUUID()},recorder);
 const timeId=randomUUID(),expenseId=randomUUID();const timeFields={startedAt:'2026-10-20T15:30:00+01:00',minutes:1,description:'Fictional short case review',billable:true},expenseFields={incurredOn:'2026-10-20',currency:'GBP',amountMinor:1001,description:'Fictional approved supplied receipt expense',receiptId:evidence.id};
 await must(caseBase+'/time-entries',{id:timeId,...timeFields},recorder);await must(caseBase+'/expenses',{id:expenseId,...expenseFields},recorder);await must(caseBase+'/expenses/'+expenseId+'/review',{id:randomUUID(),expectedVersion:1,accepted:true,reason:'Fictional independent expense review with the preserved original.'});
 const fields:BillingDeclarationFields={currency:'GBP',recipientId:clientId,billTo:'Fictional Billing Company, internal reference only',billingBasis:'Fictional commissioner requested this case and its internal draft.',hourlyRateMinor:30,expenseTreatment:'at_cost',taxTreatment:'exclusive_rate',taxBasisPoints:5000,taxLabel:'Fictional arithmetic exercise at 50 percent',rounding:'per_line_half_up',fictional:true};
 await must(base+'/declarations',{id:randomUUID(),expectedVersion:0,reason:'Fictional explicit terms selected for arithmetic exercise.',...fields});
 const input={id:randomUUID(),currency:'GBP',declarationVersion:1,reference:'FICTIONAL-DRAFT-001',reason:'Fictional frozen selection of exact time and accepted expense revisions.',lines:[{kind:'time',id:timeId,version:1},{kind:'expense',id:expenseId,version:1}],confirmInternalDraft:true};
 const compile=()=>must<InvoiceRevision>(base+'/invoices',input);
 const decision=(draft:InvoiceRevision,accepted=true)=>({id:randomUUID(),expectedVersion:draft.snapshot.version,sha256:draft.sha256,accepted,reason:'Fictional independent invoice source, recipient, arithmetic and budget review.',confirmSourceAndBudgetReview:true});
 return {admin,pool,app,root,caseId,caseBase,base,maker,reviewer,reviewerId,recorder,recorderId,client,clientId,call,must,session,member,authority,fields,input,compile,decision,timeId,timeFields,expenseId,expenseFields,evidence,
 async close(){await app.close();await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();await rm(root,{recursive:true,force:true});}};
}

test('agency drafts freeze exact source revisions, integer totals, budgets and independent reviews; retries preserve bytes',{timeout:30000},async()=>{
 const f=await setup();try{
  await f.must(f.caseBase+'/time-budget',{id:randomUUID(),expectedVersion:0,minutes:30,reason:'Fictional planning allocation only for this case.'});
  await f.must(f.caseBase+'/spending',{id:randomUUID(),expectedVersion:0,currency:'GBP',amountMinor:1500,reason:'Fictional spending plan remains distinct from invoice approval.'});
  const draft=await f.compile(),path=f.base+'/invoices/'+draft.snapshot.invoiceId;
  assert.deepEqual(draft.snapshot.totals,{currency:'GBP',netMinor:1002,taxMinor:502,totalMinor:1504});assert.equal(draft.snapshot.budget.time!.version,1);assert.equal(draft.snapshot.budget.spending!.version,1);
  assert.equal(draft.snapshot.lines.find(l=>l.kind==='time')!.source.recordedAt.includes('T'),true);assert.equal((draft.snapshot.lines.find(l=>l.kind==='time')!.source as {startedAt:string}).startedAt,'2026-10-20T15:30:00+01:00');
  assert.equal((await f.compile()).sha256,draft.sha256);assert.equal((await f.call(f.base+'/invoices',{...f.input,reference:'Different retry'})).statusCode,409);
  assert.equal((await f.call(path+'/review',f.decision(draft))).statusCode,403);
  const reviewInput=f.decision(draft),accepted=await f.must<InvoiceRevision>(path+'/review',reviewInput,f.reviewer);assert.equal(accepted.state,'accepted_internal');assert.equal((await f.must<InvoiceRevision>(path+'/review',reviewInput,f.reviewer)).review!.id,accepted.review!.id);
  const exported=await f.must<InvoiceExport>(path+'/revisions/1/export'),bytes=Buffer.from(exported.snapshotBase64,'base64');assert.equal(sha(bytes),draft.sha256);assert.deepEqual(JSON.parse(bytes.toString()),draft.snapshot);assert.equal(exported.review!.accepted,true);
  await assert.rejects(f.pool.query('UPDATE agency_invoice_revisions SET reference=$1 WHERE invoice_id=$2',['Mutated',draft.snapshot.invoiceId]),/permission denied|append-only/i);
  const audit=await f.pool.query("SELECT action FROM audit_events WHERE case_id=$1 AND action LIKE 'invoice.%'",[f.caseId]);assert.ok(audit.rows.some(v=>v.action==='invoice.exported'));assert.ok(audit.rows.some(v=>v.action==='invoice.reviewed'));
 }finally{await f.close();}
});

test('agency reservations survive source corrections and rejection; draft replacement and withdrawal retain lineage and release sources',{timeout:30000},async()=>{
 const f=await setup();try{
  const first=await f.compile(),path=f.base+'/invoices/'+first.snapshot.invoiceId;
  assert.equal((await f.call(f.base+'/invoices',{...f.input,id:randomUUID()})).statusCode,409);
  await f.must(path+'/review',f.decision(first,false),f.reviewer);
  await f.must(f.caseBase+'/time-entries/'+f.timeId+'/corrections',{id:randomUUID(),expectedVersion:1,...f.timeFields,minutes:2,reason:'Fictional correction retains the originally recorded minute.'},f.recorder);
  const current=await f.must<InvoiceRevision>(path);assert.ok(current.currentIssues.some(v=>v.includes('changed after')));assert.equal(current.snapshot.lines.find(l=>l.kind==='time')!.quantity,1);
  assert.equal((await f.call(f.base+'/invoices',{...f.input,id:randomUUID(),lines:[{kind:'time',id:f.timeId,version:2}]})).statusCode,409);
  const correction=await f.must<InvoiceRevision>(path+'/corrections',{...f.input,id:randomUUID(),expectedVersion:1,lines:[{kind:'time',id:f.timeId,version:2}],reason:'Fictional corrected invoice removes the expense and selects corrected time.'});assert.equal(correction.snapshot.previousSha256,first.sha256);assert.equal(correction.review,null);
  const expenseDraft=await f.must<InvoiceRevision>(f.base+'/invoices',{...f.input,id:randomUUID(),lines:[{kind:'expense',id:f.expenseId,version:1}]});assert.equal(expenseDraft.snapshot.lines.length,1);
  const withdrawal=await f.must<InvoiceRevision>(path+'/withdraw',{id:randomUUID(),expectedVersion:2,reason:'Fictional terminal withdrawal releases the source reservation.'});assert.equal(withdrawal.state,'withdrawn');assert.equal(withdrawal.snapshot.lines[0]!.sourceVersion,2);
  const timeDraft=await f.must<InvoiceRevision>(f.base+'/invoices',{...f.input,id:randomUUID(),lines:[{kind:'time',id:f.timeId,version:2}]});assert.equal(timeDraft.snapshot.lines[0]!.quantity,2);
  const old=await f.must<InvoiceRevision>(path+'/revisions/1');assert.equal(old.sha256,first.sha256);assert.equal(old.review!.accepted,false);assert.equal(old.state,'superseded');
 }finally{await f.close();}
});

test('agency declarations and currency/recipient boundaries invalidate acceptance without rewriting frozen drafts',{timeout:30000},async()=>{
 const f=await setup();try{
  const first=await f.compile(),path=f.base+'/invoices/'+first.snapshot.invoiceId;
  await f.must(f.base+'/declarations',{...f.fields,id:randomUUID(),expectedVersion:1,hourlyRateMinor:5000,reason:'Fictional rate correction requires a fresh invoice revision.'});
  assert.equal((await f.call(path+'/review',f.decision(first),f.reviewer)).statusCode,409);assert.equal((await f.must<InvoiceRevision>(path)).sha256,first.sha256);
  await f.must(f.base+'/declarations',{...f.fields,currency:'EUR',id:randomUUID(),expectedVersion:0,reason:'Fictional explicit euro declaration without currency conversion.'});
  const mixed=await f.call(f.base+'/invoices',{...f.input,id:randomUUID(),currency:'EUR',lines:[{kind:'expense',id:f.expenseId,version:1}]});assert.equal(mixed.statusCode,409);
  const bad=await f.call(f.base+'/declarations',{...f.fields,id:randomUUID(),expectedVersion:2,taxTreatment:'explicit_zero',reason:'Fictional mismatch cannot silently override declared tax.'});assert.equal(bad.statusCode,422);
  const coerced=await f.call(f.base+'/declarations',{...f.fields,id:randomUUID(),expectedVersion:2,hourlyRateMinor:'100',reason:'Fictional numeric strings must not be coerced into money.'});assert.equal(coerced.statusCode,422);
  await f.admin.query('DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2',[tenant,f.clientId]);assert.ok((await f.must<InvoiceRevision>(path)).currentIssues.some(x=>x.includes('recipient')));
  assert.equal((await f.call(f.base+'/declarations',{...f.fields,id:randomUUID(),expectedVersion:2,reason:'Fictional revoked recipient cannot receive a new declaration.'})).statusCode,409);
 }finally{await f.close();}
});

test('agency access denies clients, investigators, other cases and tenants on reads, writes and exports',{timeout:30000},async()=>{
 const f=await setup();try{
  const draft=await f.compile(),path=f.base+'/invoices/'+draft.snapshot.invoiceId;
  const outsider=await f.session(await f.member('reviewer','Fictional reviewer without this case'));
  const otherTenant=randomUUID();await f.admin.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[otherTenant,'Fictional other billing agency']);const foreign=await f.session(await f.member('reviewer','Fictional foreign reviewer',otherTenant),otherTenant);
  for(const [actor,status] of [[f.client,403],[f.recorder,403],[outsider,404],[foreign,404]] as const){
   for(const url of [f.base+'/declarations',f.base+'/recipients',f.base+'/eligible?currency=GBP&kind=time',f.base+'/invoices',path,path+'/history',path+'/revisions/1/export'])assert.equal((await f.call(url,undefined,actor)).statusCode,status,url);
   assert.equal((await f.call(f.base+'/invoices',{...f.input,id:randomUUID()},actor)).statusCode,status);
  }
  const other=await f.must<{id:string}>('/api/cases',{title:'Fictional other case',client:'Fictional other client',scope:'Only separate fictional material',jurisdiction:'Fictional'});
  assert.equal((await f.call('/api/cases/'+other.id+'/agency/invoices/'+draft.snapshot.invoiceId)).statusCode,404);
  await f.admin.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[tenant,f.caseId,owner]);assert.equal((await f.call(path)).statusCode,404);assert.equal((await f.call(path+'/revisions/1/export')).statusCode,404);
 }finally{await f.close();}
});

test('agency concurrent compilation reserves a logical source once and corrupted receipt bytes block acceptance and export',{timeout:30000},async()=>{
 const f=await setup();try{
  const results=await Promise.all([f.call(f.base+'/invoices',f.input),f.call(f.base+'/invoices',{...f.input,id:randomUUID()})]);assert.deepEqual(results.map(x=>x.statusCode).sort(),[200,409]);
  const draft=results.find(x=>x.statusCode===200)!.json<InvoiceRevision>(),path=f.base+'/invoices/'+draft.snapshot.invoiceId;
  const object=(await f.admin.query('SELECT object_path FROM evidence WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[tenant,f.caseId,f.evidence.id])).rows[0].object_path as string;
  const filename=join(f.root,object),bytes=await readFile(filename);await writeFile(filename,Buffer.from('Fictional corruption fixture; no original changed in production.'));
  assert.equal((await f.call(path+'/review',f.decision(draft),f.reviewer)).statusCode,409);assert.equal((await f.call(path+'/revisions/1/export')).statusCode,409);
  await writeFile(filename,bytes);assert.equal((await f.call(path+'/revisions/1/export')).statusCode,200);
 }finally{await f.close();}
});
