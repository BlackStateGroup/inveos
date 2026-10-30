/** Fictional disposable API fixtures only. Never qualifies a parser or provider. */
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {createApp} from '../../src/app.js';
import {createPool,runMigrations} from '../../src/db.js';
export const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export async function sourceDatabase(){
 const database=process.env.INVEOS_TEST_DATABASE_URL,adminDatabase=process.env.INVEOS_TEST_ADMIN_DATABASE_URL;assert.ok(database&&adminDatabase);assert.match(database,/\/inveos_test(?:\?|$)/);assert.match(adminDatabase,/\/inveos_test(?:\?|$)/);
 const schema='source_family_'+randomUUID().replaceAll('-',''),admin=createPool(adminDatabase,'public',2);await runMigrations(admin,schema);const schemaAdmin=createPool(adminDatabase,schema,2),pool=createPool(database,schema,2),storage=await mkdtemp('/tmp/inveos-source-family-');
 assert.equal((await pool.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper,false);
 return {schema,admin:schemaAdmin,pool,storage,async close(){await pool.end();await schemaAdmin.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();await rm(storage,{recursive:true,force:true});}};
}
export type SourceDatabase=Awaited<ReturnType<typeof sourceDatabase>>;
export async function sourceScenario(db:SourceDatabase){
 const tenantId=randomUUID(),origin='http://localhost:5173';await db.admin.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenantId,'Fictional source acceptance agency']);
 const member=async(role:string)=>{const userId=randomUUID(),token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');await db.admin.query('INSERT INTO users(id,display_name) VALUES($1,$2)',[userId,'Fictional '+role]);await db.admin.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenantId,userId,role]);await db.admin.query("INSERT INTO sessions(token_hash,id,csrf_hash,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '2 hours')",[hash(token),randomUUID(),hash(csrf),tenantId,userId]);return {userId,token,csrf,cookie:`inveos_session=${token}; inveos_csrf=${csrf}`};};
 const owner=await member('reviewer'),reviewer=await member('reviewer'),author=await member('investigator'),recipient=await member('client');
 const app=await createApp({pool:db.pool,storageRoot:db.storage,allowedOrigins:[origin],demoTenantId:tenantId,demoUserId:owner.userId,sessionTtlSeconds:3600,documentLab:true});app.addHook('onError',(_request,_reply,error,done)=>{if(!(error as {statusCode?:number}).statusCode)console.error('Fictional acceptance error:',error);done();});await app.ready();
 const get=async(url:string,s=author)=>{if(process.env.INVEOS_ACCEPTANCE_TRACE)console.error('GET',url);const r=await app.inject({method:'GET',url,headers:{cookie:s.cookie}});if(process.env.INVEOS_ACCEPTANCE_TRACE)console.error(r.statusCode);return r;},post=async(url:string,payload:object,s=author)=>{if(process.env.INVEOS_ACCEPTANCE_TRACE)console.error('POST',url);const r=await app.inject({method:'POST',url,headers:{origin,cookie:s.cookie,'x-csrf-token':s.csrf,'content-type':'application/json'},payload});if(process.env.INVEOS_ACCEPTANCE_TRACE)console.error(r.statusCode);return r;};
 const created=await post('/api/cases',{title:'Fictional source-family acceptance',client:'Fictional client',scope:'Supplied fictional sources and synthetic Tika contracts only; no parser qualification.',jurisdiction:'Development'},owner);assert.equal(created.statusCode,200,created.body);const caseId=created.json().id as string;
 for(const member of [reviewer,author])await db.admin.query('INSERT INTO case_memberships(tenant_id,case_id,user_id) VALUES($1,$2,$3)',[tenantId,caseId,member.userId]);
 const authorityInput={purpose:'Fictional integration acceptance only',lawfulBasis:'Synthetic supplied fixtures; no provider approval',scope:'Bounded fictional PDFs and response fixtures',retentionDays:30,minimisation:'Only fictional source contract bytes'};
 const ar=await post(`/api/cases/${caseId}/authority`,authorityInput,owner);assert.equal(ar.statusCode,200,ar.body);
 return {db,app,tenantId,caseId,owner,reviewer,author,recipient,member,get,post,authorityInput};
}
