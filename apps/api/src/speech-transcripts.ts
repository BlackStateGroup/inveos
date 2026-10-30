import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Pool,PoolClient,QueryResultRow} from 'pg';
import type {SpeechTranscript,SpeechCorrection,SpeechSegmentReview,SpeechSegment,SpeechContextPackage,SpeechReviewContext} from '@inveos/contracts';
import type {Actor} from './app.js';
import type {OriginalStore} from './original-encryption.js';
import type {LifecycleCase} from './case-lifecycle.js';
import {inTransaction} from './db.js';
import {ApiError,notFound} from './errors.js';
import {readOriginalBounded} from './storage.js';
import {sourceUseProofs} from './source-use.js';
import {speechKind,speechProfile,speechProfileDigest,makeSpeechDerivative} from './speech-derivative.js';
import {sha256} from './text-derivative.js';
import {transcriptHash as hash} from './transcript-findings.js';
import {transcriptText} from './supplied-transcript.js';
type Services={pool:Pool;storageRoot:OriginalStore;authenticate:(r:FastifyRequest)=>Promise<void>;requireCsrf:(r:FastifyRequest)=>Promise<void>;findCase:(c:PoolClient,a:Actor,id:string,lock?:boolean)=>Promise<LifecycleCase>;audit:(c:PoolClient,a:Actor,caseId:string,action:string,type:string,id:string,summary:string)=>Promise<void>};
const uuid={type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'},index={type:'integer',minimum:0,maximum:127};
const params={type:'object',additionalProperties:false,required:['caseId','jobId'],properties:{caseId:uuid,jobId:uuid}},segmentParams={...params,required:[...params.required,'segmentIndex'],properties:{...params.properties,segmentIndex:index}};
const reason={type:'string',minLength:10,maxLength:3000},version={type:'integer',minimum:0,maximum:100};
type Path={caseId:string;jobId:string;segmentIndex:number};
const keys=(a:Actor,caseId:string,jobId:string)=>[a.tenantId,caseId,jobId];
function correction(r:QueryResultRow):SpeechCorrection{return {id:r.id,segmentIndex:r.segment_index,version:r.version,startMs:r.start_ms,endMs:r.end_ms,hasSpeech:r.has_speech,text:r.text,speakerLabel:r.speaker_label,speakerUncertain:r.speaker_uncertain,reason:r.reason,actorId:r.actor_id,actorName:r.actor_name,recordedAt:r.recorded_at.toISOString()};}
export function speechAccount(raw:SpeechSegment,current:SpeechCorrection|null){return current?{startMs:current.startMs,endMs:current.endMs,hasSpeech:current.hasSpeech,text:current.text,speakerLabel:current.speakerLabel,speakerUncertain:current.speakerUncertain}:{startMs:raw.startMs,endMs:raw.endMs,hasSpeech:true,text:raw.text,speakerLabel:'Unattributed',speakerUncertain:true};}
function reviewContext(row:QueryResultRow,raw:SpeechSegment,current:SpeechCorrection|null):SpeechReviewContext{return {format:'inveos.speech_review_context.v1',caseId:row.case_id,jobId:row.job_id,sourceDigest:row.source_digest.trim(),derivativeDigest:row.output_digest.trim(),authorityVersion:row.authority_version,segmentIndex:raw.index,version:current?.version??0,account:speechAccount(raw,current)};}
function review(r:QueryResultRow,context:unknown):SpeechSegmentReview{
 const value={id:r.id,segmentIndex:r.segment_index,version:r.version,accepted:r.accepted,reason:r.reason,reviewerId:r.reviewer_id,reviewerName:r.reviewer_name,recordedAt:r.recorded_at.toISOString()};
 if(hash(r.snapshot)!==r.digest.trim()||hash(r.snapshot)!==hash({context,decision:value}))throw new ApiError(409,'Speech review provenance changed.');return {...value,digest:r.digest.trim()};
}
export function registerSpeechTranscripts(app:FastifyInstance,s:Services){
 const base='/api/cases/:caseId/speech-transcripts',internal=async(r:FastifyRequest)=>{await s.authenticate(r);if(r.actor!.role==='client')throw new ApiError(403,'Internal speech context only.');};
 const tx=<T>(f:(c:PoolClient)=>Promise<T>)=>inTransaction(s.pool,async c=>{await c.query("SET LOCAL statement_timeout='5s'");await c.query("SET LOCAL lock_timeout='2s'");return f(c);});
 async function load(c:PoolClient,a:Actor,caseId:string,jobId:string){
  const kase=await s.findCase(c,a,caseId,true),k=keys(a,caseId,jobId);
  const row=(await c.query(`SELECT d.*,e.object_path,e.byte_length,e.digest,e.original_kind,e.filename,e.source_time,e.received_time,e.authority_id,e.authority_version source_authority_version,j.requested_by,j.status,j.attempt job_attempt FROM speech_derivatives d JOIN evidence e ON e.tenant_id=d.tenant_id AND e.case_id=d.case_id AND e.id=d.evidence_id JOIN integrity_jobs j ON j.tenant_id=d.tenant_id AND j.case_id=d.case_id AND j.id=d.job_id WHERE d.tenant_id=$1 AND d.case_id=$2 AND d.job_id=$3`,k)).rows[0];if(!row)notFound();
  await sourceUseProofs(c,a.tenantId,caseId,row.evidence_id,'analysis');let original:Buffer,output:ReturnType<typeof makeSpeechDerivative>;
  try{
   original=await readOriginalBounded(s.storageRoot,row.object_path,262144);
   if(original.length!==row.byte_length||row.original_kind!=='opaque_binary'||row.digest.trim()!==row.source_digest.trim()||row.kind!==speechKind||row.profile!==speechProfile||row.profile_digest.trim()!==speechProfileDigest||row.status!=='succeeded'||row.attempt!==row.job_attempt||sha256(row.raw_bytes)!==row.raw_digest.trim())throw new Error('Speech identity mismatch');
   const context={tenantId:a.tenantId,caseId,jobId,evidenceId:row.evidence_id,sourceDigest:row.source_digest.trim(),authorityVersion:row.authority_version};
   output=makeSpeechDerivative(original,context,{context,profileDigest:speechProfileDigest,successful:true,raw:row.raw_bytes});
   if(output.digest!==row.output_digest.trim()||!output.bytes.equals(row.output_bytes))throw new Error('Speech derivative changed');
  }catch{throw new ApiError(409,'Original or speech derivative no longer verifies.');}
  const current=(await c.query(`SELECT DISTINCT ON(segment_index) x.*,count(*) OVER(PARTITION BY segment_index)::int correction_count FROM speech_segment_corrections x WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 ORDER BY segment_index,version DESC`,k)).rows;
  if(current.some(r=>r.version!==r.correction_count||!output.derivative.segments[r.segment_index]))throw new ApiError(409,'Speech correction history is incomplete.');
  const reviews=(await c.query(`SELECT r.* FROM speech_segment_reviews r WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 AND version=(SELECT coalesce(max(x.version),0) FROM speech_segment_corrections x WHERE x.tenant_id=r.tenant_id AND x.case_id=r.case_id AND x.job_id=r.job_id AND x.segment_index=r.segment_index)`,k)).rows;
  const authors=(await c.query('SELECT DISTINCT segment_index FROM speech_segment_corrections WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 AND actor_id=$4',[...k,a.userId])).rows.map(r=>r.segment_index);
  const active=kase.status==='Active'&&['Active','Review'].includes(kase.lifecycle_state)&&kase.authority_version===row.authority_version;
  const value:SpeechTranscript={caseId,jobId,source:{evidenceId:row.evidence_id,digest:row.source_digest.trim(),filename:row.filename,sourceTime:row.source_time,receivedTime:row.received_time.toISOString(),authorityId:row.authority_id,authorityVersion:row.source_authority_version},profile:JSON.parse(speechProfile),profileDigest:speechProfileDigest,rawDigest:row.raw_digest.trim(),derivativeDigest:output.digest,processedAt:row.processed_at.toISOString(),requestedBy:row.requested_by,derivative:output.derivative,segments:output.derivative.segments.map(raw=>{
   const changed=current.find(r=>r.segment_index===raw.index),selected=changed?correction(changed):null,decision=reviews.find(r=>r.segment_index===raw.index),fields=speechAccount(raw,selected);
   return {raw,current:selected,currentVersion:selected?.version??0,review:decision?review(decision,reviewContext(row,raw,selected)):null,canReview:a.role==='reviewer'&&active&&row.requested_by!==a.userId&&!authors.includes(raw.index)&&!decision,canAccept:fields.startMs>=0&&fields.endMs>fields.startMs&&fields.endMs<=output.derivative.audio.durationMs&&(!fields.hasSpeech||fields.text.trim().length>0)};
  }),interpretation:'raw_and_corrected_speech_not_findings'};
  if(Buffer.byteLength(JSON.stringify(value))>2097152)throw new ApiError(409,'Speech context exceeds its response bound.');return {value,row,original,active};
 }
 app.get(base,{preHandler:internal,schema:{params:{...params,required:['caseId'],properties:{caseId:uuid}},querystring:{type:'object',additionalProperties:false,properties:{after:uuid}}}},r=>tx(async c=>{
  const a=r.actor!,{caseId}=r.params as {caseId:string},{after}=r.query as {after?:string};await s.findCase(c,a,caseId);const rows=(await c.query(`SELECT d.job_id,d.processed_at,e.filename FROM speech_derivatives d JOIN evidence e ON e.tenant_id=d.tenant_id AND e.case_id=d.case_id AND e.id=d.evidence_id WHERE d.tenant_id=$1 AND d.case_id=$2 AND ($3::uuid IS NULL OR d.job_id>$3) ORDER BY d.job_id LIMIT 26`,[a.tenantId,caseId,after??null])).rows;return {items:rows.slice(0,25).map(r=>({jobId:r.job_id,filename:r.filename,processedAt:r.processed_at.toISOString()})),next:rows.length>25?rows[24].job_id:null};
 }));
 app.get(base+'/:jobId',{preHandler:internal,schema:{params}},r=>tx(async c=>{const {caseId,jobId}=r.params as Path;return (await load(c,r.actor!,caseId,jobId)).value;}));
 app.post(base+'/:jobId/segments/:segmentIndex/corrections',{preHandler:s.requireCsrf,preValidation:async r=>{const b=r.body as Record<string,unknown>;if(!b||typeof b.hasSpeech!=='boolean'||typeof b.speakerUncertain!=='boolean'||['expectedVersion','startMs','endMs'].some(k=>typeof b[k]!=='number'))throw new ApiError(422,'Explicit speech, uncertainty and numeric range values are required.');},schema:{params:segmentParams,body:{type:'object',additionalProperties:false,required:['id','expectedVersion','startMs','endMs','hasSpeech','text','speakerLabel','speakerUncertain','reason'],properties:{id:uuid,expectedVersion:version,startMs:{type:'integer',minimum:0,maximum:8192},endMs:{type:'integer',minimum:1,maximum:8192},hasSpeech:{type:'boolean'},text:{type:'string',maxLength:10000},speakerLabel:{type:'string',maxLength:120},speakerUncertain:{type:'boolean'},reason}}}},r=>tx(async c=>{
  const a=r.actor!,{caseId,jobId,segmentIndex}=r.params as Path,q=r.body as {id:string;expectedVersion:number;startMs:number;endMs:number;hasSpeech:boolean;text:string;speakerLabel:string;speakerUncertain:boolean;reason:string};if(a.role==='client')throw new ApiError(403,'Internal speech correction only.');
  if(!transcriptText(q.reason,3000)||q.reason.trim().length<10||Buffer.byteLength(q.text)>16384||(q.hasSpeech?(!transcriptText(q.text,10000)||!transcriptText(q.speakerLabel,120)):(q.text!==''||q.speakerLabel!==''||!q.speakerUncertain)))throw new ApiError(422,'Record bounded speech text or an explicit no-speech correction, with a clear reason.');
  const {value,active}=await load(c,a,caseId,jobId),selected=value.segments[segmentIndex];if(!selected)notFound();const h=hash({...q,jobId,segmentIndex}),k=keys(a,caseId,jobId);
  const old=(await c.query('SELECT * FROM speech_segment_corrections WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,q.id])).rows[0];if(old){if(old.actor_id!==a.userId||old.request_hash.trim()!==h)throw new ApiError(409,'Speech correction request identity already used.');return correction(old);}
  if((await c.query('SELECT 1 FROM speech_segment_reviews WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,q.id])).rowCount)throw new ApiError(409,'Speech request identity already used by a review.');
  if(!active||selected.currentVersion!==q.expectedVersion||q.expectedVersion>=100)throw new ApiError(409,'Refresh the current speech segment and case authority before correcting.');
  if(q.endMs<=q.startMs||q.endMs>value.derivative.audio.durationMs)throw new ApiError(422,'Corrected range must lie inside the original audio.');
  const saved=(await c.query(`INSERT INTO speech_segment_corrections(tenant_id,case_id,job_id,segment_index,version,id,start_ms,end_ms,has_speech,text,speaker_label,speaker_uncertain,reason,actor_id,actor_name,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,[...k,segmentIndex,q.expectedVersion+1,q.id,q.startMs,q.endMs,q.hasSpeech,q.text,q.speakerLabel,q.speakerUncertain,q.reason,a.userId,a.displayName,h])).rows[0];await s.audit(c,a,caseId,'speech.corrected','integrity_job',jobId,'Human correction stored beside unchanged raw speech output');return correction(saved);
 }));
 app.post(base+'/:jobId/segments/:segmentIndex/review',{preHandler:s.requireCsrf,preValidation:async r=>{const b=r.body as {accepted?:unknown;expectedVersion?:unknown};if(typeof b?.accepted!=='boolean'||typeof b.expectedVersion!=='number')throw new ApiError(422,'Choose an explicit correspondence decision and version.');},schema:{params:segmentParams,body:{type:'object',additionalProperties:false,required:['id','expectedVersion','accepted','reason'],properties:{id:uuid,expectedVersion:version,accepted:{type:'boolean'},reason}}}},r=>tx(async c=>{
  const a=r.actor!,{caseId,jobId,segmentIndex}=r.params as Path,q=r.body as {id:string;expectedVersion:number;accepted:boolean;reason:string};if(a.role!=='reviewer')throw new ApiError(403,'Current independent reviewer required.');if(!transcriptText(q.reason,3000)||q.reason.trim().length<10)throw new ApiError(422,'Record a clear audio-comparison review reason.');
  const {value,row}=await load(c,a,caseId,jobId),selected=value.segments[segmentIndex];if(!selected)notFound();const h=hash({...q,jobId,segmentIndex}),k=keys(a,caseId,jobId);
  const old=(await c.query('SELECT * FROM speech_segment_reviews WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,q.id])).rows[0];if(old){if(old.reviewer_id!==a.userId||old.request_hash.trim()!==h)throw new ApiError(409,'Speech review request identity already used.');return {id:old.id,version:old.version,digest:old.digest.trim()};}
  if((await c.query('SELECT 1 FROM speech_segment_corrections WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,q.id])).rowCount)throw new ApiError(409,'Speech request identity already used by a correction.');
  if(!selected.canReview||selected.currentVersion!==q.expectedVersion||(q.accepted&&!selected.canAccept))throw new ApiError(409,'This version is not available for your independent review. Correct invalid ranges before reviewing.');
  const at=(await c.query('SELECT clock_timestamp() at')).rows[0].at as Date,decision={id:q.id,segmentIndex,version:q.expectedVersion,accepted:q.accepted,reason:q.reason,reviewerId:a.userId,reviewerName:a.displayName,recordedAt:at.toISOString()},snapshot={context:reviewContext(row,selected.raw,selected.current),decision},digest=hash(snapshot);
  await c.query(`INSERT INTO speech_segment_reviews(tenant_id,case_id,job_id,segment_index,version,id,accepted,reason,reviewer_id,reviewer_name,snapshot,digest,request_hash,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)`,[...k,segmentIndex,q.expectedVersion,q.id,q.accepted,q.reason,a.userId,a.displayName,JSON.stringify(snapshot),digest,h,at]);await s.audit(c,a,caseId,'speech.reviewed','integrity_job',jobId,'Independent human audio correspondence decision recorded; no finding or speaker identity inferred');return {...decision,digest};
 }));
 app.get(base+'/:jobId/segments/:segmentIndex/history',{preHandler:internal,schema:{params:segmentParams,querystring:{type:'object',additionalProperties:false,properties:{before:{type:'integer',minimum:1,maximum:101}}}}},r=>tx(async c=>{
  const a=r.actor!,{caseId,jobId,segmentIndex}=r.params as Path,{before}=r.query as {before?:number};const {value,row}=await load(c,a,caseId,jobId),segment=value.segments[segmentIndex];if(!segment)notFound();
  const rows=(await c.query('SELECT * FROM speech_segment_corrections WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 AND segment_index=$4 AND ($5::integer IS NULL OR version<$5) ORDER BY version DESC LIMIT 26',[...keys(a,caseId,jobId),segmentIndex,before??null])).rows;
  const versions=[0,...rows.slice(0,25).map(v=>v.version)],reviews=(await c.query('SELECT * FROM speech_segment_reviews WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 AND segment_index=$4 AND version=ANY($5::integer[])',[...keys(a,caseId,jobId),segmentIndex,versions])).rows;
  return {raw:segment.raw,items:rows.slice(0,25).map(correction),reviews:reviews.map(v=>review(v,reviewContext(row,segment.raw,v.version?correction(rows.find(x=>x.version===v.version)!):null))),next:rows.length>25?rows[24].version:null,sourceVerification:'original_and_raw_derivative_verified'};
 }));
 async function context(c:PoolClient,a:Actor,caseId:string,jobId:string):Promise<SpeechContextPackage>{
   const {value,row,original}=await load(c,a,caseId,jobId),k=keys(a,caseId,jobId);
   const size=(await c.query(`SELECT (SELECT coalesce(sum(octet_length(text)+octet_length(reason)+octet_length(actor_name)+1000),0) FROM speech_segment_corrections WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3)+(SELECT coalesce(sum(octet_length(snapshot::text)+1000),0) FROM speech_segment_reviews WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3) total`,k)).rows[0].total;
   if(Number(size)>1200000)throw new ApiError(409,'Speech history exceeds the bounded context export. Inspect segment history separately.');
   const changes=(await c.query('SELECT * FROM speech_segment_corrections WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 ORDER BY segment_index,version',k)).rows;
   const decisions=(await c.query('SELECT * FROM speech_segment_reviews WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 ORDER BY segment_index,version',k)).rows;
   const segments=value.segments.map(segment=>({raw:segment.raw,corrections:changes.filter(x=>x.segment_index===segment.raw.index).map(correction),reviews:decisions.filter(x=>x.segment_index===segment.raw.index).map(x=>{
    const prior=x.version?changes.find(v=>v.segment_index===x.segment_index&&v.version===x.version):null;if(x.version&&!prior)throw new ApiError(409,'Speech review refers to missing correction history.');const context=reviewContext(row,segment.raw,prior?correction(prior):null);return {context,decision:review(x,context)};
   })}));
   const payload:SpeechContextPackage['payload']={caseId,jobId,source:{...value.source,originalBase64:original.toString('base64')},profile:speechProfile,profileDigest:speechProfileDigest,rawBase64:row.raw_bytes.toString('base64'),rawDigest:value.rawDigest,derivative:value.derivative,derivativeDigest:value.derivativeDigest,processedAt:value.processedAt,requestedBy:value.requestedBy,segments,sourceUse:await sourceUseProofs(c,a.tenantId,caseId,row.evidence_id,'analysis'),exportedAt:(await c.query('SELECT clock_timestamp() at')).rows[0].at.toISOString(),interpretation:'internal_speech_context_not_findings'};
   const result:SpeechContextPackage={format:'inveos.speech_context.v1',payload,sha256:hash(payload)};
   if(Buffer.byteLength(JSON.stringify(result))>2097152)throw new ApiError(409,'Speech context export exceeds two MiB.');return result;
 }
 app.get(base+'/:jobId/export',{preHandler:internal,schema:{params}},async(r,reply)=>{
  const a=r.actor!,{caseId,jobId}=r.params as Path;
  const bytes=await tx(async c=>{const value=await context(c,a,caseId,jobId);await s.audit(c,a,caseId,'speech.exported','integrity_job',jobId,'Internal original, raw speech, human corrections and correspondence decisions exported');return Buffer.from(JSON.stringify(value));});
  return reply.type('application/json').header('Content-Disposition',`attachment; filename="internal-speech-${jobId}.json"`).send(bytes);
 });
 return {load,context};
}
