import {randomUUID} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Pool,PoolClient,QueryResultRow} from 'pg';
import type {SpeechClaim,SpeechClaimInput,SpeechClaimRecord,SpeechContextPackage,SpeechReportFinding,TranscriptClaimReview} from '@inveos/contracts';
import type {Actor} from './app.js';
import {collectionOpen,type LifecycleCase} from './case-lifecycle.js';
import {inTransaction} from './db.js';
import {ApiError,notFound} from './errors.js';
import {transcriptHash as hash} from './transcript-findings.js';
import {speechAccount} from './speech-transcripts.js';
import {transcriptText} from './supplied-transcript.js';

type Services={pool:Pool;authenticate:(r:FastifyRequest)=>Promise<void>;requireCsrf:(r:FastifyRequest)=>Promise<void>;findCase:(c:PoolClient,a:Actor,id:string,lock?:boolean)=>Promise<LifecycleCase>;context:(c:PoolClient,a:Actor,caseId:string,jobId:string)=>Promise<SpeechContextPackage>;audit:(c:PoolClient,a:Actor,caseId:string,action:string,type:string,id:string,summary:string)=>Promise<void>};
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'},fingerprint={type:'string',pattern:'^[a-f0-9]{64}$'};
const params={type:'object',additionalProperties:false,required:['caseId'],properties:{caseId:uuid}},itemParams={...params,required:['caseId','id'],properties:{...params.properties,id:uuid}};
const reason={type:'string',minLength:10,maxLength:3000};
const limitations='Interpretation of a human-reviewed speech account. Recognition, corrected words, speaker labels and time ranges remain attributed accounts, not proof of identity, factual truth or complete recording coverage.';
const digest=(v:SpeechClaim)=>hash(Object.fromEntries(Object.entries(v).filter(([k])=>k!=='digest')));
const independent=(v:SpeechClaim,userId:string)=>v.proposedBy!==userId&&v.context.payload.requestedBy!==userId&&!v.context.payload.segments[v.reference.segmentIndex]!.corrections.some(x=>x.actorId===userId);
const decision=(r:QueryResultRow):TranscriptClaimReview=>({id:r.id,claimId:r.claim_id,claimDigest:r.claim_digest.trim(),accepted:r.accepted,reason:r.reason,reviewerId:r.reviewer_id,reviewerName:r.reviewer_name,recordedAt:new Date(r.recorded_at).toISOString()});
function bounded(value:unknown,max:number,min=1){if(!transcriptText(value,max)||value.trim().length<min)throw new ApiError(422,'Enter meaningful bounded speech interpretation text.');}
function stored(r:QueryResultRow):SpeechClaim{
 const v=r.snapshot as SpeechClaim;
 if(!v||v.id!==r.id||v.caseId!==r.case_id||v.reference.jobId!==r.job_id||v.reference.segmentIndex!==r.segment_index||v.reference.version!==r.segment_version||v.reference.correspondenceDigest!==r.correspondence_digest.trim()||v.proposedBy!==r.proposed_by||v.proposedAt!==new Date(r.proposed_at).toISOString()||v.digest!==r.digest.trim()||digest(v)!==v.digest||hash(v.context.payload)!==v.context.sha256)throw new ApiError(409,'Speech proposal provenance no longer verifies.');return v;
}
export function registerSpeechFindings(app:FastifyInstance,s:Services){
 const base='/api/cases/:caseId/speech-claims';
 const internal=(a:Actor)=>{if(a.role==='client')throw new ApiError(403,'Internal speech interpretation only.');};
 const read=async(r:FastifyRequest)=>{await s.authenticate(r);internal(r.actor!);};
 const tx=<T>(run:(c:PoolClient)=>Promise<T>)=>inTransaction(s.pool,async c=>{await c.query("SET LOCAL lock_timeout='2s'");await c.query("SET LOCAL statement_timeout='5s'");return run(c);});
 async function policy(c:PoolClient,a:Actor,caseId:string,p:SpeechContextPackage['payload']){
  const row=(await c.query('SELECT ar.* FROM evidence e JOIN authority_records ar ON ar.tenant_id=e.tenant_id AND ar.case_id=e.case_id AND ar.id=e.authority_id AND ar.version=e.authority_version WHERE e.tenant_id=$1 AND e.case_id=$2 AND e.id=$3',[a.tenantId,caseId,p.source.evidenceId])).rows[0];
  if(!row||row.id!==p.source.authorityId||row.version!==p.source.authorityVersion)throw new ApiError(409,'Speech source authority is unavailable.');
  return {id:p.source.evidenceId,filename:p.source.filename,sha256:p.source.digest,sourceTime:p.source.sourceTime,receivedTime:p.source.receivedTime,policy:{authorityId:row.id,authorityVersion:row.version,purpose:row.purpose,lawfulBasis:row.lawful_basis,scope:row.scope,retentionDays:row.retention_days,minimisation:row.minimisation}};
 }
 async function find(c:PoolClient,a:Actor,caseId:string,id:string){const r=(await c.query('SELECT * FROM speech_claims WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,id])).rows[0];if(!r)notFound();return stored(r);}
 async function verify(c:PoolClient,a:Actor,caseId:string,claim:SpeechClaim,current:boolean){
  const now=(await s.context(c,a,caseId,claim.reference.jobId)).payload,then=claim.context.payload,ref=claim.reference;
  const stable=(p:SpeechContextPackage['payload'])=>Object.fromEntries(Object.entries(p).filter(([k])=>!['segments','sourceUse','exportedAt'].includes(k)));
  if(hash(stable(now))!==hash(stable(then))||hash(await policy(c,a,caseId,now))!==hash(claim.source))throw new ApiError(409,'Frozen speech source identity differs.');
  for(const [i,segment] of then.segments.entries()){
   const latest=now.segments[i];
   if(!latest||hash(segment.raw)!==hash(latest.raw)||segment.corrections.some((v,j)=>hash(v)!==hash(latest.corrections[j]))||segment.reviews.some(v=>!latest.reviews.some(n=>hash(n)===hash(v))))throw new ApiError(409,'Frozen speech correction or review history differs.');
  }
  const segment=then.segments[ref.segmentIndex],latest=now.segments[ref.segmentIndex];
  if(!segment||!latest||segment.corrections.length!==ref.version||(current&&latest.corrections.length!==ref.version))throw new ApiError(409,'Speech interpretation requires the current corrected version.');
  const correspondence=segment.reviews.find(v=>v.decision.version===ref.version)?.decision,account=speechAccount(segment.raw,segment.corrections.at(-1)??null),bytes=Buffer.from(account.text);
  if(!correspondence?.accepted||correspondence.digest!==ref.correspondenceDigest||!account.hasSpeech||hash(account)!==hash(ref.account)||ref.offsetBasis!=='selected_speech_utf8_not_original_audio'||!Number.isInteger(ref.startByte)||!Number.isInteger(ref.endByte)||ref.startByte<0||ref.endByte<=ref.startByte||ref.endByte>bytes.length||!bytes.subarray(ref.startByte,ref.endByte).equals(Buffer.from(ref.quote)))throw new ApiError(409,'Reviewed speech citation no longer verifies.');
 }
 async function list(c:PoolClient,a:Actor,caseId:string,id?:string,after?:string):Promise<SpeechClaimRecord[]>{
  const rows=(await c.query(`SELECT p.*,to_jsonb(r) decision,to_jsonb(w) withdrawal,f.id finding_id,k.status case_status,k.authority_version,
   coalesce((SELECT max(x.version) FROM speech_segment_corrections x WHERE x.tenant_id=p.tenant_id AND x.case_id=p.case_id AND x.job_id=p.job_id AND x.segment_index=p.segment_index),0) current_version
   FROM speech_claims p JOIN cases k ON k.tenant_id=p.tenant_id AND k.id=p.case_id
   LEFT JOIN speech_claim_reviews r ON r.tenant_id=p.tenant_id AND r.case_id=p.case_id AND r.claim_id=p.id
   LEFT JOIN speech_findings f ON f.tenant_id=p.tenant_id AND f.case_id=p.case_id AND f.claim_id=p.id
   LEFT JOIN speech_claim_withdrawals w ON w.tenant_id=p.tenant_id AND w.case_id=p.case_id AND w.claim_id=p.id
   WHERE p.tenant_id=$1 AND p.case_id=$2 AND ($3::uuid IS NULL OR p.id=$3) AND ($4::uuid IS NULL OR p.id>$4) ORDER BY p.id LIMIT 26`,[a.tenantId,caseId,id??null,after??null])).rows;
  return rows.map(r=>{const claim=stored(r),review=r.decision?decision(r.decision):null;
   if(review&&(review.claimDigest!==claim.digest||!independent(claim,review.reviewerId))||Boolean(r.finding_id)!==Boolean(review?.accepted))throw new ApiError(409,'Speech finding and review differ.');
   const stale=r.current_version!==claim.reference.version||r.authority_version!==claim.source.policy.authorityVersion||r.case_status!=='Active';
   return {claim,review,findingId:r.finding_id,withdrawal:r.withdrawal?{id:r.withdrawal.id,actorId:r.withdrawal.actor_id,reason:r.withdrawal.reason,recordedAt:new Date(r.withdrawal.recorded_at).toISOString()}:null,state:r.withdrawal?'withdrawn':review&&!review.accepted?'rejected':stale?'needs_review':review?'reviewed':'candidate',canReview:a.role==='reviewer'&&!review&&!r.withdrawal&&independent(claim,a.userId),canWithdraw:!r.withdrawal&&(a.role==='reviewer'||claim.proposedBy===a.userId&&!review?.accepted)};
  });
 }
 app.get(base,{preHandler:read,schema:{params,querystring:{type:'object',additionalProperties:false,properties:{after:uuid}}}},r=>tx(async c=>{const a=r.actor!,{caseId}=r.params as {caseId:string};await s.findCase(c,a,caseId);const items=await list(c,a,caseId,undefined,(r.query as {after?:string}).after);return {items:items.slice(0,25),next:items.length>25?items[24]!.claim.id:null,sourceVerification:'not_checked_on_listing'};}));
 app.get(base+'/:id/source',{preHandler:read,schema:{params:itemParams}},r=>tx(async c=>{const a=r.actor!,{caseId,id}=r.params as {caseId:string;id:string};await s.findCase(c,a,caseId,true);const claim=await find(c,a,caseId,id);await verify(c,a,caseId,claim,false);return {claim,verification:'original_raw_corrections_and_declared_reviews_verified',speakerIdentityVerified:false};}));
 app.post(base,{preHandler:s.requireCsrf,schema:{params,body:{type:'object',additionalProperties:false,required:['id','jobId','segmentIndex','expectedVersion','correspondenceDigest','text','startByte','endByte','quote'],properties:{id:uuid,jobId:uuid,segmentIndex:{type:'integer',minimum:0,maximum:127},expectedVersion:{type:'integer',minimum:0,maximum:100},correspondenceDigest:fingerprint,text:{type:'string',minLength:10,maxLength:2000},startByte:{type:'integer',minimum:0,maximum:16384},endByte:{type:'integer',minimum:1,maximum:16384},quote:{type:'string',minLength:1,maxLength:10000}}}}},r=>tx(async c=>{
  const a=r.actor!;internal(a);const {caseId}=r.params as {caseId:string},q=r.body as SpeechClaimInput;bounded(q.text,2000,10);bounded(q.quote,10000);const kase=await s.findCase(c,a,caseId,true),requestHash=hash(q);
  const old=(await c.query('SELECT * FROM speech_claims WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[a.tenantId,caseId,q.id])).rows[0];if(old){if(old.request_hash.trim()!==requestHash||old.proposed_by!==a.userId)throw new ApiError(409,'Speech proposal request identity already used.');const v=stored(old);await verify(c,a,caseId,v,false);return v;}
  if((await c.query('SELECT count(*)::int n FROM speech_claims WHERE tenant_id=$1 AND case_id=$2',[a.tenantId,caseId])).rows[0].n>=200)throw new ApiError(422,'Speech proposal limit reached.');
  const context=await s.context(c,a,caseId,q.jobId),p=context.payload,segment=p.segments[q.segmentIndex];
  if(!segment)notFound();const selected=speechAccount(segment.raw,segment.corrections.at(-1)??null),review=segment.reviews.find(v=>v.decision.version===q.expectedVersion)?.decision;
  if(!collectionOpen(kase)||kase.authority_version!==p.derivative.context.authorityVersion||p.source.authorityVersion!==kase.authority_version||segment.corrections.length!==q.expectedVersion||!review?.accepted||review.digest!==q.correspondenceDigest)throw new ApiError(409,'A current independently reviewed speech version and source authority are required.');
  const bytes=Buffer.from(selected.text);if(!selected.hasSpeech||q.endByte<=q.startByte||q.endByte>bytes.length||!bytes.subarray(q.startByte,q.endByte).equals(Buffer.from(q.quote)))throw new ApiError(422,'Quote must match the selected speech account UTF-8 bytes.');
  const at=(await c.query('SELECT clock_timestamp() at')).rows[0].at.toISOString(),claim:SpeechClaim={id:q.id,caseId,text:q.text,proposedBy:a.userId,proposedAt:at,source:await policy(c,a,caseId,p),context,reference:{jobId:q.jobId,segmentIndex:q.segmentIndex,version:q.expectedVersion,correspondenceDigest:q.correspondenceDigest,offsetBasis:'selected_speech_utf8_not_original_audio',startByte:q.startByte,endByte:q.endByte,quote:q.quote,account:selected},limitations,digest:''};claim.digest=digest(claim);
  if(Buffer.byteLength(JSON.stringify(claim))>2200000)throw new ApiError(422,'Speech proposal lineage exceeds its bound.');
  await c.query('INSERT INTO speech_claims(tenant_id,case_id,id,job_id,segment_index,segment_version,correspondence_digest,request_hash,snapshot,digest,proposed_by,proposed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)',[a.tenantId,caseId,q.id,q.jobId,q.segmentIndex,q.expectedVersion,q.correspondenceDigest,requestHash,JSON.stringify(claim),claim.digest,a.userId,at]);await s.audit(c,a,caseId,'speech.claim_proposed','speech_claim',q.id,'Speech interpretation proposed separately from audio correspondence review');return claim;
 }));
 app.post(base+'/:id/review',{preHandler:s.requireCsrf,preValidation:async r=>{const b=r.body as {accepted?:unknown};if(typeof b?.accepted!=='boolean')throw new ApiError(422,'Choose an explicit interpretation decision.');},schema:{params:itemParams,body:{type:'object',additionalProperties:false,required:['id','digest','accepted','reason'],properties:{id:uuid,digest:fingerprint,accepted:{type:'boolean'},reason}}}},r=>tx(async c=>{
  const a=r.actor!;if(a.role!=='reviewer')throw new ApiError(403,'Independent reviewer required.');const {caseId,id}=r.params as {caseId:string;id:string},q=r.body as {id:string;digest:string;accepted:boolean;reason:string};bounded(q.reason,3000,10);const kase=await s.findCase(c,a,caseId,true),claim=await find(c,a,caseId,id);
  if(q.digest!==claim.digest)throw new ApiError(409,'Review must bind the exact speech proposal.');if(!independent(claim,a.userId))throw new ApiError(403,'The requester, proposal author and correction authors cannot independently review this interpretation.');
  const old=(await c.query('SELECT * FROM speech_claim_reviews WHERE tenant_id=$1 AND case_id=$2 AND claim_id=$3',[a.tenantId,caseId,id])).rows[0];if(old){if(old.id!==q.id||old.reviewer_id!==a.userId||old.accepted!==q.accepted||old.reason!==q.reason)throw new ApiError(409,'A speech interpretation decision is already retained.');return (await list(c,a,caseId,id))[0];}
  if((await c.query('SELECT 1 FROM speech_claim_withdrawals WHERE tenant_id=$1 AND case_id=$2 AND claim_id=$3',[a.tenantId,caseId,id])).rowCount)throw new ApiError(409,'Speech proposal withdrawn.');
  if(q.accepted){if(!collectionOpen(kase)||kase.authority_version!==claim.source.policy.authorityVersion)throw new ApiError(409,'Current source authority required.');await verify(c,a,caseId,claim,true);}
  const at=(await c.query('SELECT clock_timestamp() at')).rows[0].at.toISOString();await c.query('INSERT INTO speech_claim_reviews(tenant_id,case_id,id,claim_id,claim_digest,accepted,reason,reviewer_id,reviewer_name,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[a.tenantId,caseId,q.id,id,claim.digest,q.accepted,q.reason,a.userId,a.displayName,at]);
  if(q.accepted)await c.query('INSERT INTO speech_findings(tenant_id,case_id,id,claim_id,review_id) VALUES($1,$2,$3,$4,$5)',[a.tenantId,caseId,randomUUID(),id,q.id]);await s.audit(c,a,caseId,q.accepted?'speech.claim_accepted':'speech.claim_rejected','speech_claim',id,'Independent interpretation decision retained separately from transcript correspondence');return (await list(c,a,caseId,id))[0];
 }));
 app.post(base+'/:id/withdraw',{preHandler:s.requireCsrf,schema:{params:itemParams,body:{type:'object',additionalProperties:false,required:['id','reason'],properties:{id:uuid,reason}}}},r=>tx(async c=>{
  const a=r.actor!;internal(a);const {caseId,id}=r.params as {caseId:string;id:string},q=r.body as {id:string;reason:string};bounded(q.reason,3000,10);await s.findCase(c,a,caseId,true);const v=(await list(c,a,caseId,id))[0];if(!v)notFound();if(!v.canWithdraw&&!v.withdrawal)throw new ApiError(403,'Accepted interpretations require reviewer withdrawal.');
  if(v.withdrawal){if(v.withdrawal.id!==q.id||v.withdrawal.actorId!==a.userId||v.withdrawal.reason!==q.reason)throw new ApiError(409,'Another withdrawal is retained.');return v;}
  await c.query('INSERT INTO speech_claim_withdrawals(tenant_id,case_id,claim_id,id,actor_id,reason,recorded_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp())',[a.tenantId,caseId,id,q.id,a.userId,q.reason]);await s.audit(c,a,caseId,'speech.claim_withdrawn','speech_claim',id,'Speech interpretation withdrawn without erasing source or review history');return (await list(c,a,caseId,id))[0];
 }));
 async function* reportFindings(c:PoolClient,a:Actor,caseId:string,selected?:string[]):AsyncGenerator<SpeechReportFinding>{
  const rows=(await c.query('SELECT f.id,f.claim_id FROM speech_findings f WHERE f.tenant_id=$1 AND f.case_id=$2 AND ($3::uuid[] IS NULL OR f.id=ANY($3::uuid[])) AND ($3::uuid[] IS NOT NULL OR NOT EXISTS(SELECT 1 FROM speech_claim_withdrawals w WHERE w.tenant_id=f.tenant_id AND w.case_id=f.case_id AND w.claim_id=f.claim_id)) ORDER BY f.id LIMIT 201',[a.tenantId,caseId,selected??null])).rows;
  if(rows.length>200||selected&&new Set(selected).size!==rows.length)throw new ApiError(409,'Frozen speech finding identities are unavailable.');
  for(const row of rows){const v=(await list(c,a,caseId,row.claim_id))[0];if(!v||v.findingId!==row.id||v.state!=='reviewed'||!v.review?.accepted)throw new ApiError(409,'Speech interpretation requires fresh review.');await verify(c,a,caseId,v.claim,true);yield {kind:'reviewed_speech',id:row.id,text:v.claim.text,reviewer:v.review.reviewerName,reviewedAt:v.review.recordedAt,source:v.claim.source,claim:v.claim,review:v.review};}
 }
 return {reportFindings};
}
