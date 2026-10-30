import {registerDesktopIntake,checkDesktopIntake} from './desktop-intake.js';
import {collectionOpen,type LifecycleCase} from './case-lifecycle.js';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import type {BinaryEvidenceInput,Evidence} from '@inveos/contracts';
import type {Actor} from './app.js';
import {inTransaction} from './db.js';
import {ApiError,notFound} from './errors.js';
type Services={pool:Pool;assertSession:(c:PoolClient,a:Actor)=>Promise<void>;authenticate:(r:FastifyRequest)=>Promise<void>;requireCsrf:(r:FastifyRequest)=>Promise<void>;
 findCase:(c:PoolClient,a:Actor,id:string,lock?:boolean)=>Promise<LifecycleCase>;
 audit:(c:PoolClient,a:Actor,caseId:string,action:string,entity:string,id:string,summary:string,metadata?:Record<string,unknown>)=>Promise<void>;
 receive:(a:Actor,caseId:string,input:BinaryEvidenceInput,uploadId:string)=>Promise<Evidence>;
 receipt:(a:Actor,caseId:string,id:string)=>Promise<Evidence>;
 validFilename:(s:string,b:boolean)=>boolean;validSourceTime:(s:string)=>boolean};
const uuid={type:'string',pattern:'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-8][a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$'};
const caseParams={type:'object',required:['caseId'],additionalProperties:false,properties:{caseId:uuid}};
const params={type:'object',required:['caseId','uploadId'],additionalProperties:false,properties:{caseId:uuid,uploadId:uuid}};
const empty={type:'object',additionalProperties:false,maxProperties:0};
// Shared exact-range/canonical encoding primitives; callers retain their own access fences.
export function decodeUploadChunk(byteLength:number,ordinal:number,encoded:string){
 const bytes=Buffer.from(encoded,'base64'),length=Math.min(32768,byteLength-ordinal*32768);
 if(!Number.isInteger(ordinal)||ordinal<0||ordinal>7||length<1||bytes.length!==length||bytes.toString('base64')!==encoded)throw new ApiError(422,'Chunk must match its exact reserved range and canonical encoding.');
 return bytes;
}
export function assembleUploadChunks(byteLength:number,rows:Array<{ordinal:number;bytes:Buffer}>){
 if(rows.length!==Math.ceil(byteLength/32768)||rows.some((r,i)=>r.ordinal!==i||r.bytes.length!==Math.min(32768,byteLength-i*32768)))throw new ApiError(409,'Upload has missing chunks.');
 return Buffer.concat(rows.map(r=>r.bytes)).toString('base64');
}
export function registerUploads(app:FastifyInstance,s:Services){
 registerDesktopIntake(app,s);
 const tx=<T>(actor:Actor,fn:(c:PoolClient)=>Promise<T>)=>inTransaction(s.pool,async c=>{await s.assertSession(c,actor);const value=await fn(c);await s.assertSession(c,actor);return value;});
 const base='/api/cases/:caseId/uploads';
 // All lifecycle mutations take the same case lock as intake/finalisation.
 // Staging is transient; reservation identity and completed evidence are retained.
 app.get(base,{preHandler:s.authenticate,schema:{params:caseParams}},async(request,reply)=>{
  reply.header('Cache-Control','no-store');reply.header('X-Content-Type-Options','nosniff');
  const actor=request.actor!,{caseId}=request.params as {caseId:string};
  if(actor.role==='client')throw new ApiError(403,'Internal intake only.');
  return tx(actor,async c=>{
   await s.findCase(c,actor,caseId);
   const rows=await c.query(`SELECT id,case_id,status,byte_length,authority_version,expires_at,evidence_id,
     created_by=$3 AS owned,expires_at<=statement_timestamp() AS expired
     FROM upload_reservations WHERE tenant_id=$1 AND case_id=$2 AND status='open'
     AND ($4::boolean OR created_by=$3) ORDER BY expires_at,id LIMIT 10`,[actor.tenantId,caseId,actor.userId,actor.role==='reviewer']);
   return {canManage:actor.role==='reviewer',items:rows.rows.map(r=>({...dto(r),owned:r.owned,expired:r.expired}))};
  });
 });
 app.get(base+'/history',{preHandler:s.authenticate,schema:{params:caseParams,querystring:{type:'object',additionalProperties:false,properties:{before:uuid,limit:{type:'integer',minimum:1,maximum:50}}}}},async(request,reply)=>{
  reply.header('Cache-Control','no-store');reply.header('X-Content-Type-Options','nosniff');
  const actor=request.actor!,{caseId}=request.params as {caseId:string},{before,limit=25}=request.query as {before?:string;limit?:number};
  if(actor.role==='client')throw new ApiError(403,'Internal intake only.');
  return tx(actor,async c=>{
   await s.findCase(c,actor,caseId);
   // Resolve an opaque cursor inside the same visibility boundary; retain database timestamp precision.
   const scope=[actor.tenantId,caseId,actor.userId,actor.role==='reviewer'];
   let boundary:string|null=null;
   if(before){
    const cursor=await c.query(`SELECT created_at::text AS boundary FROM upload_reservations
     WHERE tenant_id=$1 AND case_id=$2 AND ($4::boolean OR created_by=$3) AND id=$5`,[...scope,before]);
    if(!cursor.rows[0])notFound();boundary=cursor.rows[0].boundary;
   }
   const result=await c.query(`SELECT id,case_id,status,byte_length,authority_version,created_at,expires_at,evidence_id,
    created_by=$3 AS owned FROM upload_reservations WHERE tenant_id=$1 AND case_id=$2
    AND ($4::boolean OR created_by=$3) AND ($5::timestamptz IS NULL OR (created_at,id)<($5::timestamptz,$6::uuid))
    ORDER BY created_at DESC,id DESC LIMIT $7`,[...scope,boundary,before??null,limit+1]);
   const rows=result.rows.slice(0,limit);
   return {caseId,items:rows.map(r=>({...dto(r),createdAt:r.created_at,owned:r.owned})),nextCursor:result.rows.length>limit?rows[rows.length-1].id:null};
  });
 });
 app.get(base+'/by-key/:requestKey',{preHandler:s.authenticate,schema:{params:{type:'object',additionalProperties:false,required:['caseId','requestKey'],properties:{caseId:uuid,requestKey:uuid}}}},async(request,reply)=>{
  reply.header('Cache-Control','no-store');const actor=request.actor!,{caseId,requestKey}=request.params as {caseId:string;requestKey:string};
  if(actor.role==='client')throw new ApiError(403,'Internal intake only.');
  return tx(actor,async c=>{
   await s.findCase(c,actor,caseId);
   const found=await c.query('SELECT * FROM upload_reservations WHERE tenant_id=$1 AND case_id=$2 AND created_by=$3 AND idempotency_key=$4',[actor.tenantId,caseId,actor.userId,requestKey]);
   if(!found.rows[0])notFound();return {...dto(found.rows[0]),requestKey};
  });
 });
 app.post(base+'/expire',{preHandler:s.requireCsrf,schema:{params:caseParams,body:{type:'object',additionalProperties:false,required:['limit'],properties:{limit:{type:'integer',minimum:1,maximum:10}}}}},async(request,reply)=>{
  reply.header('Cache-Control','no-store');const actor=request.actor!,{caseId}=request.params as {caseId:string};
  if(actor.role!=='reviewer')throw new ApiError(403,'Reviewer required for staging maintenance.');
  const {limit}=request.body as {limit:number};
  return tx(actor,async c=>{
   await c.query("SET LOCAL lock_timeout='2s'");await c.query("SET LOCAL statement_timeout='5s'");
   await s.findCase(c,actor,caseId,true);
   const rows=await c.query(`SELECT id FROM upload_reservations WHERE tenant_id=$1 AND case_id=$2
    AND status='open' AND expires_at<=statement_timestamp() ORDER BY expires_at,id LIMIT $3 FOR UPDATE`,[actor.tenantId,caseId,limit]);
   for(const row of rows.rows){
    const keys=[actor.tenantId,caseId,row.id];
    await c.query("UPDATE upload_reservations SET status='cancelled' WHERE tenant_id=$1 AND case_id=$2 AND id=$3",keys);
    const removed=await c.query('DELETE FROM upload_chunks WHERE tenant_id=$1 AND case_id=$2 AND upload_id=$3',keys);
    await s.audit(c,actor,caseId,'upload.expired','upload',row.id,'Expired upload closed; staging bytes removed',{removedChunks:removed.rowCount});
   }
   return {caseId,expired:rows.rows.map(r=>r.id as string)};
  });
 });
 app.post(base+'/:uploadId/reviewer-cancel',{preHandler:s.requireCsrf,schema:{params,body:{type:'object',additionalProperties:false,required:['reason'],properties:{reason:{type:'string',minLength:10,maxLength:500}}}}},async(request,reply)=>{
  reply.header('Cache-Control','no-store');const actor=request.actor!,{caseId,uploadId}=request.params as {caseId:string;uploadId:string};
  if(actor.role!=='reviewer')throw new ApiError(403,'Reviewer required for staging maintenance.');
  const reason=(request.body as {reason:string}).reason.trim();if(reason.length<10)throw new ApiError(422,'Explain why this pending upload must be cancelled.');
  return tx(actor,async c=>{
   await c.query("SET LOCAL lock_timeout='2s'");await c.query("SET LOCAL statement_timeout='5s'");
   await s.findCase(c,actor,caseId,true);const keys=[actor.tenantId,caseId,uploadId];
   const found=await c.query('SELECT * FROM upload_reservations WHERE tenant_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE',keys),row=found.rows[0];if(!row)notFound();
   if(row.status==='completed')throw new ApiError(409,'Completed originals cannot be cancelled as staging.');
   if(row.status==='open'){
    await c.query("UPDATE upload_reservations SET status='cancelled' WHERE tenant_id=$1 AND case_id=$2 AND id=$3",keys);
    const removed=await c.query('DELETE FROM upload_chunks WHERE tenant_id=$1 AND case_id=$2 AND upload_id=$3',keys);
    await s.audit(c,actor,caseId,'upload.reviewer_cancelled','upload',uploadId,'Reviewer cancelled pending upload; staging bytes removed',{reason,removedChunks:removed.rowCount});row.status='cancelled';
   }
   return dto(row);
  });
 });
 app.post(base,{preHandler:s.requireCsrf,schema:{params:caseParams,body:{type:'object',additionalProperties:false,required:['filename','sourceTime','method','expectedSha256','byteLength','idempotencyKey'],properties:{filename:{type:'string',minLength:5,maxLength:128},sourceTime:{type:'string',maxLength:64},method:{type:'string',minLength:5,maxLength:500},expectedSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},byteLength:{type:'integer',minimum:1,maximum:262144},idempotencyKey:uuid}}}},async(request,reply)=>{
  reply.header('Cache-Control','no-store');const actor=request.actor!,{caseId}=request.params as {caseId:string};
  const input=request.body as Omit<BinaryEvidenceInput,'contentBase64'>&{byteLength:number};
  if(actor.role==='client')throw new ApiError(403,'Internal intake only.');
  if(!s.validFilename(input.filename,true)||!s.validSourceTime(input.sourceTime))throw new ApiError(422,'Invalid source metadata.');
  return tx(actor,async c=>{
   const kase=await s.findCase(c,actor,caseId,true);
   const metadata={filename:input.filename,sourceTime:input.sourceTime,method:input.method,expectedSha256:input.expectedSha256};
   const prior=await c.query('SELECT * FROM upload_reservations WHERE tenant_id=$1 AND case_id=$2 AND created_by=$3 AND idempotency_key=$4',[actor.tenantId,caseId,actor.userId,input.idempotencyKey]);
   if(prior.rows[0]){const row=prior.rows[0];if(row.byte_length!==input.byteLength||Object.entries(metadata).some(([k,v])=>row.metadata[k]!==v))throw new ApiError(409,'Reservation key already used.');return dto(row);}
   if(!collectionOpen(kase))throw new ApiError(409,'Approved authority required.');
   await checkDesktopIntake(c,actor,caseId,input.idempotencyKey,metadata,input.byteLength,kase.authority_version!);
   const count=await c.query("SELECT count(*)::int AS n FROM upload_reservations WHERE tenant_id=$1 AND case_id=$2 AND status='open'",[actor.tenantId,caseId]);
   if(count.rows[0].n>=10)throw new ApiError(409,'Cancel or complete outstanding reservations before reserving more.');
   const id=randomUUID();const row=await c.query('INSERT INTO upload_reservations(tenant_id,case_id,id,created_by,idempotency_key,authority_version,metadata,byte_length) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[actor.tenantId,caseId,id,actor.userId,input.idempotencyKey,kase.authority_version,metadata,input.byteLength]);
   await s.audit(c,actor,caseId,'upload.reserved','upload',id,'Bounded binary upload reserved');return dto(row.rows[0]);
  });
 });
 for(const action of ['status','chunk','cancel','complete'])app.route({method:action==='status'?'GET':'POST',url:base+'/:uploadId'+(action==='status'?'':'/'+action),preHandler:action==='status'?s.authenticate:s.requireCsrf,schema:{params,...(action==='status'?{}:{body:action==='chunk'?{type:'object',additionalProperties:false,required:['ordinal','contentBase64'],properties:{ordinal:{type:'integer',minimum:0,maximum:7},contentBase64:{type:'string',minLength:4,maxLength:43692}}}:empty})},handler:async(request,reply)=>{
  reply.header('Cache-Control','no-store');const actor=request.actor!,{caseId,uploadId}=request.params as {caseId:string;uploadId:string};
  if(actor.role==='client')throw new ApiError(403,'Internal intake only.');
  const result=await tx(actor,async c=>{
   const kase=await s.findCase(c,actor,caseId,true),keys=[actor.tenantId,caseId,uploadId];
   const found=await c.query('SELECT *,expires_at>clock_timestamp() AS live FROM upload_reservations WHERE tenant_id=$1 AND case_id=$2 AND id=$3 AND created_by=$4 FOR UPDATE',[...keys,actor.userId]);
   const row=found.rows[0];if(!row)notFound();
   if(action==='cancel'&&row.status==='open'){
    await c.query("UPDATE upload_reservations SET status='cancelled' WHERE tenant_id=$1 AND case_id=$2 AND id=$3",keys);
    await c.query('DELETE FROM upload_chunks WHERE tenant_id=$1 AND case_id=$2 AND upload_id=$3',keys);
    await s.audit(c,actor,caseId,'upload.cancelled','upload',uploadId,'Pending upload cancelled; staging bytes removed');row.status='cancelled';
   }
   if(action==='chunk'||(action==='complete'&&row.status!=='completed')){
    if(row.status!=='open'||!row.live||!collectionOpen(kase)||kase.authority_version!==row.authority_version)throw new ApiError(409,'Upload is closed, expired or authority changed.');
   }
   if(action==='chunk'){
    const input=request.body as {ordinal:number;contentBase64:string},bytes=decodeUploadChunk(row.byte_length,input.ordinal,input.contentBase64);
    const old=await c.query('SELECT bytes FROM upload_chunks WHERE tenant_id=$1 AND case_id=$2 AND upload_id=$3 AND ordinal=$4',[...keys,input.ordinal]);
    if(old.rows[0]&&!old.rows[0].bytes.equals(bytes))throw new ApiError(409,'Chunk already received with different bytes.');
    if(!old.rows[0]){await c.query('INSERT INTO upload_chunks VALUES($1,$2,$3,$4,$5)',[...keys,input.ordinal,bytes]);await s.audit(c,actor,caseId,'upload.chunk_received','upload',uploadId,`Chunk ${input.ordinal} received`);}
   }
   const chunks=await c.query('SELECT ordinal,bytes FROM upload_chunks WHERE tenant_id=$1 AND case_id=$2 AND upload_id=$3 ORDER BY ordinal',keys);
   if(action==='complete'&&row.status!=='completed'){
    return {input:{...row.metadata,idempotencyKey:row.id,contentBase64:assembleUploadChunks(row.byte_length,chunks.rows as Array<{ordinal:number;bytes:Buffer}>)} as BinaryEvidenceInput};
   }
   return {receipt:dto(row),evidenceId:row.evidence_id as string|null,received:chunks.rows.map(r=>r.ordinal as number)};
  });
  if('input' in result)return s.receive(actor,caseId,result.input!,uploadId);
  if(action==='complete'&&result.evidenceId)return s.receipt(actor,caseId,result.evidenceId);
  return {...result.receipt,received:result.received};
 }});
}
function dto(r:Record<string,unknown>){return {id:r.id,caseId:r.case_id,status:r.status,byteLength:r.byte_length,authorityVersion:r.authority_version,expiresAt:r.expires_at,evidenceId:r.evidence_id,chunkSize:32768};}
