import {createHash} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Pool,PoolClient,QueryResultRow} from 'pg';
import type {PreservationHold,PreservationHoldFields} from '@inveos/contracts';
import type {Actor} from './app.js';
import {inTransaction} from './db.js';
import {ApiError,notFound} from './errors.js';

type Services={pool:Pool;authenticate:(r:FastifyRequest)=>Promise<void>;requireCsrf:(r:FastifyRequest)=>Promise<void>;
 findCase:(c:PoolClient,a:Actor,id:string,lock?:boolean)=>Promise<unknown>;
 source:(c:PoolClient,a:Actor,caseId:string,id:string)=>Promise<{id:string;digest:string;filename:string;authorityVersion:number}>;
 audit:(c:PoolClient,a:Actor,caseId:string,action:string,entity:string,id:string,summary:string,metadata?:Record<string,unknown>)=>Promise<void>};
const uuid={type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'};
const params=(item=false)=>({type:'object',additionalProperties:false,required:item?['caseId','holdId']:['caseId'],properties:{caseId:uuid,...(item?{holdId:uuid}:{})}});
const fields={label:{type:'string',minLength:3,maxLength:200},authorityReference:{type:'string',minLength:3,maxLength:2000},purpose:{type:'string',minLength:10,maxLength:2000},reason:{type:'string',minLength:10,maxLength:2000}};
const columns=`h.id AS hold_identity,h.evidence_id,h.evidence_digest,h.evidence_filename,h.source_authority_version,h.created_by,h.created_at,r.*`;
const join=`FROM preservation_holds h JOIN preservation_hold_revisions r ON r.tenant_id=h.tenant_id AND r.case_id=h.case_id AND r.hold_id=h.id`;
const iso=(value:Date|string)=>new Date(value).toISOString();
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function clean(value:string,minimum:number){const result=value.trim();if(result.length<minimum||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(result)||Buffer.from(result).toString('utf8')!==result)throw new ApiError(422,'Enter a clear preservation decision.');return result;}
function inputFields(input:PreservationHoldFields):PreservationHoldFields{return {label:clean(input.label,3),authorityReference:clean(input.authorityReference,3),purpose:clean(input.purpose,10),reason:clean(input.reason,10)};}
function display(row:QueryResultRow):PreservationHold{return {id:row.hold_identity,version:row.version,status:row.status,action:row.action,label:row.label,authorityReference:row.authority_reference,purpose:row.purpose,reason:row.reason,source:row.evidence_id?{id:row.evidence_id,sha256:row.evidence_digest.trim(),filename:row.evidence_filename,authorityVersion:row.source_authority_version}:null,createdBy:row.created_by,createdAt:iso(row.created_at),actorId:row.actor_id,actorName:row.actor_name,recordedAt:iso(row.recorded_at)};}
export function registerPreservationHolds(app:FastifyInstance,s:Services){
 const base='/api/cases/:caseId/preservation-holds';
 const read=async(r:FastifyRequest)=>{await s.authenticate(r);if(r.actor!.role==='client')throw new ApiError(403,'Internal preservation records only.');};
 const write=async(r:FastifyRequest)=>{await s.requireCsrf(r);if(r.actor!.role!=='reviewer')throw new ApiError(403,'An assigned reviewer must record preservation decisions.');};
 const transaction=<T>(work:(c:PoolClient)=>Promise<T>)=>inTransaction(s.pool,async c=>{await c.query("SET LOCAL lock_timeout='2s'");await c.query("SET LOCAL statement_timeout='5s'");return work(c);});
 const current=async(c:PoolClient,a:Actor,caseId:string,holdId:string)=>{const row=(await c.query(`SELECT ${columns} ${join} WHERE h.tenant_id=$1 AND h.case_id=$2 AND h.id=$3 AND r.version=h.version`,[a.tenantId,caseId,holdId])).rows[0];if(!row)notFound();return display(row);};
 const append=async(c:PoolClient,a:Actor,caseId:string,holdId:string,id:string,version:number,action:string,value:PreservationHoldFields,hash:string)=>{
  await c.query(`INSERT INTO preservation_hold_revisions(tenant_id,case_id,hold_id,version,id,request_hash,action,status,label,authority_reference,purpose,reason,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[a.tenantId,caseId,holdId,version,id,hash,action,action==='released'?'released':'active',value.label,value.authorityReference,value.purpose,value.reason,a.userId,a.displayName]);
  if(version>1)await c.query('UPDATE preservation_holds SET version=$4 WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,holdId,version]);
  await s.audit(c,a,caseId,'preservation.'+action,'preservation_hold',holdId,'Reviewer recorded a preservation decision',{version,action});
 };
 app.get(base,{preHandler:read,schema:{params:params(),querystring:{type:'object',additionalProperties:false,properties:{after:uuid,status:{enum:['all','active','released']}}}}},async r=>{
  const a=r.actor!,{caseId}=r.params as {caseId:string},{after,status='all'}=r.query as {after?:string;status?:string};return transaction(async c=>{await s.findCase(c,a,caseId,true);const rows=(await c.query(`SELECT ${columns} ${join} WHERE h.tenant_id=$1 AND h.case_id=$2 AND r.version=h.version AND ($3::uuid IS NULL OR h.id>$3) AND ($4='all' OR r.status=$4) ORDER BY h.id LIMIT 51`,[a.tenantId,caseId,after??null,status])).rows;return {items:rows.slice(0,50).map(display),next:rows.length>50?rows[49].hold_identity:null,canManage:a.role==='reviewer',sourceVerification:'not_checked_by_hold',interpretation:'preservation_decision_not_legal_determination'};});
 });
 app.post(base,{preHandler:write,schema:{params:params(),body:{type:'object',additionalProperties:false,required:['id','evidenceId',...Object.keys(fields)],properties:{id:uuid,evidenceId:{anyOf:[uuid,{type:'null'}]},...fields}}}},async r=>{
  const a=r.actor!,{caseId}=r.params as {caseId:string},input=r.body as PreservationHoldFields&{id:string;evidenceId:string|null},value=inputFields(input),hash=fingerprint({evidenceId:input.evidenceId,...value});return transaction(async c=>{
   await s.findCase(c,a,caseId,true);const existing=(await c.query('SELECT actor_id,request_hash FROM preservation_hold_revisions WHERE tenant_id=$1 AND case_id=$2 AND hold_id=$3 AND version=1',[a.tenantId,caseId,input.id])).rows[0];if(existing){if(existing.actor_id!==a.userId||existing.request_hash!==hash)throw new ApiError(409,'Hold identity already used.');return current(c,a,caseId,input.id);}
   const source=input.evidenceId?await s.source(c,a,caseId,input.evidenceId):null;if((await c.query('SELECT count(*)::int n FROM preservation_holds WHERE tenant_id=$1 AND case_id=$2',[a.tenantId,caseId])).rows[0].n>=200)throw new ApiError(409,'Case preservation record limit reached.');
   await c.query('INSERT INTO preservation_holds(tenant_id,case_id,id,evidence_id,evidence_digest,evidence_filename,source_authority_version,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[a.tenantId,caseId,input.id,source?.id??null,source?.digest??null,source?.filename??null,source?.authorityVersion??null,a.userId]);await append(c,a,caseId,input.id,input.id,1,'declared',value,hash);return current(c,a,caseId,input.id);
  });
 });
 for(const action of ['amended','released'] as const)app.post(base+'/:holdId/'+(action==='amended'?'revise':'release'),{preHandler:write,schema:{params:params(true),body:{type:'object',additionalProperties:false,required:['id','expectedVersion',...(action==='amended'?Object.keys(fields):['reason'])],properties:{id:uuid,expectedVersion:{type:'integer',minimum:1,maximum:99},...(action==='amended'?fields:{reason:fields.reason})}}}},async r=>{
  const a=r.actor!,{caseId,holdId}=r.params as {caseId:string;holdId:string},input=r.body as PreservationHoldFields&{id:string;expectedVersion:number},supplied=action==='amended'?inputFields(input):{reason:clean(input.reason,10)},hash=fingerprint({action,expectedVersion:input.expectedVersion,...supplied});return transaction(async c=>{
   await s.findCase(c,a,caseId,true);const old=await current(c,a,caseId,holdId),replay=(await c.query('SELECT actor_id,request_hash,version FROM preservation_hold_revisions WHERE tenant_id=$1 AND case_id=$2 AND hold_id=$3 AND id=$4',[a.tenantId,caseId,holdId,input.id])).rows[0];if(replay){if(replay.actor_id!==a.userId||replay.request_hash!==hash)throw new ApiError(409,'Preservation request identity already used.');return {record:old,appliedVersion:replay.version};}
   if(old.version!==input.expectedVersion)throw new ApiError(409,'Preservation record changed. Refresh before deciding.');if(old.status==='released')throw new ApiError(409,'Released holds remain closed. Record a new hold for a new instruction.');if(action==='amended'&&old.version>=99)throw new ApiError(409,'Amendment limit reached; the final version is reserved for release.');
   await append(c,a,caseId,holdId,input.id,old.version+1,action,{label:old.label,authorityReference:old.authorityReference,purpose:old.purpose,...supplied},hash);return {record:await current(c,a,caseId,holdId),appliedVersion:old.version+1};
  });
 });
 app.get(base+'/:holdId/history',{preHandler:read,schema:{params:params(true),querystring:{type:'object',additionalProperties:false,properties:{before:{type:'integer',minimum:1,maximum:101}}}}},async r=>{const a=r.actor!,{caseId,holdId}=r.params as {caseId:string;holdId:string},{before}=r.query as {before?:number};return transaction(async c=>{await s.findCase(c,a,caseId,true);await current(c,a,caseId,holdId);const rows=(await c.query(`SELECT ${columns} ${join} WHERE h.tenant_id=$1 AND h.case_id=$2 AND h.id=$3 AND ($4::int IS NULL OR r.version<$4) ORDER BY r.version DESC LIMIT 26`,[a.tenantId,caseId,holdId,before??null])).rows;return {items:rows.slice(0,25).map(display),next:rows.length>25?rows[24].version:null,sourceVerification:'not_checked_by_hold'};});});
 app.get(base+'/:holdId',{preHandler:read,schema:{params:params(true)}},async r=>{const a=r.actor!,{caseId,holdId}=r.params as {caseId:string;holdId:string};return transaction(async c=>{await s.findCase(c,a,caseId,true);return current(c,a,caseId,holdId);});});
 app.get('/api/cases/:caseId/retention-review',{preHandler:read,schema:{params:params(),querystring:{type:'object',additionalProperties:false,properties:{after:uuid,status:{enum:['all','held','due','upcoming']}}}}},async r=>{
  const a=r.actor!,{caseId}=r.params as {caseId:string},{after,status='all'}=r.query as {after?:string;status?:string};return transaction(async c=>{
   await s.findCase(c,a,caseId,true);
   const rows=(await c.query(`WITH policy AS (
    SELECT e.id,e.filename,e.digest,e.source_time,e.received_time,e.authority_id,e.authority_version,a.retention_days,
     e.received_time+a.retention_days*interval '24 hours' AS review_due_at,statement_timestamp() AS evaluated_at,
     EXISTS(SELECT 1 FROM preservation_holds h JOIN preservation_hold_revisions r
       ON r.tenant_id=h.tenant_id AND r.case_id=h.case_id AND r.hold_id=h.id AND r.version=h.version
       WHERE h.tenant_id=e.tenant_id AND h.case_id=e.case_id AND (h.evidence_id IS NULL OR h.evidence_id=e.id) AND r.status='active') AS held
    FROM evidence e JOIN authority_records a ON a.tenant_id=e.tenant_id AND a.case_id=e.case_id AND a.id=e.authority_id AND a.version=e.authority_version
    WHERE e.tenant_id=$1 AND e.case_id=$2 AND ($3::uuid IS NULL OR e.id>$3))
    SELECT * FROM policy WHERE $4='all' OR ($4='held' AND held) OR ($4='due' AND review_due_at<=evaluated_at) OR ($4='upcoming' AND review_due_at>evaluated_at)
    ORDER BY id LIMIT 51`,[a.tenantId,caseId,after??null,status])).rows;
   return {items:rows.slice(0,50).map(row=>({id:row.id,filename:row.filename,sha256:row.digest.trim(),sourceTime:row.source_time,receivedTime:iso(row.received_time),authorityId:row.authority_id,authorityVersion:row.authority_version,retentionDays:row.retention_days,reviewDueAt:iso(row.review_due_at),evaluatedAt:iso(row.evaluated_at),reviewDue:new Date(row.review_due_at)<=new Date(row.evaluated_at),held:row.held})),next:rows.length>50?rows[49].id:null,reviewBasis:'received_time_plus_pinned_case_authority_days',destructionAuthorised:false,sourceVerification:'not_checked_on_listing'};
  });
 });

}
