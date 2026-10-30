import {createHash} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Pool,PoolClient,QueryResultRow} from 'pg';
import type {ReviewAssignment,ReviewOwnership} from '@inveos/contracts';
import type {Actor} from './app.js';
import {inTransaction} from './db.js';
import {ApiError,notFound} from './errors.js';
type Services={pool:Pool;authenticate:(r:FastifyRequest)=>Promise<void>;requireCsrf:(r:FastifyRequest)=>Promise<void>;findCase:(c:PoolClient,a:Actor,id:string,lock?:boolean)=>Promise<unknown>;audit:(c:PoolClient,a:Actor,caseId:string|null,action:string,type:string,id:string,summary:string,metadata?:Record<string,unknown>)=>Promise<void>};
const uuid={type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'};
const key={type:'string',minLength:1,maxLength:200,pattern:'^[a-z_]+:[0-9a-f:-]+$'},revision={type:'string',minLength:1,maxLength:100};
const available=`EXISTS(SELECT 1 FROM case_memberships cm JOIN memberships m ON m.tenant_id=cm.tenant_id AND m.user_id=cm.user_id WHERE cm.tenant_id=a.tenant_id AND cm.case_id=a.case_id AND cm.user_id=a.assignee_id AND m.role='reviewer')`;
export const assignmentJoin=`LEFT JOIN LATERAL (SELECT a.*,${available} assignee_available FROM case_review_assignments a WHERE a.tenant_id=$1 AND a.case_id=x.case_id AND a.item_key=x.item_key AND a.revision=x.revision ORDER BY a.version DESC LIMIT 1) ra ON x.category='reviews'`;
export function assignmentSummary(r:QueryResultRow):ReviewOwnership|null{return r.assignment_version?{version:r.assignment_version,assigneeId:r.assignee_id,assigneeName:r.assignee_name,assigneeAvailable:r.assignee_available}:null;}
function display(r:QueryResultRow):ReviewAssignment{return {...assignmentSummary({...r,assignment_version:r.version})!,id:r.id,actorId:r.actor_id,actorName:r.actor_name,reason:r.reason,recordedAt:r.recorded_at.toISOString()};}
export function registerReviewAssignments(app:FastifyInstance,s:Services,candidates:string){
 const base='/api/cases/:caseId/review-assignments',params={type:'object',required:['caseId'],additionalProperties:false,properties:{caseId:uuid}};
 const reviewer=async(r:FastifyRequest)=>{await s.authenticate(r);if(r.actor!.role!=='reviewer')throw new ApiError(403,'Current reviewer membership required.');};
 const tx=<T>(run:(c:PoolClient)=>Promise<T>)=>inTransaction(s.pool,async c=>{await c.query("SET LOCAL statement_timeout='2s'");await c.query("SET LOCAL lock_timeout='2s'");return run(c);});
 const current=async(c:PoolClient,a:Actor,caseId:string,k:string,v:string)=>{const row=(await c.query(`SELECT a.*,${available} assignee_available FROM case_review_assignments a WHERE tenant_id=$1 AND case_id=$2 AND item_key=$3 AND revision=$4 ORDER BY version DESC LIMIT 1`,[a.tenantId,caseId,k,v])).rows[0];return row?display(row):null;};
 const eligible=async(c:PoolClient,a:Actor,caseId:string,k:string,v:string,userId=a.userId)=>!!(await c.query(candidates+"SELECT 1 FROM current WHERE category='reviews' AND item_key=$5 AND revision=$6",[a.tenantId,userId,'reviewer',caseId,k,v])).rowCount;
 // Reuse the same independent-review eligibility for each current case reviewer.
 // Only static SQL aliases replace parameters; user values remain bound parameters.
 const forMember=candidates.replaceAll('$2','m.user_id').replaceAll('$3',"'reviewer'").replaceAll('$4','$2');
 app.get('/api/review-assignments',{preHandler:reviewer,schema:{querystring:{type:'object',additionalProperties:false,properties:{ownership:{type:'string',enum:['all','mine']},afterCaseId:uuid,afterKey:key,afterRevision:revision}}}},r=>tx(async c=>{
  const a=r.actor!,q=r.query as {ownership?:string;afterCaseId?:string;afterKey?:string;afterRevision?:string};
  if([q.afterCaseId,q.afterKey,q.afterRevision].filter(v=>v!==undefined).length%3)throw new ApiError(422,'Supply the complete review history cursor.');
  // History is scoped by fresh membership, independently of reminder settings or
  // pending eligibility. Absence from current does not mean a review is complete.
  const rows=(await c.query(candidates+`, latest AS (
   SELECT DISTINCT ON(a.case_id,a.item_key,a.revision) a.*,c.ref case_ref,c.title case_title,${available} assignee_available
   FROM case_review_assignments a JOIN scope c ON c.tenant_id=a.tenant_id AND c.id=a.case_id
   ORDER BY a.case_id,a.item_key,a.revision,a.version DESC
  ) SELECT a.*,x.title,x.item_key IS NOT NULL pending FROM latest a
   LEFT JOIN current x ON x.case_id=a.case_id AND x.item_key=a.item_key AND x.revision=a.revision AND x.category='reviews'
   WHERE ($5='all' OR a.assignee_id=$2) AND ($6::uuid IS NULL OR (a.case_id,a.item_key,a.revision)>($6::uuid,$7::text,$8::text))
   ORDER BY a.case_id,a.item_key,a.revision LIMIT 51`,[a.tenantId,a.userId,'reviewer',null,q.ownership??'all',q.afterCaseId??null,q.afterKey??null,q.afterRevision??null])).rows;
  const labels:Record<string,string>={claim_review:'Source claim',document_review:'Document claim',transcript_review:'Transcript interpretation',speech_review:'Speech interpretation',speech_correspondence_review:'Speech correspondence',report_review:'Frozen report',pdf_review:'PDF copy',docx_review:'DOCX copy',correspondence_review:'Extraction correspondence',source_review:'Source metadata',expense_review:'Expense'};
  const last=rows[49];return {items:rows.slice(0,50).map(row=>({key:row.item_key,revision:row.revision,caseId:row.case_id,caseRef:row.case_ref,caseTitle:row.case_title,title:row.title??(labels[row.item_key.split(':')[0]]??'Review')+' · '+row.item_key.split(':')[2].slice(0,8),pending:row.pending,assignment:display(row)})),next:rows.length>50?{caseId:last.case_id,key:last.item_key,revision:last.revision}:null};
 }));
 app.get(base,{preHandler:reviewer,schema:{params,querystring:{type:'object',required:['key','revision'],additionalProperties:false,properties:{key,revision,before:{type:'integer',minimum:1,maximum:1001},after:uuid}}}},r=>tx(async c=>{
  const a=r.actor!,{caseId}=r.params as {caseId:string},q=r.query as {key:string;revision:string;before?:number;after?:string};await s.findCase(c,a,caseId,true);
  const latest=await current(c,a,caseId,q.key,q.revision),pending=await eligible(c,a,caseId,q.key,q.revision);
  // Historical assignments remain accessible only through current case access.
  if(!latest&&!pending)notFound();
  const history=(await c.query(`SELECT a.*,${available} assignee_available FROM case_review_assignments a WHERE tenant_id=$1 AND case_id=$2 AND item_key=$3 AND revision=$4 AND ($5::int IS NULL OR version<$5) ORDER BY version DESC LIMIT 51`,[a.tenantId,caseId,q.key,q.revision,q.before??null])).rows;
  const people=pending?(await c.query(`SELECT m.user_id id,u.display_name name FROM case_memberships cm JOIN memberships m ON m.tenant_id=cm.tenant_id AND m.user_id=cm.user_id JOIN users u ON u.id=m.user_id
   JOIN LATERAL (${forMember} SELECT 1 FROM current WHERE category='reviews' AND item_key=$3 AND revision=$4) eligible ON true
   WHERE cm.tenant_id=$1 AND cm.case_id=$2 AND m.role='reviewer' AND ($5::uuid IS NULL OR m.user_id>$5) ORDER BY m.user_id LIMIT 51`,[a.tenantId,caseId,q.key,q.revision,q.after??null])).rows:[];
  return {current:latest,pending,history:history.slice(0,50).map(display),next:history.length>50?history[49].version:null,candidates:people.slice(0,50),candidatesNext:people.length>50?people[49].id:null};
 }));
 app.post(base,{preHandler:[s.requireCsrf,reviewer],schema:{params,body:{type:'object',required:['id','key','revision','expectedVersion','assigneeId','reason'],additionalProperties:false,properties:{id:uuid,key,revision,expectedVersion:{type:'integer',minimum:0,maximum:999},assigneeId:{anyOf:[uuid,{type:'null'}]},reason:{type:'string',minLength:10,maxLength:2000}}}}},r=>tx(async c=>{
  const a=r.actor!,{caseId}=r.params as {caseId:string},q=r.body as {id:string;key:string;revision:string;expectedVersion:number;assigneeId:string|null;reason:string},reason=q.reason.trim();
  if(reason.length<10||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(reason)||Buffer.from(reason).toString('utf8')!==reason)throw new ApiError(422,'Record a clear review assignment reason.');
  await s.findCase(c,a,caseId,true);
  const hash=createHash('sha256').update(JSON.stringify({key:q.key,revision:q.revision,expectedVersion:q.expectedVersion,assigneeId:q.assigneeId,reason})).digest('hex');
  const previous=(await c.query('SELECT actor_id,request_hash,version FROM case_review_assignments WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,q.id])).rows[0];
  if(previous){if(previous.actor_id!==a.userId||previous.request_hash!==hash)throw new ApiError(409,'Assignment request identity already used.');return {version:previous.version,current:await current(c,a,caseId,q.key,q.revision)};}
  if(!await eligible(c,a,caseId,q.key,q.revision))throw new ApiError(409,'This exact review is no longer pending for you. Refresh its context.');
  const latest=await current(c,a,caseId,q.key,q.revision);if((latest?.version??0)!==q.expectedVersion)throw new ApiError(409,'Review ownership changed. Refresh before assigning again.');
  let assigneeName:string|null=null;
  if(q.assigneeId){
   if(!await eligible(c,a,caseId,q.key,q.revision,q.assigneeId))throw new ApiError(422,'Choose a current case reviewer eligible for this independent review.');
   assigneeName=(await c.query('SELECT display_name FROM users WHERE id=$1',[q.assigneeId])).rows[0].display_name;
  }
  if((latest?.assigneeId??null)===q.assigneeId)throw new ApiError(409,'This reviewer assignment is already current.');
  const version=q.expectedVersion+1;
  await c.query('INSERT INTO case_review_assignments(tenant_id,case_id,id,item_key,revision,version,expected_version,assignee_id,assignee_name,actor_id,actor_name,reason,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[a.tenantId,caseId,q.id,q.key,q.revision,version,q.expectedVersion,q.assigneeId,assigneeName,a.userId,a.displayName,reason,hash]);
  await s.audit(c,a,caseId,'review.assigned','review_assignment',q.id,'Review coordination recorded; no review decision or access grant',{key:q.key,revision:q.revision,version,assigneeId:q.assigneeId});
  return {version,current:await current(c,a,caseId,q.key,q.revision)};
 }));
}
