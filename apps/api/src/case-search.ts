import {sourceUseProofs} from './source-use.js';
import {createHash} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import type {CaseSearchFilter,CaseSearchResult,SavedCaseView} from '@inveos/contracts';
import type {Actor} from './app.js';
import {inTransaction} from './db.js';
import {ApiError,notFound} from './errors.js';

type Services={pool:Pool;authenticate:(r:FastifyRequest)=>Promise<void>;requireCsrf:(r:FastifyRequest)=>Promise<void>;findCase:(c:PoolClient,a:Actor,id:string,lock?:boolean)=>Promise<unknown>;audit:(c:PoolClient,a:Actor,caseId:string,action:string,entity:string,id:string,summary:string)=>Promise<void>};
const kinds=['original','claim','document_claim','document_text','text_finding','document_finding','work','chronology','entity','relationship','source_context','transcript','transcript_claim','transcript_finding','speech_claim','speech_finding'];
const uuid={type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'};
const filterProperties={query:{type:'string',maxLength:200},kind:{enum:['all',...kinds]},status:{type:'string',maxLength:40}};
const filterSchema={type:'object',additionalProperties:false,required:Object.keys(filterProperties),properties:filterProperties};
const params={type:'object',additionalProperties:false,required:['caseId'],properties:{caseId:uuid}};
const viewParams={...params,required:['caseId','viewId'],properties:{...params.properties,viewId:uuid}};
const clean=(s:string)=>Buffer.from(s).toString('utf8')===s&&!/[\u0000-\u001f\u007f]/u.test(s);
function validate(filter:CaseSearchFilter){if(!clean(filter.query)||!clean(filter.status))throw new ApiError(422,'Use a plain search phrase and status.');}
// Search describes current stored records. It never asserts source-byte verification or evidential truth.
const records=`
 SELECT 'transcript' kind,t.id,t.title title,t.title||' '||coalesce((SELECT string_agg(coalesce(c.text,g.raw_text),' ' ORDER BY g.ordinal) FROM interview_transcript_segments g LEFT JOIN interview_transcript_corrections c ON c.tenant_id=g.tenant_id AND c.case_id=g.case_id AND c.transcript_id=g.transcript_id AND c.segment_id=g.id AND c.version=g.current_version WHERE g.tenant_id=t.tenant_id AND g.case_id=t.case_id AND g.transcript_id=t.id),'') body,'Supplied transcript' status,t.evidence_id,'Interview' page FROM interview_transcripts t WHERE t.tenant_id=$1 AND t.case_id=$2
 UNION ALL
 SELECT entry.kind,entry.id,left(p.snapshot->>'text',120),(p.snapshot->>'text')||' '||(p.snapshot#>>'{reference,quote}')||' '||(p.snapshot#>>'{reference,speakerLabel}'),CASE WHEN w.claim_id IS NOT NULL THEN 'Withdrawn' WHEN r.accepted=false THEN 'Rejected' WHEN g.current_version<>p.segment_version OR k.authority_version<>(p.snapshot#>>'{source,policy,authorityVersion}')::int OR k.status<>'Active' THEN 'Needs fresh review' WHEN r.accepted THEN 'Recorded independent review' ELSE 'Proposed interpretation' END,t.evidence_id,'Interview' FROM transcript_claims p JOIN interview_transcript_segments g ON g.tenant_id=p.tenant_id AND g.case_id=p.case_id AND g.transcript_id=p.transcript_id AND g.id=p.segment_id JOIN interview_transcripts t ON t.tenant_id=p.tenant_id AND t.case_id=p.case_id AND t.id=p.transcript_id JOIN cases k ON k.tenant_id=p.tenant_id AND k.id=p.case_id LEFT JOIN transcript_claim_reviews r ON r.tenant_id=p.tenant_id AND r.case_id=p.case_id AND r.claim_id=p.id LEFT JOIN transcript_findings f ON f.tenant_id=p.tenant_id AND f.case_id=p.case_id AND f.claim_id=p.id LEFT JOIN transcript_claim_withdrawals w ON w.tenant_id=p.tenant_id AND w.case_id=p.case_id AND w.claim_id=p.id CROSS JOIN LATERAL (VALUES ('transcript_claim',p.id),('transcript_finding',f.id)) entry(kind,id) WHERE entry.id IS NOT NULL AND p.tenant_id=$1 AND p.case_id=$2
 UNION ALL
 SELECT entry.kind,entry.id,left(p.snapshot->>'text',120),(p.snapshot->>'text')||' '||(p.snapshot#>>'{reference,quote}')||' '||coalesce(p.snapshot#>>'{reference,account,speakerLabel}',''),
 CASE WHEN w.claim_id IS NOT NULL THEN 'Withdrawn' WHEN r.accepted=false THEN 'Rejected'
 WHEN coalesce((SELECT max(x.version) FROM speech_segment_corrections x WHERE x.tenant_id=p.tenant_id AND x.case_id=p.case_id AND x.job_id=p.job_id AND x.segment_index=p.segment_index),0)<>p.segment_version OR k.authority_version<>(p.snapshot#>>'{source,policy,authorityVersion}')::int OR k.status<>'Active' THEN 'Needs fresh review'
 WHEN r.accepted THEN 'Recorded independent review' ELSE 'Proposed interpretation' END,j.evidence_id,'Interview'
 FROM speech_claims p JOIN integrity_jobs j ON j.tenant_id=p.tenant_id AND j.case_id=p.case_id AND j.id=p.job_id JOIN cases k ON k.tenant_id=p.tenant_id AND k.id=p.case_id
 LEFT JOIN speech_claim_reviews r ON r.tenant_id=p.tenant_id AND r.case_id=p.case_id AND r.claim_id=p.id
 LEFT JOIN speech_findings f ON f.tenant_id=p.tenant_id AND f.case_id=p.case_id AND f.claim_id=p.id
 LEFT JOIN speech_claim_withdrawals w ON w.tenant_id=p.tenant_id AND w.case_id=p.case_id AND w.claim_id=p.id
 CROSS JOIN LATERAL (VALUES ('speech_claim',p.id),('speech_finding',f.id)) entry(kind,id)
 WHERE entry.id IS NOT NULL AND p.tenant_id=$1 AND p.case_id=$2
 UNION ALL
 SELECT 'source_context' kind,h.id,r.snapshot->>'publisher' title,(r.snapshot->>'publisher')||' '||(r.snapshot->>'url')||' '||(r.snapshot->>'annotation') body,CASE WHEN (r.snapshot->>'withdrawn')::boolean THEN 'Withdrawn source context' WHEN v.accepted THEN 'Recorded metadata review' WHEN v.accepted=false THEN 'Rejected source context' ELSE 'Pending metadata review' END status,h.evidence_id,'Research' page FROM manual_sources h JOIN manual_source_revisions r ON r.tenant_id=h.tenant_id AND r.case_id=h.case_id AND r.source_id=h.id AND r.version=h.version LEFT JOIN manual_source_reviews v ON v.tenant_id=r.tenant_id AND v.case_id=r.case_id AND v.source_id=r.source_id AND v.version=r.version WHERE h.tenant_id=$1 AND h.case_id=$2
 UNION ALL
 SELECT 'entity' kind,e.id,r.snapshot->>'label' title,(r.snapshot->>'label')||' '||(r.snapshot->>'detail')||' '||coalesce((SELECT string_agg(attribute->>'value',' ' ORDER BY ordinal) FROM jsonb_array_elements(coalesce(r.snapshot->'attributes','[]'::jsonb)) WITH ORDINALITY AS values_in_revision(attribute,ordinal)),'') body,CASE WHEN (r.snapshot->>'withdrawn')::boolean THEN 'Withdrawn entity' ELSE 'Entity record' END status,NULL::uuid evidence_id,'Intelligence' page FROM graph_entities e JOIN graph_entity_revisions r ON r.tenant_id=e.tenant_id AND r.case_id=e.case_id AND r.entity_id=e.id AND r.version=e.version WHERE e.tenant_id=$1 AND e.case_id=$2
 UNION ALL SELECT 'relationship',e.id,r.snapshot->>'relationship',(r.snapshot->>'relationship')||' '||(r.snapshot->>'account'),CASE WHEN (r.snapshot->>'withdrawn')::boolean THEN 'Withdrawn relationship' WHEN v.accepted THEN 'Recorded graph review' WHEN v.accepted=false THEN 'Rejected interpretation' ELSE 'Candidate interpretation' END,NULL::uuid,'Intelligence' FROM graph_relationships e JOIN graph_relationship_revisions r ON r.tenant_id=e.tenant_id AND r.case_id=e.case_id AND r.relationship_id=e.id AND r.version=e.version LEFT JOIN graph_relationship_reviews v ON v.tenant_id=r.tenant_id AND v.case_id=r.case_id AND v.relationship_id=r.relationship_id AND v.version=r.version WHERE e.tenant_id=$1 AND e.case_id=$2
 UNION ALL
 SELECT 'original' kind,id,filename title,filename||' '||method body,status,id evidence_id,'Evidence' page FROM evidence WHERE tenant_id=$1 AND case_id=$2
 UNION ALL SELECT 'document_text',d.job_id,e.filename,convert_from(d.output_bytes,'UTF8')::jsonb->>'text',CASE WHEN d.kind IN ('tesseract_scan_lab_v1','tesseract_scan_lab_v2') THEN 'Unreviewed OCR text' ELSE 'Unreviewed extracted text' END,d.evidence_id,'Evidence' FROM document_derivatives d JOIN evidence e ON e.tenant_id=d.tenant_id AND e.case_id=d.case_id AND e.id=d.evidence_id JOIN integrity_jobs j ON j.tenant_id=d.tenant_id AND j.case_id=d.case_id AND j.id=d.job_id WHERE d.tenant_id=$1 AND d.case_id=$2 AND j.status='succeeded'
 UNION ALL SELECT 'claim',id,left(text,120),text||' '||quote,status,evidence_id,'Findings' FROM claims WHERE tenant_id=$1 AND case_id=$2
 UNION ALL SELECT 'document_claim',c.id,left(c.text,120),c.text,CASE WHEN d.accepted IS NULL THEN 'Pending interpretation review' WHEN d.accepted THEN 'Accepted interpretation' ELSE 'Rejected interpretation' END,j.evidence_id,'Evidence' FROM document_claims c JOIN integrity_jobs j ON j.tenant_id=c.tenant_id AND j.case_id=c.case_id AND j.id=c.job_id LEFT JOIN document_claim_decisions d ON d.tenant_id=c.tenant_id AND d.case_id=c.case_id AND d.job_id=c.job_id AND d.citation_id=c.citation_id AND d.claim_id=c.id WHERE c.tenant_id=$1 AND c.case_id=$2
 UNION ALL SELECT 'text_finding',f.id,left(f.text,120),f.text,'Recorded review',c.evidence_id,'Findings' FROM findings f JOIN claims c ON c.tenant_id=f.tenant_id AND c.case_id=f.case_id AND c.id=f.claim_id WHERE f.tenant_id=$1 AND f.case_id=$2
 UNION ALL SELECT 'document_finding',f.id,left(f.text,120),f.text,'Recorded review',j.evidence_id,'Evidence' FROM document_findings f JOIN integrity_jobs j ON j.tenant_id=f.tenant_id AND j.case_id=f.case_id AND j.id=f.job_id WHERE f.tenant_id=$1 AND f.case_id=$2
 UNION ALL SELECT 'work',id,title,kind||' '||title||' '||body,status,NULL::uuid,CASE WHEN kind='task' THEN 'Tasks' ELSE 'Brief' END FROM case_work_items WHERE tenant_id=$1 AND case_id=$2
 UNION ALL SELECT 'chronology',e.id,r.snapshot->>'title',(r.snapshot->>'title')||' '||(r.snapshot->>'account')||' '||(r.snapshot#>>'{time,note}'),r.snapshot->>'status',NULL::uuid,'Timeline' FROM chronology_events e JOIN chronology_revisions r ON r.tenant_id=e.tenant_id AND r.case_id=e.case_id AND r.event_id=e.id AND r.version=e.version WHERE e.tenant_id=$1 AND e.case_id=$2`;

export function registerCaseSearch(app:FastifyInstance,s:Services){
 const internal=async(r:FastifyRequest)=>{await s.authenticate(r);if(r.actor!.role==='client')throw new ApiError(403,'Internal case search only.');};
 const base='/api/cases/:caseId',views=base+'/saved-views';
 app.post(base+'/search',{preHandler:s.requireCsrf,schema:{params,body:{type:'object',additionalProperties:false,required:Object.keys(filterProperties),properties:{...filterProperties,after:{type:'object',additionalProperties:false,required:['kind','id'],properties:{kind:{enum:kinds},id:uuid}}}}}},async r=>inTransaction(s.pool,async c=>{
  const actor=r.actor!,{caseId}=r.params as {caseId:string};if(actor.role==='client')throw new ApiError(403,'Internal case search only.');await s.findCase(c,actor,caseId);
  const input=r.body as CaseSearchFilter&{after?:{kind:string;id:string}};validate(input);
  await c.query("SET LOCAL statement_timeout='2s'");
  const found=await c.query(`WITH records AS (${records}), matched AS (SELECT * FROM records WHERE strpos(lower(body),lower($3))>0 AND ($4='' OR status=$4)),
   facets AS (SELECT kind,count(*)::int count FROM matched GROUP BY kind),
   page AS (SELECT kind,id,title,substring(body FROM greatest(1,strpos(lower(body),lower($3))-60) FOR 260) excerpt,status,evidence_id AS "evidenceId",page FROM matched WHERE ($5='all' OR kind=$5) AND ($6::text IS NULL OR (kind,id)>($6,$7::uuid)) ORDER BY kind,id LIMIT 51)
   SELECT (SELECT coalesce(jsonb_agg(facets ORDER BY kind),'[]'::jsonb) FROM facets) facets,(SELECT coalesce(jsonb_agg(p ORDER BY p.kind,p.id),'[]'::jsonb) FROM page p) items`,[actor.tenantId,caseId,input.query.trim(),input.status,input.kind,input.after?.kind??null,input.after?.id??null]);
  const {facets,items}=found.rows[0],more=items.length>50;if(more)items.pop();const last=items.at(-1);
  for(const id of new Set<string>(items.filter((item:{evidenceId:string|null;kind:string})=>item.evidenceId&&!['original','source_context'].includes(item.kind)).map((item:{evidenceId:string})=>item.evidenceId)))await sourceUseProofs(c,actor.tenantId,caseId,id,'analysis');
  for(const item of items)if(item.kind==='speech_claim'||item.kind==='speech_finding'){const row=(await c.query('SELECT p.job_id FROM speech_claims p LEFT JOIN speech_findings f ON f.tenant_id=p.tenant_id AND f.case_id=p.case_id AND f.claim_id=p.id WHERE p.tenant_id=$1 AND p.case_id=$2 AND (($3=\'speech_claim\' AND p.id=$4) OR ($3=\'speech_finding\' AND f.id=$4))',[actor.tenantId,caseId,item.kind,item.id])).rows[0];if(!row)throw new ApiError(409,'Speech search source changed.');item.speechJobId=row.job_id;}
  return {items,facets,next:more?{kind:last.kind,id:last.id}:null,interpretation:'stored_records_reverify_sources'} satisfies CaseSearchResult;
 }));
 app.get(views,{preHandler:internal,schema:{params}},async r=>inTransaction(s.pool,async c=>{
  const actor=r.actor!,{caseId}=r.params as {caseId:string};await s.findCase(c,actor,caseId);
  const result=await c.query(`SELECT r.snapshot FROM saved_case_views v JOIN saved_case_view_revisions r ON r.tenant_id=v.tenant_id AND r.case_id=v.case_id AND r.owner_id=v.owner_id AND r.view_id=v.id AND r.version=v.version WHERE v.tenant_id=$1 AND v.case_id=$2 AND v.owner_id=$3 ORDER BY v.id LIMIT 50`,[actor.tenantId,caseId,actor.userId]);return result.rows.map(v=>v.snapshot);
 }));
 const save=async(r:FastifyRequest,edit:boolean)=>inTransaction(s.pool,async c=>{
  const actor=r.actor!,{caseId,viewId}=r.params as {caseId:string;viewId?:string};if(actor.role==='client')throw new ApiError(403,'Internal case views only.');await s.findCase(c,actor,caseId,true);
  const input=r.body as {id:string;name:string;filter:CaseSearchFilter;withdrawn:boolean;expectedVersion:number};validate(input.filter);if(!clean(input.name)||input.name.trim().length<3)throw new ApiError(422,'Name the saved view.');
  const id=edit?viewId!:input.id,keys=[actor.tenantId,caseId,actor.userId,id];
  const current=(await c.query(`SELECT v.request_hash,r.snapshot FROM saved_case_views v JOIN saved_case_view_revisions r ON r.tenant_id=v.tenant_id AND r.case_id=v.case_id AND r.owner_id=v.owner_id AND r.view_id=v.id AND r.version=v.version WHERE v.tenant_id=$1 AND v.case_id=$2 AND v.owner_id=$3 AND v.id=$4`,keys)).rows[0];
  const hash=createHash('sha256').update(JSON.stringify([input.name,input.filter.query,input.filter.kind,input.filter.status,input.withdrawn])).digest('hex');
  if(!edit&&current){if(current.request_hash!==hash)throw new ApiError(409,'Saved-view identity already used.');return current.snapshot;}
  if(edit&&!current)notFound();if(edit&&current.snapshot.version!==input.expectedVersion)throw new ApiError(409,'Saved view changed. Refresh and compare before editing.');
  if(edit&&current.snapshot.version>=100)throw new ApiError(422,'Saved-view revision limit reached.');
  if(!edit){const count=(await c.query('SELECT count(*)::int n FROM saved_case_views WHERE tenant_id=$1 AND case_id=$2 AND owner_id=$3',keys.slice(0,3))).rows[0].n;if(count>=50)throw new ApiError(422,'Saved-view limit reached.');}
  const snapshot:SavedCaseView={id,name:input.name,filter:input.filter,withdrawn:input.withdrawn,version:edit?current.snapshot.version+1:1};
  if(edit)await c.query('UPDATE saved_case_views SET version=$5 WHERE tenant_id=$1 AND case_id=$2 AND owner_id=$3 AND id=$4',[...keys,snapshot.version]);
  else await c.query('INSERT INTO saved_case_views(tenant_id,case_id,owner_id,id,request_hash) VALUES($1,$2,$3,$4,$5)',[...keys,hash]);
  await c.query('INSERT INTO saved_case_view_revisions(tenant_id,case_id,owner_id,view_id,version,snapshot) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[...keys,snapshot.version,JSON.stringify(snapshot)]);
  await s.audit(c,actor,caseId,'search_view.saved','saved_view',id,`Private saved-view revision ${snapshot.version}`);return snapshot;
 });
 const properties={name:{type:'string',minLength:3,maxLength:100},filter:filterSchema,withdrawn:{type:'boolean'}};
 app.post(views,{preHandler:s.requireCsrf,schema:{params,body:{type:'object',additionalProperties:false,required:['id',...Object.keys(properties)],properties:{id:uuid,...properties}}}},r=>save(r,false));
 app.post(views+'/:viewId/revise',{preHandler:s.requireCsrf,schema:{params:viewParams,body:{type:'object',additionalProperties:false,required:['expectedVersion',...Object.keys(properties)],properties:{...properties,expectedVersion:{type:'integer',minimum:1,maximum:100}}}}},r=>save(r,true));
 app.get(views+'/:viewId/history',{preHandler:internal,schema:{params:viewParams}},async r=>inTransaction(s.pool,async c=>{
  const a=r.actor!,{caseId,viewId}=r.params as {caseId:string;viewId:string};await s.findCase(c,a,caseId);const rows=(await c.query('SELECT snapshot,recorded_at AS "recordedAt" FROM saved_case_view_revisions WHERE tenant_id=$1 AND case_id=$2 AND owner_id=$3 AND view_id=$4 ORDER BY version DESC LIMIT 100',[a.tenantId,caseId,a.userId,viewId])).rows;if(!rows.length)notFound();return rows;
 }));
}
