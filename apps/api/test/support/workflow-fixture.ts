import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../../src/app.js';
import {createPool,runMigrations} from '../../src/db.js';
import type {InternalEvidenceRequest,PortalEvidenceRequest,PortalUpload} from '@inveos/contracts';
export const tenant='00000000-0000-4000-8000-000000000001',owner='00000000-0000-4000-8000-000000000002';
export const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
export type Session={cookie:string;'x-csrf-token':string;origin:string};
export async function workflowFixture(origin='http://localhost:5173'){
 const db=process.env.INVEOS_TEST_DATABASE_URL,adminUrl=process.env.INVEOS_TEST_ADMIN_DATABASE_URL;assert.ok(db&&adminUrl,'Restricted disposable PostgreSQL URLs required');assert.match(db,/\/inveos_test(?:\?|$)/);assert.match(adminUrl,/\/inveos_test(?:\?|$)/);
 const schema='workflow_'+randomUUID().replaceAll('-',''),admin=createPool(adminUrl,schema,3);await runMigrations(admin,schema);const pool=createPool(db,schema,6),root=await mkdtemp(join(tmpdir(),'inveos-workflow-'));
 assert.equal((await pool.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper,false);
 const app=await createApp({pool,storageRoot:root,allowedOrigins:[origin],demoTenantId:tenant,demoUserId:owner,sessionTtlSeconds:3600});
 async function session(id:string,tenantId=tenant):Promise<Session>{const token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');await admin.query("INSERT INTO sessions(token_hash,id,csrf_hash,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 hour')",[sha(token),randomUUID(),sha(csrf),tenantId,id]);return {cookie:`inveos_session=${token}; inveos_csrf=${csrf}`,'x-csrf-token':csrf,origin};}
 const maker=await session(owner);
 const call=(url:string,payload?:object,actor=maker)=>app.inject({method:payload?'POST':'GET',url,headers:actor,...(payload?{payload}:{})});
 async function must<T=Record<string,unknown>>(url:string,payload?:object,actor=maker):Promise<T>{const r=await call(url,payload,actor);assert.equal(r.statusCode,200,`${url}: ${r.body}`);return r.json<T>();}
 const kase=await must<{id:string}>('/api/cases',{title:'Fictional workflow acceptance case',client:'Fictional recipient agency',scope:'Only supplied fictional records for controlled workflow acceptance.',jurisdiction:'Synthetic laboratory'}),caseId=kase.id,base='/api/cases/'+caseId;
 const authority={purpose:'Fictional workflow acceptance only',lawfulBasis:'Synthetic records only; no real personal data.',scope:'Only supplied fictional records for controlled workflow acceptance.',retentionDays:30,minimisation:'Use bounded fictional records only.'};await must(base+'/authority',authority);
 async function member(role:string,assigned=false,tenantId=tenant){const id=randomUUID();await admin.query('INSERT INTO users(id,display_name) VALUES($1,$2)',[id,'Fictional '+role+' '+id.slice(0,8)]);await admin.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenantId,id,role]);if(assigned)await admin.query('INSERT INTO case_memberships(tenant_id,case_id,user_id) VALUES($1,$2,$3)',[tenantId,caseId,id]);return {id,headers:await session(id,tenantId)};}
 const reviewer=await member('reviewer',true),investigator=await member('investigator',true),client=await member('client');
 async function finding(text='Fictional supplier reported batch dispatch GBP 100 on 2026-10-01.'){
  const e=await must<{id:string}>(base+'/evidence',{filename:'fictional-source.txt',text,expectedSha256:sha(text),sourceTime:'2026-10-01T09:00:00+02:00',method:'Supplied fictional acceptance record',idempotencyKey:randomUUID()},investigator.headers);
  const claim=await must<{id:string}>(base+'/claims',{evidenceId:e.id,text:'The fictional supplied record states: '+text,quote:text},investigator.headers);await must(base+'/claims/'+claim.id+'/review',{accepted:true,reason:'The exact fictional quote supports this attributed statement.'},reviewer.headers);
  return {evidenceId:e.id,claimId:claim.id};
 }
 async function request(expiresInMs=3600000){const input={id:randomUUID(),recipientId:client.id,expiresAt:new Date(Date.now()+expiresInMs).toISOString(),title:'Fictional supplied dispatch note',instructions:'Supply only the fictional dispatch note described here, with explicit source time and permission declarations.',reason:'Fictional separate recipient instructions; INTERNAL SECRET CONTEXT stays private.'};let g=await must<InternalEvidenceRequest>(base+'/evidence-requests',input,investigator.headers);
  const publish={id:randomUUID(),expectedSequence:0,version:1,sha256:g.draft.sha256,action:'published',reason:'Independently reviewed fictional recipient instructions.',confirmRecipientContent:true};await must(base+'/evidence-requests/'+g.id+'/publications',publish,reviewer.headers);g=await must<InternalEvidenceRequest>(base+'/evidence-requests/'+g.id);
  const external='/api/portal/evidence-requests/'+g.id,responseInput={id:randomUUID(),publicationId:g.publication!.id,publicationSha256:g.publication!.sha256,expectedSequence:0,state:'submitted',body:'Fictional recipient supplied this note for assessment only.',reason:'Fictional initial supplied-material response.'};const response=await must<PortalEvidenceRequest>(external+'/responses',responseInput,client.headers);return {g,input,publish,external,response,responseInput};}
 async function reserve(q:Awaited<ReturnType<typeof request>>,bytes=Buffer.from('Fictional supplied original bytes.'),extra:Record<string,unknown>={}){const input={idempotencyKey:randomUUID(),publicationId:q.g.publication!.id,publicationSha256:q.g.publication!.sha256,responseId:q.response.responses.at(-1)!.id,filename:'fictional-supplied.bin',sourceTime:'2026-10-01T09:15:00+02:00',method:'Fictional recipient selected an existing supplied file.',consentDeclaration:'Fictional permission declaration only; assess scope independently.',expectedSha256:sha(bytes),byteLength:bytes.length,...extra};return {u:await must<PortalUpload>(q.external+'/uploads',input,client.headers),input,bytes};}
 async function chunks(q:Awaited<ReturnType<typeof request>>,r:Awaited<ReturnType<typeof reserve>>){for(let i=0;i<Math.ceil(r.bytes.length/32768);i++)await must(q.external+'/uploads/'+r.u.id+'/chunk',{ordinal:i,contentBase64:r.bytes.subarray(i*32768,(i+1)*32768).toString('base64')},client.headers);}
 async function handling(sharing:'internal_only'|'existing_release_controls',actor=maker){const h=await must<{version:number;authorityVersion:number}>(base+'/handling');return must(base+'/handling',{id:randomUUID(),expectedVersion:h.version,expectedAuthorityVersion:h.authorityVersion,tier:'restricted',sharing,instructions:'Fictional internal handling instructions.',reason:'Fictional explicit case sharing decision.'},actor);}
 return {schema,admin,pool,app,root,caseId,base,authority,maker,reviewer,investigator,client,call,must,session,member,finding,request,reserve,chunks,handling,async close(){await app.close();await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();await rm(root,{recursive:true,force:true});}};
}
