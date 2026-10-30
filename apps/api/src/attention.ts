import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Pool,PoolClient,QueryResultRow} from 'pg';
import type {AttentionEntry,AttentionPreferences} from '@inveos/contracts';
import type {Actor} from './app.js';
import {inTransaction} from './db.js';
import {ApiError,notFound} from './errors.js';
type Services={pool:Pool;authenticate:(r:FastifyRequest)=>Promise<void>;requireCsrf:(r:FastifyRequest)=>Promise<void>;findCase:(c:PoolClient,a:Actor,id:string,lock?:boolean)=>Promise<unknown>;audit:(c:PoolClient,a:Actor,caseId:string|null,action:string,type:string,id:string,summary:string,metadata?:Record<string,unknown>)=>Promise<void>};
const uuid={type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'};
const key={type:'string',minLength:1,maxLength:200,pattern:'^[a-z_]+:[0-9a-f:-]+$'};
const defaults:AttentionPreferences={version:0,deadlines:true,failures:true,reviews:true,recordedAt:null};
const preferences=(r?:QueryResultRow):AttentionPreferences=>r?{version:r.version,deadlines:r.deadlines,failures:r.failures,reviews:r.reviews,recordedAt:r.recorded_at.toISOString()}:defaults;
// Current membership and current roles are joined inside the statement. No persisted notification payload grants access.
const candidates=`WITH scope AS (
 SELECT c.* FROM cases c JOIN case_memberships cm ON cm.tenant_id=c.tenant_id AND cm.case_id=c.id AND cm.user_id=$2
 JOIN memberships m ON m.tenant_id=cm.tenant_id AND m.user_id=cm.user_id AND m.role=$3 AND m.role IN ('reviewer','investigator')
 WHERE c.tenant_id=$1 AND ($4::uuid IS NULL OR c.id=$4)
), entries AS (
 SELECT w.case_id,w.id,'deadline'::text kind,'deadlines'::text category,w.title,w.kind work_kind,w.due_date::text due_date,
 w.version::text||':'||CASE WHEN w.due_date<(statement_timestamp() AT TIME ZONE 'UTC')::date THEN 'overdue' ELSE 'upcoming' END revision,
 CASE WHEN w.due_date<(statement_timestamp() AT TIME ZONE 'UTC')::date THEN 'Overdue' ELSE 'Due within seven days' END status,
 NULL::uuid evidence_id,NULL::uuid job_id,''::text extra,NULL::uuid context_id
 FROM case_work_items w JOIN scope c ON c.tenant_id=w.tenant_id AND c.id=w.case_id
 WHERE w.owner_id=$2 AND w.kind IN ('objective','task','question','handover') AND w.status NOT IN ('Complete','Resolved','Acknowledged')
 AND w.due_date<=(statement_timestamp() AT TIME ZONE 'UTC')::date+7 AND c.lifecycle_state NOT IN ('Closed','Archived')
 UNION ALL
 SELECT u.case_id,u.id,'upload_expired','failures',left(u.metadata->>'filename',150),NULL,NULL,'expired','Upload expired before completion',NULL,NULL,'',NULL
 FROM upload_reservations u JOIN scope c ON c.tenant_id=u.tenant_id AND c.id=u.case_id WHERE u.created_by=$2 AND u.status='open' AND u.expires_at<=statement_timestamp()
 UNION ALL
 SELECT j.case_id,j.id,'processing_failed','failures',e.filename,NULL,NULL,j.attempt::text,'Processing failed',j.evidence_id,j.id,'',NULL
 FROM integrity_jobs j JOIN scope c ON c.tenant_id=j.tenant_id AND c.id=j.case_id JOIN evidence e ON e.tenant_id=j.tenant_id AND e.case_id=j.case_id AND e.id=j.evidence_id
 WHERE j.requested_by=$2 AND j.status='failed'
 UNION ALL
 SELECT x.case_id,x.id,'claim_review','reviews',left(x.text,150),NULL,NULL,'pending','Claim awaits review',x.evidence_id,NULL,'',NULL
 FROM claims x JOIN scope c ON c.tenant_id=x.tenant_id AND c.id=x.case_id WHERE $3='reviewer' AND x.status='Under review' AND x.created_by<>$2 AND x.authority_version=c.authority_version AND c.lifecycle_state NOT IN ('Closed','Archived')
 UNION ALL
 SELECT x.case_id,x.id,'document_review','reviews',left(x.text,150),NULL,NULL,x.claim_digest::text,'Document claim awaits independent review',j.evidence_id,x.job_id,':'||x.job_id::text||':'||x.citation_id::text,NULL
 FROM document_claims x JOIN scope c ON c.tenant_id=x.tenant_id AND c.id=x.case_id JOIN integrity_jobs j ON j.tenant_id=x.tenant_id AND j.case_id=x.case_id AND j.id=x.job_id
 WHERE $3='reviewer' AND x.created_by<>$2 AND j.authority_version=c.authority_version AND c.lifecycle_state NOT IN ('Closed','Archived')
 AND NOT EXISTS(SELECT 1 FROM document_claim_decisions d WHERE d.tenant_id=x.tenant_id AND d.case_id=x.case_id AND d.job_id=x.job_id AND d.citation_id=x.citation_id AND d.claim_id=x.id)
 UNION ALL
 SELECT x.case_id,x.id,'transcript_review','reviews',left(x.snapshot->>'text',150),NULL,NULL,x.digest::text,'Transcript interpretation awaits independent review',t.evidence_id,NULL,'',x.transcript_id
 FROM transcript_claims x JOIN scope c ON c.tenant_id=x.tenant_id AND c.id=x.case_id
 JOIN interview_transcripts t ON t.tenant_id=x.tenant_id AND t.case_id=x.case_id AND t.id=x.transcript_id
 JOIN interview_transcript_segments seg ON seg.tenant_id=x.tenant_id AND seg.case_id=x.case_id AND seg.transcript_id=x.transcript_id AND seg.id=x.segment_id
 WHERE $3='reviewer' AND x.proposed_by<>$2 AND c.status='Active' AND c.lifecycle_state NOT IN ('Closed','Archived')
 AND t.authority_version=c.authority_version AND seg.current_version=x.segment_version
 AND NOT EXISTS(SELECT 1 FROM interview_transcript_corrections cr WHERE cr.tenant_id=x.tenant_id AND cr.case_id=x.case_id AND cr.transcript_id=x.transcript_id AND cr.segment_id=x.segment_id AND cr.version<=x.segment_version AND cr.actor_id=$2)
 AND NOT EXISTS(SELECT 1 FROM transcript_claim_reviews r WHERE r.tenant_id=x.tenant_id AND r.case_id=x.case_id AND r.claim_id=x.id)
 AND NOT EXISTS(SELECT 1 FROM transcript_claim_withdrawals w WHERE w.tenant_id=x.tenant_id AND w.case_id=x.case_id AND w.claim_id=x.id)
 UNION ALL
 SELECT r.case_id,r.id,'report_review','reviews','Frozen report '||left(r.id::text,8),NULL,NULL,r.digest::text||':'||c.authority_version::text,'Frozen report awaits independent review',NULL,NULL,'',r.id
 FROM report_revisions r JOIN scope c ON c.tenant_id=r.tenant_id AND c.id=r.case_id
 WHERE $3='reviewer' AND r.created_by<>$2 AND c.status='Active' AND c.authority_version IS NOT NULL AND c.lifecycle_state NOT IN ('Closed','Archived')
 AND NOT EXISTS(SELECT 1 FROM report_revision_reviews v WHERE v.tenant_id=r.tenant_id AND v.case_id=r.case_id AND v.revision_id=r.id)
 UNION ALL
 SELECT x.case_id,x.id,'pdf_review','reviews','PDF copy '||left(x.id::text,8),NULL,NULL,x.pdf_digest::text||':'||c.authority_version::text,'PDF copy awaits independent review',NULL,NULL,'',x.revision_id
 FROM report_renditions x JOIN scope c ON c.tenant_id=x.tenant_id AND c.id=x.case_id
 JOIN report_revisions r ON r.tenant_id=x.tenant_id AND r.case_id=x.case_id AND r.id=x.revision_id
 WHERE $3='reviewer' AND x.created_by<>$2 AND r.created_by<>$2 AND c.status='Active' AND c.authority_version IS NOT NULL AND c.lifecycle_state NOT IN ('Closed','Archived')
 AND NOT EXISTS(SELECT 1 FROM report_rendition_reviews v WHERE v.tenant_id=x.tenant_id AND v.case_id=x.case_id AND v.rendition_id=x.id)
 AND NOT EXISTS(SELECT 1 FROM report_revision_reviews v WHERE v.tenant_id=x.tenant_id AND v.case_id=x.case_id AND v.revision_id=x.revision_id AND v.decision='request_changes')
 UNION ALL
 SELECT x.case_id,x.id,'docx_review','reviews','DOCX copy '||left(x.id::text,8),NULL,NULL,x.docx_digest::text||':'||c.authority_version::text,'DOCX copy awaits independent review',NULL,NULL,'',x.revision_id
 FROM report_editable_renditions x JOIN scope c ON c.tenant_id=x.tenant_id AND c.id=x.case_id
 JOIN report_revisions r ON r.tenant_id=x.tenant_id AND r.case_id=x.case_id AND r.id=x.revision_id
 WHERE $3='reviewer' AND x.created_by<>$2 AND r.created_by<>$2 AND c.status='Active' AND c.authority_version IS NOT NULL AND c.lifecycle_state NOT IN ('Closed','Archived') AND x.profile='inveos_report_docx_v2'
 AND NOT EXISTS(SELECT 1 FROM report_editable_rendition_reviews v WHERE v.tenant_id=x.tenant_id AND v.case_id=x.case_id AND v.rendition_id=x.id)
 AND NOT EXISTS(SELECT 1 FROM report_revision_reviews v WHERE v.tenant_id=x.tenant_id AND v.case_id=x.case_id AND v.revision_id=x.revision_id AND v.decision='request_changes')
), current AS (SELECT e.*,e.kind||':'||e.case_id::text||':'||e.id::text||e.extra item_key,c.ref case_ref,c.title case_title FROM entries e JOIN scope c ON c.id=e.case_id)
`;
function display(r:QueryResultRow):AttentionEntry{return {key:r.item_key,revision:r.revision,caseId:r.case_id,caseRef:r.case_ref,caseTitle:r.case_title,id:r.id,kind:r.kind,category:r.category,title:r.title??'Expired upload',status:r.status,dueDate:r.due_date,workKind:r.work_kind,evidenceId:r.evidence_id,jobId:r.job_id,contextId:r.context_id};}
export function registerAttention(app:FastifyInstance,s:Services){
 const internal=async(r:FastifyRequest)=>{await s.authenticate(r);if(r.actor!.role==='client')throw new ApiError(403,'Internal attention queue only.');};
 const tx=<T>(run:(c:PoolClient)=>Promise<T>)=>inTransaction(s.pool,async c=>{await c.query("SET LOCAL statement_timeout='2s'");await c.query("SET LOCAL lock_timeout='2s'");return run(c);});
 const getPrefs=async(c:PoolClient,a:Actor)=>preferences((await c.query('SELECT * FROM attention_preferences WHERE tenant_id=$1 AND user_id=$2 ORDER BY version DESC LIMIT 1',[a.tenantId,a.userId])).rows[0]);
 app.get('/api/attention/preferences',{preHandler:internal},r=>tx(c=>getPrefs(c,r.actor!)));
 app.post('/api/attention/preferences',{preHandler:[s.requireCsrf,internal],schema:{body:{type:'object',additionalProperties:false,required:['requestId','expectedVersion','deadlines','failures','reviews'],properties:{requestId:uuid,expectedVersion:{type:'integer',minimum:0,maximum:2147483646},deadlines:{type:'boolean'},failures:{type:'boolean'},reviews:{type:'boolean'}}}}},r=>tx(async c=>{
  const a=r.actor!,input=r.body as AttentionPreferences&{requestId:string;expectedVersion:number};
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['attention:'+a.tenantId+':'+a.userId]);
  const member=(await c.query('SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2',[a.tenantId,a.userId])).rows[0];if(!member||member.role!==a.role||member.role==='client')throw new ApiError(403,'Current internal membership required.');
  const old=(await c.query('SELECT * FROM attention_preferences WHERE tenant_id=$1 AND user_id=$2 AND request_id=$3',[a.tenantId,a.userId,input.requestId])).rows[0];
  if(old){if(old.expected_version!==input.expectedVersion||old.deadlines!==input.deadlines||old.failures!==input.failures||old.reviews!==input.reviews)throw new ApiError(409,'Preference request identity already used.');return getPrefs(c,a);}
  const current=await getPrefs(c,a);if(current.version!==input.expectedVersion)throw new ApiError(409,'Preferences changed. Refresh before saving again.');
  const row=(await c.query('INSERT INTO attention_preferences(tenant_id,user_id,version,request_id,expected_version,deadlines,failures,reviews) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[a.tenantId,a.userId,current.version+1,input.requestId,current.version,input.deadlines,input.failures,input.reviews])).rows[0];
  await s.audit(c,a,null,'attention.preferences_saved','attention_preferences',a.userId,'Personal attention preferences updated',{version:row.version,deadlines:input.deadlines,failures:input.failures,reviews:input.reviews});return preferences(row);
 }));
 app.get('/api/attention',{preHandler:internal,schema:{querystring:{type:'object',additionalProperties:false,properties:{after:key,category:{enum:['deadlines','failures','reviews']},acknowledged:{type:'boolean'}}}}},r=>tx(async c=>{
  const a=r.actor!,input=r.query as {after?:string;category?:string;acknowledged?:boolean},prefs=await getPrefs(c,a);
  const enabled=['deadlines','failures','reviews'].filter(k=>prefs[k as 'deadlines'|'failures'|'reviews']);
  const rows=(await c.query(candidates+`SELECT x.*,EXISTS(SELECT 1 FROM attention_acknowledgements d WHERE d.tenant_id=$1 AND d.case_id=x.case_id AND d.user_id=$2 AND d.item_key=x.item_key AND d.revision=x.revision) acknowledged FROM current x
   WHERE ($5::text IS NULL OR x.item_key COLLATE "C">$5 COLLATE "C") AND x.category=ANY($6::text[]) AND ($7::text IS NULL OR x.category=$7)
   AND ($8::boolean OR NOT EXISTS(SELECT 1 FROM attention_acknowledgements d WHERE d.tenant_id=$1 AND d.case_id=x.case_id AND d.user_id=$2 AND d.item_key=x.item_key AND d.revision=x.revision))
   ORDER BY x.item_key COLLATE "C" LIMIT 51`,[a.tenantId,a.userId,a.role,null,input.after??null,enabled,input.category??null,input.acknowledged??false])).rows;
  return {items:rows.slice(0,50).map(row=>({...display(row),acknowledged:row.acknowledged})),next:rows.length>50?rows[49].item_key:null,preferences:prefs,asOf:new Date().toISOString(),interpretation:'personal_attention_not_review'};
 }));
 app.post('/api/cases/:caseId/attention/acknowledge',{preHandler:[s.requireCsrf,internal],schema:{params:{type:'object',required:['caseId'],additionalProperties:false,properties:{caseId:uuid}},body:{type:'object',additionalProperties:false,required:['key','revision'],properties:{key,revision:{type:'string',minLength:1,maxLength:100}}}}},r=>tx(async c=>{
  const a=r.actor!,{caseId}=r.params as {caseId:string},input=r.body as {key:string;revision:string};await s.findCase(c,a,caseId,true);
  const row=(await c.query(candidates+'SELECT * FROM current WHERE item_key=$5',[a.tenantId,a.userId,a.role,caseId,input.key])).rows[0];if(!row)notFound();if(row.revision!==input.revision)throw new ApiError(409,'This attention item changed. Refresh before acknowledging.');
  const saved=await c.query('INSERT INTO attention_acknowledgements(tenant_id,case_id,user_id,item_key,revision) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING recorded_at',[a.tenantId,caseId,a.userId,input.key,input.revision]);
  if(saved.rowCount)await s.audit(c,a,caseId,'attention.acknowledged','attention_item',row.id,'Personal acknowledgement only; underlying work remains unchanged',{key:input.key,revision:input.revision});return {acknowledged:true};
 }));
}
