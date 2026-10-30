import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {FieldContext,FieldManifest,FieldSyncAuthority} from '@inveos/contracts';
import {createApp} from '../src/app.js';
import {createPool,runMigrations} from '../src/db.js';
import {forwardBrowserApi} from './support/browser-proxy.js';
const tenantId='00000000-0000-4000-8000-000000000001',userId='00000000-0000-4000-8000-000000000002',origin='http://localhost:5173',sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
async function fixture(){
 const database=process.env.INVEOS_TEST_DATABASE_URL,adminUrl=process.env.INVEOS_TEST_ADMIN_DATABASE_URL;assert.ok(database&&adminUrl);assert.match(database,/\/inveos_test(?:\?|$)/);assert.match(adminUrl,/\/inveos_test(?:\?|$)/);
 const schema='field_recovery_'+randomUUID().replaceAll('-',''),admin=createPool(adminUrl,schema,2),pool=createPool(database,schema,4),storage=await mkdtemp(join(tmpdir(),'inveos-field-recovery-'));await runMigrations(admin,schema);
 const app=await createApp({pool,storageRoot:storage,allowedOrigins:[origin],demoTenantId:tenantId,demoUserId:userId,sessionTtlSeconds:3600});const login=await app.inject({method:'POST',url:'/api/session/start',headers:{origin},payload:{}});assert.equal(login.statusCode,200,login.body);const cookies=login.headers['set-cookie'],headers={origin,'x-csrf-token':login.json().csrf as string,cookie:(Array.isArray(cookies)?cookies:[cookies]).filter(Boolean).map(c=>c!.split(';')[0]).join('; ')};
 const req=(method:'GET'|'POST',url:string,payload?:object,auth=headers)=>app.inject({method,url,headers:auth,...(payload?{payload}:{})});const ok=async(method:'GET'|'POST',url:string,payload?:object,auth=headers)=>{const r=await req(method,url,payload,auth);assert.equal(r.statusCode,200,r.body);return r.json();};
 const kase=await ok('POST','/api/cases',{title:'Fictional Field recovery case',client:'Fictional archival client',scope:'Supplied fictional records only',jurisdiction:'England'}),caseId=kase.id as string,base='/api/cases/'+caseId;
 const approve=()=>ok('POST',base+'/authority',{purpose:'Fictional device recovery acceptance',lawfulBasis:'Fictional supplied material only',scope:'Manually supplied fictional originals',retentionDays:30,minimisation:'No real people or automatic capture'});await approve();
 const sync=(c:FieldContext):FieldSyncAuthority=>({deviceId:c.device.id,deviceVersion:c.grant!.deviceVersion,grantId:c.grant!.id,grantVersion:c.grant!.version,authorityId:c.authority.id,authorityVersion:c.authority.version,caseAccessVersion:c.grant!.caseAccessVersion});
 const device=async()=>{const id=randomUUID();await ok('POST','/api/field/devices',{id,label:'Fictional recovery software identity'});await ok('POST',base+'/field-grants/prepare',{deviceId:id});return await ok('GET',base+'/field-context/'+id) as FieldContext;};const context=await device();
 const original=(c=context)=>{const bytes=Buffer.from('Fictional unacknowledged original '+randomUUID()),manifest:FieldManifest={id:randomUUID(),deviceId:c.device.id,authorityId:c.authority.id,authorityVersion:c.authority.version,sync:sync(c),filename:'fictional-field.txt',sourceTime:'2026-10-01T09:00:00+01:00',capturedAt:'2026-10-01T08:00:02Z',clockUncertaintySeconds:5,method:'Fictional manually supplied field original',expectedSha256:sha(bytes),byteLength:bytes.length,kind:'field_note',scopeConfirmed:true};return {bytes,manifest,body:{manifest,contentBase64:bytes.toString('base64')}};};
 const member=async(assigned=true)=>{const id=randomUUID(),token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');await admin.query('INSERT INTO users(id,display_name) VALUES($1,$2)',[id,'Fictional recovery reviewer']);await admin.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'reviewer')",[tenantId,id]);if(assigned)await admin.query('INSERT INTO case_memberships(tenant_id,case_id,user_id) VALUES($1,$2,$3)',[tenantId,caseId,id]);await admin.query("INSERT INTO sessions(token_hash,id,csrf_hash,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 hour')",[sha(token),randomUUID(),sha(csrf),tenantId,id]);return {id,headers:{origin,cookie:'inveos_session='+token+'; inveos_csrf='+csrf,'x-csrf-token':csrf}};};
 return {app,admin,pool,headers,req,ok,caseId,base,context,sync,device,original,approve,member,async close(){await app.close();await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();await rm(storage,{recursive:true,force:true});}};
}
test('versioned Field grant withdrawal cannot self-renew or revive old manifests; explicit restoration retains history',async()=>{
 const f=await fixture();try{
  const frozen=f.original(),g=f.context.grant!,withdraw={id:randomUUID(),userId,deviceId:f.context.device.id,expectedVersion:g.version,state:'withdrawn',reason:'Fictional explicit case grant withdrawal'};
  await f.ok('POST',f.base+'/field-grants',withdraw);assert.equal((await f.req('POST',f.base+'/field-grants/prepare',{deviceId:f.context.device.id})).statusCode,409);assert.equal((await f.req('POST',f.base+'/field-captures',frozen.body)).statusCode,409);
  await f.ok('POST',f.base+'/field-grants',{...withdraw,id:randomUUID(),expectedVersion:2,state:'granted',reason:'Explicit reviewer restoration of fictional scope'});assert.equal((await f.req('POST',f.base+'/field-captures',frozen.body)).statusCode,409);
  const current=await f.ok('GET',f.base+'/field-context/'+f.context.device.id) as FieldContext;assert.equal(current.grant!.version,3);const fresh=f.original(current);const receipt=await f.ok('POST',f.base+'/field-captures',fresh.body);assert.equal(receipt.acceptance.authority.grantVersion,3);
  const history=await f.ok('GET',f.base+'/field-grants/'+userId+'/'+f.context.device.id+'/history');assert.deepEqual(history.items.map((v:{state:string})=>v.state),['granted','withdrawn','granted']);assert.equal((await f.pool.query('SELECT count(*)::int n FROM evidence WHERE case_id=$1',[f.caseId])).rows[0].n,1);
 }finally{await f.close();}
});
test('lost-device recovery preserves old source authority and bytes with independent current target review and acceptance fences',async()=>{
 const f=await fixture();try{
  const frozen=f.original(),reviewer=await f.member(),outsider=await f.member(false),lost={id:randomUUID(),expectedVersion:1,state:'lost',reason:'Fictional source device declared lost'};
  await f.ok('POST','/api/field/device-control/'+userId+'/'+f.context.device.id+'/state',lost);await f.approve();const target=await f.device(),request={id:randomUUID(),manifest:frozen.manifest,target:f.sync(target),reason:'Recover retained fictional original under independently reviewed current scope'};
  const proposal=await f.ok('POST',f.base+'/field-recoveries',request);assert.equal(proposal.manifest.authorityVersion,1);const review={id:randomUUID(),decision:'approve',scopeConfirmed:true,reason:'Independently compared fictional original and current recovery scope'};
  assert.equal((await f.req('POST',f.base+'/field-recoveries/'+request.id+'/review',review)).statusCode,403);assert.equal((await f.req('POST',f.base+'/field-recoveries/'+request.id+'/review',review,outsider.headers)).statusCode,404);
  await f.admin.query("CREATE FUNCTION deny_recovery_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='field.recovery_reviewed' THEN RAISE EXCEPTION 'fictional review audit failure'; END IF; RETURN NEW; END $$");await f.admin.query('CREATE TRIGGER deny_recovery_review BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_recovery_review()');
  try{assert.equal((await f.req('POST',f.base+'/field-recoveries/'+request.id+'/review',review,reviewer.headers)).statusCode,500);assert.equal((await f.pool.query('SELECT count(*)::int n FROM field_recovery_reviews WHERE case_id=$1',[f.caseId])).rows[0].n,0);}finally{await f.admin.query('DROP TRIGGER deny_recovery_review ON audit_events');await f.admin.query('DROP FUNCTION deny_recovery_review()');}
  await f.ok('POST',f.base+'/field-recoveries/'+request.id+'/review',review,reviewer.headers);const delivery={...frozen.body,recoveryId:request.id};
  await f.admin.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[tenantId,f.caseId,reviewer.id]);assert.equal((await f.req('POST',f.base+'/field-captures',delivery)).statusCode,409);await f.admin.query('INSERT INTO case_memberships(tenant_id,case_id,user_id) VALUES($1,$2,$3)',[tenantId,f.caseId,reviewer.id]);
  assert.equal((await f.req('POST',f.base+'/field-captures',{...delivery,manifest:{...frozen.manifest,sourceTime:'2026-10-02T08:00:00Z'}})).statusCode,409);
  const receipt=await f.ok('POST',f.base+'/field-captures',delivery);assert.equal(receipt.capture.authorityVersion,1);assert.equal(receipt.evidence.authorityVersion,2);assert.deepEqual(receipt.acceptance.authority,f.sync(target));assert.equal(receipt.acceptance.reviewerId,reviewer.id);assert.equal(receipt.evidence.sourceTime,frozen.manifest.sourceTime);
  assert.equal((await f.req('GET',f.base+'/evidence/'+receipt.evidence.id+'/original')).rawPayload.equals(frozen.bytes),true);assert.deepEqual((await f.pool.query('SELECT manifest FROM field_captures WHERE case_id=$1',[f.caseId])).rows[0].manifest,frozen.manifest);
  await f.ok('POST','/api/field/device-control/'+userId+'/'+target.device.id+'/state',{id:randomUUID(),expectedVersion:1,state:'revoked',reason:'Fictional target revoked after accepted original'});
  assert.equal((await f.req('POST',f.base+'/field-captures',delivery)).statusCode,409);assert.deepEqual(await f.ok('GET',f.base+'/field-captures/'+frozen.manifest.id+'/receipt'),receipt);
 }finally{await f.close();}
});
test('actual lost HTTP response recovers exact Field receipt after device revocation without accepting another original',async()=>{
 const f=await fixture();let proxy:ReturnType<typeof createServer>|undefined;try{
  const raw=f.original(),address=await f.app.listen({port:0,host:'127.0.0.1'});let drop=true;proxy=createServer((request,response)=>{forwardBrowserApi(request,response,address+request.url,status=>drop&&request.method==='POST'&&status===200?'drop':undefined);});await new Promise<void>(resolve=>proxy!.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+(proxy.address() as {port:number}).port;
  await assert.rejects(fetch(url+f.base+'/field-captures',{method:'POST',headers:{...f.headers,'content-type':'application/json'},body:JSON.stringify(raw.body)}));drop=false;assert.equal((await f.pool.query('SELECT count(*)::int n FROM field_captures WHERE case_id=$1',[f.caseId])).rows[0].n,1);
  await f.ok('POST','/api/field/device-control/'+userId+'/'+f.context.device.id+'/state',{id:randomUUID(),expectedVersion:1,state:'revoked',reason:'Fictional device revoked after ambiguous transport response'});assert.equal((await f.req('POST',f.base+'/field-captures',raw.body)).statusCode,409);
  const response=await fetch(url+f.base+'/field-captures/'+raw.manifest.id+'/receipt',{headers:f.headers});assert.equal(response.status,200);const receipt=await response.json() as {capture:{id:string};evidence:{digest:string}};assert.equal(receipt.capture.id,raw.manifest.id);assert.equal(receipt.evidence.digest,raw.manifest.expectedSha256);assert.equal((await f.pool.query('SELECT count(*)::int n FROM evidence WHERE case_id=$1',[f.caseId])).rows[0].n,1);
 }finally{if(proxy){proxy.closeAllConnections();await new Promise<void>(resolve=>proxy!.close(()=>resolve()));}await f.close();}
});
