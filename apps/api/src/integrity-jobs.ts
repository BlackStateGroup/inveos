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
  pool: Pool; storageRoot: string; authenticate: (r: FastifyRequest) => Promise<void>; requireCsrf: (r: FastifyRequest) => Promise<void>;
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
      const r=await client.query(`SELECT * FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2
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
export async function finishIntegrityJob(pool: Pool, s: Scope, token: string, failure: 'original_unavailable' | 'digest_mismatch' | null) {
  return finishProcessingJob(pool,s,token,failure);
}
type Failure = 'original_unavailable' | 'digest_mismatch' | 'unsupported_original' | 'text_limits';
async function finishProcessingJob(pool: Pool, s: Scope, token: string, failure: Failure | null, output?: DerivativeOutput) {
  return inTransaction(pool, async client => {
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
    body: {type:'object',required:['evidenceId','idempotencyKey'],additionalProperties:false,properties:{evidenceId:uuid,idempotencyKey:uuid,kind:{type:'string',enum:['original_sha256_v1','utf8_line_index_v1']}}},
  }}, async request => {
    const actor = request.actor!;
    const {caseId} = request.params as {caseId:string};
    const input = request.body as {evidenceId:string;idempotencyKey:string;kind?:string};
    return inTransaction(svc.pool,async client => {
      await svc.findCase(client,actor,caseId,true);
      const old = await client.query('SELECT * FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND requested_by=$3 AND idempotency_key=$4', [actor.tenantId,caseId,actor.userId,input.idempotencyKey]);
      if (old.rows[0]) {
        if (old.rows[0].evidence_id !== input.evidenceId || old.rows[0].kind !== (input.kind ?? 'original_sha256_v1')) throw new ApiError(409,'Idempotency key already used.');
        return dto(old.rows[0]);
      }
      const source = await client.query(`SELECT e.digest,e.original_kind,c.authority_version FROM evidence e JOIN cases c ON c.tenant_id=e.tenant_id AND c.id=e.case_id
        WHERE e.tenant_id=$1 AND e.case_id=$2 AND e.id=$3 AND c.status='Active'`, [actor.tenantId,caseId,input.evidenceId]);
      if (!source.rows[0]) notFound();
      if (input.kind==='utf8_line_index_v1' && source.rows[0].original_kind!=='original_utf8') throw new ApiError(409,'Text indexing requires a UTF-8 original.');
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
