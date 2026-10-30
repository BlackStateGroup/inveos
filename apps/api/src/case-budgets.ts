import {createHash} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Pool,PoolClient,QueryResultRow} from 'pg';
import type {CaseBudgetSnapshot,CaseBudgetVersion} from '@inveos/contracts';
import type {Actor} from './app.js';
import {inTransaction} from './db.js';
import {ApiError} from './errors.js';

type Services={pool:Pool;authenticate:(r:FastifyRequest)=>Promise<void>;requireCsrf:(r:FastifyRequest)=>Promise<void>;findCase:(c:PoolClient,a:Actor,id:string,lock?:boolean)=>Promise<unknown>;audit:(c:PoolClient,a:Actor,caseId:string,action:string,type:string,id:string,summary:string,metadata?:Record<string,unknown>)=>Promise<void>};
const uuid={type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'};
const params={type:'object',additionalProperties:false,required:['caseId'],properties:{caseId:uuid}};
const display=(r:QueryResultRow):CaseBudgetVersion=>({id:r.id,version:r.version,action:r.action,minutes:r.minutes,reason:r.reason,actorId:r.actor_id,actorName:r.actor_name,recordedAt:new Date(r.recorded_at).toISOString()});

export function registerCaseBudgets(app:FastifyInstance,s:Services){
 const base='/api/cases/:caseId/time-budget';
 async function reviewer(r:FastifyRequest,write=false){
  await (write?s.requireCsrf:s.authenticate)(r);
  if(r.actor!.role!=='reviewer')throw new ApiError(403,'Case budgets and whole-ledger totals require a current reviewer.');
 }
 const transaction=<T>(run:(c:PoolClient)=>Promise<T>)=>inTransaction(s.pool,async c=>{
  await c.query("SET LOCAL lock_timeout='2s'");await c.query("SET LOCAL statement_timeout='5s'");return run(c);
 });
 const latest=async(c:PoolClient,a:Actor,caseId:string)=>{
  const row=(await c.query('SELECT * FROM case_time_budgets WHERE tenant_id=$1 AND case_id=$2 ORDER BY version DESC LIMIT 1',[a.tenantId,caseId])).rows[0];
  return row?display(row):null;
 };
 async function snapshot(c:PoolClient,a:Actor,caseId:string):Promise<CaseBudgetSnapshot>{
  const current=await latest(c,a,caseId);
  const usage=(await c.query(`SELECT count(*)::int AS entries,COALESCE(sum(r.minutes),0)::int AS minutes,
   COALESCE(sum(r.minutes) FILTER(WHERE r.billable),0)::int AS chargeable
   FROM case_time_entries e JOIN case_time_entry_revisions r ON r.tenant_id=e.tenant_id AND r.case_id=e.case_id AND r.entry_id=e.id AND r.version=e.version
   WHERE e.tenant_id=$1 AND e.case_id=$2 AND r.status='active'`,[a.tenantId,caseId])).rows[0];
  const observed=(await c.query('SELECT clock_timestamp() AS observed')).rows[0].observed;
  const allocated=current&&current.action!=='withdrawn'?current.minutes:null;
  return {caseId,current,usage:{entries:usage.entries,minutes:usage.minutes,markedChargeableMinutes:usage.chargeable},
   remainingMinutes:allocated===null?null:allocated-usage.minutes,observedAt:new Date(observed).toISOString(),interpretation:'declared_time_planning_only'};
 }
 app.get(base,{preHandler:r=>reviewer(r),schema:{params}},r=>{
  const a=r.actor!,{caseId}=r.params as {caseId:string};return transaction(async c=>{await s.findCase(c,a,caseId,true);return snapshot(c,a,caseId);});
 });
 for(const action of ['allocate','withdraw'] as const)app.post(base+(action==='withdraw'?'/withdraw':''),{
  // Preserve the submitted decision: generic AJV coercion must not turn null,
  // booleans, numeric strings or singleton arrays into a budget/version.
  preValidation:async r=>{
   const input=r.body as Record<string,unknown>|null;
   if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.id!=='string'||typeof input.reason!=='string'||
      typeof input.expectedVersion!=='number'||(action==='allocate'&&typeof input.minutes!=='number'))
    throw new ApiError(422,'Budget decisions require text identities/reasons and numeric versions/minutes.');
  },
  preHandler:r=>reviewer(r,true),schema:{params,body:{type:'object',additionalProperties:false,
   required:['id','expectedVersion','reason',...(action==='allocate'?['minutes']:[])],
   properties:{id:uuid,expectedVersion:{type:'integer',minimum:0,maximum:999},reason:{type:'string',minLength:10,maxLength:2000},
    ...(action==='allocate'?{minutes:{type:'integer',minimum:0,maximum:14400000}}:{})}}},
 },async r=>{
  const a=r.actor!,{caseId}=r.params as {caseId:string},input=r.body as {id:string;expectedVersion:number;reason:string;minutes?:number};
  const reason=input.reason.trim();
  if(reason.length<10||Buffer.from(reason).toString('utf8')!==reason||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(reason))throw new ApiError(422,'Enter a clear allocation or withdrawal reason.');
  const hash=createHash('sha256').update(JSON.stringify({action,expectedVersion:input.expectedVersion,reason,minutes:input.minutes??null})).digest('hex');
  return transaction(async c=>{
   await s.findCase(c,a,caseId,true);
   const prior=(await c.query('SELECT actor_id,request_hash,version FROM case_time_budgets WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,input.id])).rows[0];
   if(prior){if(prior.actor_id!==a.userId||prior.request_hash!==hash)throw new ApiError(409,'This budget request identity is already in use.');return {...await snapshot(c,a,caseId),appliedVersion:prior.version};}
   const old=await latest(c,a,caseId),version=(old?.version??0)+1;
   if(input.expectedVersion!==(old?.version??0))throw new ApiError(409,'Budget changed. Refresh before recording another decision.');
   if(action==='withdraw'&&(!old||old.action==='withdrawn'))throw new ApiError(409,'No active budget to withdraw.');
   if(action==='allocate'&&version>=1000)throw new ApiError(409,'Allocation limit reached; the final version remains available for withdrawal.');
   const decision=action==='withdraw'?'withdrawn':!old||old.action==='withdrawn'?'allocated':'revised';
   await c.query(`INSERT INTO case_time_budgets(tenant_id,case_id,version,id,request_hash,action,minutes,reason,actor_id,actor_name)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[a.tenantId,caseId,version,input.id,hash,decision,action==='withdraw'?old!.minutes:input.minutes,reason,a.userId,a.displayName]);
   await s.audit(c,a,caseId,'budget.'+decision,'case_time_budget',input.id,'Case time allocation decision recorded',{version,action:decision});
   return {...await snapshot(c,a,caseId),appliedVersion:version};
  });
 });
 app.get(base+'/history',{preHandler:r=>reviewer(r),schema:{params,querystring:{type:'object',additionalProperties:false,properties:{before:{type:'integer',minimum:1,maximum:1001}}}}},r=>{
  const a=r.actor!,{caseId}=r.params as {caseId:string},{before}=r.query as {before?:number};return transaction(async c=>{
   await s.findCase(c,a,caseId,true);const rows=(await c.query('SELECT * FROM case_time_budgets WHERE tenant_id=$1 AND case_id=$2 AND ($3::int IS NULL OR version<$3) ORDER BY version DESC LIMIT 26',[a.tenantId,caseId,before??null])).rows;
   return {items:rows.slice(0,25).map(display),next:rows.length>25?rows[24].version:null};
  });
 });
}
