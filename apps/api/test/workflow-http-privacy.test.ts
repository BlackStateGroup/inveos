import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import type {WorkItem} from '@inveos/contracts';
import {workflowFixture,tenant,type Session} from './support/workflow-fixture.js';

test('real HTTP preserves private portal DTOs, no-store, origin/CSRF/session denial and strict hook errors',{timeout:45000},async()=>{
 const f=await workflowFixture();try{
  const q=await f.request(),other=await f.member('client'),origin=await f.app.listen({host:'127.0.0.1',port:0});
  async function call(path:string,payload?:object,headers:Partial<Session>=f.client.headers){const r=await fetch(origin+path,{method:payload?'POST':'GET',headers:{...headers,...(payload?{'content-type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(5000)});assert.equal(r.headers.get('cache-control'),'no-store');return {status:r.status,body:await r.text()};}
  const shown=await call(q.external);assert.equal(shown.status,200);for(const secret of [f.caseId,f.reviewer.id,f.investigator.id,'INTERNAL SECRET','authorityVersion','evidenceId'])assert.ok(!shown.body.includes(secret),secret);
  assert.equal((await call(q.external,undefined,{})).status,401);assert.equal((await call(q.external,undefined,other.headers)).status,404);assert.equal((await call(f.base+'/report-compositions',undefined,f.client.headers)).status,403);
  const correction={...q.responseInput,id:randomUUID(),expectedSequence:1,body:'Fictional HTTP correction with explicit receipt-bound context.',reason:'Fictional HTTP acceptance correction.'};
  assert.equal((await call(q.external+'/responses',correction,{cookie:f.client.headers.cookie,origin:f.client.headers.origin})).status,403);
  assert.equal((await call(q.external+'/responses',correction,{...f.client.headers,origin:'https://fictional-untrusted.invalid'})).status,403);
  assert.equal((await call(q.external+'/responses',{...correction,expectedSequence:'1'})).status,422);
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM portal_evidence_responses WHERE case_id=$1',[f.caseId])).rows[0].n,1);
  assert.equal((await call(q.external+'/responses',correction)).status,200);
  assert.equal((await call(f.base+'/report-compositions',{id:5,reason:'Fictional invalid typed outline input.'},f.investigator.headers)).status,422);
  assert.equal((await call(f.base+'/task-templates',{id:randomUUID(),fields:{},reason:'Fictional invalid typed template input.',confirmSeparateBoilerplate:'true'},f.investigator.headers)).status,422);
  const task=await f.must<WorkItem>(f.base+'/work',{id:randomUUID(),kind:'task',title:'Fictional HTTP private task',body:'Private task body.',ownerId:f.investigator.id,dueDate:null,parentId:null},f.investigator.headers);
  const grant={id:randomUUID(),taskId:task.id,taskVersion:'1',recipientId:f.client.id,expiresAt:new Date(Date.now()+86400000).toISOString(),title:'Fictional external instructions',instructions:'Only the explicitly provided fictional work instructions.',dueDate:'2026-11-30',reason:'Fictional typed hook acceptance.'};assert.equal((await call(f.base+'/restricted-work',grant,f.investigator.headers)).status,422);
  await f.admin.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE tenant_id=$1 AND user_id=$2',[tenant,f.client.id]);
  for(const path of [q.external,'/api/portal/evidence-requests']){const denied=await call(path);assert.equal(denied.status,401);assert.ok(!denied.body.includes(q.g.draft.content.title));}
  assert.equal((await call(q.external+'/responses',correction)).status,401);
 }finally{await f.close();}
});
