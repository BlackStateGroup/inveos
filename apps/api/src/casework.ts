import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { workStatuses, type WorkInput, type WorkEdit, type WorkItem, type WorkLink, type WorkLinkInput, type WorkRevision } from '@inveos/contracts';
import type { Actor } from './app.js';
import { inTransaction } from './db.js';
import { ApiError, notFound } from './errors.js';

type Services = {
  pool: Pool;
  authenticate: (request: FastifyRequest) => Promise<void>;
  requireCsrf: (request: FastifyRequest) => Promise<void>;
  findCase: (client: PoolClient, actor: Actor, id: string, lock?: boolean) => Promise<unknown>;
  verifyClaim: (client: PoolClient, actor: Actor, caseId: string, claimId: string) => Promise<void>;
  audit: (client: PoolClient, actor: Actor, caseId: string, action: string, entityType: string, id: string, summary: string, metadata?: Record<string, unknown>) => Promise<void>;
};
const uuid = {type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'} as const;
const nullableUuid = {anyOf: [uuid, {type: 'null'}]} as const;
const editable = {
  title: {type: 'string', minLength: 3, maxLength: 200},
  body: {type: 'string', maxLength: 12000},
  ownerId: nullableUuid,
  dueDate: {anyOf: [{type: 'null'}, {type: 'string', pattern: '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$'}]},
} as const;
const params = {type: 'object', required: ['caseId', 'itemId'], additionalProperties: false, properties: {caseId: uuid, itemId: uuid}} as const;
const caseParams = {type: 'object', required: ['caseId'], additionalProperties: false, properties: {caseId: uuid}} as const;
const kinds = Object.keys(workStatuses);
const allStatuses = [...new Set(Object.values(workStatuses).flat())];
const iso = (date: Date | string) => new Date(date).toISOString();

export function displayWork(row: QueryResultRow): WorkItem {
  return {
    id: row.id, caseId: row.case_id, kind: row.kind, title: row.title, body: row.body,
    status: row.status, ownerId: row.owner_id, dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
    parentId: row.parent_id, version: row.version, createdBy: row.created_by,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}
export function displayWorkLink(row: QueryResultRow): WorkLink {
  return {id: row.id, caseId: row.case_id, itemId: row.item_id, claimId: row.claim_id, relation: row.relation,
    reason: row.reason, createdBy: row.created_by, createdAt: iso(row.created_at)};
}

function validateText(input: Pick<WorkInput, 'title' | 'body' | 'dueDate'>, reason?: string): void {
  if (input.title.trim().length < 3 || (reason !== undefined && !reason.trim())) {
    throw new ApiError(422, 'Enter a title and a reason for this change.');
  }
  for (const value of [input.title, input.body, reason ?? '']) {
    if (Buffer.from(value, 'utf8').toString('utf8') !== value || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
      throw new ApiError(422, 'Text contains unsupported control characters.');
    }
  }
  if (input.dueDate) {
    const date = new Date(`${input.dueDate}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.dueDate) {
      throw new ApiError(422, 'Choose a valid calendar date.');
    }
  }
}

async function checkOwner(client: PoolClient, actor: Actor, caseId: string, ownerId: string | null): Promise<void> {
  if (!ownerId) return;
  const owner = await client.query(
    `SELECT 1 FROM case_memberships cm JOIN memberships m ON m.tenant_id = cm.tenant_id AND m.user_id = cm.user_id
      WHERE cm.tenant_id = $1 AND cm.case_id = $2 AND cm.user_id = $3 AND m.role IN ('reviewer', 'investigator')`,
    [actor.tenantId, caseId, ownerId],
  );
  if (!owner.rowCount) throw new ApiError(422, 'The owner must be an investigator or reviewer assigned to this case.');
}

async function findWork(client: PoolClient, actor: Actor, caseId: string, id: string): Promise<QueryResultRow> {
  const result = await client.query(
    'SELECT *, due_date::text AS due_date FROM case_work_items WHERE tenant_id = $1 AND case_id = $2 AND id = $3 FOR UPDATE',
    [actor.tenantId, caseId, id],
  );
  if (!result.rows[0]) notFound();
  return result.rows[0];
}

async function recordRevision(client: PoolClient, actor: Actor, item: WorkItem, reason: string): Promise<void> {
  await client.query(
    `INSERT INTO case_work_revisions (tenant_id, case_id, item_id, version, snapshot, actor_id, actor_name, reason)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
    [actor.tenantId, item.caseId, item.id, item.version, JSON.stringify(item), actor.userId, actor.displayName, reason],
  );
}

export function registerCaseWork(app: FastifyInstance, services: Services): void {
  const internal = async (request: FastifyRequest) => {
    await services.authenticate(request);
    if (request.actor!.role === 'client') throw new ApiError(403, 'This role cannot access internal case work.');
  };
  app.post('/api/cases/:caseId/work', {
    preHandler: services.requireCsrf,
    schema: {params: caseParams, body: {type: 'object', additionalProperties: false,
      required: ['id', 'kind', 'title', 'body', 'ownerId', 'dueDate', 'parentId'],
      properties: {...editable, id: uuid, kind: {type: 'string', enum: kinds}, parentId: nullableUuid}}},
  }, async (request) => {
    const actor = request.actor!;
    const {caseId} = request.params as {caseId: string};
    const input = request.body as WorkInput;
    validateText(input);
    const requestHash = createHash('sha256').update(JSON.stringify([
      input.id, input.kind, input.title, input.body, input.ownerId, input.dueDate, input.parentId,
    ])).digest('hex');
    return inTransaction(services.pool, async (client) => {
      await services.findCase(client, actor, caseId, true);
      const replay = await client.query('SELECT *, due_date::text AS due_date FROM case_work_items WHERE tenant_id = $1 AND case_id = $2 AND id = $3', [actor.tenantId, caseId, input.id]);
      if (replay.rows[0]) {
        if (replay.rows[0].created_by !== actor.userId || replay.rows[0].request_hash !== requestHash) {
          throw new ApiError(409, 'This record identifier has already been used. Refresh before trying again.');
        }
        return displayWork(replay.rows[0]);
      }
      await checkOwner(client, actor, caseId, input.ownerId);
      if (input.parentId) {
        const parent = await findWork(client, actor, caseId, input.parentId);
        if (!['question', 'objective'].includes(parent.kind)) throw new ApiError(422, 'Link work to a question or objective in this case.');
        if (input.kind === 'hypothesis' && parent.kind !== 'question') throw new ApiError(422, 'A hypothesis must belong to an investigation question.');
      } else if (input.kind === 'hypothesis') {
        throw new ApiError(422, 'A hypothesis must belong to an investigation question.');
      }
      const inserted = await client.query(
        `INSERT INTO case_work_items (tenant_id, case_id, id, kind, title, body, status, owner_id, due_date, parent_id, request_hash, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *, due_date::text AS due_date`,
        [actor.tenantId, caseId, input.id, input.kind, input.title, input.body, workStatuses[input.kind][0], input.ownerId, input.dueDate, input.parentId, requestHash, actor.userId],
      );
      const item = displayWork(inserted.rows[0]);
      await recordRevision(client, actor, item, 'Record created');
      await services.audit(client, actor, caseId, 'work.created', 'case_work', item.id, `${input.kind}: ${input.title}`, {kind: input.kind, version: 1});
      return item;
    });
  });

  app.post('/api/cases/:caseId/work/:itemId/revise', {
    preHandler: services.requireCsrf,
    schema: {params, body: {type: 'object', additionalProperties: false,
      required: ['expectedVersion', 'title', 'body', 'ownerId', 'dueDate', 'status', 'reason'],
      properties: {...editable, expectedVersion: {type: 'integer', minimum: 1}, status: {type: 'string', enum: allStatuses}, reason: {type: 'string', minLength: 1, maxLength: 3000}}}},
  }, async (request) => {
    const actor = request.actor!;
    const {caseId, itemId} = request.params as {caseId: string; itemId: string};
    const input = request.body as WorkEdit;
    validateText(input, input.reason);
    return inTransaction(services.pool, async (client) => {
      await services.findCase(client, actor, caseId, true);
      const current = displayWork(await findWork(client, actor, caseId, itemId));
      if (current.version !== input.expectedVersion) throw new ApiError(409, 'Someone changed this record. Refresh and compare the latest version before saving.');
      if (!(workStatuses[current.kind] as readonly string[]).includes(input.status)) throw new ApiError(422, 'This status is not valid for this kind of work.');
      if (current.kind === 'handover' && input.status === 'Acknowledged' && current.ownerId !== actor.userId) {
        throw new ApiError(403, 'Only the assigned recipient can acknowledge this handover.');
      }
      if (current.kind === 'handover' && input.status === 'Acknowledged' && input.ownerId !== current.ownerId) {
        throw new ApiError(422, 'Reassign this handover separately before the new recipient acknowledges it.');
      }
      if (current.kind === 'hypothesis' && ['Supported', 'Disputed'].includes(input.status)) {
        const sources = await client.query(
          'SELECT claim_id FROM case_work_links WHERE tenant_id=$1 AND case_id=$2 AND item_id=$3 AND relation=$4',
          [actor.tenantId, caseId, itemId, input.status === 'Supported' ? 'supports' : 'contradicts'],
        );
        if (!sources.rowCount) throw new ApiError(422, 'Link supporting or contrary source material before recording this assessment.');
        for (const source of sources.rows) await services.verifyClaim(client, actor, caseId, source.claim_id);
      }
      await checkOwner(client, actor, caseId, input.ownerId);
      const updated = await client.query(
        `UPDATE case_work_items SET title=$4, body=$5, status=$6, owner_id=$7, due_date=$8, version=version+1, updated_at=clock_timestamp()
          WHERE tenant_id=$1 AND case_id=$2 AND id=$3 RETURNING *, due_date::text AS due_date`,
        [actor.tenantId, caseId, itemId, input.title, input.body, input.status, input.ownerId, input.dueDate],
      );
      const item = displayWork(updated.rows[0]);
      await recordRevision(client, actor, item, input.reason);
      await services.audit(client, actor, caseId, 'work.revised', 'case_work', itemId, `${item.kind} updated: ${item.title}`, {version: item.version, reason: input.reason});
      return item;
    });
  });

  app.get('/api/cases/:caseId/work/:itemId/history', {preHandler: internal, schema: {params}}, async (request) => {
    const actor = request.actor!;
    const {caseId, itemId} = request.params as {caseId: string; itemId: string};
    return inTransaction(services.pool, async (client) => {
      await services.findCase(client, actor, caseId);
      await findWork(client, actor, caseId, itemId);
      const rows = await client.query('SELECT * FROM case_work_revisions WHERE tenant_id=$1 AND case_id=$2 AND item_id=$3 ORDER BY version DESC', [actor.tenantId, caseId, itemId]);
      return rows.rows.map((row) => ({version: row.version, item: row.snapshot, actor: row.actor_name, reason: row.reason, at: iso(row.created_at)} satisfies WorkRevision));
    });
  });

  app.post('/api/cases/:caseId/work/:itemId/links', {
    preHandler: services.requireCsrf,
    schema: {params, body: {type: 'object', additionalProperties: false, required: ['id', 'claimId', 'relation', 'reason'],
      properties: {id: uuid, claimId: uuid, relation: {type: 'string', enum: ['supports', 'contradicts', 'context']}, reason: {type: 'string', minLength: 1, maxLength: 3000}}}},
  }, async (request) => {
    const actor = request.actor!;
    const {caseId, itemId} = request.params as {caseId: string; itemId: string};
    const input = request.body as WorkLinkInput;
    validateText({title: 'Source link', body: '', dueDate: null}, input.reason);
    return inTransaction(services.pool, async (client) => {
      await services.findCase(client, actor, caseId, true);
      await findWork(client, actor, caseId, itemId);
      await services.verifyClaim(client, actor, caseId, input.claimId);
      const previous = await client.query(
        `SELECT * FROM case_work_links WHERE tenant_id=$1 AND case_id=$2 AND
          (id=$3 OR (item_id=$4 AND claim_id=$5 AND relation=$6))`,
        [actor.tenantId, caseId, input.id, itemId, input.claimId, input.relation],
      );
      if (previous.rows[0]) {
        const link = displayWorkLink(previous.rows[0]);
        if (link.itemId !== itemId || link.claimId !== input.claimId || link.relation !== input.relation || link.reason !== input.reason) throw new ApiError(409, 'A different source link already exists.');
        return link;
      }
      const result = await client.query(
        `INSERT INTO case_work_links (tenant_id, case_id, id, item_id, claim_id, relation, reason, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [actor.tenantId, caseId, input.id, itemId, input.claimId, input.relation, input.reason, actor.userId],
      );
      await services.audit(client, actor, caseId, 'work.source_linked', 'case_work', itemId, `Source linked as ${input.relation}`, {claimId: input.claimId, relation: input.relation});
      return displayWorkLink(result.rows[0]);
    });
  });
}
