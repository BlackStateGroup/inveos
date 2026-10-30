import {randomUUID} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import type {Actor} from './app.js';
import type {DesktopIntakeFile,DesktopIntakeBatch} from '@inveos/contracts';
import {collectionOpen,type LifecycleCase} from './case-lifecycle.js';
import {inTransaction} from './db.js';
import {ApiError,notFound} from './errors.js';
import {transcriptHash as hash} from './transcript-findings.js';
type Services={pool:Pool;assertSession:(c:PoolClient,a:Actor)=>Promise<void>;authenticate:(r:FastifyRequest)=>Promise<void>;requireCsrf:(r:FastifyRequest)=>Promise<void>;findCase:(c:PoolClient,a:Actor,id:string,lock?:boolean)=>Promise<LifecycleCase>;validFilename:(s:string,b:boolean)=>boolean;validSourceTime:(s:string)=>boolean;audit:(c:PoolClient,a:Actor,caseId:string,action:string,type:string,id:string,summary:string)=>Promise<void>};
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'},params={type:'object',additionalProperties:false,required:['caseId'],properties:{caseId:uuid}};
export async function checkDesktopIntake(c:PoolClient,a:Actor,caseId:string,key:string,metadata:Record<string,unknown>,byteLength:number,authorityVersion:number){
 const row=(await c.query('SELECT e.*,b.authority_version,b.request_hash FROM desktop_intake_entries e JOIN desktop_intake_batches b ON b.tenant_id=e.tenant_id AND b.case_id=e.case_id AND b.id=e.batch_id WHERE e.tenant_id=$1 AND e.case_id=$2 AND e.request_key=$3 AND b.created_by=$4',[a.tenantId,caseId,key,a.userId])).rows[0];
 if(row){const entries=(await c.query('SELECT metadata,byte_length,ordinal FROM desktop_intake_entries WHERE tenant_id=$1 AND case_id=$2 AND batch_id=$3 ORDER BY ordinal',[a.tenantId,caseId,row.batch_id])).rows;if(entries.some((r,i)=>r.ordinal!==i)||hash({id:row.batch_id,files:entries.map(r=>({...r.metadata,byteLength:r.byte_length}))})!==row.request_hash.trim())throw new ApiError(409,'Saved batch manifest changed.');}
 if(row&&(row.authority_version!==authorityVersion||row.byte_length!==byteLength||hash(row.metadata)!==hash(metadata)))throw new ApiError(409,'Batch metadata or current authority differs. Keep the originals; create a new explicit batch under current scope.');
}
export function registerDesktopIntake(app:FastifyInstance,s:Services){
 const base='/api/cases/:caseId/intake-batches',internal=async(r:FastifyRequest)=>{await s.authenticate(r);if(r.actor!.role==='client')throw new ApiError(403,'Internal original intake only.');};
 const tx=<T>(r:FastifyRequest,f:(c:PoolClient)=>Promise<T>)=>inTransaction(s.pool,async c=>{await c.query("SET LOCAL statement_timeout='5s'");await c.query("SET LOCAL lock_timeout='2s'");await s.assertSession(c,r.actor!);const value=await f(c);await s.assertSession(c,r.actor!);return value;});
 async function load(c:PoolClient,a:Actor,caseId:string,id:string):Promise<DesktopIntakeBatch>{
  const kase=await s.findCase(c,a,caseId),batch=(await c.query('SELECT * FROM desktop_intake_batches WHERE tenant_id=$1 AND case_id=$2 AND id=$3 AND created_by=$4',[a.tenantId,caseId,id,a.userId])).rows[0];if(!batch)notFound();
  const entries=(await c.query(`SELECT e.*,u.id reservation_id,u.status,u.evidence_id,u.expires_at FROM desktop_intake_entries e LEFT JOIN upload_reservations u ON u.tenant_id=e.tenant_id AND u.case_id=e.case_id AND u.created_by=$4 AND u.idempotency_key=e.request_key WHERE e.tenant_id=$1 AND e.case_id=$2 AND e.batch_id=$3 ORDER BY e.ordinal`,[a.tenantId,caseId,id,a.userId])).rows;
  if(!entries.length||entries.length>20||entries.some((r,i)=>r.ordinal!==i))throw new ApiError(409,'Batch entry history is incomplete.');
  if(hash({id,files:entries.map(r=>({...r.metadata,byteLength:r.byte_length}))})!==batch.request_hash.trim())throw new ApiError(409,'Saved batch manifest changed.');
  return {id,caseId,createdAt:batch.created_at.toISOString(),authorityVersion:batch.authority_version,canTransfer:collectionOpen(kase)&&batch.authority_version===kase.authority_version,entries:entries.map(r=>({...r.metadata,byteLength:r.byte_length,ordinal:r.ordinal,requestKey:r.request_key,reservationId:r.reservation_id??null,state:r.status==='open'&&r.expires_at<=new Date()?'expired':r.status??'pending',evidenceId:r.evidence_id??null})),interpretation:'saved_metadata_not_original_verification'};
 }
 app.get(base,{preHandler:internal,schema:{params,querystring:{type:'object',additionalProperties:false,properties:{after:uuid}}}},r=>tx(r,async c=>{const a=r.actor!,{caseId}=r.params as {caseId:string},{after}=r.query as {after?:string};await s.findCase(c,a,caseId);const rows=(await c.query('SELECT id,created_at,authority_version FROM desktop_intake_batches WHERE tenant_id=$1 AND case_id=$2 AND created_by=$3 AND ($4::uuid IS NULL OR id>$4) ORDER BY id LIMIT 26',[a.tenantId,caseId,a.userId,after??null])).rows;return {items:rows.slice(0,25).map(v=>({id:v.id,createdAt:v.created_at.toISOString(),authorityVersion:v.authority_version})),next:rows.length>25?rows[24].id:null};}));
 app.get(base+'/:id',{preHandler:internal,schema:{params:{...params,required:['caseId','id'],properties:{...params.properties,id:uuid}}}},r=>tx(r,c=>{const {caseId,id}=r.params as {caseId:string;id:string};return load(c,r.actor!,caseId,id);}));
 app.post(base,{preHandler:[s.requireCsrf,internal],schema:{params,body:{type:'object',additionalProperties:false,required:['id','files'],properties:{id:uuid,files:{type:'array',minItems:1,maxItems:20,items:{type:'object',additionalProperties:false,required:['filename','sourceTime','method','expectedSha256','byteLength'],properties:{filename:{type:'string',minLength:5,maxLength:128},sourceTime:{type:'string',maxLength:64},method:{type:'string',minLength:5,maxLength:500},expectedSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},byteLength:{type:'integer',minimum:1,maximum:262144}}}}}}}},r=>tx(r,async c=>{
  const a=r.actor!,{caseId}=r.params as {caseId:string},q=r.body as {id:string;files:DesktopIntakeFile[]};
  if(q.files.some(f=>!s.validFilename(f.filename,true)||!s.validSourceTime(f.sourceTime)||f.method.trim().length<5||/[\u0000-\u001f\u007f-\u009f]/u.test(f.method)))throw new ApiError(422,'Declare valid original filenames, source timestamps and acquisition methods for every file.');
  const kase=await s.findCase(c,a,caseId,true),requestHash=hash(q),old=(await c.query('SELECT created_by,request_hash FROM desktop_intake_batches WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,q.id])).rows[0];
  if(old){if(old.created_by!==a.userId||old.request_hash.trim()!==requestHash)throw new ApiError(409,'Batch request identity already used.');return load(c,a,caseId,q.id);}
  if(!collectionOpen(kase))throw new ApiError(409,'Current collection authority is required.');
  if((await c.query('SELECT count(*)::int n FROM desktop_intake_batches WHERE tenant_id=$1 AND case_id=$2 AND created_by=$3',[a.tenantId,caseId,a.userId])).rows[0].n>=1000)throw new ApiError(422,'Intake batch limit reached.');
  await c.query('INSERT INTO desktop_intake_batches(tenant_id,case_id,id,created_by,authority_version,request_hash) VALUES($1,$2,$3,$4,$5,$6)',[a.tenantId,caseId,q.id,a.userId,kase.authority_version,requestHash]);
  for(const [ordinal,file] of q.files.entries()){const {byteLength,...metadata}=file;await c.query('INSERT INTO desktop_intake_entries(tenant_id,case_id,batch_id,ordinal,request_key,metadata,byte_length) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)',[a.tenantId,caseId,q.id,ordinal,randomUUID(),JSON.stringify(metadata),byteLength]);}
  await s.audit(c,a,caseId,'intake.batch_registered','intake_batch',q.id,'Desktop batch metadata registered; bytes still require individual verified intake');return load(c,a,caseId,q.id);
 }));
}
