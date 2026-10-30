// Definitions for the combined PostgreSQL acceptance phase; not a run receipt.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../src/app.js';
import {createPool,runMigrations} from '../src/db.js';
import type {CaseHandling} from '@inveos/contracts';

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
 const input={id:randomUUID(),expectedVersion:0,expectedAuthorityVersion:1,tier:'restricted',sharing:'internal_only',instructions:'Fictional internal handling instructions; no recipient access.',reason:'Fictional explicit reviewer decision to restrict sharing.'};
 return {admin,pool,app,root,caseId,base,maker,reviewer,investigator,client,call,must,member,input,authority,async close(){await app.close();await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();await rm(root,{recursive:true,force:true});}};
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
  const revision=await f.must<{id:string;sha256:string}>(f.base+'/report-revisions',{idempotencyKey:randomUUID()}),path=f.base+'/report-revisions/'+revision.id;
  await f.must(path+'/reviews',{sha256:revision.sha256,decision:'accept_internal',reason:'Fictional independent review of the empty scoped draft.'},f.reviewer.headers);
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
