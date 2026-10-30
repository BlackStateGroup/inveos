import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {workflowFixture,tenant,sha} from './support/workflow-fixture.js';
import type {AnalysisRunRecord,FieldContext,FieldManifest,FieldSyncAuthority,ReportDraft} from '@inveos/contracts';
type Fixture=Awaited<ReturnType<typeof workflowFixture>>;
async function afterRevocation(f:Fixture,path:string,input:object|undefined,actorId:string,lockSql='SELECT 1 FROM cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE',lockArgs:unknown[]=[tenant,f.caseId]){
 const actor=await f.session(actorId),lock=await f.admin.connect();await lock.query('BEGIN');await lock.query(lockSql,lockArgs);
 try{const pending=f.call(path,input,actor);let waiting=false;for(let i=0;i<70;i++){if((await f.admin.query('SELECT 1 FROM pg_locks WHERE NOT granted AND pid<>pg_backend_pid()')).rowCount){waiting=true;break;}await delay(10);}assert.ok(waiting,'API must actually block on the owned lock: '+path);
  const token=actor.cookie.split(';')[0]!.slice('inveos_session='.length);await f.admin.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1',[sha(token)]);await lock.query('COMMIT');return await pending;
 }finally{await lock.query('ROLLBACK');lock.release();}
}
async function device(f:Fixture){const id=randomUUID();await f.must('/api/field/devices',{id,label:'Fictional independent review device'},f.investigator.headers);await f.must(f.base+'/field-grants/prepare',{deviceId:id},f.investigator.headers);const c=await f.must<FieldContext>(f.base+'/field-context/'+id,undefined,f.investigator.headers);const sync:FieldSyncAuthority={deviceId:id,deviceVersion:c.grant!.deviceVersion,grantId:c.grant!.id,grantVersion:c.grant!.version,authorityId:c.authority.id,authorityVersion:c.authority.version,caseAccessVersion:c.grant!.caseAccessVersion};return {id,c,sync};}

test('independent review: revocation during lock waits fences Field, handling, analysis and desktop reads/writes',{timeout:60000},async()=>{const f=await workflowFixture();try{
 const d=await device(f);await f.finding();const report=await f.must<ReportDraft>(f.base+'/report');const analysisInput={id:randomUUID(),mode:'passages',question:'Fictional scoped reading',sources:report.findings.map(v=>({kind:'text_finding',findingId:v.id}))};const analysis=await f.must<AnalysisRunRecord>(f.base+'/analysis',analysisInput,f.investigator.headers);
 const batchInput={id:randomUUID(),files:[{filename:'fictional-review.bin',sourceTime:'2026-10-01T09:00:00Z',method:'Fictional independently reviewed intake',expectedSha256:sha('fictional'),byteLength:9}]};const failures:string[]=[];
 for(const [path,input,user] of [
  [f.base+'/field-sessions',undefined,f.investigator.id],
  [f.base+'/field-dispatch-options',undefined,f.investigator.id],
  [f.base+'/field-recoveries',undefined,f.investigator.id],
  [f.base+'/field-context/'+d.id,undefined,f.investigator.id],
  [f.base+'/handling',undefined,f.reviewer.id],
  [f.base+'/analysis/'+analysis.run.id,undefined,f.investigator.id],
  [f.base+'/intake-batches',batchInput,f.investigator.id],
  [f.base+'/analysis',{...analysisInput,id:randomUUID()},f.investigator.id],
 ] as const){const r=await afterRevocation(f,path,input,user);if(r.statusCode!==401)failures.push(path+': '+r.statusCode);}
 const deviceDecision={id:randomUUID(),expectedVersion:1,state:'lost',reason:'Fictional decision must fail after session revocation.'};const state=await afterRevocation(f,'/api/field/device-control/'+f.investigator.id+'/'+d.id+'/state',deviceDecision,f.investigator.id,'SELECT 1 FROM field_devices WHERE tenant_id=$1 AND user_id=$2 AND id=$3 FOR UPDATE',[tenant,f.investigator.id,d.id]);if(state.statusCode!==401)failures.push('device state: '+state.statusCode);
 assert.deepEqual(failures,[],'Revoked sessions must not expose case content or commit work');assert.equal((await f.pool.query('SELECT count(*)::int n FROM desktop_intake_batches WHERE case_id=$1',[f.caseId])).rows[0].n,0);assert.equal((await f.pool.query('SELECT count(*)::int n FROM case_analysis_runs WHERE case_id=$1',[f.caseId])).rows[0].n,1);assert.equal((await f.pool.query('SELECT max(version) v FROM field_device_events WHERE device_id=$1',[d.id])).rows[0].v,1);
 }finally{await f.close();}});

test('independent review: revoked in-flight Field intake retains no accepted bytes or audit and a fresh retry works',{timeout:45000},async()=>{const f=await workflowFixture();try{
 const d=await device(f),bytes=Buffer.from('Fictional original preserved across denied session.'),manifest:FieldManifest={id:randomUUID(),deviceId:d.id,authorityId:d.c.authority.id,authorityVersion:d.c.authority.version,sync:d.sync,filename:'fictional-locked.txt',sourceTime:'2026-10-01T09:00:00Z',capturedAt:'2026-10-01T09:00:01Z',clockUncertaintySeconds:1,method:'Fictional retained original under explicit scope',expectedSha256:sha(bytes),byteLength:bytes.length,kind:'field_note',scopeConfirmed:true},input={manifest,contentBase64:bytes.toString('base64')};
 const r=await afterRevocation(f,f.base+'/field-captures',input,f.investigator.id);assert.equal(r.statusCode,401,r.body);
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM field_captures WHERE case_id=$1',[f.caseId])).rows[0].n,0);assert.equal((await f.pool.query('SELECT count(*)::int n FROM evidence WHERE case_id=$1',[f.caseId])).rows[0].n,0);assert.equal((await f.pool.query("SELECT count(*)::int n FROM audit_events WHERE case_id=$1 AND action='field.capture_received'",[f.caseId])).rows[0].n,0);
 const key='fictional-intake-audit-'+randomUUID();await f.admin.query(`CREATE FUNCTION wait_intake_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='field.capture_received' THEN PERFORM pg_advisory_xact_lock(hashtextextended('${key}',0)); END IF; RETURN NEW; END $$;CREATE TRIGGER wait_intake_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION wait_intake_audit()`);
 const late=await afterRevocation(f,f.base+'/field-captures',input,f.investigator.id,'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);assert.equal(late.statusCode,401,late.body);assert.equal((await f.pool.query('SELECT count(*)::int n FROM evidence WHERE case_id=$1',[f.caseId])).rows[0].n,0);assert.deepEqual(await readdir(join(f.root,tenant,f.caseId)),[],'Rolled-back original bytes must be removed');
 const receipt=await f.must<{evidence:{id:string}}>(f.base+'/field-captures',input,f.investigator.headers);assert.deepEqual((await f.call(f.base+'/evidence/'+receipt.evidence.id+'/original',undefined,f.investigator.headers)).rawPayload,bytes);
 }finally{await f.close();}});

test('independent review: revocation while final audit waits rolls back desktop metadata and handling decisions',{timeout:45000},async()=>{const f=await workflowFixture();try{
 const key='fictional-independent-review-'+randomUUID();await f.admin.query(`CREATE FUNCTION wait_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('intake.batch_registered','case.handling_decided') THEN PERFORM pg_advisory_xact_lock(hashtextextended('${key}',0)); END IF; RETURN NEW; END $$;CREATE TRIGGER wait_review_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION wait_review_audit()`);
 const manifest={id:randomUUID(),files:[{filename:'fictional-private.bin',sourceTime:'2026-10-01T09:00:00Z',method:'Fictional explicit source declaration',expectedSha256:sha('fictional'),byteLength:9}]},handling={id:randomUUID(),expectedVersion:0,expectedAuthorityVersion:1,tier:'restricted',sharing:'internal_only',instructions:'Fictional private handling instructions.',reason:'Fictional independent review decision.'},failures:string[]=[];
 for(const [path,input,actor] of [[f.base+'/intake-batches',manifest,f.investigator.id],[f.base+'/handling',handling,f.reviewer.id]] as const){const r=await afterRevocation(f,path,input,actor,'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);if(r.statusCode!==401)failures.push(path+': '+r.statusCode);}
 assert.deepEqual(failures,[]);for(const table of ['desktop_intake_batches','desktop_intake_entries','case_handling_events'])assert.equal((await f.pool.query(`SELECT count(*)::int n FROM ${table} WHERE case_id=$1`,[f.caseId])).rows[0].n,0,table);assert.equal((await f.pool.query("SELECT count(*)::int n FROM audit_events WHERE case_id=$1 AND action IN ('intake.batch_registered','case.handling_decided')",[f.caseId])).rows[0].n,0);
 }finally{await f.close();}});

test('independent review: desktop upload reservations and staged chunks reject sessions revoked during case-lock waits',{timeout:45000},async()=>{const f=await workflowFixture();try{
 const bytes=Buffer.from('Fictional bounded desktop upload.'),input={filename:'fictional-desktop.bin',sourceTime:'2026-10-01T09:00:00Z',method:'Fictional explicitly selected local file.',expectedSha256:sha(bytes),byteLength:bytes.length,idempotencyKey:randomUUID()};
 const rejected=await afterRevocation(f,f.base+'/uploads',input,f.investigator.id);assert.equal(rejected.statusCode,401,rejected.body);assert.equal((await f.pool.query('SELECT count(*)::int n FROM upload_reservations WHERE case_id=$1',[f.caseId])).rows[0].n,0);
 const saved=await f.must<{id:string}>(f.base+'/uploads',input,f.investigator.headers),path=f.base+'/uploads/'+saved.id,chunk={ordinal:0,contentBase64:bytes.toString('base64')};assert.equal((await afterRevocation(f,path+'/chunk',chunk,f.investigator.id)).statusCode,401);assert.equal((await f.pool.query('SELECT count(*)::int n FROM upload_chunks WHERE case_id=$1',[f.caseId])).rows[0].n,0);
 await f.must(path+'/chunk',chunk,f.investigator.headers);assert.equal((await afterRevocation(f,path+'/cancel',{},f.investigator.id)).statusCode,401);assert.equal((await f.pool.query('SELECT count(*)::int n FROM upload_chunks WHERE case_id=$1',[f.caseId])).rows[0].n,1);assert.equal((await afterRevocation(f,path,undefined,f.investigator.id)).statusCode,401);
 const receipt=await f.must<{id:string}>(path+'/complete',{},f.investigator.headers);assert.deepEqual(await f.must(path+'/complete',{},f.investigator.headers),receipt);assert.deepEqual((await f.call(f.base+'/evidence/'+receipt.id+'/original',undefined,f.investigator.headers)).rawPayload,bytes);
 }finally{await f.close();}});
