import {randomUUID} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import type {BinaryEvidenceInput,Evidence} from '@inveos/contracts';
import type {Actor} from './app.js';
import {inTransaction} from './db.js';
import {ApiError,notFound} from './errors.js';
type Services={pool:Pool;authenticate:(r:FastifyRequest)=>Promise<void>;requireCsrf:(r:FastifyRequest)=>Promise<void>;
 findCase:(c:PoolClient,a:Actor,id:string,lock?:boolean)=>Promise<{status:string;authority_version:number|null}>;
 audit:(c:PoolClient,a:Actor,caseId:string,action:string,entity:string,id:string,summary:string)=>Promise<void>;
 receive:(a:Actor,caseId:string,input:BinaryEvidenceInput,uploadId:string)=>Promise<Evidence>;
 receipt:(a:Actor,caseId:string,id:string)=>Promise<Evidence>;
 validFilename:(s:string,b:boolean)=>boolean;validSourceTime:(s:string)=>boolean};
const uuid={type:'string',pattern:'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-8][a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$'};
const caseParams={type:'object',required:['caseId'],additionalProperties:false,properties:{caseId:uuid}};
const params={type:'object',required:['caseId','uploadId'],additionalProperties:false,properties:{caseId:uuid,uploadId:uuid}};
const empty={type:'object',additionalProperties:false,maxProperties:0};
export function registerUploads(app:FastifyInstance,s:Services){
 const base='/api/cases/:caseId/uploads';
 app.post(base,{preHandler:s.requireCsrf,schema:{params:caseParams,body:{type:'object',additionalProperties:false,required:['filename','sourceTime','method','expectedSha256','byteLength','idempotencyKey'],properties:{filename:{type:'string',minLength:5,maxLength:128},sourceTime:{type:'string',maxLength:64},method:{type:'string',minLength:5,maxLength:500},expectedSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},byteLength:{type:'integer',minimum:1,maximum:262144},idempotencyKey:uuid}}}},async(request,reply)=>{
  reply.header('Cache-Control','no-store');const actor=request.actor!,{caseId}=request.params as {caseId:string};
  const input=request.body as Omit<BinaryEvidenceInput,'contentBase64'>&{byteLength:number};
  if(actor.role==='client')throw new ApiError(403,'Internal intake only.');
  if(!s.validFilename(input.filename,true)||!s.validSourceTime(input.sourceTime))throw new ApiError(422,'Invalid source metadata.');
  return inTransaction(s.pool,async c=>{
   const kase=await s.findCase(c,actor,caseId,true);
   const metadata={filename:input.filename,sourceTime:input.sourceTime,method:input.method,expectedSha256:input.expectedSha256};
   const prior=await c.query('SELECT * FROM upload_reservations WHERE tenant_id=$1 AND case_id=$2 AND created_by=$3 AND idempotency_key=$4',[actor.tenantId,caseId,actor.userId,input.idempotencyKey]);
   if(prior.rows[0]){const row=prior.rows[0];if(row.byte_length!==input.byteLength||Object.entries(metadata).some(([k,v])=>row.metadata[k]!==v))throw new ApiError(409,'Reservation key already used.');return dto(row);}
   if(kase.status!=='Active'||!kase.authority_version)throw new ApiError(409,'Approved authority required.');
   const count=await c.query("SELECT count(*)::int AS n FROM upload_reservations WHERE tenant_id=$1 AND case_id=$2 AND status='open'",[actor.tenantId,caseId]);
   if(count.rows[0].n>=10)throw new ApiError(409,'Cancel or complete outstanding reservations before reserving more.');
   const id=randomUUID();const row=await c.query('INSERT INTO upload_reservations(tenant_id,case_id,id,created_by,idempotency_key,authority_version,metadata,byte_length) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[actor.tenantId,caseId,id,actor.userId,input.idempotencyKey,kase.authority_version,metadata,input.byteLength]);
   await s.audit(c,actor,caseId,'upload.reserved','upload',id,'Bounded binary upload reserved');return dto(row.rows[0]);
  });
 });
 for(const action of ['status','chunk','cancel','complete'])app.route({method:action==='status'?'GET':'POST',url:base+'/:uploadId'+(action==='status'?'':'/'+action),preHandler:action==='status'?s.authenticate:s.requireCsrf,schema:{params,...(action==='status'?{}:{body:action==='chunk'?{type:'object',additionalProperties:false,required:['ordinal','contentBase64'],properties:{ordinal:{type:'integer',minimum:0,maximum:7},contentBase64:{type:'string',minLength:4,maxLength:43692}}}:empty})},handler:async(request,reply)=>{
  reply.header('Cache-Control','no-store');const actor=request.actor!,{caseId,uploadId}=request.params as {caseId:string;uploadId:string};
  if(actor.role==='client')throw new ApiError(403,'Internal intake only.');
  const result=await inTransaction(s.pool,async c=>{
   const kase=await s.findCase(c,actor,caseId,true),keys=[actor.tenantId,caseId,uploadId];
   const found=await c.query('SELECT *,expires_at>clock_timestamp() AS live FROM upload_reservations WHERE tenant_id=$1 AND case_id=$2 AND id=$3 AND created_by=$4 FOR UPDATE',[...keys,actor.userId]);
   const row=found.rows[0];if(!row)notFound();
   if(action==='cancel'&&row.status==='open'){
    await c.query("UPDATE upload_reservations SET status='cancelled' WHERE tenant_id=$1 AND case_id=$2 AND id=$3",keys);
    await c.query('DELETE FROM upload_chunks WHERE tenant_id=$1 AND case_id=$2 AND upload_id=$3',keys);
    await s.audit(c,actor,caseId,'upload.cancelled','upload',uploadId,'Pending upload cancelled; staging bytes removed');row.status='cancelled';
   }
   if(action==='chunk'||(action==='complete'&&row.status!=='completed')){
    if(row.status!=='open'||!row.live||kase.status!=='Active'||kase.authority_version!==row.authority_version)throw new ApiError(409,'Upload is closed, expired or authority changed.');
   }
   if(action==='chunk'){
    const input=request.body as {ordinal:number;contentBase64:string},bytes=Buffer.from(input.contentBase64,'base64');
    const length=Math.min(32768,row.byte_length-input.ordinal*32768);
    if(length<1||bytes.length!==length||bytes.toString('base64')!==input.contentBase64)throw new ApiError(422,'Chunk must match its exact reserved range and canonical encoding.');
    const old=await c.query('SELECT bytes FROM upload_chunks WHERE tenant_id=$1 AND case_id=$2 AND upload_id=$3 AND ordinal=$4',[...keys,input.ordinal]);
    if(old.rows[0]&&!old.rows[0].bytes.equals(bytes))throw new ApiError(409,'Chunk already received with different bytes.');
    if(!old.rows[0]){await c.query('INSERT INTO upload_chunks VALUES($1,$2,$3,$4,$5)',[...keys,input.ordinal,bytes]);await s.audit(c,actor,caseId,'upload.chunk_received','upload',uploadId,`Chunk ${input.ordinal} received`);}
   }
   const chunks=await c.query('SELECT ordinal,bytes FROM upload_chunks WHERE tenant_id=$1 AND case_id=$2 AND upload_id=$3 ORDER BY ordinal',keys);
   if(action==='complete'&&row.status!=='completed'){
    if(chunks.rows.length!==Math.ceil(row.byte_length/32768)||chunks.rows.some((r,i)=>r.ordinal!==i))throw new ApiError(409,'Upload has missing chunks.');
    return {input:{...row.metadata,idempotencyKey:row.id,contentBase64:Buffer.concat(chunks.rows.map(r=>r.bytes)).toString('base64')} as BinaryEvidenceInput};
   }
   return {receipt:dto(row),evidenceId:row.evidence_id as string|null,received:chunks.rows.map(r=>r.ordinal as number)};
  });
  if('input' in result)return s.receive(actor,caseId,result.input!,uploadId);
  if(action==='complete'&&result.evidenceId)return s.receipt(actor,caseId,result.evidenceId);
  return {...result.receipt,received:result.received};
 }});
}
function dto(r:Record<string,unknown>){return {id:r.id,caseId:r.case_id,status:r.status,byteLength:r.byte_length,authorityVersion:r.authority_version,expiresAt:r.expires_at,evidenceId:r.evidence_id,chunkSize:32768};}
