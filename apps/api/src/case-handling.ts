import {assertRestoredRetirementComplete,restoredCaseWorkEligibility} from './restored-case-gates.js';
import {createHash} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Pool,PoolClient,QueryResultRow} from 'pg';
import {caseSensitivityTiers,type CaseHandling,type CaseHandlingDecision,type CaseSensitivityTier,type CaseSharing} from '@inveos/contracts';
import type {Actor} from './app.js';
import {ApiError} from './errors.js';
import {inTransaction} from './db.js';

const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,canonical(x)])):v;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
function decision(row:QueryResultRow):CaseHandlingDecision{
 const v={id:row.id,caseId:row.case_id,version:row.version,tier:row.tier,sharing:row.sharing,instructions:row.instructions,reason:row.reason,authorityVersion:row.authority_version,actorId:row.actor_id,actorName:row.actor_name,recordedAt:row.recorded_at.toISOString()};
 if(hash(v)!==row.sha256.trim())throw new ApiError(409,'Case handling history integrity failed.');
 return {...v,sha256:row.sha256.trim()};
}

// Discovery predicate only; content access additionally verifies the exact record below.
// The caller's case table alias is c. No declaration preserves existing release controls.
export const caseSharingEligibility=`(${restoredCaseWorkEligibility}) AND NOT EXISTS(SELECT 1 FROM case_handling_events h
 WHERE h.tenant_id=c.tenant_id AND h.case_id=c.id
 AND h.version=(SELECT max(v.version) FROM case_handling_events v WHERE v.tenant_id=h.tenant_id AND v.case_id=h.case_id)
 AND (h.sharing='internal_only' OR h.authority_version IS DISTINCT FROM c.authority_version OR h.authority_version IS NULL
 OR NOT EXISTS(SELECT 1 FROM memberships hm JOIN case_memberships hc ON hc.tenant_id=hm.tenant_id AND hc.user_id=hm.user_id
 WHERE hm.tenant_id=h.tenant_id AND hm.user_id=h.actor_id AND hm.role='reviewer' AND hc.case_id=h.case_id)))`;

export async function caseSharingState(c:PoolClient,tenantId:string,caseId:string){
 const row=(await c.query(`SELECT h.*,c.authority_version current_authority,(${restoredCaseWorkEligibility}) recovery_current,
 EXISTS(SELECT 1 FROM memberships m JOIN case_memberships cm ON cm.tenant_id=m.tenant_id AND cm.user_id=m.user_id WHERE m.tenant_id=h.tenant_id AND m.user_id=h.actor_id AND m.role='reviewer' AND cm.case_id=h.case_id) reviewer_current
 FROM case_handling_events h JOIN cases c ON c.tenant_id=h.tenant_id AND c.id=h.case_id
 WHERE h.tenant_id=$1 AND h.case_id=$2 ORDER BY h.version DESC LIMIT 1`,[tenantId,caseId])).rows[0];
 if(!row)return {current:null,allowed:true,reason:null};
 const current=decision(row),reason=!row.recovery_current?'Restored case requires new authority and fresh handling review before recipient access.':current.sharing==='internal_only'?'This case is restricted to internal use.':!current.authorityVersion||current.authorityVersion!==row.current_authority||!row.reviewer_current?'Case sharing requires a fresh handling decision under current authority.':null;
 return {current,allowed:reason===null,reason};
}
// Caller first verifies tenant/case access and holds the case lock for mutations.
export async function assertCaseSharing(c:PoolClient,tenantId:string,caseId:string){
 const state=await caseSharingState(c,tenantId,caseId);
 if(!state.allowed)throw new ApiError(409,state.reason!);
}

type Kase={authority_version:number|null;status:string;lifecycle_state:string};
type Services={pool:Pool;authenticate:(r:FastifyRequest)=>Promise<void>;requireCsrf:(r:FastifyRequest)=>Promise<void>;findCase:(c:PoolClient,a:Actor,id:string,lock?:boolean)=>Promise<Kase>;audit:(c:PoolClient,a:Actor,caseId:string,action:string,entity:string,id:string,summary:string,metadata?:Record<string,unknown>)=>Promise<void>};
export function registerCaseHandling(app:FastifyInstance,s:Services){
 const uuid={type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'},params={type:'object',additionalProperties:false,required:['caseId'],properties:{caseId:uuid}},base='/api/cases/:caseId/handling';
 const tx=<T>(fn:(c:PoolClient)=>Promise<T>)=>inTransaction(s.pool,async c=>{await c.query("SET LOCAL lock_timeout='2s'");await c.query("SET LOCAL statement_timeout='5s'");return fn(c);}).catch(e=>{if(e.code==='23505')throw new ApiError(409,'Handling request identity already used.');throw e;});
 async function view(c:PoolClient,a:Actor,caseId:string,kase:Kase,before?:number):Promise<CaseHandling>{
  const state=await caseSharingState(c,a.tenantId,caseId),rows=(await c.query('SELECT * FROM case_handling_events WHERE tenant_id=$1 AND case_id=$2 AND ($3::int IS NULL OR version<$3) ORDER BY version DESC LIMIT 26',[a.tenantId,caseId,before??null])).rows;
  return {version:state.current?.version??0,authorityVersion:kase.authority_version,current:state.current,history:rows.slice(0,25).map(decision),nextBefore:rows.length>25?rows[24].version:null,canDecide:a.role==='reviewer'&&(state.current?.version??0)<1000,sharingAllowed:state.allowed,blockReason:state.reason};
 }
 app.get(base,{preHandler:s.authenticate,schema:{params,querystring:{type:'object',additionalProperties:false,properties:{before:{type:'integer',minimum:1,maximum:1000}}}}},async(r,reply)=>{
  reply.header('Cache-Control','no-store');const a=r.actor!;if(a.role==='client')throw new ApiError(403,'Internal handling decisions only.');const {caseId}=r.params as {caseId:string},{before}=r.query as {before?:number};
  return tx(async c=>{const kase=await s.findCase(c,a,caseId,true);return view(c,a,caseId,kase,before);});
 });
 app.post(base,{preHandler:s.requireCsrf,preValidation:async r=>{const input=r.body as Record<string,unknown>;if(!input||['id','tier','sharing','instructions','reason'].some(k=>typeof input[k]!=='string')||typeof input.expectedVersion!=='number'||(input.expectedAuthorityVersion!==null&&typeof input.expectedAuthorityVersion!=='number'))throw new ApiError(422,'Explicit typed handling decisions and versions are required.');},schema:{params,body:{type:'object',additionalProperties:false,required:['id','expectedVersion','expectedAuthorityVersion','tier','sharing','instructions','reason'],properties:{id:uuid,expectedVersion:{type:'integer',minimum:0,maximum:999},expectedAuthorityVersion:{anyOf:[{type:'integer',minimum:1},{type:'null'}]},tier:{enum:caseSensitivityTiers},sharing:{enum:['existing_release_controls','internal_only']},instructions:{type:'string',minLength:10,maxLength:2000},reason:{type:'string',minLength:10,maxLength:2000}}}}},async(r,reply)=>{
  reply.header('Cache-Control','no-store');const a=r.actor!;if(a.role!=='reviewer')throw new ApiError(403,'A case reviewer must record handling decisions.');const {caseId}=r.params as {caseId:string},input=r.body as {id:string;expectedVersion:number;expectedAuthorityVersion:number|null;tier:CaseSensitivityTier;sharing:CaseSharing;instructions:string;reason:string};
  return tx(async c=>{
   const kase=await s.findCase(c,a,caseId,true);
   await recordCaseHandling(c,a,caseId,kase,input,s.audit);
   return view(c,a,caseId,kase);
  });
 });
}

export type HandlingInput={id:string;expectedVersion:number;expectedAuthorityVersion:number|null;tier:CaseSensitivityTier;sharing:CaseSharing;instructions:string;reason:string};
// Caller holds the case lock and has verified current reviewer membership in this transaction.
export async function recordCaseHandling(c:PoolClient,a:Actor,caseId:string,kase:Kase,input:HandlingInput,audit:Services['audit']):Promise<CaseHandlingDecision>{
 if(a.role!=='reviewer')throw new ApiError(403,'A case reviewer must record handling decisions.');
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.id)||!Number.isInteger(input.expectedVersion)||input.expectedVersion<0||input.expectedVersion>999||!caseSensitivityTiers.includes(input.tier)||!['internal_only','existing_release_controls'].includes(input.sharing)||![input.instructions,input.reason].every(t=>typeof t==='string'&&t.length<=2000))throw new ApiError(422,'Invalid handling decision.');
 for(const text of [input.instructions,input.reason])if(text.trim().length<10||Buffer.from(text).toString('utf8')!==text||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))throw new ApiError(422,'Record clear handling instructions and a decision reason.');
 await assertRestoredRetirementComplete(c,a.tenantId,caseId);
 const requestHash=hash(input),old=(await c.query('SELECT * FROM case_handling_events WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,input.id])).rows[0];
 if(old){decision(old);if(old.actor_id!==a.userId||old.request_hash.trim()!==requestHash)throw new ApiError(409,'Handling request identity already used.');return decision(old);}
 const current=await caseSharingState(c,a.tenantId,caseId);
 if(input.expectedVersion!==(current.current?.version??0)||input.expectedAuthorityVersion!==kase.authority_version)throw new ApiError(409,'Case handling or authority changed. Refresh and compare before deciding.');
 if(input.sharing==='existing_release_controls'&&(!kase.authority_version||kase.status!=='Active'||!['Active','Review','Released'].includes(kase.lifecycle_state)))throw new ApiError(409,'An active approved case is required to enable recipient sharing.');
 if(input.expectedVersion===999&&input.sharing!=='internal_only')throw new ApiError(422,'The final handling decision is reserved for internal-only use.');
 const at=(await c.query('SELECT clock_timestamp() at')).rows[0].at as Date;
 const value={id:input.id,caseId,version:input.expectedVersion+1,tier:input.tier,sharing:input.sharing,instructions:input.instructions,reason:input.reason,authorityVersion:kase.authority_version,actorId:a.userId,actorName:a.displayName,recordedAt:at.toISOString()},sha256=hash(value);
 await c.query('INSERT INTO case_handling_events(tenant_id,case_id,id,version,tier,sharing,instructions,reason,authority_version,actor_id,actor_name,recorded_at,sha256,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[a.tenantId,caseId,value.id,value.version,value.tier,value.sharing,value.instructions,value.reason,value.authorityVersion,a.userId,a.displayName,at,sha256,requestHash]);
 await audit(c,a,caseId,'case.handling_decided','case',caseId,'Reviewer recorded sensitivity and current sharing controls',{version:value.version,tier:value.tier,sharing:value.sharing,sha256});return {...value,sha256};
}
