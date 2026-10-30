import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {PoolClient,QueryResultRow} from 'pg';
import type {CompositionPayload,CompositionReview,CompositionRevision,ReportOutline,ReportDraft} from '@inveos/contracts';
import type {Actor} from './app.js';
import {ApiError,notFound} from './errors.js';
import {compositionChoices,compositionDigest,compositionHash,compositionIds,orderedCompositionPayload,verifyCompositionSelection} from './report-composition-model.js';

type Services={authenticate:(r:FastifyRequest)=>Promise<void>;requireCsrf:(r:FastifyRequest)=>Promise<void>;
 transaction:<T>(op:(c:PoolClient)=>Promise<T>)=>Promise<T>;access:(c:PoolClient,a:Actor,caseId:string)=>Promise<void>;
 lock:(c:PoolClient,a:Actor,caseId:string)=>Promise<unknown>;
 build:(c:PoolClient,a:Actor,caseId:string,text?:string[],documents?:string[],transcripts?:string[],speech?:string[],omitContext?:boolean,tika?:string[]|'available')=>Promise<ReportDraft>;
 audit:(c:PoolClient,a:Actor,caseId:string,action:string,type:string,id:string,summary:string,metadata?:Record<string,unknown>)=>Promise<void>};
const uuid={type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'},sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const short={type:'string',minLength:3,maxLength:150},note={type:'string',minLength:10,maxLength:2000},version={type:'integer',minimum:1,maximum:100};
const obj=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',additionalProperties:false,required,properties});
const outlineSchema=obj({name:short,scope:note,method:note,limitations:note,sections:{type:'array',minItems:1,maxItems:50,items:obj({id:uuid,title:short,findings:{type:'array',maxItems:1000,items:obj({kind:{enum:['text','document','transcript','speech','tika']},id:uuid,sha256:sha})}})}});
const iso=(v:Date|string)=>new Date(v).toISOString();
function clean(v:string,min=10){const text=v.trim().normalize('NFC').replace(/\r\n?/g,'\n');if(text.length<min||Buffer.from(text).toString('utf8')!==text||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))throw new ApiError(422,'Enter explicit plain-text context and a reason.');return text;}
function cleanOutline(o:ReportOutline):ReportOutline{
 const sections=o.sections.map(s=>({id:s.id,title:clean(s.title,3),findings:s.findings.map(f=>({kind:f.kind,id:f.id,sha256:f.sha256}))})),ids=sections.flatMap(s=>s.findings.map(f=>f.id));
 if(new Set(sections.map(s=>s.id)).size!==sections.length||new Set(ids).size!==ids.length||ids.length>1000)throw new ApiError(422,'Section identities and selected findings must be unique; select at most 1000 findings.');
 return {name:clean(o.name,3),scope:clean(o.scope),method:clean(o.method),limitations:clean(o.limitations),sections};
}
function strict(r:FastifyRequest){
 const b=r.body as Record<string,unknown>;
 if(!b||typeof b!=='object'||Array.isArray(b)||['expectedVersion','expectedReviewSequence'].some(k=>k in b&&(!Number.isInteger(b[k])||typeof b[k]!=='number'))||'confirmContextNotFindings' in b&&b.confirmContextNotFindings!==true)throw new ApiError(422,'Explicit typed version and review decisions required.');
 for(const k of ['id','reason','sha256','decision'])if(k in b&&typeof b[k]!=='string')throw new ApiError(422,'Explicit plain-text fields required.');
 if('outline' in b){const o=b.outline as ReportOutline;if(!o||['name','scope','method','limitations'].some(k=>typeof (o as unknown as Record<string,unknown>)[k]!=='string')||!Array.isArray(o.sections)||o.sections.some(section=>!section||typeof section.id!=='string'||typeof section.title!=='string'||!Array.isArray(section.findings)||section.findings.some(f=>!f||typeof f.kind!=='string'||typeof f.id!=='string'||typeof f.sha256!=='string')))throw new ApiError(422,'Explicit outline text and reviewed finding identities required.');}
}
export function registerReportCompositions(app:FastifyInstance,s:Services){
 const base='/api/cases/:caseId/report-compositions',params=obj({caseId:uuid}),itemParams=obj({caseId:uuid,compositionId:uuid});
 const tx=<T>(r:FastifyRequest,work:(c:PoolClient,a:Actor,caseId:string)=>Promise<T>)=>s.transaction(async c=>{const a=r.actor!,{caseId}=r.params as {caseId:string};await s.access(c,a,caseId);await s.lock(c,a,caseId);return work(c,a,caseId);});
 async function head(c:PoolClient,a:Actor,caseId:string,id:string,v?:number){const row=(await c.query('SELECT * FROM report_composition_revisions WHERE tenant_id=$1 AND case_id=$2 AND composition_id=$3 AND ($4::int IS NULL OR version=$4) ORDER BY version DESC LIMIT 1',[a.tenantId,caseId,id,v??null])).rows[0];if(!row)notFound();check(row);return row;}
 function check(r:QueryResultRow){if(compositionDigest(r.payload)!==r.sha256.trim())throw new ApiError(409,'Saved outline fingerprint failed.');}
 async function latestReview(c:PoolClient,a:Actor,caseId:string,id:string,v:number){return (await c.query('SELECT * FROM report_composition_reviews WHERE tenant_id=$1 AND case_id=$2 AND composition_id=$3 AND version=$4 ORDER BY sequence DESC LIMIT 1',[a.tenantId,caseId,id,v])).rows[0];}
 function reviewView(r:QueryResultRow):CompositionReview{return {id:r.id,decision:r.decision,reason:r.reason,reviewerId:r.actor_id,reviewerName:r.actor_name,recordedAt:iso(r.recorded_at)};}
 async function independent(c:PoolClient,a:Actor,caseId:string,id:string){return a.role==='reviewer'&&!(await c.query('SELECT 1 FROM report_composition_revisions WHERE tenant_id=$1 AND case_id=$2 AND composition_id=$3 AND actor_id=$4 LIMIT 1',[a.tenantId,caseId,id,a.userId])).rowCount;}
 async function view(c:PoolClient,a:Actor,caseId:string,r:QueryResultRow):Promise<CompositionRevision&{reviewSequence:number}>{check(r);const review=await latestReview(c,a,caseId,r.composition_id,r.version);return {payload:orderedCompositionPayload(r.payload),sha256:r.sha256.trim(),authorId:r.actor_id,authorName:r.actor_name,recordedAt:iso(r.recorded_at),review:review?reviewView(review):null,reviewSequence:review?.sequence??0,canReview:await independent(c,a,caseId,r.composition_id)};}
 const audit=(c:PoolClient,a:Actor,caseId:string,action:string,id:string,metadata:Record<string,unknown>)=>s.audit(c,a,caseId,'report.composition.'+action,'report_composition',id,'Internal report outline '+action,metadata);
 async function selected(c:PoolClient,a:Actor,caseId:string,p:CompositionPayload){
  const report=await s.build(c,a,caseId,compositionIds(p,'text'),compositionIds(p,'document'),compositionIds(p,'transcript'),compositionIds(p,'speech'),true,compositionIds(p,'tika'));
  try{verifyCompositionSelection(report,p);}catch(e){throw new ApiError(409,(e as Error).message);}return report;
 }
 async function replay(c:PoolClient,a:Actor,caseId:string,id:string,hash:string,table:'report_composition_revisions'|'report_composition_reviews'){
  const old=(await c.query(`SELECT * FROM ${table} WHERE tenant_id=$1 AND case_id=$2 AND ${table==='report_composition_reviews'?'id':'operation_id'}=$3`,[a.tenantId,caseId,id])).rows[0];if(old&&(old.actor_id!==a.userId||old.request_hash.trim()!==hash))throw new ApiError(409,'This operation identity was used for a different outline decision.');return old;
 }
 app.get(base,{preHandler:s.authenticate,schema:{params,querystring:obj({after:uuid},[])}},r=>tx(r,async(c,a,caseId)=>{
  const {after}=r.query as {after?:string},rows=(await c.query('SELECT DISTINCT ON (composition_id) * FROM report_composition_revisions WHERE tenant_id=$1 AND case_id=$2 AND ($3::uuid IS NULL OR composition_id>$3) ORDER BY composition_id,version DESC LIMIT 26',[a.tenantId,caseId,after??null])).rows;
  return {items:await Promise.all(rows.slice(0,25).map(row=>view(c,a,caseId,row))),next:rows.length>25?rows[24].composition_id:null};
 }));
 app.get(base+'/findings',{preHandler:s.authenticate,schema:{params}},r=>tx(r,async(c,a,caseId)=>{
  // The existing bounded builder verifies originals, citations and current source permissions.
  try{return {items:compositionChoices(await s.build(c,a,caseId,undefined,undefined,undefined,undefined,true,'available'))};}catch(e){if(e instanceof ApiError&&e.message==='A report draft requires at least one accepted finding.')return {items:[]};throw e;}
 }));
 app.get(base+'/findings/:findingId/tika',{preHandler:s.authenticate,schema:{params:obj({caseId:uuid,findingId:uuid})}},r=>tx(r,async(c,a,caseId)=>{
  const {findingId}=r.params as {findingId:string};const report=await s.build(c,a,caseId,[],[],[],[],true,[findingId]);await audit(c,a,caseId,'tika_inspected',findingId,{});return report;
 }));
 app.get(base+'/:compositionId',{preHandler:s.authenticate,schema:{params:itemParams}},r=>tx(r,async(c,a,caseId)=>view(c,a,caseId,await head(c,a,caseId,(r.params as {compositionId:string}).compositionId))));
 app.get(base+'/:compositionId/history',{preHandler:s.authenticate,schema:{params:itemParams,querystring:obj({before:{type:'integer',minimum:1,maximum:101}},[])}},r=>tx(r,async(c,a,caseId)=>{
  const {compositionId}=r.params as {compositionId:string},{before}=r.query as {before?:number};await head(c,a,caseId,compositionId);const rows=(await c.query('SELECT * FROM report_composition_revisions WHERE tenant_id=$1 AND case_id=$2 AND composition_id=$3 AND ($4::int IS NULL OR version<$4) ORDER BY version DESC LIMIT 26',[a.tenantId,caseId,compositionId,before??null])).rows;
  return {items:await Promise.all(rows.slice(0,25).map(row=>view(c,a,caseId,row))),next:rows.length>25?rows[24].version:null};
 }));
 app.get(base+'/:compositionId/reviews',{preHandler:s.authenticate,schema:{params:itemParams,querystring:obj({version})}},r=>tx(r,async(c,a,caseId)=>{
  const {compositionId}=r.params as {compositionId:string},{version}=r.query as {version:number};await head(c,a,caseId,compositionId,version);return {items:(await c.query('SELECT * FROM report_composition_reviews WHERE tenant_id=$1 AND case_id=$2 AND composition_id=$3 AND version=$4 ORDER BY sequence DESC',[a.tenantId,caseId,compositionId,version])).rows.map(reviewView)};
 }));
 app.get(base+'/:compositionId/preview',{preHandler:s.authenticate,schema:{params:itemParams,querystring:obj({version})}},r=>tx(r,async(c,a,caseId)=>{
  const {compositionId}=r.params as {compositionId:string},{version}=r.query as {version:number},row=await head(c,a,caseId,compositionId,version);const report=await selected(c,a,caseId,row.payload);await audit(c,a,caseId,'previewed',compositionId,{version});return {outline:await view(c,a,caseId,row),report};
 }));
 app.post(base,{preHandler:s.requireCsrf,preValidation:strict,schema:{params,body:obj({id:uuid,outline:outlineSchema,reason:note})}},r=>tx(r,async(c,a,caseId)=>{
  const b=r.body as {id:string;outline:ReportOutline;reason:string},outline=cleanOutline(b.outline),reason=clean(b.reason),hash=compositionHash({id:b.id,outline,reason}),old=await replay(c,a,caseId,b.id,hash,'report_composition_revisions');if(old)return view(c,a,caseId,old);
  if((await c.query('SELECT count(DISTINCT composition_id)::int n FROM report_composition_revisions WHERE tenant_id=$1 AND case_id=$2',[a.tenantId,caseId])).rows[0].n>=200)throw new ApiError(409,'Case outline limit reached. Reuse an existing outline.');
  return save(c,a,caseId,{format:'inveos_report_outline_v1',caseId,id:b.id,version:1,state:'active',outline,reason},b.id,hash);
 }));
 async function save(c:PoolClient,a:Actor,caseId:string,p:CompositionPayload,operationId:string,hash:string){
  if(p.state==='active'&&p.outline.sections.some(s=>s.findings.length))await selected(c,a,caseId,p);
  const digest=compositionDigest(p),row=(await c.query('INSERT INTO report_composition_revisions(tenant_id,case_id,composition_id,version,operation_id,request_hash,payload,sha256,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[a.tenantId,caseId,p.id,p.version,operationId,hash,JSON.stringify(p),digest,a.userId,a.displayName])).rows[0];await audit(c,a,caseId,p.state==='withdrawn'?'withdrawn':'saved',p.id,{version:p.version,sha256:digest});return view(c,a,caseId,row);
 }
 for(const withdraw of [false,true])app.post(base+'/:compositionId/'+(withdraw?'withdraw':'revisions'),{preHandler:s.requireCsrf,preValidation:strict,schema:{params:itemParams,body:obj({id:uuid,expectedVersion:version,sha256:sha,reason:note,...(withdraw?{}:{outline:outlineSchema})})}},r=>tx(r,async(c,a,caseId)=>{
  const {compositionId}=r.params as {compositionId:string},b=r.body as {id:string;expectedVersion:number;sha256:string;reason:string;outline?:ReportOutline},outline=withdraw?null:cleanOutline(b.outline!),reason=clean(b.reason),hash=compositionHash({compositionId,withdraw,expectedVersion:b.expectedVersion,sha256:b.sha256,outline,reason}),prior=await replay(c,a,caseId,b.id,hash,'report_composition_revisions');if(prior)return view(c,a,caseId,prior);
  const old=await head(c,a,caseId,compositionId);if(old.version!==b.expectedVersion||old.sha256.trim()!==b.sha256||old.payload.state==='withdrawn'||old.version>=(withdraw?100:99))throw new ApiError(409,'Outline changed or was withdrawn; version 100 is reserved for withdrawal.');
  return save(c,a,caseId,{...orderedCompositionPayload(old.payload),version:old.version+1,state:withdraw?'withdrawn':'active',outline:outline??old.payload.outline,reason},b.id,hash);
 }));
 app.post(base+'/:compositionId/reviews',{preHandler:s.requireCsrf,preValidation:strict,schema:{params:itemParams,body:obj({id:uuid,expectedVersion:version,expectedReviewSequence:{type:'integer',minimum:0,maximum:99},sha256:sha,decision:{enum:['accepted','changes_requested']},reason:note,confirmContextNotFindings:{const:true}})}},r=>tx(r,async(c,a,caseId)=>{
  const {compositionId}=r.params as {compositionId:string},b=r.body as {id:string;expectedVersion:number;expectedReviewSequence:number;sha256:string;decision:string;reason:string},reason=clean(b.reason),hash=compositionHash({compositionId,...b,reason});
  const prior=await replay(c,a,caseId,b.id,hash,'report_composition_reviews');if(prior)return view(c,a,caseId,await head(c,a,caseId,compositionId,prior.version));
  const row=await head(c,a,caseId,compositionId),previous=await latestReview(c,a,caseId,compositionId,row.version);
  if(!await independent(c,a,caseId,compositionId))throw new ApiError(403,'An independent reviewer who authored no version of this outline must review it.');
  if(row.version!==b.expectedVersion||row.sha256.trim()!==b.sha256||row.payload.state!=='active'||(previous?.sequence??0)!==b.expectedReviewSequence)throw new ApiError(409,'Review must name the current outline and decision sequence. Refresh history.');
  if(b.decision==='accepted')await selected(c,a,caseId,row.payload);
  await c.query('INSERT INTO report_composition_reviews(tenant_id,case_id,composition_id,version,id,sequence,request_hash,sha256,decision,reason,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[a.tenantId,caseId,compositionId,row.version,b.id,b.expectedReviewSequence+1,hash,b.sha256,b.decision,reason,a.userId,a.displayName]);await audit(c,a,caseId,'reviewed',compositionId,{version:row.version,decision:b.decision,sha256:b.sha256});return view(c,a,caseId,row);
 }));
 return {async freeze(c:PoolClient,a:Actor,caseId:string,binding:{id:string;version:number;sha256:string;reviewId:string}){
  const row=await head(c,a,caseId,binding.id),review=await latestReview(c,a,caseId,binding.id,row.version);
  if(row.version!==binding.version||row.sha256.trim()!==binding.sha256||row.payload.state!=='active'||!review||review.id!==binding.reviewId||review.decision!=='accepted')throw new ApiError(409,'Freezing requires the current independently accepted outline and exact review receipt.');
  const report=await selected(c,a,caseId,row.payload);report.composition={format:'inveos_report_composition_v1',payload:orderedCompositionPayload(row.payload),sha256:binding.sha256,authorId:row.actor_id,authorName:row.actor_name,recordedAt:iso(row.recorded_at),review:reviewView(review)};
  return report;
 }};
}
