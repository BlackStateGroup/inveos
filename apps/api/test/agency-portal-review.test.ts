import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {CompositionChoice,CompositionRevision,InternalCollaboratorWork,WorkItem,TaskTemplateRevision,TaskTemplatePreview,ManualSourceRecord,ReportDraft} from '@inveos/contracts';
import {workflowFixture,tenant,owner} from './support/workflow-fixture.js';

type Fixture=Awaited<ReturnType<typeof workflowFixture>>;
const reason='Fictional independent review of exact current access and retained receipts.';

// Observe a real blocked database request, not a guessed delay or an API mock.
async function blockedCaseRequest(f:Fixture,start:()=>ReturnType<Fixture['call']>,change:()=>Promise<unknown>){
 const lock=await f.admin.connect();await lock.query('BEGIN');
 await lock.query('SELECT 1 FROM cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,f.caseId]);
 const pid=(await lock.query('SELECT pg_backend_pid() pid')).rows[0].pid;
 try{
  const pending=start();let blocked=false;
  for(let i=0;i<50;i++){
   if((await f.admin.query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[pid])).rowCount){blocked=true;break;}
   await delay(10);
  }
  assert.ok(blocked,'API request must actually wait on this fixture case lock');
  await change();await lock.query('COMMIT');return await pending;
 }finally{await lock.query('ROLLBACK');lock.release();}
}

async function blockedAuditRequest(f:Fixture,action:'invoice.compiled'|'report.frozen'|'work.template.applied'|'portal.feedback.requested',start:()=>ReturnType<Fixture['call']>,change:()=>Promise<unknown>){
 // The fixture owns this trigger and lock. Production code receives no hook.
 await f.admin.query(`CREATE FUNCTION review_audit_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='${action}' THEN PERFORM pg_advisory_xact_lock(150,135); END IF; RETURN NEW; END $$;CREATE TRIGGER review_audit_barrier BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION review_audit_barrier()`);
 const lock=await f.admin.connect();await lock.query('BEGIN');await lock.query('SELECT pg_advisory_xact_lock(150,135)');
 const pid=(await lock.query('SELECT pg_backend_pid() pid')).rows[0].pid;
 try{
  const pending=start();let blocked=false;
  for(let i=0;i<100;i++){
   if((await f.admin.query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[pid])).rowCount){blocked=true;break;}
   await delay(10);
  }
  assert.ok(blocked,'API must reach its late audit write before authority changes');
  await change();await lock.query('COMMIT');return await pending;
 }finally{await lock.query('ROLLBACK');lock.release();await f.admin.query('DROP TRIGGER review_audit_barrier ON audit_events;DROP FUNCTION review_audit_barrier()');}
}

async function composition(f:Fixture){
 await f.finding();const base=f.base+'/report-compositions';
 const choices=await f.must<{items:CompositionChoice[]}>(base+'/findings');
 const input={id:randomUUID(),outline:{name:'Fictional composed report',scope:reason,method:reason,limitations:reason,sections:[{id:randomUUID(),title:'Fictional reviewed statements',findings:choices.items.map(({kind,id,sha256})=>({kind,id,sha256}))}]},reason};
 const draft=await f.must<CompositionRevision>(base,input,f.investigator.headers);
 const accepted=await f.must<CompositionRevision>(base+'/'+input.id+'/reviews',{id:randomUUID(),expectedVersion:1,expectedReviewSequence:0,sha256:draft.sha256,decision:'accepted',reason,confirmContextNotFindings:true},f.reviewer.headers);
 return {base,input,draft,accepted,pin:{id:input.id,version:1,sha256:draft.sha256,reviewId:accepted.review!.id}};
}

test('invoice reads deny a session revoked while waiting for the case lock',{timeout:30000},async()=>{
 const f=await workflowFixture();try{
  const response=await blockedCaseRequest(f,()=>f.call(f.base+'/agency/declarations'),()=>f.admin.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE tenant_id=$1 AND user_id=$2',[tenant,owner]));
  assert.equal(response.statusCode,401,response.body);
 }finally{await f.close();}
});

for(const boundary of ['session','recipient'] as const)test(`invoice compilation rolls back its reservation and audit on late ${boundary} revocation; exact retry can recover`,{timeout:30000},async()=>{
 const f=await workflowFixture();try{
  const timeId=randomUUID();await f.must(f.base+'/time-entries',{id:timeId,startedAt:'2026-10-20T15:30:00+01:00',minutes:1,description:reason,billable:true},f.investigator.headers);
  await f.must(f.base+'/agency/declarations',{id:randomUUID(),expectedVersion:0,reason,currency:'GBP',recipientId:f.client.id,billTo:'Fictional internal bill-to',billingBasis:reason,hourlyRateMinor:30,expenseTreatment:'at_cost',taxTreatment:'exclusive_rate',taxBasisPoints:5000,taxLabel:'Fictional arithmetic only',rounding:'per_line_half_up',fictional:true});
  const input={id:randomUUID(),currency:'GBP',declarationVersion:1,reference:'FICTIONAL-RETRY',reason,lines:[{kind:'time',id:timeId,version:1}],confirmInternalDraft:true};
  const response=await blockedAuditRequest(f,'invoice.compiled',()=>f.call(f.base+'/agency/invoices',input),()=>boundary==='session'?f.admin.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE tenant_id=$1 AND user_id=$2',[tenant,owner]):f.admin.query("UPDATE memberships SET role='investigator' WHERE tenant_id=$1 AND user_id=$2",[tenant,f.client.id]));
  assert.equal(response.statusCode,boundary==='session'?401:409,response.body);
  for(const table of ['agency_invoices','agency_invoice_revisions','agency_invoice_lines'])assert.equal((await f.pool.query(`SELECT count(*)::int n FROM ${table} WHERE case_id=$1`,[f.caseId])).rows[0].n,0,table);
  assert.equal((await f.pool.query("SELECT count(*)::int n FROM audit_events WHERE case_id=$1 AND action='invoice.compiled'",[f.caseId])).rows[0].n,0);
  if(boundary==='recipient')await f.admin.query("UPDATE memberships SET role='client' WHERE tenant_id=$1 AND user_id=$2",[tenant,f.client.id]);
  const headers=await f.session(owner),retry=await f.must(f.base+'/agency/invoices',input,headers);
  assert.deepEqual(await f.must(f.base+'/agency/invoices',input,headers),retry);
 }finally{await f.close();}
});

test('composition reads recheck session and case membership after a real case lock wait',{timeout:30000},async()=>{
 const f=await workflowFixture();try{
  const revoked=await blockedCaseRequest(f,()=>f.call(f.base+'/report-compositions',undefined,f.investigator.headers),()=>f.admin.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE tenant_id=$1 AND user_id=$2',[tenant,f.investigator.id]));
  assert.equal(revoked.statusCode,401,revoked.body);
  const removed=await blockedCaseRequest(f,()=>f.call(f.base+'/report-compositions',undefined,f.reviewer.headers),()=>f.admin.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[tenant,f.caseId,f.reviewer.id]));
  assert.equal(removed.statusCode,404,removed.body);
 }finally{await f.close();}
});

test('new composition freezes require a currently assigned accepting reviewer without changing historical reports',{timeout:30000},async()=>{
 const f=await workflowFixture();try{
  const c=await composition(f),input={idempotencyKey:randomUUID(),composition:c.pin};
  const frozen=await f.must<{id:string}>(f.base+'/report-revisions',input),path=f.base+'/report-revisions/'+frozen.id;
  const before=(await f.call(path)).rawPayload;
  await f.admin.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[tenant,f.caseId,f.reviewer.id]);
  const response=await f.call(f.base+'/report-revisions',{...input,idempotencyKey:randomUUID()});
  assert.equal(response.statusCode,409,response.body);
  assert.deepEqual(await f.must(f.base+'/report-revisions',input),frozen);
  assert.deepEqual((await f.call(path)).rawPayload,before);
 }finally{await f.close();}
});

test('composed freeze rechecks its accepting reviewer after the late audit write and rolls back atomically',{timeout:30000},async()=>{
 const f=await workflowFixture();try{
  const c=await composition(f),input={idempotencyKey:randomUUID(),composition:c.pin};
  const response=await blockedAuditRequest(f,'report.frozen',()=>f.call(f.base+'/report-revisions',input),()=>f.admin.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[tenant,f.caseId,f.reviewer.id]));
  assert.equal(response.statusCode,409,response.body);
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM report_revisions WHERE case_id=$1',[f.caseId])).rows[0].n,0);
  assert.equal((await f.pool.query("SELECT count(*)::int n FROM audit_events WHERE case_id=$1 AND action='report.frozen'",[f.caseId])).rows[0].n,0);
  await f.admin.query('INSERT INTO case_memberships(tenant_id,case_id,user_id) VALUES($1,$2,$3)',[tenant,f.caseId,f.reviewer.id]);
  const retry=await f.must(f.base+'/report-revisions',input);assert.deepEqual(await f.must(f.base+'/report-revisions',input),retry);
 }finally{await f.close();}
});

test('collaborator publication stops recipient access when its publishing reviewer loses case membership',{timeout:30000},async()=>{
 const f=await workflowFixture();try{
  const task=await f.must<WorkItem>(f.base+'/work',{id:randomUUID(),kind:'task',title:'Fictional private task',body:'Private fictional task context',ownerId:f.investigator.id,dueDate:null,parentId:null},f.investigator.headers);
  const g=await f.must<InternalCollaboratorWork>(f.base+'/restricted-work',{id:randomUUID(),taskId:task.id,taskVersion:1,recipientId:f.client.id,expiresAt:new Date(Date.now()+2*86400000).toISOString(),title:'Fictional public task',instructions:reason,dueDate:new Date(Date.now()+86400000).toISOString().slice(0,10),reason},f.investigator.headers);
  const publish={id:randomUUID(),version:1,sha256:g.draft.sha256,expectedSequence:0,reason,confirmRecipientVisible:true};
  await f.must(f.base+'/restricted-work/'+g.id+'/publish',publish,f.reviewer.headers);
  await f.must('/api/portal/work/'+g.id,undefined,f.client.headers);
  await f.admin.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[tenant,f.caseId,f.reviewer.id]);
  const response=await f.call('/api/portal/work/'+g.id,undefined,f.client.headers);
  assert.equal(response.statusCode,404,response.body);
  assert.equal((await f.must<{items:unknown[]}>('/api/portal/work',undefined,f.client.headers)).items.length,0);
  // A different current reviewer can explicitly reapprove the retained instructions.
  await f.must(f.base+'/restricted-work/'+g.id+'/publish',{...publish,id:randomUUID(),expectedSequence:1});
  await f.must('/api/portal/work/'+g.id,undefined,f.client.headers);
 }finally{await f.close();}
});

test('collaborator discovery never returns a cursor for a handling-restricted grant',{timeout:30000},async()=>{
 const f=await workflowFixture();try{
  const task=await f.must<WorkItem>(f.base+'/work',{id:randomUUID(),kind:'task',title:'Fictional private task',body:'Private fictional context',ownerId:null,dueDate:null,parentId:null});
  for(let i=0;i<26;i++){
   const g=await f.must<InternalCollaboratorWork>(f.base+'/restricted-work',{id:randomUUID(),taskId:task.id,taskVersion:1,recipientId:f.client.id,expiresAt:new Date(Date.now()+2*86400000).toISOString(),title:'Fictional public instructions',instructions:reason,dueDate:new Date(Date.now()+86400000).toISOString().slice(0,10),reason},f.investigator.headers);
   await f.must(f.base+'/restricted-work/'+g.id+'/publish',{id:randomUUID(),version:1,sha256:g.draft.sha256,expectedSequence:0,reason,confirmRecipientVisible:true},f.reviewer.headers);
  }
  const before=await f.must<{items:unknown[];next:string|null}>('/api/portal/work',undefined,f.client.headers);assert.equal(before.items.length,25);assert.ok(before.next);
  await f.handling('internal_only');
  assert.deepEqual(await f.must('/api/portal/work',undefined,f.client.headers),{items:[],next:null});
 }finally{await f.close();}
});

for(const boundary of ['reviewer','owner'] as const)test(`template application rechecks ${boundary} after its audit and rolls back the complete work set`,{timeout:30000},async()=>{
 const f=await workflowFixture();try{
  const assignee=await f.member('investigator',true),changedId=boundary==='reviewer'?f.reviewer.id:assignee.id;
  const fields={name:'Fictional review checklist',description:reason,entries:[{id:randomUUID(),kind:'task',title:'Fictional review step',body:reason,timingGuidance:'Fictional planning only'}]};
  const t=await f.must<TaskTemplateRevision>(f.base+'/task-templates',{id:randomUUID(),fields,reason,confirmSeparateBoilerplate:true},f.investigator.headers);
  const reviewed=await f.must<TaskTemplateRevision>(f.base+'/task-templates/'+t.id+'/reviews',{id:randomUUID(),version:1,sha256:t.sha256,expectedReviewSequence:0,decision:'accepted',reason,confirmBoilerplateOnly:true},f.reviewer.headers);
  const p=await f.must<TaskTemplatePreview>(f.base+'/task-templates/'+t.id+'/previews',{id:randomUUID(),version:1,sha256:t.sha256,reviewId:reviewed.review!.id,choices:[{entryId:fields.entries[0]!.id,workId:randomUUID(),ownerId:assignee.id,dueDate:null}],reason,confirmExplicitChoices:true},f.investigator.headers);
  const path=f.base+'/task-template-previews/'+p.payload.id+'/apply',input={sha256:p.sha256,confirmCreateWork:true};
  const response=await blockedAuditRequest(f,'work.template.applied',()=>f.call(path,input,f.investigator.headers),()=>f.admin.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[tenant,f.caseId,changedId]));
  assert.equal(response.statusCode,409,response.body);
  for(const table of ['case_work_items','case_work_revisions','case_task_template_application_items','case_task_template_applications'])assert.equal((await f.pool.query(`SELECT count(*)::int n FROM ${table} WHERE case_id=$1`,[f.caseId])).rows[0].n,0,table);
  await f.admin.query('INSERT INTO case_memberships(tenant_id,case_id,user_id) VALUES($1,$2,$3)',[tenant,f.caseId,changedId]);
  const retry=await f.must(path,input,f.investigator.headers);assert.deepEqual(await f.must(path,input,f.investigator.headers),retry);
 }finally{await f.close();}
});

test('feedback final check rejects source permission review revoked during its audit and retains no partial request',{timeout:30000},async()=>{
 const f=await workflowFixture();try{
  const finding=await f.finding(),sourceReviewer=await f.member('reviewer',true),sourceBase=f.base+'/manual-sources';
  const source=await f.must<ManualSourceRecord>(sourceBase,{id:randomUUID(),evidenceId:finding.evidenceId,url:'https://fictional.invalid/supplied-note',publisher:'Fictional supplied record',retrievedAt:'2026-10-01T09:15:00+02:00',method:reason,trustGrade:'unassessed',termsReference:reason,purpose:reason,lawfulBasis:'Synthetic exercise only.',scope:reason,retentionDays:30,minimisation:'No real data or external collection.',annotation:reason},f.investigator.headers);
  await f.must(sourceBase+'/'+source.id+'/review',{id:randomUUID(),expectedVersion:source.version,digest:source.digest,accepted:true,reason},sourceReviewer.headers);
  await f.must(sourceBase+'/'+source.id+'/use-decisions',{id:randomUUID(),expectedSequence:0,sourceVersion:source.version,sourceDigest:source.digest,permission:'analysis_and_release',reason,validForHours:1},sourceReviewer.headers);
  const report=await f.must<{id:string;sha256:string}>(f.base+'/report-revisions',{idempotencyKey:randomUUID()}),rp=f.base+'/report-revisions/'+report.id;
  await f.must(rp+'/reviews',{sha256:report.sha256,decision:'accept_internal',reason},f.reviewer.headers);
  const release=await f.must<{id:string}>(rp+'/disclosures',{sha256:report.sha256,recipientId:f.client.id,idempotencyKey:randomUUID(),expiresAt:new Date(Date.now()+3600000).toISOString(),reason,confirmFullDisclosure:true});
  const path='/api/portal/disclosures/'+release.id+'/feedback',input={id:randomUUID(),sha256:report.sha256,reportSha256:report.sha256,kind:'clarification',subject:'Fictional clarification',body:reason,confirmReleasedScope:true};
  const response=await blockedAuditRequest(f,'portal.feedback.requested',()=>f.call(path,input,f.client.headers),()=>f.admin.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[tenant,f.caseId,sourceReviewer.id]));
  assert.equal(response.statusCode,409,response.body);
  for(const table of ['portal_feedback_requests','portal_feedback_request_revisions'])assert.equal((await f.pool.query(`SELECT count(*)::int n FROM ${table} WHERE case_id=$1`,[f.caseId])).rows[0].n,0,table);
  assert.equal((await f.pool.query("SELECT count(*)::int n FROM audit_events WHERE case_id=$1 AND action='portal.feedback.requested'",[f.caseId])).rows[0].n,0);
  await f.admin.query('INSERT INTO case_memberships(tenant_id,case_id,user_id) VALUES($1,$2,$3)',[tenant,f.caseId,sourceReviewer.id]);
  await f.must(path,input,f.client.headers);await f.must(path,input,f.client.headers);
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM portal_feedback_requests WHERE case_id=$1',[f.caseId])).rows[0].n,1);
 }finally{await f.close();}
});

test('composition exports contain only selected findings in declared order and redact context plus embedded models',{timeout:30000},async()=>{
 const f=await workflowFixture();try{
  const hidden='FICTIONAL_ALPHA_SECRET',visible='FICTIONAL_BETA_VISIBLE',excluded='FICTIONAL_GAMMA_EXCLUDED';
  for(const marker of [hidden,visible,excluded])await f.finding('Fictional supplied statement '+marker+'.');
  const base=f.base+'/report-compositions',choices=(await f.must<{items:CompositionChoice[]}>(base+'/findings')).items;
  const pick=(marker:string)=>{const {kind,id,sha256}=choices.find(c=>c.text.includes(marker))!;return {kind,id,sha256};};
  const input={id:randomUUID(),outline:{name:'Fictional outline '+hidden,scope:reason,method:reason,limitations:reason,sections:[{id:randomUUID(),title:'Fictional section '+hidden,findings:[pick(visible),pick(hidden)]}]},reason};
  const draft=await f.must<CompositionRevision>(base,input,f.investigator.headers);
  const review=await f.must<CompositionRevision>(base+'/'+input.id+'/reviews',{id:randomUUID(),expectedVersion:1,expectedReviewSequence:0,sha256:draft.sha256,decision:'accepted',reason,confirmContextNotFindings:true},f.reviewer.headers);
  const freeze={idempotencyKey:randomUUID(),composition:{id:input.id,version:1,sha256:draft.sha256,reviewId:review.review!.id}};
  const [a,b]=await Promise.all([f.call(f.base+'/report-revisions',freeze),f.call(f.base+'/report-revisions',freeze)]);assert.equal(a.statusCode,200,a.body);assert.equal(b.statusCode,200,b.body);assert.deepEqual(a.json(),b.json());
  const path=f.base+'/report-revisions/'+a.json<{id:string}>().id,report=await f.must<ReportDraft>(path);
  assert.equal(report.findings.length,2);assert.ok(!JSON.stringify(report).includes(excluded));
  assert.deepEqual(report.composition!.payload.outline.sections[0]!.findings.map(x=>x.id),[pick(visible).id,pick(hidden).id]);
  assert.equal((await f.call(f.base+'/report-revisions',{...freeze,composition:{...freeze.composition,sha256:'0'.repeat(64)}})).statusCode,409);
  for(const route of ['renditions','editable-renditions'])for(const redact of [false,true]){
   const receipt=await f.must<{id:string}>(path+'/'+route,{idempotencyKey:randomUUID(),redactedFindingIds:redact?[pick(hidden).id]:[],...(redact?{reason}:{} )});
   const download=await f.call(path+'/'+route+'/'+receipt.id);assert.equal(download.statusCode,200,download.body);
   const raw=download.rawPayload.toString('utf8'),encoded=route==='renditions'?raw.match(/\/ASCIIHexDecode >>\nstream\n([A-F0-9]+)>/)?.[1]:raw.match(/<inveos:model[^>]*>([A-Za-z0-9+/=]+)<\/inveos:model>/)?.[1];
   assert.ok(encoded,'Downloaded artifact must contain its actual embedded model');
   const model=JSON.parse(Buffer.from(encoded,route==='renditions'?'hex':'base64').toString('utf8')) as {visibleLines?:string[];paragraphs?:string[]};
   const lines=model.visibleLines??model.paragraphs!,text=lines.join('\n');assert.ok(text.includes(visible));assert.ok(!text.includes(excluded));
   if(redact){assert.ok(!text.includes(hidden));assert.ok(text.includes('[REDACTED]'));assert.ok(text.includes('[WITHHELD]'));}
   else{const first=text.split('FINDING 1\n')[1]!.split('FINDING 2\n')[0]!;const second=text.split('FINDING 2\n')[1]!;assert.ok(first.includes(visible));assert.ok(!first.includes(hidden));assert.ok(second.includes(hidden));}
  }
 }finally{await f.close();}
});
