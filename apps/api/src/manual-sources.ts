import {createHash} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import type {ManualSourceEntry,ManualSourceFields,ManualSourceOriginal,ManualSourceRecord,ManualSourceReview} from '@inveos/contracts';
import type {Actor} from './app.js';
import {validateAllegedTime} from './chronology.js';
import {inTransaction} from './db.js';
import {ApiError,notFound} from './errors.js';

type Services={pool:Pool;authenticate:(r:FastifyRequest)=>Promise<void>;requireCsrf:(r:FastifyRequest)=>Promise<void>;findCase:(c:PoolClient,a:Actor,id:string,lock?:boolean)=>Promise<unknown>;original:(c:PoolClient,a:Actor,caseId:string,id:string)=>Promise<ManualSourceOriginal>;audit:(c:PoolClient,a:Actor,caseId:string,action:string,entity:string,id:string,summary:string)=>Promise<void>};
const uuid={type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'},version={type:'integer',minimum:1,maximum:100};
const text=(maxLength:number,minLength=1)=>({type:'string',minLength,maxLength});
const fields={url:text(2048),publisher:text(300),retrievedAt:text(40),method:text(1000),trustGrade:{enum:['unassessed','primary_record','secondary_report','disputed']},termsReference:text(2000),purpose:text(1000),lawfulBasis:text(1000),scope:text(2000),retentionDays:{type:'integer',minimum:1,maximum:3650},minimisation:text(2000),annotation:text(4000)};
const body=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const params=body({caseId:uuid}),itemParams=body({caseId:uuid,id:uuid});
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,canonical(x)])):v;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const digest=(r:ManualSourceRecord)=>hash(Object.fromEntries(Object.entries(r).filter(([key])=>key!=='digest')));
function validText(...values:string[]){if(values.some(v=>!v.trim()||Buffer.from(v).toString('utf8')!==v||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v)))throw new ApiError(422,'Enter meaningful source context without control characters.');}
function validate(input:ManualSourceFields){
 validText(...Object.keys(fields).filter(k=>k!=='retentionDays').map(k=>input[k as keyof ManualSourceFields] as string));
 let url:URL;try{url=new URL(input.url);}catch{throw new ApiError(422,'Record a complete HTTP or HTTPS source URL.');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!/^https?:\/\//.test(input.url)||/[\s\\]/.test(input.url))throw new ApiError(422,'Record a complete HTTP or HTTPS URL without credentials or whitespace.');
 validateAllegedTime({precision:'instant',start:input.retrievedAt,end:null,timezone:'As supplied',note:'Reported retrieval time, not a server observation.'});
}
const internal=(a:Actor)=>{if(a.role==='client')throw new ApiError(403,'Internal source register only.');};
type Scope={status:string;authority_version:number};
async function rows(c:PoolClient,a:Actor,caseId:string,kase:Scope,id?:string,history=false):Promise<ManualSourceEntry[]>{
 const result=await c.query(`SELECT h.id,h.evidence_id,r.version,r.actor_id,r.recorded_at AS revision_at,r.snapshot,r.digest,
  v.id AS review_id,v.digest AS review_digest,v.accepted,v.reviewer_id,v.reviewer_name,v.reason,v.recorded_at AS review_at,
  EXISTS(SELECT 1 FROM manual_source_revisions authored WHERE authored.tenant_id=h.tenant_id AND authored.case_id=h.case_id AND authored.source_id=h.id AND authored.actor_id=$3) AS authored
  FROM manual_sources h JOIN manual_source_revisions r ON r.tenant_id=h.tenant_id AND r.case_id=h.case_id AND r.source_id=h.id ${history?'':'AND r.version=h.version'}
  LEFT JOIN manual_source_reviews v ON v.tenant_id=r.tenant_id AND v.case_id=r.case_id AND v.source_id=r.source_id AND v.version=r.version
  WHERE h.tenant_id=$1 AND h.case_id=$2 AND ($4::uuid IS NULL OR h.id=$4) ORDER BY h.id,r.version DESC LIMIT 201`,[a.tenantId,caseId,a.userId,id??null]);
 if(result.rows.length>200)throw new ApiError(422,'Source register query limit exceeded.');
 return result.rows.map(row=>{const record=row.snapshot as ManualSourceRecord;
  if(record.id!==row.id||record.caseId!==caseId||record.version!==row.version||record.original.id!==row.evidence_id||record.recordedBy!==row.actor_id||record.recordedAt!==row.revision_at.toISOString()||record.digest!==row.digest.trim()||record.digest!==digest(record))throw new ApiError(409,'Source register history is inconsistent.');
  const review:ManualSourceReview|null=row.review_id?{id:row.review_id,digest:row.review_digest.trim(),accepted:row.accepted,reviewerId:row.reviewer_id,reviewerName:row.reviewer_name,reason:row.reason,recordedAt:row.review_at.toISOString()}:null;
  if(review&&review.digest!==record.digest)throw new ApiError(409,'Source review does not bind the retained record.');
  return {record,review,state:record.withdrawn?'withdrawn':review&&!review.accepted?'record_rejected':kase.status!=='Active'||kase.authority_version!==record.original.authorityVersion?'authority_changed':review?.accepted?'record_accepted':'pending',canReview:a.role==='reviewer'&&!row.authored&&!review&&!record.withdrawn};
 });
}

export function registerManualSources(app:FastifyInstance,s:Services){
 const base='/api/cases/:caseId/manual-sources',read=async(r:FastifyRequest)=>{await s.authenticate(r);internal(r.actor!);};
 const transact=<T>(run:(c:PoolClient)=>Promise<T>)=>inTransaction(s.pool,async c=>{await c.query("SET LOCAL statement_timeout='2s'");return run(c);});
 const current=async(c:PoolClient,a:Actor,caseId:string,id?:string,history=false)=>{const kase=await s.findCase(c,a,caseId) as Scope;return rows(c,a,caseId,kase,id,history);};
 const check=async(c:PoolClient,a:Actor,caseId:string,record:ManualSourceRecord)=>{const original=await s.original(c,a,caseId,record.original.id);if(hash(original)!==hash(record.original))throw new ApiError(409,'Source original context changed. Review a corrected register record.');return original;};
 app.get(base,{preHandler:read,schema:{params}},async r=>transact(async c=>({collection:'supplied_capture_metadata_only',sourceVerification:'not_checked_on_listing',items:await current(c,r.actor!,(r.params as {caseId:string}).caseId)})));
 app.get(base+'/originals',{preHandler:read,schema:{params,querystring:{type:'object',additionalProperties:false,properties:{after:uuid}}}},async r=>transact(async c=>{const a=r.actor!,{caseId}=r.params as {caseId:string},{after}=r.query as {after?:string};await s.findCase(c,a,caseId);const items=(await c.query('SELECT id,filename,status FROM evidence WHERE tenant_id=$1 AND case_id=$2 AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT 51',[a.tenantId,caseId,after??null])).rows,more=items.length>50;if(more)items.pop();return {items,next:more?items.at(-1)!.id:null};}));
 const save=async(r:FastifyRequest,edit:boolean,withdraw=false)=>transact(async c=>{
  const a=r.actor!;internal(a);const {caseId,id:routeId}=r.params as {caseId:string;id?:string},input=r.body as ManualSourceFields&{id:string;evidenceId:string;expectedVersion:number;reason:string};
  if(!withdraw)validate(input);if(edit)validText(input.reason);const kase=await s.findCase(c,a,caseId,true) as Scope,entries=await rows(c,a,caseId,kase),id=edit?routeId!:input.id,old=entries.find(e=>e.record.id===id)?.record;
  const attributes=withdraw?{}:Object.fromEntries(Object.keys(fields).map(k=>[k,input[k as keyof ManualSourceFields]])),requestHash=hash([input.evidenceId,attributes]);
  if(!edit&&old){const existing=(await c.query('SELECT created_by,request_hash FROM manual_sources WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,id])).rows[0];if(existing.created_by!==a.userId||existing.request_hash.trim()!==requestHash)throw new ApiError(409,'Source register identity already used.');return old;}
  if(edit&&!old)notFound();if(edit&&old!.version!==input.expectedVersion)throw new ApiError(409,'Source record changed. Refresh and compare.');if(old&&old.version>=100)throw new ApiError(422,'Source revision limit reached.');if(!edit&&entries.length>=200)throw new ApiError(422,'Source register limit reached.');if(withdraw&&old!.withdrawn)throw new ApiError(409,'Source already withdrawn.');
  const original=withdraw?old!.original:await s.original(c,a,caseId,old?.original.id??input.evidenceId);
  if(!withdraw){if(kase.status!=='Active'||kase.authority_version!==original.authorityVersion)throw new ApiError(409,'Current case authority is required for active source records.');const authority=(await c.query('SELECT retention_days FROM authority_records WHERE tenant_id=$1 AND case_id=$2 AND id=$3 AND version=$4',[a.tenantId,caseId,original.authorityId,original.authorityVersion])).rows[0];if(!authority||input.retentionDays>authority.retention_days)throw new ApiError(422,'Source retention cannot exceed the approved case retention.');}
  const at=(await c.query('SELECT clock_timestamp() at')).rows[0].at.toISOString(),record:ManualSourceRecord={...(withdraw?old!:attributes as ManualSourceFields),id,caseId,version:old?old.version+1:1,original,recordedBy:a.userId,recordedAt:at,withdrawn:withdraw,digest:''};record.digest=digest(record);
  if(old)await c.query('UPDATE manual_sources SET version=$4 WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,id,record.version]);else await c.query('INSERT INTO manual_sources(tenant_id,case_id,id,evidence_id,created_by,request_hash) VALUES($1,$2,$3,$4,$5,$6)',[a.tenantId,caseId,id,original.id,a.userId,requestHash]);
  await c.query('INSERT INTO manual_source_revisions(tenant_id,case_id,source_id,version,snapshot,digest,actor_id,reason,recorded_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)',[a.tenantId,caseId,id,record.version,JSON.stringify(record),record.digest,a.userId,edit?input.reason:'Supplied capture context recorded',at]);await s.audit(c,a,caseId,withdraw?'manual_source.withdrawn':'manual_source.recorded','manual_source',id,`Manual source revision ${record.version}`);return record;
 });
 app.post(base,{preHandler:s.requireCsrf,schema:{params,body:body({id:uuid,evidenceId:uuid,...fields})}},r=>save(r,false));
 app.post(base+'/:id/revise',{preHandler:s.requireCsrf,schema:{params:itemParams,body:body({...fields,expectedVersion:version,reason:text(3000)})}},r=>save(r,true));
 app.post(base+'/:id/withdraw',{preHandler:s.requireCsrf,schema:{params:itemParams,body:body({expectedVersion:version,reason:text(3000)})}},r=>save(r,true,true));
 app.get(base+'/:id/history',{preHandler:read,schema:{params:itemParams}},async r=>transact(async c=>{const a=r.actor!,{caseId,id}=r.params as {caseId:string;id:string},entries=await current(c,a,caseId,id,true);if(!entries.length)notFound();const reasons=(await c.query('SELECT version,reason FROM manual_source_revisions WHERE tenant_id=$1 AND case_id=$2 AND source_id=$3 ORDER BY version DESC',[a.tenantId,caseId,id])).rows;return entries.map(e=>({...e,reason:reasons.find(v=>v.version===e.record.version)!.reason}));}));
 app.get(base+'/:id/original',{preHandler:read,schema:{params:itemParams}},async r=>transact(async c=>{const a=r.actor!,{caseId,id}=r.params as {caseId:string;id:string},entry=(await current(c,a,caseId,id))[0];if(!entry)notFound();const original=await check(c,a,caseId,entry.record);await s.audit(c,a,caseId,'manual_source.original_verified','manual_source',id,'Supplied capture original verified; URL and metadata not authenticated');return original;}));
 app.post(base+'/:id/review',{preHandler:s.requireCsrf,schema:{params:itemParams,body:body({id:uuid,expectedVersion:version,digest:{type:'string',pattern:'^[a-f0-9]{64}$'},accepted:{type:'boolean'},reason:text(3000)})}},async r=>transact(async c=>{
  const a=r.actor!;if(a.role!=='reviewer')throw new ApiError(403,'An assigned independent reviewer is required.');const {caseId,id}=r.params as {caseId:string;id:string},input=r.body as {id:string;expectedVersion:number;digest:string;accepted:boolean;reason:string};validText(input.reason);await s.findCase(c,a,caseId,true);const entry=(await current(c,a,caseId,id))[0];if(!entry)notFound();
  if(entry.record.version!==input.expectedVersion||entry.record.digest!==input.digest)throw new ApiError(409,'Review the exact current source record.');if(entry.review){if(entry.review.id===input.id&&entry.review.reviewerId===a.userId&&entry.review.accepted===input.accepted&&entry.review.reason===input.reason)return entry.review;throw new ApiError(409,'Source record already reviewed; revise it for a new decision.');}if(!entry.canReview)throw new ApiError(403,'A reviewer who authored no version must assess this source record.');
  if(input.accepted){if(entry.state==='authority_changed')throw new ApiError(409,'Current case authority is required for source review.');await check(c,a,caseId,entry.record);}
  const row=(await c.query('INSERT INTO manual_source_reviews(tenant_id,case_id,source_id,version,id,digest,accepted,reviewer_id,reviewer_name,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING recorded_at',[a.tenantId,caseId,id,input.expectedVersion,input.id,input.digest,input.accepted,a.userId,a.displayName,input.reason])).rows[0];await s.audit(c,a,caseId,'manual_source.reviewed','manual_source',id,`Source metadata revision ${input.expectedVersion} ${input.accepted?'accepted':'rejected'}`);return {id:input.id,digest:input.digest,accepted:input.accepted,reviewerId:a.userId,reviewerName:a.displayName,reason:input.reason,recordedAt:row.recorded_at.toISOString()} satisfies ManualSourceReview;
 }));
}
