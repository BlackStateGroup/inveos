/** Scoped Tika inspection, exact derived-page references, human review and independent export. */
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Pool,PoolClient,QueryResultRow} from 'pg';
import type {Actor} from './app.js';
import type {OriginalStore} from './original-encryption.js';
import type {TikaSelection,TikaCitationEntry,TikaReview,TikaClaim,TikaDecision,TikaInspection} from '@inveos/contracts';
import {inTransaction} from './db.js';
import {ApiError,notFound} from './errors.js';
import {sourceUseProofs} from './source-use.js';
import {readOriginalBounded} from './storage.js';
import {sha256} from './text-derivative.js';
import {transcriptHash} from './transcript-findings.js';
import {tikaKind,tikaProfile,tikaProfileDigest,makeTikaDerivative} from './tika-derivative.js';
import {makeTikaEntry,makeTikaReview,makeTikaClaim,makeTikaDecision} from './tika-review.js';
type Services={pool:Pool;storageRoot:OriginalStore;authenticate:(r:FastifyRequest)=>Promise<void>;requireCsrf:(r:FastifyRequest)=>Promise<void>;findCase:(c:PoolClient,a:Actor,id:string,lock?:boolean)=>Promise<unknown>;audit:(c:PoolClient,a:Actor,caseId:string,action:string,type:string,id:string,summary:string)=>Promise<void>};
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'},digest={type:'string',pattern:'^[a-f0-9]{64}$'},reason={type:'string',minLength:10,maxLength:3000};
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const params=object({caseId:uuid,jobId:uuid}),citationParams=object({caseId:uuid,jobId:uuid,citationId:uuid}),claimParams=object({caseId:uuid,jobId:uuid,citationId:uuid,claimId:uuid});
const selectionSchema=object({derivativeDigest:digest,page:{type:'integer',minimum:1,maximum:16},startByte:{type:'integer',minimum:0,maximum:262144},endByte:{type:'integer',minimum:1,maximum:262144},quote:{type:'string',minLength:1,maxLength:4096}});
const iso=(v:Date|string)=>new Date(v).toISOString(),keys=(a:Actor,caseId:string,jobId:string)=>[a.tenantId,caseId,jobId];
function internal(a:Actor){if(a.role==='client')throw new ApiError(403,'Internal parser research only.');}
function same(record:unknown,rebuilt:{digest:string},row:QueryResultRow){if(transcriptHash(record)!==transcriptHash(rebuilt)||row.digest.trim()!==rebuilt.digest)throw new ApiError(409,'Stored Tika review lineage does not verify.');}
export function registerTikaJobs(app:FastifyInstance,s:Services){
 const base='/api/cases/:caseId/integrity-jobs/:jobId/tika';
 const tx=<T>(run:(c:PoolClient)=>Promise<T>)=>inTransaction(s.pool,async c=>{await c.query("SET LOCAL lock_timeout='2s'");await c.query("SET LOCAL statement_timeout='5s'");return run(c);});
 app.post(base+'/recover',{preHandler:s.requireCsrf,schema:{params,body:object({reason})}},r=>tx(async c=>{
  const a=r.actor!;internal(a);const {caseId,jobId}=r.params as {caseId:string;jobId:string},{reason}=r.body as {reason:string};
  if(reason.trim().length<10||/[\u0000-\u001f\u007f]/u.test(reason))throw new ApiError(422,'Record a meaningful recovery reason.');await s.findCase(c,a,caseId,true);
  const row=(await c.query('SELECT *,lease_until<=clock_timestamp() expired FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND id=$3 AND kind=$4 FOR UPDATE',[...keys(a,caseId,jobId),tikaKind])).rows[0];if(!row)notFound();
  if(row.status!=='running'||!row.expired)throw new ApiError(409,'Only an expired running Tika lease can be reconciled.');
  await c.query("UPDATE integrity_jobs SET status='failed',failure_code='lease_expired_unknown_outcome',lease_token=NULL,lease_until=NULL,lease_deadline=NULL,finished_at=clock_timestamp() WHERE tenant_id=$1 AND case_id=$2 AND id=$3",keys(a,caseId,jobId));
  await c.query("INSERT INTO integrity_job_events(tenant_id,case_id,job_id,status,attempt,failure_code) VALUES($1,$2,$3,'failed',$4,'lease_expired_unknown_outcome')",[...keys(a,caseId,jobId),row.attempt]);await s.audit(c,a,caseId,'tika.lease_reconciled','integrity_job',jobId,reason);return {id:jobId,status:'failed',failureCode:'lease_expired_unknown_outcome'};
 }));
 async function load(c:PoolClient,a:Actor,caseId:string,jobId:string,change=false){
  internal(a);await s.findCase(c,a,caseId,true);
  const row=(await c.query(`SELECT d.*,e.object_path,e.byte_length,e.digest,e.original_kind,e.filename,e.source_time,e.received_time,e.authority_id,e.authority_version source_authority_version,j.status,j.requested_by,j.created_at job_created_at,j.finished_at,c.authority_version current_authority,c.status case_status,c.lifecycle_state
  FROM tika_derivatives d JOIN evidence e ON e.tenant_id=d.tenant_id AND e.case_id=d.case_id AND e.id=d.evidence_id
  JOIN integrity_jobs j ON j.tenant_id=d.tenant_id AND j.case_id=d.case_id AND j.id=d.job_id
  JOIN cases c ON c.tenant_id=d.tenant_id AND c.id=d.case_id WHERE d.tenant_id=$1 AND d.case_id=$2 AND d.job_id=$3`,keys(a,caseId,jobId))).rows[0];if(!row)notFound();
  const proofs=await sourceUseProofs(c,a.tenantId,caseId,row.evidence_id,'analysis'),canChange=row.case_status==='Active'&&['Active','Review'].includes(row.lifecycle_state)&&row.current_authority===row.authority_version;
  if(change&&!canChange)throw new ApiError(409,'Current active case authority must match this extraction.');
  let original:Buffer,output:ReturnType<typeof makeTikaDerivative>;
  try{
   original=await readOriginalBounded(s.storageRoot,row.object_path,2097152);
   if(row.status!=='succeeded'||row.kind!==tikaKind||row.original_kind!=='opaque_binary'||original.length!==row.byte_length||row.digest.trim()!==row.source_digest.trim()||row.profile!==tikaProfile||row.profile_digest.trim()!==tikaProfileDigest||sha256(row.raw_bytes)!==row.raw_digest.trim())throw new Error();
   const context={tenantId:a.tenantId,caseId,jobId,evidenceId:row.evidence_id,sourceDigest:row.source_digest.trim(),authorityVersion:row.authority_version};
   output=makeTikaDerivative(original,context,{context,profileDigest:tikaProfileDigest,raw:row.raw_bytes,runtime:row.runtime});
   if(output.digest!==row.output_digest.trim()||!output.bytes.equals(row.output_bytes))throw new Error();
  }catch{throw new ApiError(409,'Original, runtime, raw output or Tika derivative failed integrity verification.');}
  return {row,original,output,proofs,canChange};
 }
 async function histories(c:PoolClient,a:Actor,caseId:string,jobId:string,output:ReturnType<typeof makeTikaDerivative>){
  const scope=keys(a,caseId,jobId),citations=(await c.query('SELECT * FROM tika_citations WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 ORDER BY created_at,id LIMIT 26',scope)).rows;
  if(citations.length>25)throw new ApiError(409,'Tika citation history bound exceeded.');
  const allReviews=(await c.query('SELECT * FROM tika_citation_reviews WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 ORDER BY citation_id,sequence LIMIT 501',scope)).rows;
  const allClaims=(await c.query('SELECT * FROM tika_claims WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 ORDER BY citation_id,id LIMIT 251',scope)).rows;
  const allDecisions=(await c.query('SELECT * FROM tika_claim_decisions WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 ORDER BY citation_id,claim_id LIMIT 251',scope)).rows;
  if(allReviews.length>500||allClaims.length>250||allDecisions.length>250)throw new ApiError(409,'Tika review history bound exceeded.');
  try{return citations.map(stored=>{
   const v=stored.record as TikaCitationEntry,entry=makeTikaEntry(output,stored.id,stored.selection,stored.created_by,v.authorName,iso(stored.created_at));same(v,entry,stored);
   const reviews:TikaReview[]=[];
   for(const row of allReviews.filter(r=>r.citation_id===entry.id)){
    const v=row.record as TikaReview,review=makeTikaReview(entry,v,reviews.at(-1)??null,row.reviewer_id,v.reviewerName,v.recordedAt);if(review.sequence!==row.sequence||review.id!==row.id)throw new ApiError(409,'Tika review identity differs.');same(v,review,row);reviews.push(review);
   }
   const claims=allClaims.filter(r=>r.citation_id===entry.id).map(row=>{
    const v=row.record as TikaClaim,correspondence=reviews.find(r=>r.digest===v.correspondenceDigest);if(!correspondence)throw new ApiError(409,'Tika claim correspondence is missing.');
    const claim=makeTikaClaim(entry,correspondence,v,row.author_id,v.authorName,v.recordedAt);if(claim.id!==row.id)throw new ApiError(409,'Tika claim identity differs.');same(v,claim,row);
    const saved=allDecisions.find(r=>r.citation_id===entry.id&&r.claim_id===claim.id);let decision:TikaDecision|null=null;
    if(saved){const v=saved.record as TikaDecision;decision=makeTikaDecision(claim,v,saved.reviewer_id,v.reviewerName,v.recordedAt);if(decision.id!==saved.id)throw new ApiError(409,'Tika decision identity differs.');same(v,decision,saved);}
    return {claim,decision,eligible:decision?.accepted===true&&reviews.at(-1)?.decision==='accepted'&&reviews.at(-1)?.digest===claim.correspondenceDigest};
   });if(claims.length>10)throw new ApiError(409,'Tika interpretation count exceeds bound.');return {entry,reviews,claims};
  });}catch(error){if(error instanceof ApiError)throw error;throw new ApiError(409,'Stored Tika human review history failed verification.');}
 }
 function view(loaded:Awaited<ReturnType<typeof load>>,citations:TikaInspection['citations'],a:Actor):TikaInspection{
  const {row,output,canChange}=loaded;return {jobId:row.job_id,caseId:row.case_id,evidenceId:row.evidence_id,source:{filename:row.filename,sha256:row.source_digest.trim(),sourceTime:row.source_time,receivedAt:iso(row.received_time),authorityId:row.authority_id,authorityVersion:row.source_authority_version},processedAt:iso(row.processed_at),profile:tikaProfile,profileDigest:tikaProfileDigest,rawDigest:output.rawDigest,derivativeDigest:output.digest,derivative:output.derivative,canReview:a.role==='reviewer',canChange,citations:citations.map(item=>({...item,claims:item.claims.map(v=>({...v,eligible:v.eligible&&canChange}))}))};
 }
 app.get(base,{preHandler:s.authenticate,schema:{params}},r=>tx(async c=>{const a=r.actor!,{caseId,jobId}=r.params as {caseId:string;jobId:string},loaded=await load(c,a,caseId,jobId),history=await histories(c,a,caseId,jobId,loaded.output);await s.audit(c,a,caseId,'tika.inspected','integrity_job',jobId,'Verified research PDF page text and human decision lineage inspected');return view(loaded,history,a);}));
 app.post(base+'/citations/:citationId',{preHandler:s.requireCsrf,schema:{params:citationParams,body:selectionSchema}},r=>tx(async c=>{
  const a=r.actor!,{caseId,jobId,citationId}=r.params as {caseId:string;jobId:string;citationId:string},selection=r.body as TikaSelection,loaded=await load(c,a,caseId,jobId,true),scope=keys(a,caseId,jobId),hash=transcriptHash(selection);
  const old=(await c.query('SELECT * FROM tika_citations WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 AND id=$4',[...scope,citationId])).rows[0];if(old){if(old.created_by!==a.userId||old.request_hash.trim()!==hash)throw new ApiError(409,'Citation identity already used.');await histories(c,a,caseId,jobId,loaded.output);return old.record;}
  if(Number((await c.query('SELECT count(*) n FROM tika_citations WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3',scope)).rows[0].n)>=25)throw new ApiError(422,'At most 25 citations per extraction.');
  let entry;const at=iso((await c.query('SELECT clock_timestamp() at')).rows[0].at);try{entry=makeTikaEntry(loaded.output,citationId,selection,a.userId,a.displayName,at);}catch{throw new ApiError(422,'Choose an exact occurrence within one extracted PDF page, using derived UTF-8 offsets.');}
  await c.query('INSERT INTO tika_citations(tenant_id,case_id,job_id,id,selection,record,digest,created_by,created_at,request_hash) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10)',[...scope,citationId,JSON.stringify(selection),JSON.stringify(entry),entry.digest,a.userId,at,hash]);await s.audit(c,a,caseId,'tika.citation_created','tika_citation',citationId,'Exact derived page-text occurrence saved; unreviewed, without bounding box or original PDF byte offsets');return entry;
 }));
 app.post(base+'/citations/:citationId/reviews',{preHandler:s.requireCsrf,schema:{params:citationParams,body:object({id:uuid,citationDigest:digest,previousDigest:{anyOf:[digest,{type:'null'}]},decision:{enum:['accepted','rejected']},reason,originalCompared:{type:'boolean'}})}},r=>tx(async c=>{
  const a=r.actor!;if(a.role!=='reviewer')throw new ApiError(403,'Assigned independent reviewer required.');const {caseId,jobId,citationId}=r.params as {caseId:string;jobId:string;citationId:string},input=r.body as Pick<TikaReview,'id'|'citationDigest'|'previousDigest'|'decision'|'reason'|'originalCompared'>,loaded=await load(c,a,caseId,jobId,true),history=await histories(c,a,caseId,jobId,loaded.output),item=history.find(v=>v.entry.id===citationId);if(!item)notFound();const scope=keys(a,caseId,jobId),hash=transcriptHash(input);
  const old=(await c.query('SELECT * FROM tika_citation_reviews WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,input.id])).rows[0];if(old){if(old.job_id!==jobId||old.citation_id!==citationId||old.reviewer_id!==a.userId||old.request_hash.trim()!==hash)throw new ApiError(409,'Decision identity already used.');return old.record;}
  if(input.citationDigest!==item.entry.digest||input.previousDigest!==(item.reviews.at(-1)?.digest??null))throw new ApiError(409,'Citation or review history changed.');
  let review;try{review=makeTikaReview(item.entry,input,item.reviews.at(-1)??null,a.userId,a.displayName,iso((await c.query('SELECT clock_timestamp() at')).rows[0].at));}catch{throw new ApiError(422,'Independent review, a reason and original comparison for acceptance are required; history is bounded to 20 decisions.');}
  await c.query('INSERT INTO tika_citation_reviews(tenant_id,case_id,job_id,citation_id,id,sequence,record,digest,reviewer_id,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)',[...scope,citationId,review.id,review.sequence,JSON.stringify(review),review.digest,a.userId,hash]);await s.audit(c,a,caseId,'tika.correspondence_reviewed','tika_citation',citationId,'Append-only original comparison decision; interpretation remains separate');return review;
 }));
 app.post(base+'/citations/:citationId/claims',{preHandler:s.requireCsrf,schema:{params:citationParams,body:object({id:uuid,citationDigest:digest,correspondenceDigest:digest,text:{type:'string',minLength:1,maxLength:6000}})}},r=>tx(async c=>{
  const a=r.actor!,{caseId,jobId,citationId}=r.params as {caseId:string;jobId:string;citationId:string},input=r.body as Pick<TikaClaim,'id'|'citationDigest'|'correspondenceDigest'|'text'>,loaded=await load(c,a,caseId,jobId,true),item=(await histories(c,a,caseId,jobId,loaded.output)).find(v=>v.entry.id===citationId);if(!item)notFound();const scope=keys(a,caseId,jobId),hash=transcriptHash(input),old=(await c.query('SELECT * FROM tika_claims WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,input.id])).rows[0];
  if(old){if(old.job_id!==jobId||old.citation_id!==citationId||old.author_id!==a.userId||old.request_hash.trim()!==hash)throw new ApiError(409,'Interpretation identity already used.');return old.record;}
  const review=item.reviews.at(-1);if(!review||review.decision!=='accepted'||input.citationDigest!==item.entry.digest||input.correspondenceDigest!==review.digest)throw new ApiError(409,'The latest independent correspondence decision must accept this exact citation.');if(item.claims.length>=10)throw new ApiError(422,'At most ten interpretations per citation.');
  let claim;try{claim=makeTikaClaim(item.entry,review,input,a.userId,a.displayName,iso((await c.query('SELECT clock_timestamp() at')).rows[0].at));}catch{throw new ApiError(422,'A bounded linked interpretation is required.');}
  await c.query('INSERT INTO tika_claims(tenant_id,case_id,job_id,citation_id,id,record,digest,author_id,request_hash) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)',[...scope,citationId,claim.id,JSON.stringify(claim),claim.digest,a.userId,hash]);await s.audit(c,a,caseId,'tika.interpretation_proposed','tika_claim',claim.id,'Human interpretation linked to independently reviewed page-text citation');return claim;
 }));
 app.post(base+'/citations/:citationId/claims/:claimId/decision',{preHandler:s.requireCsrf,schema:{params:claimParams,body:object({id:uuid,claimDigest:digest,accepted:{type:'boolean'},reason})}},r=>tx(async c=>{
  const a=r.actor!;if(a.role!=='reviewer')throw new ApiError(403,'Assigned independent reviewer required.');const {caseId,jobId,citationId,claimId}=r.params as {caseId:string;jobId:string;citationId:string;claimId:string},input=r.body as Pick<TikaDecision,'id'|'claimDigest'|'accepted'|'reason'>,loaded=await load(c,a,caseId,jobId,true),item=(await histories(c,a,caseId,jobId,loaded.output)).find(v=>v.entry.id===citationId),entry=item?.claims.find(v=>v.claim.id===claimId);if(!item||!entry)notFound();const scope=keys(a,caseId,jobId),hash=transcriptHash(input);
  const old=(await c.query('SELECT * FROM tika_claim_decisions WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 AND citation_id=$4 AND claim_id=$5',[...scope,citationId,claimId])).rows[0];if(old){if(old.id!==input.id||old.reviewer_id!==a.userId||old.request_hash.trim()!==hash)throw new ApiError(409,'Interpretation already decided; retain history and propose a correction separately.');return old.record;}
  if(input.claimDigest!==entry.claim.digest||input.accepted&&(item.reviews.at(-1)?.decision!=='accepted'||item.reviews.at(-1)?.digest!==entry.claim.correspondenceDigest))throw new ApiError(409,'Claim or latest correspondence decision changed.');
  let decision;try{decision=makeTikaDecision(entry.claim,input,a.userId,a.displayName,iso((await c.query('SELECT clock_timestamp() at')).rows[0].at));}catch{throw new ApiError(422,'An independent interpretation decision and meaningful reason are required.');}
  await c.query('INSERT INTO tika_claim_decisions(tenant_id,case_id,job_id,citation_id,claim_id,id,record,digest,reviewer_id,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)',[...scope,citationId,claimId,decision.id,JSON.stringify(decision),decision.digest,a.userId,hash]);await s.audit(c,a,caseId,'tika.interpretation_decided','tika_claim',claimId,'Independent interpretation decision retained; no automatic report or release');return decision;
 }));
 app.get(base+'/export',{preHandler:s.authenticate,schema:{params}},r=>tx(async c=>{
  const a=r.actor!,{caseId,jobId}=r.params as {caseId:string;jobId:string},loaded=await load(c,a,caseId,jobId),history=await histories(c,a,caseId,jobId,loaded.output),{row}=loaded,authority=(await c.query('SELECT to_jsonb(ar) authority FROM authority_records ar WHERE tenant_id=$1 AND case_id=$2 AND version=$3',[a.tenantId,caseId,row.authority_version])).rows[0]?.authority;if(!authority)throw new ApiError(409,'Processing authority history is missing.');
  const payload={format:'inveos.tika_context.v1',inspection:view(loaded,history,a),originalBase64:loaded.original.toString('base64'),rawBase64:(row.raw_bytes as Buffer).toString('base64'),derivativeBase64:loaded.output.bytes.toString('base64'),runtime:row.runtime,processingAuthority:authority,sourceUse:loaded.proofs,job:{id:jobId,kind:row.kind,status:row.status,attempt:row.attempt,requestedBy:row.requested_by,createdAt:iso(row.job_created_at),finishedAt:iso(row.finished_at)},exportedAt:iso((await c.query('SELECT clock_timestamp() at')).rows[0].at),limitation:'Internal research consistency record. Not provider truth, runtime certification, actor authentication, current permission or report/client release approval.'};
  if(Buffer.byteLength(JSON.stringify(payload))>12582912)throw new ApiError(422,'Tika context export exceeds its bound.');await s.audit(c,a,caseId,'tika.context_exported','integrity_job',jobId,'Original, immutable raw/profile/derivative and linked human decisions exported for independent verification');return {payload,sha256:transcriptHash(payload)};
 }));
}
