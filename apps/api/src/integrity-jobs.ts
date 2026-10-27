import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { Actor } from './app.js';
import { inTransaction } from './db.js';
import { ApiError, notFound } from './errors.js';
import { readOriginalBounded } from './storage.js';

type Scope = {tenantId: string; caseId: string; jobId: string};
type Services = {
  pool: Pool; authenticate: (r: FastifyRequest) => Promise<void>; requireCsrf: (r: FastifyRequest) => Promise<void>;
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
      AND c.status='Active' AND c.authority_version=$4 FOR SHARE OF c,cm,m`, [row.tenant_id,row.case_id,row.requested_by,row.authority_version]);
  return r.rowCount === 1;
}
async function terminal(client: PoolClient, s: Scope, status: string, code: string | null) {
  const result = await client.query(`UPDATE integrity_jobs SET status=$4,failure_code=$5,lease_token=NULL,lease_until=NULL,finished_at=clock_timestamp()
    WHERE tenant_id=$1 AND case_id=$2 AND id=$3 RETURNING *`, [...values(s),status,code]);
  await event(client,s,result.rows[0]);
  return dto(result.rows[0]);
}

/** Trusted worker entry point, never an HTTP route. Scope must be supplied explicitly. */
export async function claimIntegrityJob(pool: Pool, s: Scope) {
  return inTransaction(pool, async client => {
    const found = await client.query(`SELECT *, lease_until > clock_timestamp() AS live FROM integrity_jobs
      WHERE tenant_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE`, values(s));
    const row = found.rows[0];
    if (!row || !['queued','running'].includes(row.status) || row.live) return null;
    if (!await permitted(client,row)) { await terminal(client,s,'cancelled','scope_changed'); return null; }
    if (row.attempt >= 3) { await terminal(client,s,'failed','attempts_exhausted'); return null; }
    const updated = await client.query(`UPDATE integrity_jobs SET status='running',attempt=attempt+1,lease_token=$4,
      lease_until=clock_timestamp()+interval '60 seconds' WHERE tenant_id=$1 AND case_id=$2 AND id=$3 RETURNING *`, [...values(s),randomUUID()]);
    await event(client,s,updated.rows[0]);
    return {token: updated.rows[0].lease_token as string, evidenceId: row.evidence_id as string, digest: row.source_digest.trim() as string};
  });
}
export async function finishIntegrityJob(pool: Pool, s: Scope, token: string, failure: 'original_unavailable' | 'digest_mismatch' | null) {
  return inTransaction(pool, async client => {
    const r = await client.query(`SELECT * FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND id=$3
      AND status='running' AND lease_token=$4 AND lease_until > clock_timestamp() FOR UPDATE`, [...values(s),token]);
    if (!r.rows[0]) return null; // Expired, cancelled or superseded worker cannot commit.
    if (!await permitted(client,r.rows[0])) return terminal(client,s,'cancelled','scope_changed');
    return terminal(client,s,failure ? 'failed' : 'succeeded',failure);
  });
}
export async function runIntegrityJob(pool: Pool, root: string, s: Scope) {
  const lease = await claimIntegrityJob(pool,s);
  if (!lease) return null;
  let failure: 'original_unavailable' | 'digest_mismatch' | null = null;
  try {
    const result = await pool.query(`SELECT object_path,byte_length,digest FROM evidence WHERE tenant_id=$1 AND case_id=$2 AND id=$3`, [s.tenantId,s.caseId,lease.evidenceId]);
    const source = result.rows[0];
    if (!source) throw new Error('Missing original');
    const bytes = await readOriginalBounded(root,source.object_path,262144);
    if (bytes.length !== source.byte_length || createHash('sha256').update(bytes).digest('hex') !== lease.digest
        || source.digest.trim() !== lease.digest) failure = 'digest_mismatch';
  } catch { failure = 'original_unavailable'; }
  return finishIntegrityJob(pool,s,lease.token,failure);
}

export function registerIntegrityJobs(app: FastifyInstance, svc: Services) {
  app.post('/api/cases/:caseId/integrity-jobs', {preHandler: svc.requireCsrf, schema: {
    params: {type:'object',required:['caseId'],additionalProperties:false,properties:{caseId:uuid}},
    body: {type:'object',required:['evidenceId','idempotencyKey'],additionalProperties:false,properties:{evidenceId:uuid,idempotencyKey:uuid}},
  }}, async request => {
    const actor = request.actor!;
    const {caseId} = request.params as {caseId:string};
    const input = request.body as {evidenceId:string;idempotencyKey:string};
    return inTransaction(svc.pool,async client => {
      await svc.findCase(client,actor,caseId,true);
      const old = await client.query('SELECT * FROM integrity_jobs WHERE tenant_id=$1 AND case_id=$2 AND requested_by=$3 AND idempotency_key=$4', [actor.tenantId,caseId,actor.userId,input.idempotencyKey]);
      if (old.rows[0]) {
        if (old.rows[0].evidence_id !== input.evidenceId) throw new ApiError(409,'Idempotency key already used.');
        return dto(old.rows[0]);
      }
      const source = await client.query(`SELECT e.digest,c.authority_version FROM evidence e JOIN cases c ON c.tenant_id=e.tenant_id AND c.id=e.case_id
        WHERE e.tenant_id=$1 AND e.case_id=$2 AND e.id=$3 AND c.status='Active'`, [actor.tenantId,caseId,input.evidenceId]);
      if (!source.rows[0]) notFound();
      const id = randomUUID();
      const inserted = await client.query(`INSERT INTO integrity_jobs (tenant_id,case_id,id,evidence_id,source_digest,authority_version,requested_by,idempotency_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [actor.tenantId,caseId,id,input.evidenceId,source.rows[0].digest,source.rows[0].authority_version,actor.userId,input.idempotencyKey]);
      await event(client,{tenantId:actor.tenantId,caseId,jobId:id},inserted.rows[0]);
      await svc.audit(client,actor,caseId,'integrity_job.queued','integrity_job',id,'Original-byte integrity check requested');
      return dto(inserted.rows[0]);
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
