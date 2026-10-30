import {randomUUID} from 'node:crypto';
import {createCaseWorkItem,displayWork} from './casework.js';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Pool,PoolClient,QueryResultRow} from 'pg';
import type {AnalysisDecision,AnalysisMode,AnalysisRun,AnalysisRunRecord,AnalysisSource,ChronologySource,ReviewedSourceFinding} from '@inveos/contracts';
import type {Actor} from './app.js';
import type {LifecycleCase} from './case-lifecycle.js';
import {inTransaction} from './db.js';
import {ApiError,notFound} from './errors.js';
import {transcriptHash as hash} from './transcript-findings.js';
import {analyseSources,analysisSource} from './case-analysis-rules.js';
type Services={pool:Pool;assertSession:(c:PoolClient,a:Actor)=>Promise<void>;authenticate:(r:FastifyRequest)=>Promise<void>;requireCsrf:(r:FastifyRequest)=>Promise<void>;findCase:(c:PoolClient,a:Actor,id:string,lock?:boolean)=>Promise<LifecycleCase>;source:(c:PoolClient,a:Actor,caseId:string,source:ChronologySource)=>Promise<ReviewedSourceFinding>;audit:(c:PoolClient,a:Actor,caseId:string,action:string,type:string,id:string,summary:string)=>Promise<void>};
const uuid={type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'};
const params={type:'object',additionalProperties:false,required:['caseId'],properties:{caseId:uuid}},item={...params,required:['caseId','id'],properties:{...params.properties,id:uuid}},suggestionParams={...item,required:[...item.required,'suggestion'],properties:{...item.properties,suggestion:{type:'integer',minimum:0,maximum:39}}};
const reference={type:'object',additionalProperties:false,required:['kind','findingId'],properties:{kind:{enum:['text_finding','document_finding','transcript_finding','speech_finding']},findingId:uuid}};
const clean=(v:string)=>Buffer.from(v).toString('utf8')===v&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v);
const runDigest=(r:AnalysisRun)=>hash(Object.fromEntries(Object.entries(r).filter(([key])=>key!=='digest')));
const displayDecision=(r:QueryResultRow):AnalysisDecision=>({id:r.id,suggestion:r.suggestion,version:r.version,disposition:r.disposition,reason:r.reason,actorId:r.actor_id,actorName:r.actor_name,recordedAt:r.recorded_at.toISOString()});
export function registerCaseAnalysis(app:FastifyInstance,s:Services){
 const base='/api/cases/:caseId/analysis',read=async(r:FastifyRequest)=>{await s.authenticate(r);if(r.actor!.role==='client')throw new ApiError(403,'Internal case analysis only.');};
 const tx=<T>(r:FastifyRequest,f:(c:PoolClient)=>Promise<T>)=>inTransaction(s.pool,async c=>{await c.query("SET LOCAL statement_timeout='5s'");await c.query("SET LOCAL lock_timeout='2s'");await s.assertSession(c,r.actor!);const value=await f(c);await s.assertSession(c,r.actor!);return value;});
 async function checkSources(c:PoolClient,a:Actor,caseId:string,refs:ChronologySource[]){const sources:AnalysisSource[]=[];for(const ref of refs)sources.push(analysisSource(ref,await s.source(c,a,caseId,ref)));return sources;}
 async function load(c:PoolClient,a:Actor,caseId:string,id:string):Promise<AnalysisRunRecord>{
  const kase=await s.findCase(c,a,caseId,true),row=(await c.query('SELECT * FROM case_analysis_runs WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,id])).rows[0];if(!row)notFound();const run=row.snapshot as AnalysisRun;
  if(run.id!==id||run.caseId!==caseId||run.createdBy!==row.created_by||run.createdAt!==row.created_at.toISOString()||run.authorityVersion!==row.authority_version||run.profile!=='cited_rules_v1'||run.digest!==row.digest.trim()||runDigest(run)!==run.digest)throw new ApiError(409,'Stored analysis provenance changed.');
  if(kase.status!=='Active'||!['Active','Review'].includes(kase.lifecycle_state)||run.authorityVersion!==kase.authority_version)throw new ApiError(409,'This run requires its current case authority. Create a new run after scope changes; the original run is retained.');
  const rows=(await c.query('SELECT * FROM case_analysis_sources WHERE tenant_id=$1 AND case_id=$2 AND run_id=$3 ORDER BY ordinal',[a.tenantId,caseId,id])).rows;
  const refs=rows.map((r,i)=>{if(r.ordinal!==i)throw new ApiError(409,'Analysis source history is incomplete.');return {kind:r.text_finding_id?'text_finding':r.document_finding_id?'document_finding':r.transcript_finding_id?'transcript_finding':'speech_finding',findingId:r.text_finding_id??r.document_finding_id??r.transcript_finding_id??r.speech_finding_id} as ChronologySource;});
  if(!refs.length||refs.length>8||hash(refs)!==hash(run.sources.map(v=>v.reference)))throw new ApiError(409,'Analysis source references changed.');
  if(hash(await checkSources(c,a,caseId,refs))!==hash(run.sources))throw new ApiError(409,'A selected reviewed source changed. Create a new analysis run; previous suggestions are retained.');
  const computed=analyseSources(run.sources,run.mode,run.question);if(hash(computed)!==hash({passages:run.passages,suggestions:run.suggestions,limitations:run.limitations}))throw new ApiError(409,'Stored rule output differs from its declared profile.');
  const decisions=(await c.query('SELECT DISTINCT ON(suggestion) * FROM case_analysis_decisions WHERE tenant_id=$1 AND case_id=$2 AND run_id=$3 ORDER BY suggestion,version DESC',[a.tenantId,caseId,id])).rows.map(displayDecision);
  if(decisions.some(d=>!run.suggestions[d.suggestion]))throw new ApiError(409,'Analysis decision refers to a missing suggestion.');
  const followups=(await c.query('SELECT suggestion,decision_version,work_id FROM case_analysis_followups WHERE tenant_id=$1 AND case_id=$2 AND run_id=$3 ORDER BY suggestion',[a.tenantId,caseId,id])).rows.map(v=>({suggestion:v.suggestion,decisionVersion:v.decision_version,workId:v.work_id}));
  return {run,decisions,followups,sourceVerification:'current_reviewed_sources_reverified',canDecide:a.role==='reviewer'&&a.userId!==run.createdBy};
 }
 app.get(base,{preHandler:read,schema:{params,querystring:{type:'object',additionalProperties:false,properties:{after:uuid}}}},r=>tx(r,async c=>{
  const a=r.actor!,{caseId}=r.params as {caseId:string},{after}=r.query as {after?:string};await s.findCase(c,a,caseId);
  const rows=(await c.query(`SELECT id,created_at,created_by,authority_version,snapshot->>'mode' mode,snapshot->>'question' question,jsonb_array_length(snapshot->'sources') source_count,jsonb_array_length(snapshot->'suggestions') suggestion_count FROM case_analysis_runs WHERE tenant_id=$1 AND case_id=$2 AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT 26`,[a.tenantId,caseId,after??null])).rows;
  return {items:rows.slice(0,25).map(v=>({id:v.id,mode:v.mode,question:v.question,createdAt:v.created_at.toISOString(),createdBy:v.created_by,authorityVersion:v.authority_version,sourceCount:v.source_count,suggestionCount:v.suggestion_count})),next:rows.length>25?rows[24].id:null};
 }));
 app.get(base+'/:id',{preHandler:read,schema:{params:item}},r=>tx(r,c=>{const {caseId,id}=r.params as {caseId:string;id:string};return load(c,r.actor!,caseId,id);}));
 app.post(base,{preHandler:[s.requireCsrf,read],schema:{params,body:{type:'object',additionalProperties:false,required:['id','mode','question','sources'],properties:{id:uuid,mode:{enum:['passages','question','comparison']},question:{type:'string',maxLength:1000},sources:{type:'array',minItems:1,maxItems:8,items:reference}}}}},r=>tx(r,async c=>{
  const a=r.actor!,{caseId}=r.params as {caseId:string},q=r.body as {id:string;mode:AnalysisMode;question:string;sources:ChronologySource[]};
  if(!clean(q.question)||(q.mode==='question'&&q.question.trim().length<3)||new Set(q.sources.map(v=>v.kind+v.findingId)).size!==q.sources.length||(q.mode==='comparison'&&q.sources.length<2))throw new ApiError(422,'Choose distinct sources, at least two for comparison, and a clear question for passage retrieval.');
  const kase=await s.findCase(c,a,caseId,true),requestHash=hash(q),old=(await c.query('SELECT request_hash,created_by FROM case_analysis_runs WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,q.id])).rows[0];
  if(old){if(old.created_by!==a.userId||old.request_hash.trim()!==requestHash)throw new ApiError(409,'Analysis request identity already used.');return load(c,a,caseId,q.id);}
  if(kase.status!=='Active'||!kase.authority_version||!['Active','Review'].includes(kase.lifecycle_state))throw new ApiError(409,'Current active case authority is required.');
  if((await c.query('SELECT count(*)::int n FROM case_analysis_runs WHERE tenant_id=$1 AND case_id=$2',[a.tenantId,caseId])).rows[0].n>=1000)throw new ApiError(422,'Case analysis run limit reached.');
  const sources=await checkSources(c,a,caseId,q.sources),at=(await c.query('SELECT clock_timestamp() at')).rows[0].at.toISOString();
  const run:AnalysisRun={id:q.id,caseId,authorityVersion:kase.authority_version,createdBy:a.userId,createdAt:at,profile:'cited_rules_v1',mode:q.mode,question:q.question,sources,...analyseSources(sources,q.mode,q.question),digest:''};run.digest=runDigest(run);
  if(Buffer.byteLength(JSON.stringify(run))>200000)throw new ApiError(422,'Selected analysis exceeds its context bound. Select fewer passages.');
  await c.query('INSERT INTO case_analysis_runs(tenant_id,case_id,id,authority_version,created_by,created_at,request_hash,snapshot,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)',[a.tenantId,caseId,q.id,kase.authority_version,a.userId,at,requestHash,JSON.stringify(run),run.digest]);
  for(const [ordinal,ref] of q.sources.entries())await c.query('INSERT INTO case_analysis_sources(tenant_id,case_id,run_id,ordinal,text_finding_id,document_finding_id,transcript_finding_id,speech_finding_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[a.tenantId,caseId,q.id,ordinal,...(['text_finding','document_finding','transcript_finding','speech_finding'] as const).map(kind=>kind===ref.kind?ref.findingId:null)]);
  await s.audit(c,a,caseId,'analysis.created','case_analysis',q.id,'Cited rule suggestions saved separately from claims and findings');return {run,decisions:[],followups:[],sourceVerification:'current_reviewed_sources_reverified',canDecide:false} satisfies AnalysisRunRecord;
 }));
 app.post(base+'/:id/suggestions/:suggestion/decisions',{preHandler:[s.requireCsrf,read],schema:{params:suggestionParams,body:{type:'object',additionalProperties:false,required:['id','expectedVersion','disposition','reason'],properties:{id:uuid,expectedVersion:{type:'integer',minimum:0,maximum:99},disposition:{enum:['request_check','dismiss']},reason:{type:'string',minLength:10,maxLength:2000}}}}},r=>tx(r,async c=>{
  const a=r.actor!,{caseId,id,suggestion}=r.params as {caseId:string;id:string;suggestion:number},q=r.body as {id:string;expectedVersion:number;disposition:'request_check'|'dismiss';reason:string};
  if(a.role!=='reviewer')throw new ApiError(403,'An independent case reviewer records suggestion triage.');if(!clean(q.reason)||q.reason.trim().length<10)throw new ApiError(422,'Record a clear triage reason.');
  const record=await load(c,a,caseId,id);if(!record.run.suggestions[suggestion])notFound();if(!record.canDecide)throw new ApiError(403,'The run author cannot independently triage its suggestions.');
  const requestHash=hash({runId:id,suggestion,...q}),old=(await c.query('SELECT * FROM case_analysis_decisions WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,q.id])).rows[0];if(old){if(old.actor_id!==a.userId||old.request_hash.trim()!==requestHash)throw new ApiError(409,'Analysis decision identity already used.');return displayDecision(old);}
  const current=record.decisions.find(v=>v.suggestion===suggestion);if((current?.version??0)!==q.expectedVersion)throw new ApiError(409,'Suggestion triage changed. Refresh its retained history.');
  const row=(await c.query('INSERT INTO case_analysis_decisions(tenant_id,case_id,run_id,suggestion,version,id,disposition,reason,actor_id,actor_name,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[a.tenantId,caseId,id,suggestion,q.expectedVersion+1,q.id,q.disposition,q.reason,a.userId,a.displayName,requestHash])).rows[0];
  await s.audit(c,a,caseId,'analysis.triaged','case_analysis',id,'Suggestion triage recorded; no finding, task or release created automatically');return displayDecision(row);
 }));
 app.post(base+'/:id/suggestions/:suggestion/followup',{preHandler:[s.requireCsrf,read],schema:{params:suggestionParams,body:{type:'object',additionalProperties:false,required:['id','decisionVersion','title','body','ownerId','dueDate'],properties:{id:uuid,decisionVersion:{type:'integer',minimum:1,maximum:100},title:{type:'string',minLength:3,maxLength:200},body:{type:'string',maxLength:10000},ownerId:{anyOf:[uuid,{type:'null'}]},dueDate:{anyOf:[{type:'string',pattern:'^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$'},{type:'null'}]}}}}},r=>tx(r,async c=>{
  const a=r.actor!,{caseId,id,suggestion}=r.params as {caseId:string;id:string;suggestion:number},q=r.body as {id:string;decisionVersion:number;title:string;body:string;ownerId:string|null;dueDate:string|null};
  const record=await load(c,a,caseId,id),candidate=record.run.suggestions[suggestion];if(!candidate)notFound();
  const requestHash=hash({runId:id,suggestion,...q}),old=(await c.query('SELECT * FROM case_analysis_followups WHERE tenant_id=$1 AND case_id=$2 AND run_id=$3 AND suggestion=$4',[a.tenantId,caseId,id,suggestion])).rows[0];
  if(old){if(old.created_by!==a.userId||old.request_hash.trim()!==requestHash)throw new ApiError(409,'This suggestion already has a follow-up question. Open its saved work record.');const item=(await c.query('SELECT *,due_date::text AS due_date FROM case_work_items WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,old.work_id])).rows[0];if(!item)notFound();return displayWork(item);}
  const decision=record.decisions.find(d=>d.suggestion===suggestion);if(!decision||decision.version!==q.decisionVersion||decision.disposition!=='request_check')throw new ApiError(409,'A current independent request for a follow-up check is required. Refresh the suggestion.');
  if((await c.query('SELECT 1 FROM case_work_items WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,q.id])).rowCount)throw new ApiError(409,'Choose a new work request identity.');
  const body=q.body+'\n\nAnalysis run '+id+'; suggestion '+(suggestion+1)+'; triage v'+decision.version+'. Rule suggestions are not findings. '+candidate.check;
  const item=await createCaseWorkItem(c,a,caseId,{id:q.id,kind:'question',title:q.title,body,ownerId:q.ownerId,dueDate:q.dueDate,parentId:null},s,{initialise:async work=>{
   for(const index of candidate.sources){const ref=record.run.sources[index]!.reference;let claimId:string|null=null;if(ref.kind==='text_finding'){const row=(await c.query('SELECT claim_id FROM findings WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,ref.findingId])).rows[0];if(!row)notFound();claimId=row.claim_id;}
    await c.query('INSERT INTO case_work_links(tenant_id,case_id,id,item_id,claim_id,document_finding_id,transcript_finding_id,speech_finding_id,relation,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[a.tenantId,caseId,randomUUID(),work.id,claimId,ref.kind==='document_finding'?ref.findingId:null,ref.kind==='transcript_finding'?ref.findingId:null,ref.kind==='speech_finding'?ref.findingId:null,'context','Context for human follow-up of analysis '+id+', suggestion '+(suggestion+1)+'. No contradiction or factual truth inferred.',a.userId]);
   }
  }});
  await c.query('INSERT INTO case_analysis_followups(tenant_id,case_id,run_id,suggestion,decision_version,work_id,created_by,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[a.tenantId,caseId,id,suggestion,decision.version,item.id,a.userId,requestHash]);
  await s.audit(c,a,caseId,'analysis.followup_created','case_analysis',id,'Investigator explicitly created a question with both contextual source links');return item;
 }));
 app.get(base+'/:id/suggestions/:suggestion/history',{preHandler:read,schema:{params:suggestionParams,querystring:{type:'object',additionalProperties:false,properties:{before:{type:'integer',minimum:1,maximum:101}}}}},r=>tx(r,async c=>{
  const a=r.actor!,{caseId,id,suggestion}=r.params as {caseId:string;id:string;suggestion:number},{before}=r.query as {before?:number};const record=await load(c,a,caseId,id);if(!record.run.suggestions[suggestion])notFound();
  const rows=(await c.query('SELECT * FROM case_analysis_decisions WHERE tenant_id=$1 AND case_id=$2 AND run_id=$3 AND suggestion=$4 AND ($5::int IS NULL OR version<$5) ORDER BY version DESC LIMIT 26',[a.tenantId,caseId,id,suggestion,before??null])).rows;return {items:rows.slice(0,25).map(displayDecision),next:rows.length>25?rows[24].version:null};
 }));
}
