// Build-phase definitions only. Root runs these against disposable PostgreSQL after integration.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseFieldRecord,type FieldContext,type FieldRecord,type FieldSessionRecord,type FieldObservationRecord,type FieldManifest,type FieldSyncAuthority} from '@inveos/contracts';
import {createPool,runMigrations} from '../src/db.js';
import {createApp} from '../src/app.js';
const tenant='00000000-0000-4000-8000-000000000001',user='00000000-0000-4000-8000-000000000002',origin='http://localhost:5173';
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
async function fixture(){
 const database=process.env.INVEOS_TEST_DATABASE_URL,adminUrl=process.env.INVEOS_TEST_ADMIN_DATABASE_URL;assert.ok(database&&adminUrl,'Disposable restricted PostgreSQL required');assert.match(database,/\/inveos_test(?:\?|$)/);assert.match(adminUrl,/\/inveos_test(?:\?|$)/);
 const schema='field_sessions_'+randomUUID().replaceAll('-',''),admin=createPool(adminUrl,schema,2),pool=createPool(database,schema,4),root=await mkdtemp(join(tmpdir(),'inveos-field-sessions-'));
 await runMigrations(admin,schema);const app=await createApp({pool,storageRoot:root,allowedOrigins:[origin],demoTenantId:tenant,demoUserId:user,sessionTtlSeconds:3600});await app.ready();
 const login=await app.inject({method:'POST',url:'/api/session/start',headers:{origin},payload:{}});assert.equal(login.statusCode,200,login.body);const cookies=login.headers['set-cookie'],cookie=(Array.isArray(cookies)?cookies:[cookies]).filter(Boolean).map(v=>v!.split(';')[0]).join('; '),session={cookie,csrf:login.json().csrf as string};
 const req=(method:'GET'|'POST',url:string,payload?:object,auth=session)=>app.inject({method,url,headers:{cookie:auth.cookie,origin,'x-csrf-token':auth.csrf},...(payload?{payload}:{})});
 const created=await req('POST','/api/cases',{title:'Fictional Field session case',client:'Fictional Fieldworks',scope:'Inspect supplied fictional records only.',jurisdiction:'England'});assert.equal(created.statusCode,200,created.body);const caseId=created.json().id as string,base='/api/cases/'+caseId;
 const approve=()=>req('POST',base+'/authority',{purpose:'Fictional session and correction exercise',lawfulBasis:'Fictional supplied records only; no personal data.',scope:'Manually record supplied fictional observations.',retentionDays:30,minimisation:'Retain minimal fictional content; no automatic location capture.'});assert.equal((await approve()).statusCode,200);
 const deviceId=randomUUID();assert.equal((await req('POST','/api/field/devices',{id:deviceId,label:'Fictional session device'})).statusCode,200);assert.equal((await req('POST',base+'/field-grants/prepare',{deviceId})).statusCode,200);const context=(await req('GET',base+'/field-context/'+deviceId)).json() as FieldContext,g=context.grant!,sync:FieldSyncAuthority={deviceId,deviceVersion:g.deviceVersion,grantId:g.id,grantVersion:g.version,authorityId:g.authorityId,authorityVersion:g.authorityVersion,caseAccessVersion:g.caseAccessVersion};
 const common=(id:string,sessionId:string)=>({format:'inveos.field.record.v1' as const,id,tenantId:tenant,userId:user,caseId,sessionId,deviceId,authorityId:context.authority.id,authorityVersion:1,sourceTime:'2026-10-01T09:00:00+01:00',deviceTime:'2026-10-01T08:00:02.000Z',clockUncertaintySeconds:5,reason:'Explicit fictional manual record for acceptance'});
 const start=(id=randomUUID()):FieldSessionRecord=>({...common(id,id),kind:'session_start',expectedVersion:0,title:'Fictional session',purpose:'Record a fictional supplied account',summary:''});
 const observe=(sessionId:string,id=randomUUID()):FieldObservationRecord=>({...common(id,sessionId),kind:'observation_record',expectedVersion:0,observationId:id,supersedesCaptureId:null,status:'recorded',category:'observation',title:'Fictional observation',account:'A fictional blue box was described in the supplied record.',basis:'supplied_record',sourceDescription:'Fictional commissioning-party note',consentBasis:'Fictional supplied material within the approved case scope',location:{method:'manually_declared',description:'Fictional archive room',latitude:null,longitude:null,uncertaintyMetres:null,purpose:'Disambiguate the fictional room named by the source'},attachments:[]});
 const intake=async(record:FieldRecord)=>{const bytes=Buffer.from(JSON.stringify(record)),manifest:FieldManifest={sync,id:record.id,deviceId,authorityId:context.authority.id,authorityVersion:1,filename:'field-'+record.id+'.txt',sourceTime:record.sourceTime,capturedAt:record.deviceTime,clockUncertaintySeconds:record.clockUncertaintySeconds,method:'Explicit fictional structured record; manually authored',expectedSha256:hash(bytes),byteLength:bytes.length,kind:'field_note',scopeConfirmed:true};const r=await req('POST',base+'/field-captures',{manifest,contentBase64:bytes.toString('base64')});assert.equal(r.statusCode,200,r.body);return {original:r.json(),request:{id:randomUUID(),captureId:record.id,expectedSha256:hash(bytes),authority:sync,reason:'Explicit organisation of this fictional original under current scope'}};};
 const organise=async(record:FieldRecord)=>{const raw=await intake(record),r=await req('POST',base+'/field-records',raw.request);assert.equal(r.statusCode,200,r.body);return {...raw,receipt:r.json()};};
 const member=async(role:'investigator'|'reviewer'|'client',assigned=false)=>{const id=randomUUID(),token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');await admin.query('INSERT INTO users(id,display_name) VALUES($1,$2)',[id,'Fictional session boundary account']);await admin.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenant,id,role]);if(assigned)await admin.query('INSERT INTO case_memberships(tenant_id,case_id,user_id) VALUES($1,$2,$3)',[tenant,caseId,id]);await admin.query("INSERT INTO sessions(token_hash,id,csrf_hash,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 hour')",[hash(token),randomUUID(),hash(csrf),tenant,id]);return {id,cookie:'inveos_session='+token+'; inveos_csrf='+csrf,csrf};};
 return {app,admin,pool,root,req,base,caseId,context,sync,deviceId,start,observe,intake,organise,approve,member,async close(){await app.close();await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();await rm(root,{recursive:true,force:true});}};
}
test('Field sessions preserve originals, stable receipts, correction lineage and distinct times',async()=>{
 const f=await fixture();try{const start=f.start(),a=await f.organise(start),obs=f.observe(start.id),b=await f.organise(obs);
  assert.deepEqual((await f.req('POST',f.base+'/field-records',b.request)).json(),b.receipt);assert.deepEqual((await f.req('GET',f.base+'/field-records/'+obs.id+'/receipt')).json(),b.receipt);
  const correction:FieldObservationRecord={...obs,id:randomUUID(),kind:'observation_correct',expectedVersion:1,supersedesCaptureId:obs.id,account:'The fictional supplied record described a green box; earlier colour was incorrect.',reason:'Explicit colour correction retaining the previous fictional original'};const c=await f.organise(correction);assert.equal(c.receipt.previousCaptureId,obs.id);assert.equal(c.receipt.version,2);
  const stale=await f.intake({...correction,id:randomUUID()});assert.equal((await f.req('POST',f.base+'/field-records',stale.request)).statusCode,409);
  const end:FieldSessionRecord={...start,id:randomUUID(),kind:'session_end',expectedVersion:1,sourceTime:'2026-10-01T10:00:00+01:00',reason:'Explicit fictional session end; originals remain retained'};await f.organise(end);
  const late=await f.organise(f.observe(start.id));assert.equal(late.receipt.receivedAfterEnd,true);
  const view=(await f.req('GET',f.base+'/field-sessions/'+start.id)).json();assert.equal(view.events.length,2);assert.equal(view.observations.find((x:{latest:{observationId:string}})=>x.latest.observationId===obs.id).history.length,2);
  assert.equal(b.receipt.source.sourceTime,obs.sourceTime);assert.equal(b.receipt.source.deviceTime,obs.deviceTime);assert.equal(b.receipt.source.receivedAt,b.original.capture.receivedAt);assert.equal((await f.req('GET',f.base+'/evidence/'+b.original.evidence.id+'/original')).body,JSON.stringify(obs));assert.equal(a.receipt.version,1);
  await assert.rejects(f.admin.query("UPDATE field_session_records SET version=9 WHERE case_id=$1",[f.caseId]),/append|immutable/i);
 }finally{await f.close();}
});
test('Field organisation fences current authority and revoked devices while receipt lookup remains available',async()=>{
 const f=await fixture();try{const start=f.start(),saved=await f.organise(start),queued=await f.intake(f.observe(start.id));assert.equal((await f.req('POST','/api/field/device-control/'+user+'/'+f.deviceId+'/state',{id:randomUUID(),expectedVersion:1,state:'lost',reason:'Fictional lost-device acceptance exercise'})).statusCode,200);
  assert.equal((await f.req('POST',f.base+'/field-records',queued.request)).statusCode,409);assert.equal((await f.req('GET',f.base+'/field-records/'+start.id+'/receipt')).statusCode,200);assert.deepEqual((await f.req('POST',f.base+'/field-records',saved.request)).json(),saved.receipt);
  const unassigned=await f.member('investigator'),client=await f.member('client',true);assert.equal((await f.req('GET',f.base+'/field-sessions/'+start.id,undefined,unassigned)).statusCode,404);assert.equal((await f.req('GET',f.base+'/field-sessions',undefined,client)).statusCode,403);
  await f.approve();assert.equal((await f.req('POST',f.base+'/field-records',queued.request)).statusCode,409);assert.equal((await f.pool.query('SELECT count(*)::int n FROM field_captures WHERE case_id=$1',[f.caseId])).rows[0].n,2);
 }finally{await f.close();}
});
test('Field context review is independent, exact-version bound and never approves a later correction',async()=>{
 const f=await fixture();try{const start=f.start();await f.organise(start);const obs=f.observe(start.id),o=await f.organise(obs),input={id:randomUUID(),expectedVersion:1,authorityVersion:1,caseAccessVersion:f.sync.caseAccessVersion,decision:'context_checked',reason:'Independent fictional context review with explicit limits',scopeConfirmed:true};
  assert.equal((await f.req('POST',f.base+'/field-records/'+obs.id+'/reviews',input)).statusCode,409);const reviewer=await f.member('reviewer',true),r=await f.req('POST',f.base+'/field-records/'+obs.id+'/reviews',input,reviewer);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().captureId,o.receipt.captureId);
  await f.organise({...obs,id:randomUUID(),kind:'observation_correct',expectedVersion:1,supersedesCaptureId:obs.id,status:'withdrawn',reason:'Explicit fictional withdrawal retaining the account and its original'});assert.equal((await f.req('POST',f.base+'/field-records/'+obs.id+'/reviews',{...input,id:randomUUID()},reviewer)).statusCode,409);assert.deepEqual((await f.req('POST',f.base+'/field-records/'+obs.id+'/reviews',input,reviewer)).json(),r.json());
  const detail=(await f.req('GET',f.base+'/field-sessions/'+start.id)).json();assert.equal(detail.observations[0].reviews.length,1);assert.equal(detail.observations[0].latest.version,2);
 }finally{await f.close();}
});
test('Field attachment errors and audit failure retain delivered raw originals without partial organisation',async()=>{
 const f=await fixture();try{const start=f.start();await f.organise(start);const linked=f.observe(start.id);linked.attachments=[{kind:'capture',id:randomUUID(),sha256:'a'.repeat(64),relation:'source',note:'Fictional attachment not yet delivered'}];const bad=await f.intake(linked);assert.equal((await f.req('POST',f.base+'/field-records',bad.request)).statusCode,409);
  const obs=f.observe(start.id),raw=await f.intake(obs);await f.admin.query(`CREATE FUNCTION reject_session_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='field.record_organised' THEN RAISE EXCEPTION 'fictional session audit failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_session_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_session_audit()`);
  try{assert.equal((await f.req('POST',f.base+'/field-records',raw.request)).statusCode,500);assert.equal((await f.pool.query('SELECT count(*)::int n FROM field_session_records WHERE case_id=$1 AND capture_id=$2',[f.caseId,obs.id])).rows[0].n,0);}finally{await f.admin.query('DROP TRIGGER reject_session_audit ON audit_events;DROP FUNCTION reject_session_audit()');}
  assert.equal((await f.req('POST',f.base+'/field-records',raw.request)).statusCode,200);assert.equal((await f.req('GET',f.base+'/evidence/'+raw.original.evidence.id+'/original')).body,JSON.stringify(obs));
 }finally{await f.close();}
});
test('structured original validator rejects automatic location claims, invalid dates and broken correction identities',()=>{
 const id=randomUUID(),record:FieldSessionRecord={format:'inveos.field.record.v1',id,tenantId:randomUUID(),userId:randomUUID(),caseId:randomUUID(),sessionId:id,deviceId:randomUUID(),authorityId:randomUUID(),authorityVersion:1,sourceTime:'2026-10-01T09:00:00Z',deviceTime:'2026-10-01T09:00:01Z',clockUncertaintySeconds:null,reason:'Fictional explicit session start',kind:'session_start',expectedVersion:0,title:'Fictional session',purpose:'Record a fictional exercise',summary:''};
 assert.deepEqual(parseFieldRecord(record),record);assert.throws(()=>parseFieldRecord({...record,sourceTime:'2026-02-30T09:00:00Z'}),/time/);assert.throws(()=>parseFieldRecord({...record,expectedVersion:'0'}),/integer/);assert.throws(()=>parseFieldRecord({...record,location:{method:'automatic'}}),/fields/);assert.throws(()=>parseFieldRecord({...record,sessionId:randomUUID()}),/identity/);
});

// Definitions for combined acceptance. Do not infer a run from their presence.
test('Field search follows the current correction while exact inspection retains older original bytes',async()=>{
 const f=await fixture();try{
  const start=f.start();await f.organise(start);const first=f.observe(start.id),saved=await f.organise(first);
  const corrected:FieldObservationRecord={...first,id:randomUUID(),kind:'observation_correct',expectedVersion:1,supersedesCaptureId:first.id,title:'Fictional corrected archive observation',account:'The supplied fictional account describes a green archive box.',reason:'Retain the earlier blue account and explicitly correct its colour.'};
  const latest=await f.organise(corrected);
  const found=await f.req('POST',f.base+'/search',{query:'archive green',queryMode:'all_words',kind:'field_observation',status:''});assert.equal(found.statusCode,200,found.body);
  assert.deepEqual(found.json().items.map((row:{id:string})=>row.id),[corrected.id]);assert.equal(found.json().items[0].evidenceId,latest.original.evidence.id);assert.equal(found.json().items[0].status,'Unreviewed observation');
  const old=await f.req('POST',f.base+'/search',{query:'blue',kind:'field_observation',status:''});assert.equal(old.statusCode,200,old.body);assert.equal(old.json().items.length,0);
  const context=await f.req('GET',f.base+'/field-records/'+first.id+'/context');assert.equal(context.statusCode,200,context.body);assert.equal(context.json().selected.source.sha256,saved.receipt.source.sha256);assert.deepEqual(context.json().history.map((row:{version:number})=>row.version),[2,1]);assert.equal(context.json().latest.captureId,corrected.id);
  assert.equal(context.json().selected.record.account,first.account);assert.equal(context.json().selected.source.sourceTime,first.sourceTime);assert.equal(context.json().selected.source.deviceTime,first.deviceTime);
  const page=await f.req('GET',f.base+'/field-records/'+corrected.id+'/context?beforeVersion=2');assert.equal(page.statusCode,200,page.body);assert.deepEqual(page.json().history.map((row:{captureId:string})=>row.captureId),[first.id]);
  const wrong=await f.req('POST',f.base+'/search',{query:'',kind:'field_observation',status:'',evidenceId:saved.original.evidence.id});assert.equal(wrong.statusCode,200,wrong.body);assert.equal(wrong.json().items.length,0);
  const unassigned=await f.member('investigator'),client=await f.member('client',true);
  assert.equal((await f.req('GET',f.base+'/field-records/'+first.id+'/context',undefined,unassigned)).statusCode,404);
  assert.equal((await f.req('GET',f.base+'/field-records/'+first.id+'/context',undefined,client)).statusCode,403);
  await assert.rejects(f.pool.query('UPDATE field_session_records SET receipt=$1 WHERE case_id=$2 AND capture_id=$3',[JSON.stringify({...saved.receipt,record:{...first,account:'Unattributed replacement'}}),f.caseId,first.id]),/permission denied|append|immutable/i);
 }finally{await f.close();}
});

test('Field context and same-original retries reject a retained receipt that disagrees with original semantics',async()=>{
 const f=await fixture();try{
  const start=f.start();await f.organise(start);const observation=f.observe(start.id),saved=await f.organise(observation);
  // Controlled corruption in this disposable schema only, beyond ordinary role rights.
  await f.admin.query('ALTER TABLE field_session_records DISABLE TRIGGER field_session_records_immutable');
  try{await f.admin.query('UPDATE field_session_records SET receipt=$1::jsonb WHERE case_id=$2 AND capture_id=$3',[JSON.stringify({...saved.receipt,record:{...observation,account:'Fictional forged replacement retaining the old original digest.'}}),f.caseId,observation.id]);}
  finally{await f.admin.query('ALTER TABLE field_session_records ENABLE TRIGGER field_session_records_immutable');}
  for(const path of ['/receipt','/context']){const reply=await f.req('GET',f.base+'/field-records/'+observation.id+path);assert.equal(reply.statusCode,409,reply.body);assert.match(reply.body,/receipt does not match/i);}
  const replay=await f.req('POST',f.base+'/field-records',saved.request);assert.equal(replay.statusCode,409,replay.body);
  assert.equal((await f.req('GET',f.base+'/evidence/'+saved.original.evidence.id+'/original')).body,JSON.stringify(observation));
 }finally{await f.close();}
});
