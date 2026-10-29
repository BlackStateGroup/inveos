import {documentReview,type DocumentReviewInput,type ReviewPredecessor} from './document-review.js';
import {documentClaim,documentClaimDecision,type DocumentClaimDecisionInput,type DocumentClaimInput,type ReviewedCitation} from './document-claim.js';
import {documentCitation,type DocumentSelection} from './document-citation.js';
import {makeRasterDerivative,rasterProfile,rasterProfileDigest,type RasterResult} from './raster-derivative.js';
const rasterKind='pdf_raster_lab_v1';
import {documentKind,documentProfile,documentProfileDigest,makeDocumentDerivative,type DocumentContext,type DocumentResult} from './document-derivative.js';
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { Actor } from './app.js';
import { inTransaction } from './db.js';
import { ApiError, notFound } from './errors.js';
import { readOriginalBounded } from './storage.js';
import { makeTextDerivative, sha256, textConfiguration, textProcessor, verifyTextDerivative, type DerivativeOutput } from './text-derivative.js';

type Scope = {tenantId: string; caseId: string; jobId: string};
type Services = {
  pool: Pool; storageRoot: string; documentLab?: boolean; authenticate: (r: FastifyRequest) => Promise<void>; requireCsrf: (r: FastifyRequest) => Promise<void>;
  audit: (c: PoolClient, a: Actor, caseId: string, action: string, entityType: string, id: string, summary: string) => Promise<void>;
  findCase: (c: PoolClient, a: Actor, id: string, lock?: boolean) => Promise<unknown>;
};
const uuid = {type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'} as const;
const params = {type: 'object', required: ['caseId','jobId'], additionalProperties: false, properties: {caseId: uuid, jobId: uuid}} as const;
const values = (s: Scope) => [s.tenantId, s.caseId, s.jobId];
function dto(row: QueryResultRow) {
  return {id: row.id, caseId: row.case_id, evidenceId: row.evidence_id, sourceDigest: row.source_digest.trim(),
    authorityVersion: row.authority_version, kind: row.kind, status: row.status, attempt: row.attempt,
    failureCode: row.failure_code, createdAt: row.created_at, finishedAt: row.finished_at};
}
async function event(client: PoolClient, s: Scope, row: QueryResultRow) {
  await client.query(`INSERT INTO integrity_job_events (tenant_id,case_id,job_id,status,attempt,failure_code)
    VALUES ($1,$2,$3,$4,$5,$6)`, [...values(s), row.status, row.attempt, row.failure_code]);
}
// Match HTTP cancellation/authority lock order: case first, then job.
async function lockWorkerCase(client:PoolClient,s:{tenantId:string;caseId:string}) {
  await client.query('SELECT id FROM cases WHERE tenant_id=$1 AND id=$2 FOR SHARE',[s.tenantId,s.caseId]);
}
async function permitted(client: PoolClient, row: QueryResultRow): Promise<boolean> {
  const r = await client.query(`SELECT 1 FROM cases c JOIN case_memberships cm ON cm.tenant_id=c.tenant_id AND cm.case_id=c.id
    JOIN memberships m ON m.tenant_id=cm.tenant_id AND m.user_id=cm.user_id
    WHERE c.tenant_id=$1 AND c.id=$2 AND cm.user_id=$3 AND m.role <> 'client'
      AND c.status='Active' AND c.authority_version=$4 FOR SHARE OF c`, [row.tenant_id,row.case_id,row.requested_by,row.authority_version]);
  return r.rowCount === 1;
}
async function terminal(client: PoolClient, s: Scope, status: string, code: string | null, token: string | null = null) {
  const result = await client.query(`UPDATE integrity_jobs SET status=$4,failure_code=$5,lease_token=NULL,lease_until=NULL,finished_at=clock_timestamp()
    WHERE tenant_id=$1 AND case_id=$2 AND id=$3
      AND ($6::uuid IS NULL OR (status='running' AND lease_token=$6 AND lease_until>clock_timestamp()))
      AND ($6::uuid IS NULL OR $4='cancelled' OR EXISTS (
        SELECT 1 FROM case_memberships cm JOIN memberships m ON m.tenant_id=cm.tenant_id AND m.user_id=cm.user_id
        WHERE cm.tenant_id=integrity_jobs.tenant_id AND cm.case_id=integrity_jobs.case_id
          AND cm.user_id=integrity_jobs.requested_by AND m.role <> 'client')) RETURNING *`, [...values(s),status,code,token]);
  if (!result.rows[0]) return null;
  await event(client,s,result.rows[0]);
  return dto(result.rows[0]);
}

type Lease = {token: string; evidenceId: string; digest: string; kind: string};
/** Caller holds the row lock. Both named jobs and dispatch use the same checks. */
async function claimLocked(client: PoolClient, s: Scope, row: QueryResultRow) {
  if (!await permitted(client,row)) return {lease:null,receipt:await terminal(client,s,'cancelled','scope_changed')};
  if (row.attempt >= 3) return {lease:null,receipt:await terminal(client,s,'failed','attempts_exhausted')};
  const updated = await client.query(`UPDATE integrity_jobs SET status='running',attempt=attempt+1,lease_token=$4,
    lease_until=clock_timestamp()+interval '60 seconds',lease_deadline=clock_timestamp()+interval '5 minutes' WHERE tenant_id=$1 AND case_id=$2 AND id=$3 RETURNING *`, [...values(s),randomUUID()]);
  await event(client,s,updated.rows[0]);
  const lease: Lease = {token:updated.rows[0].lease_token,evidenceId:row.evidence_id,digest:row.source_digest.trim(),kind:row.kind};
  return {lease,receipt:null};
}

/** Trusted worker entry point, never an HTTP route. Scope must be supplied explicitly. */
export async function claimIntegrityJob(pool: Pool, s: Scope) {
  return inTransaction(pool, async client => {
    await lockWorkerCase(client,s);
    const found = await client.query(`SELECT *, lease_until > clock_timestamp() AS live FROM integrity_jobs
      WHERE tenant_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE`, values(s));
    const row = found.rows[0];
    if (!row || !['queued','running'].includes(row.status) || row.live) return null;
    return (await claimLocked(client,s,row)).lease;
  });
}

/** Trusted worker heartbeat. No HTTP exposure and no new attempt/token. */
export async function renewIntegrityJob(pool: Pool, s: Scope, token: string) {
  return inTransaction(pool,async client=>{
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '5s'");
    await lockWorkerCase(client,s);
    const found=await client.query(`SELECT * FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND id=$3
      AND status='running' AND lease_token=$4 AND lease_until>clock_timestamp()
      AND lease_deadline>clock_timestamp() FOR UPDATE`,[...values(s),token]);
    const row=found.rows[0];if(!row)return null;
    if(!await permitted(client,row)) {
      await terminal(client,s,'cancelled','scope_changed',token);
      return null;
    }
    // Recheck after lock waits. Membership may have been withdrawn meanwhile.
    const renewed=await client.query(`UPDATE integrity_jobs SET
      lease_until=LEAST(lease_deadline,clock_timestamp()+interval '60 seconds')
      WHERE tenant_id=$1 AND case_id=$2 AND id=$3 AND status='running' AND lease_token=$4
        AND lease_until>clock_timestamp() AND lease_deadline>clock_timestamp()
        AND EXISTS (SELECT 1 FROM case_memberships cm JOIN memberships m
          ON m.tenant_id=cm.tenant_id AND m.user_id=cm.user_id
          WHERE cm.tenant_id=integrity_jobs.tenant_id AND cm.case_id=integrity_jobs.case_id
            AND cm.user_id=integrity_jobs.requested_by AND m.role<>'client')
      RETURNING lease_until,lease_deadline,attempt`,[...values(s),token]);
    if(!renewed.rows[0])return null;
    const result=renewed.rows[0];
    return {leaseUntil:result.lease_until,deadline:result.lease_deadline,attempt:result.attempt};
  });
}

export type DispatchScope = {tenantId:string;caseId:string};
const workerUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateDispatch(s: DispatchScope, limit: number) {
  if (!workerUuid.test(s.tenantId) || !workerUuid.test(s.caseId) || !Number.isInteger(limit) || limit<1 || limit>25) {
    throw new Error('Dispatch requires tenant and case UUIDs and a limit from 1 to 25.');
  }
}

/** One bounded pass. No global tenant discovery, HTTP endpoint or privileged credentials. */
export async function dispatchIntegrityJobs(pool: Pool, root: string, scope: DispatchScope, limit = 10, signal?: AbortSignal) {
  validateDispatch(scope,limit);
  const results: {jobId:string;status:string;attempt:number|null;failureCode:string|null}[] = [];
  let stopReason: 'limit' | 'empty' | 'aborted' = 'limit';
  while (results.length < limit) {
    if (signal?.aborted) {stopReason='aborted';break;}
    const selected = await inTransaction(pool,async client=>{
      // Bound waits on authority locks and database statements; these are not an OS sandbox.
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query("SET LOCAL statement_timeout = '5s'");
      await lockWorkerCase(client,scope);
      const r=await client.query(`SELECT * FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2
        AND kind IN ('original_sha256_v1','utf8_line_index_v1')
        AND (status='queued' OR (status='running' AND lease_until<=clock_timestamp()))
        ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,[scope.tenantId,scope.caseId]);
      const row=r.rows[0];if(!row)return null;
      const s={...scope,jobId:row.id as string};
      return {scope:s,...await claimLocked(client,s,row)};
    });
    if (!selected) {stopReason='empty';break;}
    // A stop signal prevents the next claim, but an already acquired lease can finish safely.
    const receipt=selected.lease
      ? await processLeasedJob(pool,root,selected.scope,selected.lease) : selected.receipt;
    results.push({jobId:selected.scope.jobId,status:receipt?.status??'lease_lost',
      attempt:receipt?.attempt??null,failureCode:receipt?.failureCode??null});
  }
  return {selected:results.length,stopReason,results};
}
export async function finishIntegrityJob(pool: Pool, s: Scope, token: string, failure: 'original_unavailable' | 'digest_mismatch' | 'worker_execution_failed' | 'worker_cleanup_unconfirmed' | null) {
  return finishProcessingJob(pool,s,token,failure);
}
type Failure = 'original_unavailable' | 'digest_mismatch' | 'unsupported_original' | 'text_limits' | 'worker_execution_failed' | 'worker_cleanup_unconfirmed';
async function finishProcessingJob(pool: Pool, s: Scope, token: string, failure: Failure | null, output?: DerivativeOutput) {
  return inTransaction(pool, async client => {
    await lockWorkerCase(client,s);
    const r = await client.query(`SELECT * FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND id=$3
      AND status='running' AND lease_token=$4 AND lease_until > clock_timestamp() FOR UPDATE`, [...values(s),token]);
    if (!r.rows[0]) return null; // Expired, cancelled or superseded worker cannot commit.
    if (!await permitted(client,r.rows[0])) return terminal(client,s,'cancelled','scope_changed',token);
    const completed=await terminal(client,s,failure ? 'failed' : 'succeeded',failure,token);
    if (completed?.status==='succeeded' && output && r.rows[0].kind==='utf8_line_index_v1') {
      const row=r.rows[0];
      await client.query(`INSERT INTO text_derivatives (tenant_id,case_id,job_id,evidence_id,source_digest,authority_version,kind,attempt,
        processor,processor_digest,configuration,configuration_digest,runtime,output_bytes,output_digest)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [...values(s),row.evidence_id,row.source_digest,row.authority_version,row.kind,row.attempt,
        textProcessor,output.processorDigest,textConfiguration,sha256(textConfiguration),output.runtime,output.bytes,output.digest]);
    }
    return completed;
  });
}
export async function runIntegrityJob(pool: Pool, root: string, s: Scope) {
  const kind=await pool.query('SELECT kind FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND id=$3',values(s));
  if([documentKind,rasterKind].includes(kind.rows[0]?.kind))return null; // Separate qualified worker required.
  const lease = await claimIntegrityJob(pool,s);
  if (!lease) return null;
  return processLeasedJob(pool,root,s,lease);
}
async function processLeasedJob(pool: Pool, root: string, s: Scope, lease: Lease) {
  let failure: Failure | null = null;
  let output: DerivativeOutput | undefined;
  try {
    const result = await pool.query(`SELECT object_path,byte_length,digest,original_kind FROM evidence WHERE tenant_id=$1 AND case_id=$2 AND id=$3`, [s.tenantId,s.caseId,lease.evidenceId]);
    const source = result.rows[0];
    if (!source) throw new Error('Missing original');
    const bytes = await readOriginalBounded(root,source.object_path,262144);
    if (bytes.length !== source.byte_length || createHash('sha256').update(bytes).digest('hex') !== lease.digest
        || source.digest.trim() !== lease.digest) failure = 'digest_mismatch';
    if (!failure && lease.kind==='utf8_line_index_v1') {
      if (source.original_kind!=='original_utf8') failure='unsupported_original';
      else { try { output=await makeTextDerivative(bytes); } catch { failure='text_limits'; } }
    }
  } catch { failure = 'original_unavailable'; }
  return finishProcessingJob(pool,s,lease.token,failure,output);
}

function documentContext(row:QueryResultRow):DocumentContext {
  return {tenantId:row.tenant_id,caseId:row.case_id,jobId:row.job_id??row.id,evidenceId:row.evidence_id,
    sourceDigest:row.source_digest.trim(),authorityVersion:row.authority_version};
}
/** Trusted attachment only. Worker context/profile are attestations, never browser inputs. */
export async function finishDocumentJob(pool:Pool,root:string,s:Scope,token:string,result:DocumentResult) {
  return inTransaction(pool,async client=>{
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '5s'");
    await lockWorkerCase(client,s);
    const found=await client.query(`SELECT * FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND id=$3
      AND status='running' AND lease_token=$4 AND lease_until>clock_timestamp() FOR UPDATE`,[...values(s),token]);
    const row=found.rows[0];if(!row||row.kind!==documentKind)return null;
    if(!await permitted(client,row))return terminal(client,s,'cancelled','scope_changed',token);
    const source=(await client.query('SELECT * FROM evidence WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[s.tenantId,s.caseId,row.evidence_id])).rows[0];
    let original:Buffer;
    try {
      original=await readOriginalBounded(root,source.object_path,65536);
      if(source.original_kind!=='opaque_binary'||original.length!==source.byte_length||sha256(original)!==row.source_digest.trim()||source.digest.trim()!==row.source_digest.trim())throw new Error('Original mismatch');
    } catch {return terminal(client,s,'failed','original_unavailable',token);}
    let output;
    try {output=makeDocumentDerivative(original,documentContext(row),result);}
    catch {return terminal(client,s,'failed','document_result_invalid',token);}
    // Final fenced transition occurs after original and output checks, within the same transaction.
    const completed=await terminal(client,s,'succeeded',null,token);
    if(!completed)return null;
    await client.query(`INSERT INTO document_derivatives (tenant_id,case_id,job_id,evidence_id,source_digest,authority_version,kind,attempt,
      profile,profile_digest,raw_bytes,raw_digest,output_bytes,output_digest) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [...values(s),row.evidence_id,row.source_digest,row.authority_version,row.kind,row.attempt,documentProfile,documentProfileDigest,result.raw,output.rawDigest,output.bytes,output.digest]);
    return completed;
  });
}

export async function finishRasterJob(pool:Pool,root:string,s:Scope,token:string,result:RasterResult) {
  return inTransaction(pool,async client=>{
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '5s'");
    await lockWorkerCase(client,s);
    const found=await client.query(`SELECT * FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND id=$3
      AND status='running' AND lease_token=$4 AND lease_until>clock_timestamp() FOR UPDATE`,[...values(s),token]);
    const row=found.rows[0];if(!row||row.kind!==rasterKind)return null;
    if(!await permitted(client,row))return terminal(client,s,'cancelled','scope_changed',token);
    const source=(await client.query('SELECT * FROM evidence WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[s.tenantId,s.caseId,row.evidence_id])).rows[0];
    let original:Buffer;
    try {
      original=await readOriginalBounded(root,source.object_path,65536);
      if(source.original_kind!=='opaque_binary'||original.length!==source.byte_length||sha256(original)!==row.source_digest.trim()||source.digest.trim()!==row.source_digest.trim())throw new Error('Original mismatch');
    } catch {return terminal(client,s,'failed','original_unavailable',token);}
    let output;
    try {output=makeRasterDerivative(original,documentContext(row),result);}
    catch {return terminal(client,s,'failed','raster_result_invalid',token);}
    const raw=Buffer.from(JSON.stringify({context:documentContext(row),profileDigest:rasterProfileDigest,originalSha256:row.source_digest.trim(),
      pages:output.pages.map(p=>({page:p.page,width:p.width,height:p.height,pngSha256:p.digest,pngBytes:p.byteLength,pngBase64:p.bytes.toString('base64')}))}));
    // Final fenced transition occurs after original and output checks, within the same transaction.
    const completed=await terminal(client,s,'succeeded',null,token);
    if(!completed)return null;
    await client.query(`INSERT INTO raster_derivatives (tenant_id,case_id,job_id,evidence_id,source_digest,authority_version,kind,attempt,
      profile,profile_digest,raw_bytes,raw_digest,output_bytes,output_digest) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [...values(s),row.evidence_id,row.source_digest,row.authority_version,row.kind,row.attempt,rasterProfile,rasterProfileDigest,raw,sha256(raw),output.bytes,output.digest]);
    return completed;
  });
}

export function registerIntegrityJobs(app: FastifyInstance, svc: Services) {
  app.get('/api/cases/:caseId/integrity-jobs', {preHandler:svc.authenticate,schema:{
    params:{type:'object',required:['caseId'],additionalProperties:false,properties:{caseId:uuid}},
    querystring:{type:'object',additionalProperties:false,properties:{before:uuid,limit:{type:'integer',minimum:1,maximum:50,default:25}}},
  }},async(request,reply)=>{
    const actor=request.actor!;
    if(actor.role==='client') throw new ApiError(403,'Internal jobs only.');
    const {caseId}=request.params as {caseId:string}, {before,limit=25}=request.query as {before?:string;limit?:number};
    const page=await inTransaction(svc.pool,async client=>{
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await svc.findCase(client,actor,caseId);
      if(before && !(await client.query('SELECT 1 FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[actor.tenantId,caseId,before])).rowCount) notFound();
      const result=await client.query(`SELECT * FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2
        AND ($3::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND id=$3))
        ORDER BY created_at DESC,id DESC LIMIT $4`,[actor.tenantId,caseId,before??null,limit+1]);
      return {items:result.rows.slice(0,limit).map(dto),nextBefore:result.rows.length>limit?result.rows[limit-1].id:null};
    });
    return reply.header('Cache-Control','no-store').send(page);
  });
  app.get('/api/cases/:caseId/integrity-jobs/:jobId/events', {preHandler:svc.authenticate,schema:{params,
    querystring:{type:'object',additionalProperties:false,properties:{after:{type:'string',pattern:'^[0-9]{1,18}$'},limit:{type:'integer',minimum:1,maximum:50,default:25}}},
  }},async(request,reply)=>{
    const actor=request.actor!;
    if(actor.role==='client') throw new ApiError(403,'Internal jobs only.');
    const {caseId,jobId}=request.params as {caseId:string;jobId:string};
    const {after,limit=25}=request.query as {after?:string;limit?:number};
    const page=await inTransaction(svc.pool,async client=>{
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await svc.findCase(client,actor,caseId);
      if(!(await client.query('SELECT 1 FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[actor.tenantId,caseId,jobId])).rowCount) notFound();
      if(after && !(await client.query('SELECT 1 FROM integrity_job_events WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 AND id=$4',[actor.tenantId,caseId,jobId,after])).rowCount) notFound();
      const result=await client.query(`SELECT id::text,status,attempt,failure_code AS "failureCode",recorded_at AS "recordedAt"
        FROM integrity_job_events WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 AND ($4::bigint IS NULL OR id>$4)
        ORDER BY integrity_job_events.id LIMIT $5`,[actor.tenantId,caseId,jobId,after??null,limit+1]);
      return {items:result.rows.slice(0,limit),nextAfter:result.rows.length>limit?result.rows[limit-1].id:null};
    });
    return reply.header('Cache-Control','no-store').send(page);
  });
  app.post('/api/cases/:caseId/integrity-jobs', {preHandler: svc.requireCsrf, schema: {
    params: {type:'object',required:['caseId'],additionalProperties:false,properties:{caseId:uuid}},
    body: {type:'object',required:['evidenceId','idempotencyKey'],additionalProperties:false,properties:{evidenceId:uuid,idempotencyKey:uuid,kind:{type:'string',enum:['original_sha256_v1','utf8_line_index_v1',documentKind,rasterKind]}}},
  }}, async request => {
    const actor = request.actor!;
    const {caseId} = request.params as {caseId:string};
    const input = request.body as {evidenceId:string;idempotencyKey:string;kind?:string};
    if([documentKind,rasterKind].includes(input.kind??'')&&!svc.documentLab)throw new ApiError(409,'Document processing lab is disabled.');
    return inTransaction(svc.pool,async client => {
      await svc.findCase(client,actor,caseId,true);
      const old = await client.query('SELECT * FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND requested_by=$3 AND idempotency_key=$4', [actor.tenantId,caseId,actor.userId,input.idempotencyKey]);
      if (old.rows[0]) {
        if (old.rows[0].evidence_id !== input.evidenceId || old.rows[0].kind !== (input.kind ?? 'original_sha256_v1')) throw new ApiError(409,'Idempotency key already used.');
        return dto(old.rows[0]);
      }
      const source = await client.query(`SELECT e.digest,e.original_kind,e.byte_length,c.authority_version FROM evidence e JOIN cases c ON c.tenant_id=e.tenant_id AND c.id=e.case_id
        WHERE e.tenant_id=$1 AND e.case_id=$2 AND e.id=$3 AND c.status='Active'`, [actor.tenantId,caseId,input.evidenceId]);
      if (!source.rows[0]) notFound();
      if (input.kind==='utf8_line_index_v1' && source.rows[0].original_kind!=='original_utf8') throw new ApiError(409,'Text indexing requires a UTF-8 original.');
      if([documentKind,rasterKind].includes(input.kind??'')&&(source.rows[0].original_kind!=='opaque_binary'||source.rows[0].byte_length>65536))throw new ApiError(409,'Document lab requires a bounded binary original.');
      const id = randomUUID();
      const inserted = await client.query(`INSERT INTO integrity_jobs (tenant_id,case_id,id,evidence_id,source_digest,authority_version,requested_by,idempotency_key,kind)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [actor.tenantId,caseId,id,input.evidenceId,source.rows[0].digest,source.rows[0].authority_version,actor.userId,input.idempotencyKey,input.kind ?? 'original_sha256_v1']);
      await event(client,{tenantId:actor.tenantId,caseId,jobId:id},inserted.rows[0]);
      await svc.audit(client,actor,caseId,'integrity_job.queued','integrity_job',id,'Scoped original processing requested');
      return dto(inserted.rows[0]);
    });
  });
  app.get('/api/cases/:caseId/integrity-jobs/:jobId/derivative', {preHandler:svc.authenticate,schema:{params}}, async (request,reply) => {
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff');
    const actor=request.actor!;
    if (actor.role==='client') throw new ApiError(403,'Internal derivatives only.');
    const {caseId,jobId}=request.params as {caseId:string;jobId:string};
    return inTransaction(svc.pool,async client => {
      await svc.findCase(client,actor,caseId,true);
      const result=await client.query(`SELECT d.*,e.object_path,e.byte_length,e.digest,e.original_kind,e.source_time,e.received_time
        FROM text_derivatives d JOIN evidence e ON e.tenant_id=d.tenant_id AND e.case_id=d.case_id AND e.id=d.evidence_id
        WHERE d.tenant_id=$1 AND d.case_id=$2 AND d.job_id=$3`,[actor.tenantId,caseId,jobId]);
      const row=result.rows[0];if (!row) notFound();
      let derivative;
      try {
        const original=await readOriginalBounded(svc.storageRoot,row.object_path,262144);
        if (original.length!==row.byte_length || sha256(original)!==row.source_digest.trim() || row.digest.trim()!==row.source_digest.trim()
          || row.original_kind!=='original_utf8' || row.configuration!==textConfiguration || sha256(row.configuration)!==row.configuration_digest.trim()) throw new Error('Lineage mismatch');
        derivative=verifyTextDerivative(original,row.output_bytes,row.output_digest.trim());
      } catch { throw new ApiError(409,'Original or derivative integrity verification failed.'); }
      await svc.audit(client,actor,caseId,'derivative.read','integrity_job',jobId,'Verified unreviewed text derivative read');
      return {jobId,evidenceId:row.evidence_id,caseId,status:'unreviewed_derivative',sourceDigest:row.source_digest.trim(),
        authorityVersion:row.authority_version,attempt:row.attempt,processor:row.processor,processorDigest:row.processor_digest.trim(),
        configuration:JSON.parse(row.configuration),configurationDigest:row.configuration_digest.trim(),runtime:row.runtime,
        derivativeDigest:row.output_digest.trim(),processedAt:row.processed_at,sourceTime:row.source_time,receivedAt:row.received_time,derivative};
    });
  });
  async function verifiedDocument(client:PoolClient,actor:Actor,caseId:string,jobId:string){
      await svc.findCase(client,actor,caseId,true);
      const row=(await client.query(`SELECT d.*,e.object_path,e.byte_length,e.digest,e.original_kind,e.source_time,e.received_time
        FROM document_derivatives d JOIN evidence e ON e.tenant_id=d.tenant_id AND e.case_id=d.case_id AND e.id=d.evidence_id
        WHERE d.tenant_id=$1 AND d.case_id=$2 AND d.job_id=$3`,[actor.tenantId,caseId,jobId])).rows[0];
      if(!row)notFound();let output;
      try {
        const original=await readOriginalBounded(svc.storageRoot,row.object_path,65536);
        if(original.length!==row.byte_length||row.original_kind!=='opaque_binary'||row.digest.trim()!==row.source_digest.trim()
          ||row.profile!==documentProfile||row.profile_digest.trim()!==documentProfileDigest||sha256(row.raw_bytes)!==row.raw_digest.trim())throw new Error('Lineage mismatch');
        const context=documentContext(row);
        output=makeDocumentDerivative(original,context,{context,profileDigest:row.profile_digest.trim(),successful:true,raw:row.raw_bytes});
        if(output.digest!==row.output_digest.trim()||!output.bytes.equals(row.output_bytes))throw new Error('Derivative mismatch');
      } catch {throw new ApiError(409,'Original or document derivative integrity verification failed.');}
      return {row,output};
  }
  app.get('/api/cases/:caseId/integrity-jobs/:jobId/document-derivative',{preHandler:svc.authenticate,schema:{params}},async(request,reply)=>{
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff');
    const actor=request.actor!;if(actor.role==='client')throw new ApiError(403,'Internal derivatives only.');
    const {caseId,jobId}=request.params as {caseId:string;jobId:string};
    return inTransaction(svc.pool,async client=>{
      const {row,output}=await verifiedDocument(client,actor,caseId,jobId);
      await svc.audit(client,actor,caseId,'document_derivative.read','integrity_job',jobId,'Verified unreviewed document derivative read');
      return {jobId,caseId,evidenceId:row.evidence_id,status:'unreviewed_derivative',authorityVersion:row.authority_version,
        sourceDigest:row.source_digest.trim(),attempt:row.attempt,profile:JSON.parse(row.profile),profileDigest:row.profile_digest.trim(),
        rawDigest:row.raw_digest.trim(),derivativeDigest:row.output_digest.trim(),processedAt:row.processed_at,
        sourceTime:row.source_time,receivedAt:row.received_time,derivative:output.derivative};
    });
  });
  app.get('/api/cases/:caseId/integrity-jobs/:jobId/document-citations',{preHandler:svc.authenticate,schema:{params,querystring:{type:'object',additionalProperties:false,properties:{after:uuid}}}},async(request,reply)=>{
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff');
    const actor=request.actor!;if(actor.role==='client')throw new ApiError(403,'Internal citation candidates only.');
    const {caseId,jobId}=request.params as {caseId:string;jobId:string},after=(request.query as {after?:string}).after;
    return inTransaction(svc.pool,async client=>{
      const {output}=await verifiedDocument(client,actor,caseId,jobId);
      const rows=(await client.query('SELECT * FROM document_citation_candidates WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 AND ($4::uuid IS NULL OR id>$4::uuid) ORDER BY id LIMIT 51',[actor.tenantId,caseId,jobId,after??null])).rows;
      const items=rows.slice(0,50).map(stored=>{
        let checked;try{checked=documentCitation(output,stored.selection);}catch{throw new ApiError(409,'Stored citation selection failed verification.');}
        if(checked.digest!==stored.citation_digest.trim()||!checked.bytes.equals(stored.citation_bytes))throw new ApiError(409,'Stored citation bytes failed verification.');
        return {id:stored.id,createdBy:stored.created_by,createdAt:stored.created_at,citationDigest:checked.digest,citation:checked.citation};
      });
      await svc.audit(client,actor,caseId,'document_citation.listed','integrity_job',jobId,'Verified unreviewed document citation candidates listed');
      return {items,nextAfter:rows.length>50?items.at(-1)!.id:null};
    });
  });
  const citationParams={...params,required:[...params.required,'citationId'],properties:{...params.properties,citationId:uuid}};
  const selectionSchema={type:'object',additionalProperties:false,required:['derivativeDigest','itemRef','startByte','endByte','quote'],properties:{derivativeDigest:{type:'string',pattern:'^[a-f0-9]{64}$'},itemRef:{type:'string',pattern:'^#/texts/[0-9]{1,4}$'},startByte:{type:'integer',minimum:0,maximum:1048576},endByte:{type:'integer',minimum:1,maximum:1048576},quote:{type:'string',minLength:1,maxLength:4096}}};
  for(const create of [false,true])app.route({method:create?'POST':'GET',url:'/api/cases/:caseId/integrity-jobs/:jobId/document-citations/:citationId',preHandler:create?svc.requireCsrf:svc.authenticate,schema:{params:citationParams,...(create?{body:selectionSchema}:{})},handler:async(request,reply)=>{
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff');
    const actor=request.actor!;if(actor.role==='client')throw new ApiError(403,'Internal citation candidates only.');
    const {caseId,jobId,citationId}=request.params as {caseId:string;jobId:string;citationId:string};
    return inTransaction(svc.pool,async client=>{
      const {row,output}=await verifiedDocument(client,actor,caseId,jobId);
      if(create){const active=await client.query("SELECT 1 FROM cases WHERE tenant_id=$1 AND id=$2 AND status='Active' AND authority_version=$3",[actor.tenantId,caseId,row.authority_version]);if(!active.rowCount)throw new ApiError(409,'Current authority must match the extraction.');}
      const key=[actor.tenantId,caseId,jobId,citationId];
      let stored=(await client.query('SELECT * FROM document_citation_candidates WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 AND id=$4',key)).rows[0];
      if(!create&&!stored)notFound();
      const selection=(create?request.body:stored.selection) as DocumentSelection;
      let checked;try{checked=documentCitation(output,selection);}catch{throw new ApiError(409,'Document citation selection failed verification.');}
      if(stored){
        let persisted;try{persisted=documentCitation(output,stored.selection);}catch{throw new ApiError(409,'Stored citation selection failed verification.');}
        if(persisted.digest!==stored.citation_digest.trim()||!persisted.bytes.equals(stored.citation_bytes))throw new ApiError(409,'Stored citation bytes failed verification.');
        if(create&&stored.created_by!==actor.userId)throw new ApiError(409,'Citation identity belongs to another author.');
        if(stored.citation_digest.trim()!==checked.digest||!stored.citation_bytes.equals(checked.bytes))throw new ApiError(409,'Citation identity conflicts or stored bytes failed verification.');
      }else{
        stored=(await client.query(`INSERT INTO document_citation_candidates(tenant_id,case_id,job_id,id,created_by,selection,citation_bytes,citation_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[...key,actor.userId,selection,checked.bytes,checked.digest])).rows[0];
      }
      await svc.audit(client,actor,caseId,create?'document_citation.saved':'document_citation.read','document_citation',citationId,'Verified unreviewed document citation candidate');
      return {id:citationId,createdBy:stored.created_by,createdAt:stored.created_at,citationDigest:checked.digest,citation:checked.citation};
    });
  }});
  const reviewSchema={type:'object',additionalProperties:false,required:['id','previousReviewId','citationDigest','decision','reason','originalCompared'],properties:{id:uuid,previousReviewId:{anyOf:[uuid,{type:'null'}]},citationDigest:{type:'string',pattern:'^[a-f0-9]{64}$'},decision:{enum:['accepted','rejected']},reason:{type:'string',minLength:1,maxLength:4096},originalCompared:{type:'boolean'}}};
  for(const create of [false,true])app.route({method:create?'POST':'GET',url:'/api/cases/:caseId/integrity-jobs/:jobId/document-citations/:citationId/reviews',preHandler:create?svc.requireCsrf:svc.authenticate,schema:{params:citationParams,...(create?{body:reviewSchema}:{})},handler:async(request,reply)=>{
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff');
    const actor=request.actor!;if(actor.role==='client'||create&&actor.role!=='reviewer')throw new ApiError(403,'Only internal reviewers can record citation decisions.');
    const {caseId,jobId,citationId}=request.params as {caseId:string;jobId:string;citationId:string};
    return inTransaction(svc.pool,async client=>{
      const {row,output}=await verifiedDocument(client,actor,caseId,jobId),key=[actor.tenantId,caseId,jobId,citationId];
      const candidate=(await client.query('SELECT * FROM document_citation_candidates WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 AND id=$4',key)).rows[0];if(!candidate)notFound();
      let checked;try{checked=documentCitation(output,candidate.selection);}catch{throw new ApiError(409,'Stored citation selection failed verification.');}
      if(checked.digest!==candidate.citation_digest.trim()||!checked.bytes.equals(candidate.citation_bytes))throw new ApiError(409,'Stored citation bytes failed verification.');
      const rows=(await client.query('SELECT * FROM document_citation_reviews WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 AND citation_id=$4 ORDER BY sequence LIMIT 101',key)).rows;
      let previous:ReviewPredecessor|null=null;
      const reviews:(ReturnType<typeof documentReview>['record']&{digest:string})[]=[];
      for(const stored of rows){
        let verified;try{verified=documentReview(citationId,checked,stored.request,stored.reviewed_by,new Date(stored.reviewed_at).toISOString(),previous);}catch{throw new ApiError(409,'Stored review chain failed verification.');}
        if(stored.id!==verified.record.id||stored.sequence!==verified.record.sequence||stored.reviewed_by===candidate.created_by||stored.review_digest.trim()!==verified.digest||!stored.review_bytes.equals(verified.bytes))throw new ApiError(409,'Stored review bytes failed verification.');
        previous={id:stored.id,sequence:stored.sequence,digest:verified.digest};reviews.push({...verified.record,digest:verified.digest});
      }
      if(create){
        const input=request.body as DocumentReviewInput;
        if(actor.userId===candidate.created_by)throw new ApiError(403,'A different reviewer must assess this citation.');
        const existing=rows.find(r=>r.id===input.id);
        if(existing){
          if(existing.reviewed_by!==actor.userId||(['id','previousReviewId','citationDigest','decision','reason','originalCompared'] as const).some(k=>existing.request[k]!==input[k]))throw new ApiError(409,'Review identity conflicts with an existing decision.');
        }else{
          const active=await client.query("SELECT 1 FROM cases WHERE tenant_id=$1 AND id=$2 AND status='Active' AND authority_version=$3",[actor.tenantId,caseId,row.authority_version]);if(!active.rowCount)throw new ApiError(409,'Current authority must match the extraction before review.');
          if(input.previousReviewId!==(previous?.id??null))throw new ApiError(409,'Review changed; refresh before recording a replacement.');
          const reviewedAt=new Date().toISOString();let review;
          try{review=documentReview(citationId,checked,input,actor.userId,reviewedAt,previous);}catch{throw new ApiError(422,'Review requires the exact citation digest, a reason and original comparison for acceptance.');}
          await client.query('INSERT INTO document_citation_reviews(tenant_id,case_id,job_id,citation_id,id,sequence,reviewed_by,reviewed_at,request,review_bytes,review_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[...key,input.id,review.record.sequence,actor.userId,reviewedAt,input,review.bytes,review.digest]);
          reviews.push({...review.record,digest:review.digest});
        }
      }
      await svc.audit(client,actor,caseId,create?'document_citation.reviewed':'document_citation.reviews_read','document_citation',citationId,'Verified citation correspondence review history; no finding approval');
      return {citationId,citationDigest:checked.digest,currentReviewId:reviews.at(-1)?.id??null,reviews};
    });
  }});
  async function verifiedReviewedCitation(client:PoolClient,actor:Actor,caseId:string,jobId:string,citationId:string){
    const {row,output}=await verifiedDocument(client,actor,caseId,jobId),key=[actor.tenantId,caseId,jobId,citationId];
    const candidate=(await client.query('SELECT * FROM document_citation_candidates WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 AND id=$4',key)).rows[0];if(!candidate)notFound();
    let checked;try{checked=documentCitation(output,candidate.selection);}catch{throw new ApiError(409,'Stored citation selection failed verification.');}
    if(checked.digest!==candidate.citation_digest.trim()||!checked.bytes.equals(candidate.citation_bytes))throw new ApiError(409,'Stored citation bytes failed verification.');
    const storedReviews=(await client.query('SELECT * FROM document_citation_reviews WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 AND citation_id=$4 ORDER BY sequence LIMIT 101',key)).rows;
    let previous:ReviewPredecessor|null=null;const reviews:ReviewedCitation[]=[];
    for(const stored of storedReviews){
      let verified;try{verified=documentReview(citationId,checked,stored.request,stored.reviewed_by,new Date(stored.reviewed_at).toISOString(),previous);}catch{throw new ApiError(409,'Stored review chain failed verification.');}
      if(stored.id!==verified.record.id||stored.sequence!==verified.record.sequence||stored.reviewed_by===candidate.created_by||stored.review_digest.trim()!==verified.digest||!stored.review_bytes.equals(verified.bytes))throw new ApiError(409,'Stored review bytes failed verification.');
      previous={id:stored.id,sequence:stored.sequence,digest:verified.digest};reviews.push({...verified.record,digest:verified.digest});
    }
    return {row,key,candidate,checked,reviews};
  }
  const documentClaimSchema={type:'object',additionalProperties:false,required:['id','citationDigest','correspondenceReviewId','correspondenceReviewDigest','text'],properties:{id:uuid,citationDigest:{type:'string',pattern:'^[a-f0-9]{64}$'},correspondenceReviewId:uuid,correspondenceReviewDigest:{type:'string',pattern:'^[a-f0-9]{64}$'},text:{type:'string',minLength:1,maxLength:8000}}};
  const claimParams={...citationParams,required:[...citationParams.required,'claimId'],properties:{...citationParams.properties,claimId:uuid}};
  const documentDecisionSchema={type:'object',additionalProperties:false,required:['id','claimDigest','accepted','reason'],properties:{id:uuid,claimDigest:{type:'string',pattern:'^[a-f0-9]{64}$'},accepted:{type:'boolean'},reason:{type:'string',minLength:1,maxLength:6000}}};
  async function verifiedDocumentClaims(client:PoolClient,actor:Actor,caseId:string,jobId:string,citationId:string){
    const verified=await verifiedReviewedCitation(client,actor,caseId,jobId,citationId),latest=verified.reviews.at(-1)??null;
    const storedClaims=(await client.query('SELECT * FROM document_claims WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 AND citation_id=$4 ORDER BY created_at,id LIMIT 51',verified.key)).rows;
    if(storedClaims.length>50)throw new ApiError(409,'Document claim limit exceeded.');
    const claims=[];
    for(const stored of storedClaims){
      const correspondence=verified.reviews.find(r=>r.id===stored.correspondence_review_id);if(!correspondence)throw new ApiError(409,'Stored claim correspondence review is unavailable.');
      const input:DocumentClaimInput={id:stored.id,citationDigest:stored.citation_digest.trim(),correspondenceReviewId:stored.correspondence_review_id,correspondenceReviewDigest:stored.correspondence_review_digest.trim(),text:stored.text};
      let claim;try{claim=documentClaim(citationId,verified.checked,correspondence,input,stored.created_by,new Date(stored.created_at).toISOString());}catch{throw new ApiError(409,'Stored document claim failed verification.');}
      if(claim.digest!==stored.claim_digest.trim()||!claim.bytes.equals(stored.claim_bytes))throw new ApiError(409,'Stored document claim bytes failed verification.');
      const decisionRow=(await client.query('SELECT * FROM document_claim_decisions WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 AND citation_id=$4 AND claim_id=$5',[...verified.key,stored.id])).rows[0];
      let decision=null,finding=null;
      if(decisionRow){
        const decisionInput:DocumentClaimDecisionInput={id:decisionRow.id,claimDigest:decisionRow.claim_digest.trim(),accepted:decisionRow.accepted,reason:decisionRow.reason};
        let checkedDecision;try{checkedDecision=documentClaimDecision(claim,decisionInput,decisionRow.reviewed_by,new Date(decisionRow.reviewed_at).toISOString());}catch{throw new ApiError(409,'Stored document claim decision failed verification.');}
        if(checkedDecision.digest!==decisionRow.decision_digest.trim()||!checkedDecision.bytes.equals(decisionRow.decision_bytes))throw new ApiError(409,'Stored document claim decision bytes failed verification.');
        decision={...checkedDecision.record,digest:checkedDecision.digest};
        const findingRow=(await client.query('SELECT * FROM document_findings WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 AND citation_id=$4 AND claim_id=$5',[...verified.key,stored.id])).rows[0];
        if(decisionRow.accepted){if(!findingRow||findingRow.id!==decisionRow.id||findingRow.decision_id!==decisionRow.id||findingRow.text!==stored.text||findingRow.reviewer_user_id!==decisionRow.reviewed_by||new Date(findingRow.reviewed_at).toISOString()!==new Date(decisionRow.reviewed_at).toISOString())throw new ApiError(409,'Stored document finding failed verification.');finding={id:findingRow.id,text:findingRow.text};}
        else if(findingRow)throw new ApiError(409,'Rejected document claim has an invalid finding.');
      }
      claims.push({...claim.record,digest:claim.digest,correspondenceCurrent:latest?.id===correspondence.id&&latest.decision==='accepted',decision,finding});
    }
    return {...verified,latest,claims};
  }
  for(const create of [false,true])app.route({method:create?'POST':'GET',url:'/api/cases/:caseId/integrity-jobs/:jobId/document-citations/:citationId/claims',preHandler:create?svc.requireCsrf:svc.authenticate,schema:{params:citationParams,...(create?{body:documentClaimSchema}:{})},handler:async(request,reply)=>{
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff');const actor=request.actor!;if(actor.role==='client')throw new ApiError(403,'Internal document claims only.');
    const {caseId,jobId,citationId}=request.params as {caseId:string;jobId:string;citationId:string};
    return inTransaction(svc.pool,async client=>{
      let state=await verifiedDocumentClaims(client,actor,caseId,jobId,citationId);
      if(create){
        const input=request.body as DocumentClaimInput,existing=state.claims.find(c=>c.id===input.id);
        if(existing){if(existing.createdBy!==actor.userId||(['citationDigest','correspondenceReviewId','correspondenceReviewDigest','text'] as const).some(k=>existing[k]!==input[k]))throw new ApiError(409,'Claim identity conflicts with an existing proposal.');}
        else{
          const active=await client.query("SELECT 1 FROM cases WHERE tenant_id=$1 AND id=$2 AND status='Active' AND authority_version=$3",[actor.tenantId,caseId,state.row.authority_version]);if(!active.rowCount)throw new ApiError(409,'Current authority must match the extraction before proposing a claim.');
          const review=state.latest;if(!review||review.decision!=='accepted'||review.id!==input.correspondenceReviewId||review.digest!==input.correspondenceReviewDigest)throw new ApiError(409,'The latest independent correspondence review must be accepted.');
          const createdAt=new Date().toISOString();let claim;try{claim=documentClaim(citationId,state.checked,review,input,actor.userId,createdAt);}catch{throw new ApiError(422,'Claim must bind the current accepted correspondence review and include proposed text.');}
          const inserted=await client.query('INSERT INTO document_claims(tenant_id,case_id,job_id,citation_id,id,text,citation_digest,correspondence_review_id,correspondence_review_digest,created_by,created_at,claim_bytes,claim_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (tenant_id,case_id,job_id,citation_id,id) DO NOTHING',[...state.key,input.id,input.text,input.citationDigest,input.correspondenceReviewId,input.correspondenceReviewDigest,actor.userId,createdAt,claim.bytes,claim.digest]);
          if(inserted.rowCount)await svc.audit(client,actor,caseId,'document_claim.proposed','document_claim',input.id,'Document-derived interpretation proposed; not a finding');
          state=await verifiedDocumentClaims(client,actor,caseId,jobId,citationId);
          const saved=state.claims.find(c=>c.id===input.id);if(!saved||saved.createdBy!==actor.userId||(['citationDigest','correspondenceReviewId','correspondenceReviewDigest','text'] as const).some(k=>saved[k]!==input[k]))throw new ApiError(409,'Claim identity conflicts with an existing proposal.');
        }
      }else await svc.audit(client,actor,caseId,'document_claims.read','document_citation',citationId,'Verified document-derived claim workspace read');
      return {citationId,citationDigest:state.checked.digest,currentCorrespondenceReviewId:state.latest?.id??null,currentCorrespondenceDecision:state.latest?.decision??null,claims:state.claims};
    });
  }});
  app.post('/api/cases/:caseId/integrity-jobs/:jobId/document-citations/:citationId/claims/:claimId/decision',{preHandler:svc.requireCsrf,schema:{params:claimParams,body:documentDecisionSchema}},async(request,reply)=>{
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff');const actor=request.actor!;if(actor.role!=='reviewer')throw new ApiError(403,'Only a reviewer can decide a document-derived claim.');
    const {caseId,jobId,citationId,claimId}=request.params as {caseId:string;jobId:string;citationId:string;claimId:string};const input=request.body as DocumentClaimDecisionInput;
    return inTransaction(svc.pool,async client=>{
      let state=await verifiedDocumentClaims(client,actor,caseId,jobId,citationId),claim=state.claims.find(c=>c.id===claimId);if(!claim)notFound();
      if(claim.decision){if(claim.decision.id!==input.id||claim.decision.reviewedBy!==actor.userId||claim.decision.claimDigest!==input.claimDigest||claim.decision.accepted!==input.accepted||claim.decision.reason!==input.reason)throw new ApiError(409,'Claim already has a different decision.');return {claimId,decision:claim.decision,finding:claim.finding};}
      if(claim.createdBy===actor.userId)throw new ApiError(403,'A different reviewer must decide this claim.');
      const active=await client.query("SELECT 1 FROM cases WHERE tenant_id=$1 AND id=$2 AND status='Active' AND authority_version=$3",[actor.tenantId,caseId,state.row.authority_version]);if(!active.rowCount)throw new ApiError(409,'Current authority must match the extraction before deciding a claim.');
      if(!state.latest||state.latest.decision!=='accepted'||state.latest.id!==claim.correspondenceReviewId||state.latest.digest!==claim.correspondenceReviewDigest)throw new ApiError(409,'The claim no longer has the current accepted correspondence review.');
      const stored=(await client.query('SELECT * FROM document_claims WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 AND citation_id=$4 AND id=$5',[...state.key,claimId])).rows[0],correspondence=state.reviews.find(r=>r.id===stored.correspondence_review_id)!;
      const checkedClaim=documentClaim(citationId,state.checked,correspondence,{id:stored.id,citationDigest:stored.citation_digest.trim(),correspondenceReviewId:stored.correspondence_review_id,correspondenceReviewDigest:stored.correspondence_review_digest.trim(),text:stored.text},stored.created_by,new Date(stored.created_at).toISOString());
      const reviewedAt=new Date().toISOString();let decision;try{decision=documentClaimDecision(checkedClaim,input,actor.userId,reviewedAt);}catch{throw new ApiError(422,'Decision must bind the exact claim and include a reason.');}
      const inserted=await client.query('INSERT INTO document_claim_decisions(tenant_id,case_id,job_id,citation_id,claim_id,id,claim_digest,accepted,reason,reviewed_by,reviewed_at,decision_bytes,decision_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (tenant_id,case_id,job_id,citation_id,claim_id) DO NOTHING',[...state.key,claimId,input.id,input.claimDigest,input.accepted,input.reason,actor.userId,reviewedAt,decision.bytes,decision.digest]);
      if(inserted.rowCount){
        if(input.accepted)await client.query('INSERT INTO document_findings(tenant_id,case_id,job_id,citation_id,claim_id,id,decision_id,text,reviewer_user_id,reviewed_at) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9)',[...state.key,claimId,input.id,stored.text,actor.userId,reviewedAt]);
        await svc.audit(client,actor,caseId,input.accepted?'document_claim.accepted':'document_claim.rejected','document_claim_decision',input.id,input.accepted?'Document-derived interpretation accepted as a finding':'Document-derived interpretation rejected');
      }
      state=await verifiedDocumentClaims(client,actor,caseId,jobId,citationId);claim=state.claims.find(c=>c.id===claimId)!;
      if(!claim.decision||claim.decision.id!==input.id||claim.decision.reviewedBy!==actor.userId||claim.decision.claimDigest!==input.claimDigest||claim.decision.accepted!==input.accepted||claim.decision.reason!==input.reason)throw new ApiError(409,'Claim already has a different decision.');
      return {claimId,decision:claim.decision,finding:claim.finding};
    });
  });
  async function readRaster(actor:Actor,caseId:string,jobId:string){
    if(actor.role==='client')throw new ApiError(403,'Internal derivatives only.');
    return inTransaction(svc.pool,async client=>{
      await svc.findCase(client,actor,caseId,true);
      const row=(await client.query(`SELECT d.*,e.object_path,e.byte_length,e.digest,e.original_kind,e.source_time,e.received_time
        FROM raster_derivatives d JOIN evidence e ON e.tenant_id=d.tenant_id AND e.case_id=d.case_id AND e.id=d.evidence_id
        WHERE d.tenant_id=$1 AND d.case_id=$2 AND d.job_id=$3`,[actor.tenantId,caseId,jobId])).rows[0];
      if(!row)notFound();let output;
      try{
        const original=await readOriginalBounded(svc.storageRoot,row.object_path,65536);
        if(original.length!==row.byte_length||row.original_kind!=='opaque_binary'||row.digest.trim()!==row.source_digest.trim()||
          row.profile!==rasterProfile||row.profile_digest.trim()!==rasterProfileDigest||sha256(row.raw_bytes)!==row.raw_digest.trim())throw new Error('Raster lineage mismatch');
        output=makeRasterDerivative(original,documentContext(row),JSON.parse(row.raw_bytes.toString('utf8')));
        if(output.digest!==row.output_digest.trim()||!output.bytes.equals(row.output_bytes))throw new Error('Raster manifest mismatch');
      }catch{throw new ApiError(409,'Original or raster derivative integrity verification failed.');}
      await svc.audit(client,actor,caseId,'raster_derivative.read','integrity_job',jobId,'Verified unreviewed raster derivative read');
      return {output,receipt:{jobId,caseId,evidenceId:row.evidence_id,status:'unreviewed_derivative',authorityVersion:row.authority_version,
        sourceDigest:row.source_digest.trim(),attempt:row.attempt,profile:JSON.parse(row.profile),profileDigest:row.profile_digest.trim(),
        derivativeDigest:row.output_digest.trim(),processedAt:row.processed_at,sourceTime:row.source_time,receivedAt:row.received_time,manifest:output.manifest}};
    });
  }
  app.get('/api/cases/:caseId/integrity-jobs/:jobId/raster-derivative',{preHandler:svc.authenticate,schema:{params}},async(request,reply)=>{
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff');
    const {caseId,jobId}=request.params as {caseId:string;jobId:string};
    return (await readRaster(request.actor!,caseId,jobId)).receipt;
  });
  app.get('/api/cases/:caseId/integrity-jobs/:jobId/raster-pages/:page',{preHandler:svc.authenticate,schema:{params:{...params,required:[...params.required,'page'],properties:{...params.properties,page:{type:'string',enum:['1','2']}}}}},async(request,reply)=>{
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('Content-Security-Policy',"default-src 'none'; sandbox").header('Cross-Origin-Resource-Policy','same-origin');
    const {caseId,jobId,page}=request.params as {caseId:string;jobId:string;page:string};
    const result=await readRaster(request.actor!,caseId,jobId),selected=result.output.pages[Number(page)-1];
    if(!selected)notFound();
    return reply.type('image/png').header('Content-Disposition','inline; filename="page-'+page+'.png"').send(selected.bytes);
  });
  for (const cancel of [false,true]) {
    app.route({method:cancel?'POST':'GET',url: `/api/cases/:caseId/integrity-jobs/:jobId${cancel?'/cancel':''}`,
      preHandler:cancel?svc.requireCsrf:svc.authenticate,schema:{params,...(cancel?{body:{type:'object',additionalProperties:false,maxProperties:0}}:{})},
      handler:async request => {
        const actor = request.actor!;
        if (actor.role==='client') throw new ApiError(403,'Internal jobs only.');
        const {caseId,jobId} = request.params as {caseId:string;jobId:string};
        const s = {tenantId:actor.tenantId,caseId,jobId};
        return inTransaction(svc.pool,async client => {
          await svc.findCase(client,actor,caseId,true);
          const r = await client.query('SELECT * FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE',values(s));
          if (!r.rows[0]) notFound();
          if (cancel && ['queued','running'].includes(r.rows[0].status)) {
            await svc.audit(client,actor,caseId,'integrity_job.cancelled','integrity_job',jobId,'Integrity check cancelled');
            return terminal(client,s,'cancelled','user_cancelled');
          }
          return dto(r.rows[0]);
        });
      }});
  }
}
