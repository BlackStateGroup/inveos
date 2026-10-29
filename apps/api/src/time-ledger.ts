import {createHash} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Pool,PoolClient,QueryResultRow} from 'pg';
import type {CaseTimeEntry,CaseTimeFields} from '@inveos/contracts';
import type {Actor} from './app.js';
import {inTransaction} from './db.js';
import {ApiError,notFound} from './errors.js';

type Services={pool:Pool;authenticate:(r:FastifyRequest)=>Promise<void>;requireCsrf:(r:FastifyRequest)=>Promise<void>;findCase:(c:PoolClient,a:Actor,id:string,lock?:boolean)=>Promise<unknown>;audit:(c:PoolClient,a:Actor,caseId:string,action:string,type:string,id:string,summary:string,metadata?:Record<string,unknown>)=>Promise<void>};
const uuid={type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'};
const params=(item=false)=>({type:'object',additionalProperties:false,required:item?['caseId','entryId']:['caseId'],properties:{caseId:uuid,...(item?{entryId:uuid}:{})}});
const fields={startedAt:{type:'string',maxLength:35},minutes:{type:'integer',minimum:1,maximum:1440},description:{type:'string',minLength:3,maxLength:2000},billable:{type:'boolean'}};
const reason={type:'string',minLength:10,maxLength:2000};
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso=(v:Date|string)=>new Date(v).toISOString();
const columns='e.id AS entry_identity,e.created_by,e.created_by_name,e.created_at,r.*';
const join='FROM case_time_entries e JOIN case_time_entry_revisions r ON r.tenant_id=e.tenant_id AND r.case_id=e.case_id AND r.entry_id=e.id';
function clean(value:string,min:number){const text=value.trim();if(text.length<min||Buffer.from(text).toString('utf8')!==text||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))throw new ApiError(422,'Enter a clear time description and correction reason.');return text;}
function values(input:CaseTimeFields):CaseTimeFields{
 const time=input.startedAt,date=new Date(time.slice(0,10)+'T00:00:00Z');
 if(!/^[1-9][0-9]{3}-\d{2}-\d{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$/.test(time)||time.endsWith('-00:00')||/[+-]14:(?!00)/.test(time)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==time.slice(0,10)||!Number.isFinite(Date.parse(time)))throw new ApiError(422,'Enter a valid started time with an explicit known UTC offset.');
 return {startedAt:time,minutes:input.minutes,description:clean(input.description,3),billable:input.billable};
}
function display(row:QueryResultRow,a:Actor):CaseTimeEntry{return {id:row.entry_identity,version:row.version,startedAt:row.declared_start,startedAtUtc:iso(row.started_at),minutes:row.minutes,description:row.description,billable:row.billable,status:row.status,action:row.action,reason:row.reason,authorId:row.created_by,author:row.created_by_name,createdAt:iso(row.created_at),actorId:row.actor_id,actorName:row.actor_name,recordedAt:iso(row.recorded_at),canCorrect:row.created_by===a.userId&&row.status==='active'};}
export function registerTimeLedger(app:FastifyInstance,s:Services):void{
 const base='/api/cases/:caseId/time-entries';
 const read=async(r:FastifyRequest)=>{await s.authenticate(r);if(r.actor!.role==='client')throw new ApiError(403,'Internal time records only.');};
 const transaction=<T>(run:(c:PoolClient)=>Promise<T>)=>inTransaction(s.pool,async c=>{await c.query("SET LOCAL lock_timeout='2s'");await c.query("SET LOCAL statement_timeout='5s'");return run(c);});
 const current=async(c:PoolClient,a:Actor,caseId:string,id:string,write=false)=>{const row=(await c.query(`SELECT ${columns} ${join} WHERE e.tenant_id=$1 AND e.case_id=$2 AND e.id=$3 AND r.version=e.version`,[a.tenantId,caseId,id])).rows[0];if(!row)notFound();if(write&&row.created_by!==a.userId)throw new ApiError(403,'Only the original recorder can change this time record.');if(!write&&a.role!=='reviewer'&&row.created_by!==a.userId)notFound();return display(row,a);};
 const append=async(c:PoolClient,a:Actor,caseId:string,id:string,requestId:string,version:number,action:string,value:CaseTimeFields,why:string,hash:string)=>{
  await c.query(`INSERT INTO case_time_entry_revisions(tenant_id,case_id,entry_id,version,id,request_hash,action,status,started_at,declared_start,minutes,description,billable,reason,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::text::timestamptz,$9,$10,$11,$12,$13,$14,$15)`,[a.tenantId,caseId,id,version,requestId,hash,action,action==='withdrawn'?'withdrawn':'active',value.startedAt,value.minutes,value.description,value.billable,why,a.userId,a.displayName]);
  if(version>1)await c.query('UPDATE case_time_entries SET version=$4 WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,id,version]);
  await s.audit(c,a,caseId,'time.'+action,'case_time_entry',id,'Attributed time decision recorded',{version,action});
 };
 app.post(base,{preHandler:s.requireCsrf,schema:{params:params(),body:{type:'object',additionalProperties:false,required:['id',...Object.keys(fields)],properties:{id:uuid,...fields}}}},async r=>{
  const a=r.actor!,{caseId}=r.params as {caseId:string},input=r.body as CaseTimeFields&{id:string},value=values(input),hash=fingerprint(value);return transaction(async c=>{await s.findCase(c,a,caseId,true);const existing=(await c.query('SELECT request_hash,actor_id FROM case_time_entry_revisions WHERE tenant_id=$1 AND case_id=$2 AND entry_id=$3 AND version=1',[a.tenantId,caseId,input.id])).rows[0];if(existing){if(existing.actor_id!==a.userId||existing.request_hash!==hash)throw new ApiError(409,'This time identity is already in use.');return current(c,a,caseId,input.id);}
   if((await c.query('SELECT count(*)::int n FROM case_time_entries WHERE tenant_id=$1 AND case_id=$2',[a.tenantId,caseId])).rows[0].n>=10000)throw new ApiError(409,'Case time-record limit reached.');
   await c.query('INSERT INTO case_time_entries(tenant_id,case_id,id,created_by,created_by_name) VALUES($1,$2,$3,$4,$5)',[a.tenantId,caseId,input.id,a.userId,a.displayName]);await append(c,a,caseId,input.id,input.id,1,'recorded',value,'Time record declared by its recorder.',hash);return current(c,a,caseId,input.id);
  });
 });
 app.get(base,{preHandler:read,schema:{params:params(),querystring:{type:'object',additionalProperties:false,properties:{after:uuid,scope:{enum:['mine','case']},status:{enum:['all','active','withdrawn']},billable:{enum:['all','yes','no']}}}}},async r=>{
  const a=r.actor!,{caseId}=r.params as {caseId:string},{after,scope='case',status='all',billable='all'}=r.query as {after?:string;scope?:string;status?:string;billable?:string};return transaction(async c=>{await s.findCase(c,a,caseId,true);const rows=(await c.query(`SELECT ${columns} ${join} WHERE e.tenant_id=$1 AND e.case_id=$2 AND r.version=e.version AND ($3::uuid IS NULL OR e.id>$3) AND ($4 OR e.created_by=$5) AND ($6='all' OR r.status=$6) AND ($7='all' OR r.billable=($7='yes')) ORDER BY e.id LIMIT 51`,[a.tenantId,caseId,after??null,a.role==='reviewer'&&scope==='case',a.userId,status,billable])).rows;return {items:rows.slice(0,50).map(row=>display(row,a)),next:rows.length>50?rows[49].entry_identity:null,canViewCase:a.role==='reviewer',scope:a.role==='reviewer'&&scope==='case'?'case':'mine',interpretation:'recorded_time_not_an_invoice'};});
 });
 for(const action of ['corrected','withdrawn'] as const)app.post(base+'/:entryId/'+(action==='corrected'?'corrections':'withdraw'),{preHandler:s.requireCsrf,schema:{params:params(true),body:{type:'object',additionalProperties:false,required:['id','expectedVersion','reason',...(action==='corrected'?Object.keys(fields):[])],properties:{id:uuid,expectedVersion:{type:'integer',minimum:1,maximum:99},reason,...(action==='corrected'?fields:{})}}}},async r=>{
  const a=r.actor!,{caseId,entryId}=r.params as {caseId:string;entryId:string},input=r.body as CaseTimeFields&{id:string;expectedVersion:number;reason:string},value=action==='corrected'?values(input):null,why=clean(input.reason,10),hash=fingerprint({action,expectedVersion:input.expectedVersion,value,reason:why});return transaction(async c=>{
   await s.findCase(c,a,caseId,true);const old=await current(c,a,caseId,entryId,true),replay=(await c.query('SELECT request_hash,version FROM case_time_entry_revisions WHERE tenant_id=$1 AND case_id=$2 AND entry_id=$3 AND id=$4',[a.tenantId,caseId,entryId,input.id])).rows[0];if(replay){if(replay.request_hash!==hash)throw new ApiError(409,'This correction identity is already in use.');return {...old,appliedVersion:replay.version};}
   if(old.status==='withdrawn')throw new ApiError(409,'Withdrawn entries remain closed. Record a new entry if needed.');if(old.version!==input.expectedVersion)throw new ApiError(409,'Time record changed. Refresh before correcting it.');if(action==='corrected'&&old.version>=99)throw new ApiError(409,'Correction limit reached; the last version remains available for withdrawal.');
   await append(c,a,caseId,entryId,input.id,old.version+1,action,value??old,why,hash);return {...await current(c,a,caseId,entryId),appliedVersion:old.version+1};
  });
 });
 app.get(base+'/:entryId/history',{preHandler:read,schema:{params:params(true),querystring:{type:'object',additionalProperties:false,properties:{before:{type:'integer',minimum:1,maximum:101}}}}},async r=>{const a=r.actor!,{caseId,entryId}=r.params as {caseId:string;entryId:string},{before}=r.query as {before?:number};return transaction(async c=>{await s.findCase(c,a,caseId,true);await current(c,a,caseId,entryId);const rows=(await c.query(`SELECT ${columns} ${join} WHERE e.tenant_id=$1 AND e.case_id=$2 AND e.id=$3 AND ($4::int IS NULL OR r.version<$4) ORDER BY r.version DESC LIMIT 26`,[a.tenantId,caseId,entryId,before??null])).rows;return {items:rows.slice(0,25).map(row=>({...display(row,a),canCorrect:false})),next:rows.length>25?rows[24].version:null};});});
 app.get(base+'/:entryId',{preHandler:read,schema:{params:params(true)}},async r=>{const a=r.actor!,{caseId,entryId}=r.params as {caseId:string;entryId:string};return transaction(async c=>{await s.findCase(c,a,caseId,true);return current(c,a,caseId,entryId);});});
}
