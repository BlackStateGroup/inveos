import {assertRestoredRetirementComplete} from './restored-case-gates.js';
import {createHash,randomUUID} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import {caseStages,type CaseStage} from '@inveos/contracts';
import type {Actor} from './app.js';
import {inTransaction} from './db.js';
import {ApiError} from './errors.js';
export type LifecycleCase={lifecycle_state:CaseStage;lifecycle_version:number;authority_version:number|null;status:string;restored_work_open?:boolean};
type Services={pool:Pool;authenticate:(r:FastifyRequest)=>Promise<void>;requireCsrf:(r:FastifyRequest)=>Promise<void>;
 findCase:(c:PoolClient,a:Actor,id:string,lock?:boolean)=>Promise<LifecycleCase>;
 audit:(c:PoolClient,a:Actor,caseId:string,action:string,entity:string,id:string,summary:string,metadata?:Record<string,unknown>)=>Promise<void>;
 disclosures:(c:PoolClient,a:Actor,caseId:string,id?:string)=>Promise<{id:string;createdAt:string}[]>};
const uuid={type:'string',pattern:'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-8][a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$'};
const params={type:'object',additionalProperties:false,required:['caseId'],properties:{caseId:uuid}};
const choices:Record<CaseStage,CaseStage[]>={Intake:['Scope review','Closed'],'Scope review':['Closed'],Active:['Review','Closed'],Review:['Active','Released','Closed'],Released:['Active','Review','Closed'],Closed:['Scope review','Archived'],Archived:['Scope review']};
export function collectionOpen(kase:LifecycleCase){return kase.restored_work_open!==false&&kase.status==='Active'&&kase.authority_version!==null&&['Active','Review'].includes(kase.lifecycle_state);}
// Caller holds the case lock. Authority approval and explicit transitions share this history.
export async function appendCaseStage(c:PoolClient,a:Actor,caseId:string,kase:LifecycleCase,to:CaseStage,reason:string,source:'authority_approved'|'investigator_transition',id:string=randomUUID(),requestHash:string|null=null,disclosureId:string|null=null){
 if(source==='investigator_transition'&&!choices[kase.lifecycle_state].includes(to))throw new ApiError(409,'This stage transition is unavailable.');
 await assertRestoredRetirementComplete(c,a.tenantId,caseId);
 if(kase.lifecycle_version>=1000)throw new ApiError(409,'Case stage history limit reached.');
 const version=kase.lifecycle_version+1;
 await c.query(`INSERT INTO case_lifecycle_events(tenant_id,case_id,id,version,from_state,to_state,actor_id,reason,source,authority_version,request_hash,disclosure_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[a.tenantId,caseId,id,version,kase.lifecycle_state,to,a.userId,reason,source,kase.authority_version,requestHash,disclosureId]);
 await c.query('UPDATE cases SET lifecycle_state=$3,lifecycle_version=$4 WHERE tenant_id=$1 AND id=$2',[a.tenantId,caseId,to,version]);
 return version;
}
export function registerCaseLifecycle(app:FastifyInstance,s:Services){
 const base='/api/cases/:caseId/lifecycle';
 const view=async(c:PoolClient,a:Actor,caseId:string,kase:LifecycleCase,before?:number)=>{
  const history=(await c.query(`SELECT id,version,from_state AS "from",to_state AS "to",actor_id AS "actorId",reason,source,authority_version AS "authorityVersion",disclosure_id AS "disclosureId",recorded_at AS "recordedAt" FROM case_lifecycle_events WHERE tenant_id=$1 AND case_id=$2 AND ($3::int IS NULL OR version<$3) ORDER BY version DESC LIMIT 51`,[a.tenantId,caseId,before??null])).rows;
  return {state:kase.lifecycle_state,version:kase.lifecycle_version,collectionOpen:collectionOpen(kase),canManage:a.role==='reviewer',allowed:a.role==='reviewer'?choices[kase.lifecycle_state]:[],history:history.slice(0,50),nextBefore:history.length>50?history[49].version:null,disclosures:a.role==='reviewer'&&kase.lifecycle_state==='Review'?await s.disclosures(c,a,caseId):[]};
 };
 app.get(base,{preHandler:s.authenticate,schema:{params,querystring:{type:'object',additionalProperties:false,properties:{before:{type:'integer',minimum:1,maximum:1000}}}}},async r=>{
  const a=r.actor!;if(a.role==='client')throw new ApiError(403,'Internal case stages only.');const {caseId}=r.params as {caseId:string},{before}=r.query as {before?:number};
  return inTransaction(s.pool,async c=>{await c.query("SET LOCAL lock_timeout='2s'");await c.query("SET LOCAL statement_timeout='2s'");const kase=await s.findCase(c,a,caseId,true);return view(c,a,caseId,kase,before);});
 });
 app.post(base,{preHandler:s.requireCsrf,schema:{params,body:{type:'object',additionalProperties:false,required:['id','expectedVersion','to','reason'],properties:{id:uuid,expectedVersion:{type:'integer',minimum:1,maximum:1000},to:{enum:caseStages},reason:{type:'string',minLength:10,maxLength:2000},disclosureId:uuid}}}},async r=>{
  const a=r.actor!;if(a.role!=='reviewer')throw new ApiError(403,'A reviewer must record case stage decisions.');
  const {caseId}=r.params as {caseId:string},input=r.body as {id:string;expectedVersion:number;to:CaseStage;reason:string;disclosureId?:string};
  const reason=input.reason.trim();if(reason.length<10||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason))throw new ApiError(422,'Record a clear stage decision.');
  if((input.to==='Released')!==Boolean(input.disclosureId))throw new ApiError(422,'Only a released stage must identify its approved disclosure.');
  const digest=createHash('sha256').update(JSON.stringify({expectedVersion:input.expectedVersion,to:input.to,reason,disclosureId:input.disclosureId??null})).digest('hex');
  return inTransaction(s.pool,async c=>{
   await c.query("SET LOCAL lock_timeout='2s'");await c.query("SET LOCAL statement_timeout='5s'");const kase=await s.findCase(c,a,caseId,true);
   const old=(await c.query('SELECT actor_id,request_hash FROM case_lifecycle_events WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,input.id])).rows[0];
   if(old){if(old.actor_id!==a.userId||old.request_hash!==digest)throw new ApiError(409,'Stage request identity already used.');return view(c,a,caseId,kase);}
   if(input.expectedVersion!==kase.lifecycle_version)throw new ApiError(409,'Case stage changed. Refresh before deciding.');
   if(!choices[kase.lifecycle_state].includes(input.to))throw new ApiError(409,'This stage transition is unavailable. Active intake requires authority approval.');
   if(input.to==='Released'&&!(await s.disclosures(c,a,caseId,input.disclosureId)).some(d=>d.id===input.disclosureId))throw new ApiError(409,'Select a current explicitly approved recipient disclosure.');
   const version=await appendCaseStage(c,a,caseId,kase,input.to,reason,'investigator_transition',input.id,digest,input.disclosureId??null);
   await s.audit(c,a,caseId,'case.stage_changed','case',caseId,'Investigator recorded a case stage decision',{from:kase.lifecycle_state,to:input.to,version});
   return view(c,a,caseId,{...kase,lifecycle_state:input.to,lifecycle_version:version});
  });
 });
}
