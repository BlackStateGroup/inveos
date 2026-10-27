import {registerUploads} from './uploads.js';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookiePlugin from '@fastify/cookie';
import rateLimitPlugin from '@fastify/rate-limit';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type {
  Activity,
  AuthorityInput,
  AuthorityRecord,
  BinaryEvidenceInput,
  Case,
  CaseInput,
  Claim,
  ClaimInput,
  Evidence,
  EvidenceInput,
  Finding,
  ReportDraft,
  ReviewInput,
  Workspace,
} from '@inveos/contracts';
import { ReportBudget, REPORT_MAX_BYTES, REPORT_MAX_ITEMS } from './report-budget.js';
import { exactSpan, selectSourceSpan } from './source-span.js';
import { registerIntegrityJobs } from './integrity-jobs.js';
import { ApiError, notFound } from './errors.js';
import { inTransaction } from './db.js';
import { readOriginalBounded, writeOriginal, type StoredOriginal } from './storage.js';
import { displayWork, displayWorkLink, registerCaseWork } from './casework.js';

type Role = 'reviewer' | 'investigator' | 'client';

export type Actor = {
  tokenHash: string;
  csrfHash: string;
  tenantId: string;
  userId: string;
  displayName: string;
  role: Role;
};

type CaseRow = QueryResultRow & {
  tenant_id: string;
  id: string;
  ref: string;
  title: string;
  client: string;
  category: string;
  status: 'Scope review' | 'Active';
  owner_user_id: string;
  due: string;
  scope: string;
  jurisdiction: string;
  authority_version: number | null;
  created_at: Date | string;
  owner_name?: string;
};

type EvidenceRow = QueryResultRow & {
  tenant_id: string;
  case_id: string;
  id: string;
  authority_id: string;
  authority_version: number;
  filename: string;
  byte_length: number;
  source_time: string;
  received_time: Date | string;
  method: string;
  digest: string;
  object_path: string;
  status: 'Verified' | 'Quarantined';
  original_kind: 'original_utf8' | 'opaque_binary';
  request_hash: string;
  created_by: string;
};

type ClaimRow = QueryResultRow & {
  tenant_id: string;
  case_id: string;
  id: string;
  evidence_id: string;
  authority_id: string;
  authority_version: number;
  text: string;
  quote: string;
  source_start_byte: number;
  source_end_byte: number;
  source_digest: string;
  status: 'Under review' | 'Accepted' | 'Rejected';
  reason: string | null;
  created_at: Date | string;
  created_by: string;
};

type AppOptions = {
  pool: Pool;
  storageRoot: string;
  allowedOrigins: string[];
  demoTenantId: string;
  demoUserId: string;
  sessionTtlSeconds: number;
};

type AppRequest = FastifyRequest & { actor: Actor | null };

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

const sessionCookieName = 'inveos_session';
const csrfCookieName = 'inveos_csrf';
const uuidSchema = {
  type: 'string',
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
} as const;
const caseParamsSchema = {
  type: 'object',
  required: ['caseId'],
  additionalProperties: false,
  properties: {caseId: uuidSchema},
} as const;
const evidenceParamsSchema = {
  type: 'object',
  required: ['caseId', 'evidenceId'],
  additionalProperties: false,
  properties: {caseId: uuidSchema, evidenceId: uuidSchema},
} as const;
const claimParamsSchema = {
  type: 'object',
  required: ['caseId', 'claimId'],
  additionalProperties: false,
  properties: {caseId: uuidSchema, claimId: uuidSchema},
} as const;
const emptyBodySchema = {
  type: 'object',
  maxProperties: 0,
  additionalProperties: false,
} as const;
const caseBodySchema = {
  type: 'object',
  required: ['title', 'client', 'scope', 'jurisdiction'],
  additionalProperties: false,
  properties: {
    title: {type: 'string', minLength: 3, maxLength: 150},
    client: {type: 'string', minLength: 1, maxLength: 150},
    scope: {type: 'string', minLength: 10, maxLength: 3000},
    jurisdiction: {type: 'string', minLength: 2, maxLength: 100},
  },
} as const;
const authorityBodySchema = {
  type: 'object',
  required: ['purpose', 'lawfulBasis', 'scope', 'retentionDays', 'minimisation'],
  additionalProperties: false,
  properties: {
    purpose: {type: 'string', minLength: 10, maxLength: 1000},
    lawfulBasis: {type: 'string', minLength: 10, maxLength: 3000},
    scope: {type: 'string', minLength: 10, maxLength: 3000},
    retentionDays: {type: 'integer', minimum: 1, maximum: 3650},
    minimisation: {type: 'string', minLength: 10, maxLength: 2000},
  },
} as const;
const evidenceBodySchema = {
  type: 'object',
  required: ['filename', 'text', 'expectedSha256', 'sourceTime', 'method', 'idempotencyKey'],
  additionalProperties: false,
  properties: {
    filename: {type: 'string', minLength: 5, maxLength: 128},
    text: {type: 'string', minLength: 1, maxLength: 262144},
    expectedSha256: {type: 'string', pattern: '^[a-fA-F0-9]{64}$'},
    sourceTime: {type: 'string', minLength: 10, maxLength: 64},
    method: {type: 'string', minLength: 5, maxLength: 500},
    idempotencyKey: uuidSchema,
  },
} as const;
const binaryEvidenceBodySchema = {
  type: 'object',
  required: ['filename', 'contentBase64', 'expectedSha256', 'sourceTime', 'method', 'idempotencyKey'],
  additionalProperties: false,
  properties: {
    filename: evidenceBodySchema.properties.filename,
    contentBase64: {type: 'string', minLength: 4, maxLength: 349528},
    expectedSha256: evidenceBodySchema.properties.expectedSha256,
    sourceTime: evidenceBodySchema.properties.sourceTime,
    method: evidenceBodySchema.properties.method,
    idempotencyKey: uuidSchema,
  },
} as const;
const claimBodySchema = {
  type: 'object',
  required: ['evidenceId', 'text', 'quote'],
  additionalProperties: false,
  properties: {
    evidenceId: uuidSchema,
    text: {type: 'string', minLength: 1, maxLength: 2000},
    quote: {type: 'string', minLength: 1, maxLength: 4000},
    sourceStartByte: {type: 'integer', minimum: 0, maximum: 262144},
    sourceEndByte: {type: 'integer', minimum: 1, maximum: 262144},
  },
} as const;
const reviewBodySchema = {
  type: 'object',
  required: ['accepted', 'reason'],
  additionalProperties: false,
  properties: {
    accepted: {type: 'boolean'},
    reason: {type: 'string', minLength: 1, maxLength: 3000},
  },
} as const;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function sameSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function jsonOnly(request: FastifyRequest): void {
  const contentType = request.headers['content-type']?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) {
    throw new ApiError(415, 'A JSON request body is required.');
  }
}

function requireAllowedOrigin(request: FastifyRequest, allowedOrigins: string[]): string {
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.includes(origin)) {
    throw new ApiError(403, 'Request origin is not allowed.');
  }
  return origin;
}

function rejectClientRole(actor: Actor): void {
  if (actor.role === 'client') {
    throw new ApiError(403, 'This role cannot access the internal API.');
  }
}

function sha256TextBytes(text: string): Buffer {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) {
        throw new ApiError(422, 'Evidence text must be valid Unicode.');
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new ApiError(422, 'Evidence text must be valid Unicode.');
    }
  }
  if (!text) {
    throw new ApiError(422, 'Evidence text must be valid Unicode.');
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text)) {
    throw new ApiError(422, 'Evidence text contains disallowed control characters.');
  }
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length < 1 || bytes.length > 256 * 1024) {
    throw new ApiError(422, 'Evidence text must be between 1 byte and 256 KiB.');
  }
  return bytes;
}

function binaryBytes(encoded: string): Buffer {
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 1 || bytes.length > 256 * 1024 || bytes.toString('base64') !== encoded) {
    throw new ApiError(422, 'Binary evidence must be canonical base64 encoding 1 byte to 256 KiB.');
  }
  return bytes;
}

function requireTextOriginal(evidence: EvidenceRow): void {
  if (evidence.original_kind !== 'original_utf8' || evidence.status !== 'Verified') {
    throw new ApiError(409, 'Unprocessed binary originals cannot support original-text claims or reports.');
  }
}

function validSourceTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:[Zz]|[+-](\d{2}):(\d{2}))$/u.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[8] ?? 0);
  const offsetMinute = Number(match[9] ?? 0);
  if (
    month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59
  ) {
    return false;
  }

  const daysInMonth = month === 2
    ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
    : ([4, 6, 9, 11].includes(month) ? 30 : 31);
  return day >= 1 && day <= daysInMonth;
}

function validFilename(value: string, binary = false): boolean {
  const hasUnsafeCharacters = [...value].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return character === '/' || character === '\\' || codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
  return (binary || value.toLowerCase().endsWith('.txt'))
    && value.length > 4
    && value.trim() === value
    && Buffer.from(value, 'utf8').toString('utf8') === value
    && !hasUnsafeCharacters;
}

function displayCase(row: CaseRow): Case {
  return {
    id: row.id,
    ref: row.ref,
    title: row.title,
    client: row.client,
    category: row.category,
    status: row.status,
    owner: row.owner_name ?? 'Synthetic reviewer',
    due: row.due,
    scope: row.scope,
    jurisdiction: row.jurisdiction,
    authority: row.authority_version !== null,
  };
}

function displayEvidence(row: EvidenceRow, text = ''): Evidence {
  return {
    id: row.id,
    caseId: row.case_id,
    filename: row.filename,
    kind: row.original_kind === 'opaque_binary' ? 'Binary (unprocessed)' : 'Document',
    originalKind: row.original_kind,
    receivedTime: iso(row.received_time),
    sourceTime: row.source_time,
    method: row.method,
    bytes: row.byte_length,
    digest: row.digest.trim(),
    status: row.status,
    text,
    authorityId: row.authority_id,
    authorityVersion: row.authority_version,
  };
}

function displayClaim(row: ClaimRow): Claim {
  return {
    id: row.id,
    caseId: row.case_id,
    evidenceId: row.evidence_id,
    text: row.text,
    quote: row.quote,
    status: row.status,
    reason: row.reason ?? undefined,
    sourceStartByte: row.source_start_byte,
    sourceEndByte: row.source_end_byte,
    sourceDigest: row.source_digest.trim(),
  };
}

async function findCase(
  client: PoolClient,
  actor: Actor,
  caseId: string | null,
  lock = false,
): Promise<CaseRow> {
  const result = await client.query<CaseRow>(
    `SELECT c.*
       FROM cases c
       JOIN case_memberships cm
         ON cm.tenant_id = c.tenant_id AND cm.case_id = c.id
      WHERE c.tenant_id = $1 AND c.id = $2 AND cm.user_id = $3
      ${lock ? 'FOR UPDATE OF c' : ''}`,
    [actor.tenantId, caseId, actor.userId],
  );
  const row = result.rows[0];
  if (!row) {
    notFound();
  }
  return row;
}

async function findEvidence(
  client: PoolClient,
  actor: Actor,
  caseId: string,
  evidenceId: string,
): Promise<EvidenceRow> {
  const result = await client.query<EvidenceRow>(
    `SELECT e.*
       FROM evidence e
       JOIN case_memberships cm
         ON cm.tenant_id = e.tenant_id AND cm.case_id = e.case_id
      WHERE e.tenant_id = $1 AND e.case_id = $2 AND e.id = $3 AND cm.user_id = $4`,
    [actor.tenantId, caseId, evidenceId, actor.userId],
  );
  const row = result.rows[0];
  if (!row) {
    notFound();
  }
  return row;
}

async function findClaim(
  client: PoolClient,
  actor: Actor,
  caseId: string,
  claimId: string,
  lock = false,
): Promise<ClaimRow> {
  const result = await client.query<ClaimRow>(
    `SELECT cl.*
       FROM claims cl
       JOIN case_memberships cm
         ON cm.tenant_id = cl.tenant_id AND cm.case_id = cl.case_id
      WHERE cl.tenant_id = $1 AND cl.case_id = $2 AND cl.id = $3 AND cm.user_id = $4
      ${lock ? 'FOR UPDATE OF cl' : ''}`,
    [actor.tenantId, caseId, claimId, actor.userId],
  );
  const row = result.rows[0];
  if (!row) {
    notFound();
  }
  return row;
}

async function verifiedBytes(storageRoot: string, evidence: EvidenceRow): Promise<Buffer> {
  let bytes: Buffer;
  try {
    bytes = await readOriginalBounded(storageRoot, evidence.object_path, 262144);
  } catch {
    throw new ApiError(409, 'The cited original is unavailable.');
  }
  if (bytes.length !== evidence.byte_length || sha256(bytes) !== evidence.digest.trim()) {
    throw new ApiError(409, 'The cited original no longer matches its recorded digest.');
  }
  return bytes;
}

async function writeAudit(
  client: PoolClient,
  actor: Actor,
  caseId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
       (tenant_id, case_id, id, actor_user_id, action, entity_type, entity_id, summary, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [actor.tenantId, caseId, randomUUID(), actor.userId, action, entityType, entityId, summary, JSON.stringify(metadata)],
  );
}

function evidenceDtoWithText(row: EvidenceRow, bytes: Buffer): Evidence {
  return displayEvidence(row, row.original_kind === 'opaque_binary' ? '' : bytes.toString('utf8'));
}

function toAuthorityRecord(row: QueryResultRow, caseId: string): AuthorityRecord {
  return {
    id: row.id,
    caseId,
    version: row.version,
    purpose: row.purpose,
    lawfulBasis: row.lawful_basis,
    scope: row.scope,
    retentionDays: row.retention_days,
    minimisation: row.minimisation,
    approvedBy: row.approved_by_name,
    approvedAt: iso(row.approved_at),
  };
}

export async function createApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 2 * 1024 * 1024,
    ajv: {customOptions: {removeAdditional: false}},
    logger: false,
  });
  app.decorateRequest('actor', null);
  await app.register(cookiePlugin);
  await app.register(rateLimitPlugin, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
  });
  app.addHook('onRequest', async (request) => {
    if (request.method === 'POST' && request.url.startsWith('/api/')) {
      jsonOnly(request);
    }
  });
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  const authenticate = async (request: AppRequest): Promise<void> => {
    const token = request.cookies[sessionCookieName];
    if (!token) {
      throw new ApiError(401, 'A valid local demo session is required.');
    }
    const tokenHash = sha256(token);
    const result = await options.pool.query(
      `SELECT s.token_hash, s.csrf_hash, s.tenant_id, s.user_id, u.display_name, m.role
         FROM sessions s
         JOIN memberships m ON m.tenant_id = s.tenant_id AND m.user_id = s.user_id
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [tokenHash],
    );
    const row = result.rows[0] as QueryResultRow | undefined;
    if (!row) {
      throw new ApiError(401, 'A valid local demo session is required.');
    }
    request.actor = {
      tokenHash: row.token_hash,
      csrfHash: row.csrf_hash,
      tenantId: row.tenant_id,
      userId: row.user_id,
      displayName: row.display_name,
      role: row.role,
    };
  };

  const requireCsrf = async (request: AppRequest): Promise<void> => {
    requireAllowedOrigin(request, options.allowedOrigins);
    jsonOnly(request);
    await authenticate(request);
    rejectClientRole(request.actor!);
    const header = request.headers['x-csrf-token'];
    const cookie = request.cookies[csrfCookieName];
    if (
      typeof header !== 'string'
      || !cookie
      || !sameSecret(header, cookie)
      || !sameSecret(sha256(header), request.actor!.csrfHash)
    ) {
      throw new ApiError(403, 'A valid CSRF token is required.');
    }
  };

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({error: error.message});
    }
    if (typeof error === 'object' && error !== null) {
      const details = error as {validation?: unknown; statusCode?: unknown};
      if (details.validation) {
        return reply.code(422).send({error: 'Request validation failed.'});
      }
      if (details.statusCode === 400) {
        return reply.code(400).send({error: 'Malformed JSON request body.'});
      }
      if (details.statusCode === 429) {
        return reply.code(429).send({error: 'Too many requests. Please try again later.'});
      }
      if (details.statusCode === 413) {
        return reply.code(413).send({error: 'Request body is too large.'});
      }
      if (details.statusCode === 415) {
        return reply.code(415).send({error: 'A JSON request body is required.'});
      }
    }
    return reply.code(500).send({error: 'Internal server error.'});
  });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({error: 'Not found.'}));

  registerIntegrityJobs(app, {pool: options.pool, storageRoot: options.storageRoot, authenticate, requireCsrf, findCase, audit: writeAudit});

  registerCaseWork(app, {
    pool: options.pool, authenticate, requireCsrf, findCase, audit: writeAudit,
    verifyClaim: async (client, actor, caseId, claimId) => {
      const claim = await findClaim(client, actor, caseId, claimId);
      const source = await findEvidence(client, actor, caseId, claim.evidence_id);
      requireTextOriginal(source);
      const bytes = await verifiedBytes(options.storageRoot, source);
      const quoteBytes = Buffer.from(claim.quote, 'utf8');
      const span = bytes.subarray(claim.source_start_byte, claim.source_end_byte);
      if (!claim.quote.trim() || claim.source_start_byte < 0 || claim.source_end_byte > bytes.length
          || claim.source_end_byte <= claim.source_start_byte || source.digest.trim() !== claim.source_digest.trim()
          || span.length !== quoteBytes.length || !span.equals(quoteBytes)) {
        throw new ApiError(409, 'The claim no longer matches its cited original.');
      }
    },
  });

  app.post(
    '/api/session/start',
    {
      config: {rateLimit: {max: 5, timeWindow: 60_000}},
      preHandler: async (request) => {
        requireAllowedOrigin(request, options.allowedOrigins);
        jsonOnly(request);
      },
      schema: {body: emptyBodySchema},
    },
    async (request, reply) => {
      const demo = await options.pool.query(
        `SELECT u.display_name, m.role
           FROM memberships m
           JOIN users u ON u.id = m.user_id
          WHERE m.tenant_id = $1 AND m.user_id = $2`,
        [options.demoTenantId, options.demoUserId],
      );
      const demoUser = demo.rows[0] as QueryResultRow | undefined;
      if (!demoUser || demoUser.role !== 'reviewer') {
        throw new ApiError(503, 'The configured fictional reviewer is unavailable.');
      }

      const token = randomBytes(32).toString('base64url');
      const csrf = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + options.sessionTtlSeconds * 1000);
      const sessionId = randomUUID();
      const sessionActor: Actor = {
        tokenHash: sha256(token),
        csrfHash: sha256(csrf),
        tenantId: options.demoTenantId,
        userId: options.demoUserId,
        displayName: demoUser.display_name,
        role: 'reviewer',
      };
      await inTransaction(options.pool, async (client) => {
        await client.query(
          `INSERT INTO sessions (token_hash, id, csrf_hash, tenant_id, user_id, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [sessionActor.tokenHash, sessionId, sessionActor.csrfHash, sessionActor.tenantId, sessionActor.userId, expiresAt],
        );
        await writeAudit(client, sessionActor, null, 'session.started', 'session', sessionId, 'Local demo session started');
      });

      const origin = request.headers.origin!;
      const secure = origin.startsWith('https://');
      reply.setCookie(sessionCookieName, token, {
        httpOnly: true,
        secure,
        sameSite: 'strict',
        path: '/',
        expires: expiresAt,
      });
      reply.setCookie(csrfCookieName, csrf, {
        httpOnly: false,
        secure,
        sameSite: 'strict',
        path: '/',
        expires: expiresAt,
      });
      return reply.send({csrf});
    },
  );

  app.post(
    '/api/session/end',
    {preHandler: requireCsrf, schema: {body: emptyBodySchema}},
    async (request, reply) => {
      const actor = request.actor!;
      await inTransaction(options.pool, async (client) => {
        const revoked = await client.query(
          `UPDATE sessions SET revoked_at = now()
            WHERE token_hash = $1 AND revoked_at IS NULL
            RETURNING id`,
          [actor.tokenHash],
        );
        if (revoked.rows[0]) {
          await writeAudit(client, actor, null, 'session.ended', 'session', revoked.rows[0].id, 'Local demo session ended');
        }
      });
      reply.clearCookie(sessionCookieName, {path: '/', sameSite: 'strict'});
      reply.clearCookie(csrfCookieName, {path: '/', sameSite: 'strict'});
      return reply.send({ok: true});
    },
  );

  app.get('/api/workspace', {preHandler: authenticate}, async (request, reply) => {
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff');
    const actor = request.actor!;
    rejectClientRole(actor);
    const casesResult = await options.pool.query<CaseRow>(
      `SELECT c.*, u.display_name AS owner_name
         FROM cases c
         JOIN case_memberships cm
           ON cm.tenant_id = c.tenant_id AND cm.case_id = c.id
         JOIN users u ON u.id = c.owner_user_id
        WHERE c.tenant_id = $1 AND cm.user_id = $2
        ORDER BY c.created_at DESC, c.id`,
      [actor.tenantId, actor.userId],
    );
    const caseIds = casesResult.rows.map((row) => row.id);
    const workspace: Workspace = {cases: casesResult.rows.map(displayCase), evidence: [], claims: [], findings: [], activity: [], workItems: [], workLinks: [], members: []};
    if (!caseIds.length) {
      return workspace;
    }

    const workResult = await options.pool.query(
      `SELECT w.*, w.due_date::text AS due_date FROM case_work_items w JOIN case_memberships cm
         ON cm.tenant_id=w.tenant_id AND cm.case_id=w.case_id
        WHERE w.tenant_id=$1 AND cm.user_id=$2 ORDER BY w.created_at DESC, w.id`,
      [actor.tenantId, actor.userId],
    );
    workspace.workItems = workResult.rows.map(displayWork);
    const linksResult = await options.pool.query(
      `SELECT l.* FROM case_work_links l JOIN case_memberships cm ON cm.tenant_id=l.tenant_id AND cm.case_id=l.case_id
        WHERE l.tenant_id=$1 AND cm.user_id=$2 ORDER BY l.created_at, l.id`, [actor.tenantId, actor.userId],
    );
    workspace.workLinks = linksResult.rows.map(displayWorkLink);
    const membersResult = await options.pool.query(
      `SELECT cm.case_id, cm.user_id, u.display_name, m.role FROM case_memberships cm
         JOIN case_memberships mine ON mine.tenant_id=cm.tenant_id AND mine.case_id=cm.case_id
         JOIN memberships m ON m.tenant_id=cm.tenant_id AND m.user_id=cm.user_id
         JOIN users u ON u.id=cm.user_id
        WHERE cm.tenant_id=$1 AND mine.user_id=$2 AND m.role IN ('investigator','reviewer') ORDER BY u.display_name`,
      [actor.tenantId, actor.userId],
    );
    workspace.members = membersResult.rows.map((row) => ({caseId: row.case_id, userId: row.user_id, name: row.display_name, role: row.role}));

    const evidenceResult = await options.pool.query<EvidenceRow>(
      `SELECT e.*
         FROM evidence e
         JOIN case_memberships cm
           ON cm.tenant_id = e.tenant_id AND cm.case_id = e.case_id
        WHERE e.tenant_id = $1 AND cm.user_id = $2 AND e.case_id = ANY($3::uuid[])
        ORDER BY e.received_time DESC, e.id`,
      [actor.tenantId, actor.userId, caseIds],
    );
    for (const row of evidenceResult.rows) {
      try {
        const bytes = await readOriginalBounded(options.storageRoot, row.object_path, 262144);
        const valid = bytes.length === row.byte_length && sha256(bytes) === row.digest.trim();
        workspace.evidence.push({
          ...displayEvidence(row, valid && row.original_kind === 'original_utf8' ? bytes.toString('utf8') : ''),
          status: valid ? row.status : 'Integrity mismatch',
        });
      } catch {
        workspace.evidence.push({...displayEvidence(row), status: 'Original unavailable'});
      }
    }

    const claimsResult = await options.pool.query<ClaimRow>(
      `SELECT cl.*
         FROM claims cl
         JOIN case_memberships cm
           ON cm.tenant_id = cl.tenant_id AND cm.case_id = cl.case_id
        WHERE cl.tenant_id = $1 AND cm.user_id = $2 AND cl.case_id = ANY($3::uuid[])
        ORDER BY cl.created_at DESC, cl.id`,
      [actor.tenantId, actor.userId, caseIds],
    );
    workspace.claims = claimsResult.rows.map(displayClaim);

    const findingsResult = await options.pool.query(
      `SELECT f.id, f.case_id, f.claim_id, f.text, f.reviewed_at, u.display_name AS reviewer
         FROM findings f
         JOIN case_memberships cm
           ON cm.tenant_id = f.tenant_id AND cm.case_id = f.case_id
         JOIN users u ON u.id = f.reviewer_user_id
        WHERE f.tenant_id = $1 AND cm.user_id = $2 AND f.case_id = ANY($3::uuid[])
        ORDER BY f.reviewed_at DESC, f.id`,
      [actor.tenantId, actor.userId, caseIds],
    );
    workspace.findings = findingsResult.rows.map((row) => ({
      id: row.id,
      caseId: row.case_id,
      claimId: row.claim_id,
      text: row.text,
      reviewer: row.reviewer,
      reviewedAt: iso(row.reviewed_at),
    } satisfies Finding));

    const activityResult = await options.pool.query(
      `SELECT a.id, a.case_id, a.summary, a.created_at, u.display_name AS actor
         FROM audit_events a
         JOIN case_memberships cm
           ON cm.tenant_id = a.tenant_id AND cm.case_id = a.case_id
         JOIN users u ON u.id = a.actor_user_id
        WHERE a.tenant_id = $1 AND cm.user_id = $2 AND a.case_id = ANY($3::uuid[])
        ORDER BY a.created_at DESC, a.id`,
      [actor.tenantId, actor.userId, caseIds],
    );
    workspace.activity = activityResult.rows.map((row) => ({
      id: row.id,
      caseId: row.case_id,
      text: row.summary,
      actor: row.actor,
      at: iso(row.created_at),
    } satisfies Activity));
    return workspace;
  });

  app.post(
    '/api/cases',
    {preHandler: requireCsrf, schema: {body: caseBodySchema}},
    async (request) => {
      const actor = request.actor!;
      rejectClientRole(actor);
      const input = request.body as CaseInput;
      const id = randomUUID();
      const ref = `INV-${new Date().getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`;
      const row = await inTransaction(options.pool, async (client) => {
        const inserted = await client.query<CaseRow>(
          `INSERT INTO cases
             (tenant_id, id, ref, title, client, owner_user_id, scope, jurisdiction)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [actor.tenantId, id, ref, input.title, input.client, actor.userId, input.scope, input.jurisdiction],
        );
        await client.query(
          'INSERT INTO case_memberships (tenant_id, case_id, user_id) VALUES ($1, $2, $3)',
          [actor.tenantId, id, actor.userId],
        );
        await writeAudit(client, actor, id, 'case.created', 'case', id, 'Case created');
        const row = inserted.rows[0];
        if (!row) {
          throw new Error('Case insert did not return a row.');
        }
        return row;
      });
      return displayCase({...row, owner_name: actor.displayName});
    },
  );

  app.post(
    '/api/cases/:caseId/authority',
    {preHandler: requireCsrf, schema: {params: caseParamsSchema, body: authorityBodySchema}},
    async (request) => {
      const actor = request.actor!;
      rejectClientRole(actor);
      if (actor.role !== 'reviewer') {
        throw new ApiError(403, 'Only a reviewer can approve authority.');
      }
      const {caseId} = request.params as {caseId: string};
      const input = request.body as AuthorityInput;
      const authorityId = randomUUID();
      const record = await inTransaction(options.pool, async (client) => {
        const kase = await findCase(client, actor, caseId, true);
        const version = (kase.authority_version ?? 0) + 1;
        const inserted = await client.query(
          `INSERT INTO authority_records
             (tenant_id, case_id, id, version, purpose, lawful_basis, scope, retention_days, minimisation, approved_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            actor.tenantId,
            caseId,
            authorityId,
            version,
            input.purpose,
            input.lawfulBasis,
            input.scope,
            input.retentionDays,
            input.minimisation,
            actor.userId,
          ],
        );
        await client.query(
          `UPDATE cases SET status = 'Active', scope = $3, authority_version = $4
            WHERE tenant_id = $1 AND id = $2`,
          [actor.tenantId, caseId, input.scope, version],
        );
        await writeAudit(
          client,
          actor,
          caseId,
          'authority.approved',
          'authority',
          authorityId,
          `Authority scope approved (version ${version})`,
          {authorityVersion: version, retentionDays: input.retentionDays},
        );
        return inserted.rows[0];
      });
      return toAuthorityRecord({...record, approved_by_name: actor.displayName}, caseId);
    },
  );

  async function receiveEvidence(actor:Actor,caseId:string,input:EvidenceInput|BinaryEvidenceInput,binary:boolean,uploadId?:string) {
        rejectClientRole(actor);
        const originalKind = binary ? 'opaque_binary' : 'original_utf8';
        if (!validFilename(input.filename, binary)) {
          throw new ApiError(422, binary ? 'Evidence filename must be safe.' : 'Evidence filename must be a safe .txt filename.');
        }
        if (!validSourceTime(input.sourceTime)) {
          throw new ApiError(422, 'Source time must be a valid timestamp with an explicit timezone.');
        }
        const bytes = binary ? binaryBytes((input as BinaryEvidenceInput).contentBase64)
          : sha256TextBytes((input as EvidenceInput).text);
        const digest = sha256(bytes);
        if (digest !== input.expectedSha256.toLowerCase()) {
          throw new ApiError(422, 'Server-computed digest does not match expectedSha256.');
        }
        const requestHash = sha256(JSON.stringify({
          filename: input.filename,
          ...(binary ? {originalKind, contentBase64: (input as BinaryEvidenceInput).contentBase64}
            : {text: (input as EvidenceInput).text}),
          expectedSha256: input.expectedSha256.toLowerCase(),
          sourceTime: input.sourceTime,
          method: input.method,
          idempotencyKey: input.idempotencyKey,
        }));
        let stored: StoredOriginal | undefined;
        try {
          const result = await inTransaction(options.pool, async (client) => {
            await client.query(
              'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
              [`${actor.tenantId}:${caseId}:${actor.userId}:${input.idempotencyKey}`],
            );
            const kase = await findCase(client, actor, caseId, true);
            const prior = await client.query<EvidenceRow>(
              `SELECT * FROM evidence
                WHERE tenant_id = $1 AND case_id = $2 AND created_by = $3 AND idempotency_key = $4`,
              [actor.tenantId, caseId, actor.userId, input.idempotencyKey],
            );
            if (prior.rows[0]) {
              if (prior.rows[0].request_hash.trim() !== requestHash) {
                throw new ApiError(409, 'Idempotency key was already used for a different request.');
              }
              if(uploadId){const saved=await client.query("SELECT 1 FROM upload_reservations WHERE tenant_id=$1 AND case_id=$2 AND id=$3 AND status='completed' AND evidence_id=$4",[actor.tenantId,caseId,uploadId,prior.rows[0].id]);if(!saved.rowCount)throw new ApiError(409,'Upload key conflicts with another intake.');}
              const existingBytes = await verifiedBytes(options.storageRoot, prior.rows[0]);
              return {row: prior.rows[0], bytes: existingBytes};
            }
            if(uploadId){
              const upload=await client.query('SELECT *,expires_at>clock_timestamp() AS live FROM upload_reservations WHERE tenant_id=$1 AND case_id=$2 AND id=$3 AND created_by=$4 FOR UPDATE',[actor.tenantId,caseId,uploadId,actor.userId]);
              const u=upload.rows[0];if(!u||u.status!=='open'||!u.live||u.authority_version!==kase.authority_version)throw new ApiError(409,'Upload is closed, expired or authority changed.');
            }
            if (!kase.authority_version || kase.status !== 'Active') {
              throw new ApiError(409, 'Evidence intake is blocked until authority scope is approved.');
            }
            const authorityResult = await client.query(
              `SELECT id, version
                 FROM authority_records
                WHERE tenant_id = $1 AND case_id = $2 AND version = $3`,
              [actor.tenantId, caseId, kase.authority_version],
            );
            const authority = authorityResult.rows[0] as QueryResultRow | undefined;
            if (!authority) {
              throw new ApiError(409, 'The current immutable authority record is unavailable.');
            }

            const evidenceId = randomUUID();
            stored = await writeOriginal(options.storageRoot, actor.tenantId, caseId, evidenceId, bytes, binary ? 'bin' : 'txt');
            const inserted = await client.query<EvidenceRow>(
              `INSERT INTO evidence
                 (tenant_id, case_id, id, authority_id, authority_version, filename, byte_length,
                  source_time, method, digest, object_path, status, idempotency_key, request_hash, created_by, original_kind)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $15, $12, $13, $14, $16)
               RETURNING *`,
              [
                actor.tenantId,
                caseId,
                evidenceId,
                authority.id,
                authority.version,
                input.filename,
                bytes.length,
                input.sourceTime,
                input.method,
                digest,
                stored.objectPath,
                input.idempotencyKey,
                requestHash,
                actor.userId,
                binary ? 'Quarantined' : 'Verified',
                originalKind,
              ],
            );
            await writeAudit(
              client,
              actor,
              caseId,
              'evidence.received',
              'evidence',
              evidenceId,
              binary ? 'Binary original received; digest matched; quarantined without scanning or parsing'
                : 'Evidence received; server digest matched supplied bytes',
              {sha256: digest, authorityVersion: authority.version, byteLength: bytes.length, originalKind},
            );
            const row = inserted.rows[0];
            if (!row) {
              throw new Error('Evidence insert did not return a row.');
            }
            if(uploadId){
              const keys=[actor.tenantId,caseId,uploadId];
              await client.query("UPDATE upload_reservations SET status='completed',evidence_id=$4 WHERE tenant_id=$1 AND case_id=$2 AND id=$3",[...keys,evidenceId]);
              await client.query('DELETE FROM upload_chunks WHERE tenant_id=$1 AND case_id=$2 AND upload_id=$3',keys);
              await writeAudit(client,actor,caseId,'upload.completed','upload',uploadId,'Upload verified and attached as quarantined original');
            }
            return {row, bytes};
          });
          if (stored && result.row.object_path !== stored.objectPath) {
            await stored.remove();
            stored = undefined;
          }
          return evidenceDtoWithText(result.row, result.bytes);
        } catch (error) {
          await stored?.remove();
          throw error;
        }
  }
  for(const binary of [false,true])app.post(binary?'/api/cases/:caseId/evidence/binary':'/api/cases/:caseId/evidence',
    {preHandler:requireCsrf,schema:{params:caseParamsSchema,body:binary?binaryEvidenceBodySchema:evidenceBodySchema}},
    request=>receiveEvidence(request.actor!,(request.params as {caseId:string}).caseId,request.body as EvidenceInput|BinaryEvidenceInput,binary));
  registerUploads(app,{pool:options.pool,authenticate,requireCsrf,findCase,audit:writeAudit,validFilename,validSourceTime,
    receive:(actor,caseId,input,uploadId)=>receiveEvidence(actor,caseId,input,true,uploadId),
    receipt:(actor,caseId,id)=>inTransaction(options.pool,async c=>{const row=await findEvidence(c,actor,caseId,id);return evidenceDtoWithText(row,await verifiedBytes(options.storageRoot,row));})});

  app.get(
    '/api/cases/:caseId/evidence/:evidenceId/original',
    {preHandler: authenticate, schema: {params: evidenceParamsSchema}},
    async (request, reply) => {
      reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff');
      const actor = request.actor!;
      rejectClientRole(actor);
      const {caseId, evidenceId} = request.params as {caseId: string; evidenceId: string};
      const {evidence,bytes} = await inTransaction(options.pool, async (client) => {
        await findCase(client, actor, caseId);
        const evidence=await findEvidence(client, actor, caseId, evidenceId);
        const bytes=await verifiedBytes(options.storageRoot,evidence);
        await writeAudit(client,actor,caseId,'evidence.original_read','evidence',evidenceId,
          'Verified original prepared for download',
          {sha256:evidence.digest.trim(),byteLength:bytes.length,originalKind:evidence.original_kind,authorityVersion:evidence.authority_version});
        return {evidence,bytes};
      });
      const encodedFilename = encodeURIComponent(evidence.filename).replace(/['()]/g, (char) =>
        `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      return reply
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Disposition', `attachment; filename="evidence.${evidence.original_kind === 'opaque_binary' ? 'bin' : 'txt'}"; filename*=UTF-8''${encodedFilename}`)
        .header('X-INVEOS-Original-State', evidence.status)
        .type(evidence.original_kind === 'opaque_binary' ? 'application/octet-stream' : 'text/plain; charset=utf-8')
        .send(bytes);
    },
  );

  app.post(
    '/api/cases/:caseId/claims',
    {preHandler: requireCsrf, schema: {params: caseParamsSchema, body: claimBodySchema}},
    async (request) => {
      const actor = request.actor!;
      rejectClientRole(actor);
      const {caseId} = request.params as {caseId: string};
      const input = request.body as ClaimInput;
      if (!input.text.trim()) {
        throw new ApiError(422, 'Claim text cannot be empty.');
      }
      if (!input.quote.trim()) {
        throw new ApiError(422, 'A source quote is required.');
      }
      const claimId = randomUUID();
      const claim = await inTransaction(options.pool, async (client) => {
        await findCase(client, actor, caseId, true);
        const evidence = await findEvidence(client, actor, caseId, input.evidenceId);
        requireTextOriginal(evidence);
        const bytes = await verifiedBytes(options.storageRoot, evidence);
        const {startByte,endByte}=selectSourceSpan(bytes,input.quote,input.sourceStartByte,input.sourceEndByte);
        const inserted = await client.query<ClaimRow>(
          `INSERT INTO claims
             (tenant_id, case_id, id, evidence_id, authority_id, authority_version, text, quote,
              source_start_byte, source_end_byte, source_digest, status, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Under review', $12)
           RETURNING *`,
          [
            actor.tenantId,
            caseId,
            claimId,
            evidence.id,
            evidence.authority_id,
            evidence.authority_version,
            input.text,
            input.quote,
            startByte,
            endByte,
            evidence.digest.trim(),
            actor.userId,
          ],
        );
        await writeAudit(client, actor, caseId, 'claim.proposed', 'claim', claimId, 'Source-linked claim proposed', {
          evidenceId: evidence.id,
          sourceStartByte: startByte,
          sourceEndByte: endByte,
        });
        const row = inserted.rows[0];
        if (!row) {
          throw new Error('Claim insert did not return a row.');
        }
        return row;
      });
      return displayClaim(claim);
    },
  );

  app.post(
    '/api/cases/:caseId/claims/:claimId/review',
    {preHandler: requireCsrf, schema: {params: claimParamsSchema, body: reviewBodySchema}},
    async (request) => {
      const actor = request.actor!;
      rejectClientRole(actor);
      if (actor.role !== 'reviewer') {
        throw new ApiError(403, 'Only a reviewer can review claims.');
      }
      const {caseId, claimId} = request.params as {caseId: string; claimId: string};
      const input = request.body as ReviewInput;
      if (!input.reason.trim()) {
        throw new ApiError(422, 'A review reason is required.');
      }

      return inTransaction(options.pool, async (client) => {
        await findCase(client, actor, caseId, true);
        const claim = await findClaim(client, actor, caseId, claimId, true);
        const previous = await client.query(
          `SELECT r.*, f.id AS finding_id
             FROM reviews r
             LEFT JOIN findings f
               ON f.tenant_id = r.tenant_id AND f.case_id = r.case_id AND f.review_id = r.id
            WHERE r.tenant_id = $1 AND r.case_id = $2 AND r.claim_id = $3`,
          [actor.tenantId, caseId, claimId],
        );
        if (previous.rows[0]) {
          const old = previous.rows[0] as QueryResultRow;
          if (old.accepted !== input.accepted || old.reason !== input.reason) {
            throw new ApiError(409, 'This claim already has a different review decision.');
          }
          if (input.accepted) {
            const evidence = await findEvidence(client, actor, caseId, claim.evidence_id);
            requireTextOriginal(evidence);
            const bytes = await verifiedBytes(options.storageRoot, evidence);
            if (
              evidence.digest.trim() !== claim.source_digest.trim()
              || !exactSpan(bytes,claim.quote,claim.source_start_byte,claim.source_end_byte)
              || previous.rows[0].source_digest.trim()!==claim.source_digest.trim()
              || previous.rows[0].source_start_byte!==claim.source_start_byte
              || previous.rows[0].source_end_byte!==claim.source_end_byte
            ) {
              throw new ApiError(409, 'The claim source link no longer verifies.');
            }
          }
          return {
            id: old.id,
            caseId,
            claimId,
            accepted: old.accepted,
            reason: old.reason,
            findingId: old.finding_id ?? undefined,
          };
        }

        let evidence: EvidenceRow | undefined;
        let bytes: Buffer | undefined;
        if (input.accepted) {
          evidence = await findEvidence(client, actor, caseId, claim.evidence_id);
          requireTextOriginal(evidence);
          bytes = await verifiedBytes(options.storageRoot, evidence);

          if (
            evidence.digest.trim() !== claim.source_digest.trim()
            || !exactSpan(bytes,claim.quote,claim.source_start_byte,claim.source_end_byte)
          ) {
            throw new ApiError(409, 'The claim source link no longer verifies.');
          }
        }

        const reviewId = randomUUID();
        const reviewedAt = new Date();
        const review = await client.query(
          `INSERT INTO reviews
             (tenant_id, case_id, id, claim_id, accepted, reason, reviewed_by, reviewed_at,
              source_digest, source_start_byte, source_end_byte)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [
            actor.tenantId,
            caseId,
            reviewId,
            claimId,
            input.accepted,
            input.reason,
            actor.userId,
            reviewedAt,
            claim.source_digest,
            claim.source_start_byte,
            claim.source_end_byte,
          ],
        );
        await client.query(
          `UPDATE claims SET status = $4, reason = $5
            WHERE tenant_id = $1 AND case_id = $2 AND id = $3`,
          [actor.tenantId, caseId, claimId, input.accepted ? 'Accepted' : 'Rejected', input.reason],
        );
        let findingId: string | undefined;
        if (input.accepted) {
          findingId = randomUUID();
          await client.query(
            `INSERT INTO findings
               (tenant_id, case_id, id, claim_id, review_id, text, reviewer_user_id, reviewed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [actor.tenantId, caseId, findingId, claimId, reviewId, claim.text, actor.userId, reviewedAt],
          );
        }
        await writeAudit(
          client,
          actor,
          caseId,
          input.accepted ? 'claim.accepted' : 'claim.rejected',
          'review',
          reviewId,
          input.accepted ? 'Claim accepted as a finding' : 'Claim rejected',
          {claimId, findingId: findingId ?? null, sourceDigest: claim.source_digest},
        );
        return {
          id: review.rows[0].id,
          caseId,
          claimId,
          accepted: input.accepted,
          reason: input.reason,
          findingId,
          sourceDigest: evidence?.digest.trim() ?? claim.source_digest.trim(),
          sourceVerified: input.accepted && bytes !== undefined,
        };
      });
    },
  );

  // Cursor names are fixed application constants. Transaction end also closes them on failure.
  async function* reportRows(client: PoolClient, name: 'report_findings' | 'report_work', sql: string, values: string[], message: string) {
    await client.query(`DECLARE ${name} NO SCROLL CURSOR FOR ${sql}`, values);
    let count = 0;
    for (;;) {
      const batch = await client.query(`FETCH FORWARD 32 FROM ${name}`);
      if (!batch.rows.length) break;
      for (const row of batch.rows) {
        if (++count > REPORT_MAX_ITEMS) throw new ApiError(422, message);
        yield row;
      }
    }
    await client.query(`CLOSE ${name}`);
  }

  async function buildReport(client: PoolClient, actor: Actor, caseId: string): Promise<ReportDraft> {
      await findCase(client,actor,caseId);
      const caseResult = await client.query<CaseRow>(
        `SELECT c.*, u.display_name AS owner_name
           FROM cases c
           JOIN case_memberships cm
             ON cm.tenant_id = c.tenant_id AND cm.case_id = c.id
           JOIN users u ON u.id = c.owner_user_id
          WHERE c.tenant_id = $1 AND c.id = $2 AND cm.user_id = $3`,
        [actor.tenantId, caseId, actor.userId],
      );
      const caseRow = caseResult.rows[0];
      if (!caseRow) {
        notFound();
      }

      const report: ReportDraft = {
        status: 'draft_not_released',
        case: {
          id: caseRow.id,
          ref: caseRow.ref,
          title: caseRow.title,
          client: caseRow.client,
          scope: caseRow.scope,
          jurisdiction: caseRow.jurisdiction,
        },
        findings: [],
        investigation: {
          status: 'working_context_not_findings',
          objectives: [],
          questions: [],
          hypotheses: [],
          blockers: [],
        },
        limitations: 'Internal synthetic-lab JSON draft only. Working questions and hypotheses are not findings. Verify cited bytes/spans offline with tools/verify_report.py; authenticate the whole draft using a separately trusted fingerprint. Not a signed custody certificate, production PDF, or client release.',
      };
      const budget = new ReportBudget();
      budget.add(report);
      for await (const row of reportRows(client, 'report_findings',
        `SELECT f.id AS finding_id, f.text AS finding_text, f.reviewed_at, reviewer.display_name AS reviewer,
                cl.id AS claim_id, cl.evidence_id, cl.quote, cl.source_start_byte, cl.source_end_byte, cl.source_digest,
                r.claim_id AS review_claim_id, r.accepted AS review_accepted, r.source_digest AS review_digest,
                r.source_start_byte AS review_start_byte, r.source_end_byte AS review_end_byte,
                e.filename, e.byte_length, e.source_time, e.received_time, e.digest, e.object_path, e.original_kind, e.status,
                e.authority_id, e.authority_version, a.purpose, a.lawful_basis, a.scope,
                a.retention_days, a.minimisation, a.approved_at, policy_user.display_name AS approved_by
           FROM findings f
           JOIN reviews r ON r.tenant_id=f.tenant_id AND r.case_id=f.case_id AND r.id=f.review_id
           JOIN claims cl
             ON cl.tenant_id = f.tenant_id AND cl.case_id = f.case_id AND cl.id = f.claim_id
           JOIN evidence e
             ON e.tenant_id = cl.tenant_id AND e.case_id = cl.case_id AND e.id = cl.evidence_id
           JOIN authority_records a
             ON a.tenant_id = e.tenant_id AND a.case_id = e.case_id AND a.id = e.authority_id
             AND a.version = e.authority_version
           JOIN users reviewer ON reviewer.id = f.reviewer_user_id
           JOIN users policy_user ON policy_user.id = a.approved_by
          WHERE f.tenant_id = $1 AND f.case_id = $2
          ORDER BY f.reviewed_at, f.id LIMIT 1001`,
        [actor.tenantId, caseId],
        'Report finding limit exceeded.')) {
        const evidence = row as EvidenceRow;
        requireTextOriginal(evidence);
        if (!Number.isSafeInteger(evidence.byte_length) || evidence.byte_length < 1 || evidence.byte_length > 262144) {
          throw new ApiError(409, 'The cited original size is invalid.');
        }
        const source: ReportDraft['findings'][number]['source'] = {
          id: row.evidence_id,
          filename: row.filename,
          sha256: row.digest.trim(),
          sourceTime: row.source_time,
          receivedTime: iso(row.received_time),
          quote: row.quote,
          startByte: row.source_start_byte,
          endByte: row.source_end_byte,
          contentBase64: '',
          policy: {
            authorityId: row.authority_id,
            authorityVersion: row.authority_version,
            purpose: row.purpose,
            lawfulBasis: row.lawful_basis,
            scope: row.scope,
            retentionDays: row.retention_days,
            minimisation: row.minimisation,
          },
        };
        const finding = {
          id: row.finding_id, text: row.finding_text, reviewer: row.reviewer,
          reviewedAt: iso(row.reviewed_at), source,
        };
        // Reject before reading or base64-encoding this original. Count every occurrence:
        // the export embeds a source per finding even when several share an evidence ID.
        budget.add(finding, 4 * Math.ceil(evidence.byte_length / 3), report.findings.length > 0);
        const bytes = await verifiedBytes(options.storageRoot, evidence);
        if (
          row.source_digest.trim() !== evidence.digest.trim()
          || !exactSpan(bytes,row.quote,row.source_start_byte,row.source_end_byte)
          || !row.review_accepted || row.review_claim_id!==row.claim_id
          || row.review_digest.trim()!==row.source_digest.trim()
          || row.review_start_byte!==row.source_start_byte || row.review_end_byte!==row.source_end_byte
        ) {
          throw new ApiError(409, 'A cited source link no longer verifies.');
        }
        source.contentBase64 = bytes.toString('base64');
        report.findings.push(finding);
      }
      if (!report.findings.length) throw new ApiError(422, 'A report draft requires at least one accepted finding.');
      for await (const row of reportRows(client, 'report_work',
        `SELECT *, due_date::text AS due_date FROM case_work_items
          WHERE tenant_id=$1 AND case_id=$2
          AND (kind IN ('objective','question','hypothesis') OR (kind='task' AND status='Blocked'))
          ORDER BY created_at, id LIMIT 1001`, [actor.tenantId, caseId], 'Report working-context limit exceeded.')) {
        const item = displayWork(row);
        const context = report.investigation!;
        const target = item.kind === 'objective' ? context.objectives : item.kind === 'question' ? context.questions
          : item.kind === 'hypothesis' ? context.hypotheses : context.blockers;
        budget.add(item, 0, target.length > 0);
        target.push(item);
      }
      return report;
  }
  async function reportTransaction<T>(operation: (client: PoolClient)=>Promise<T>): Promise<T> {
    for(let attempt=0;;attempt++) {
      try {return await inTransaction(options.pool,async client=>{
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        return operation(client);
      });} catch(error) {
        if (attempt>=2 || (error as {code?:string}).code!=='40001') throw error;
      }
    }
  }
  async function reportAccess(client: PoolClient,actor: Actor,caseId:string) {
    rejectClientRole(actor);
    await findCase(client,actor,caseId);
    const member=await client.query("SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role<>'client'",[actor.tenantId,actor.userId]);
    if(!member.rowCount) throw new ApiError(403,'Internal reports only.');
  }
  app.get('/api/cases/:caseId/report',{preHandler:authenticate,schema:{params:caseParamsSchema}},async request=>{
    const actor=request.actor!,{caseId}=request.params as {caseId:string};
    return reportTransaction(async client=>{await reportAccess(client,actor,caseId);return buildReport(client,actor,caseId);});
  });
  app.get('/api/cases/:caseId/report-revisions',{preHandler:authenticate,schema:{params:caseParamsSchema,
    querystring:{type:'object',additionalProperties:false,properties:{before:uuidSchema,limit:{type:'integer',minimum:1,maximum:50,default:25}}}}},async(request,reply)=>{
    const actor=request.actor!,{caseId}=request.params as {caseId:string};
    const {before,limit=25}=request.query as {before?:string;limit?:number};
    const page=await reportTransaction(async client=>{
      await reportAccess(client,actor,caseId);
      if(before) {
        const cursor=await client.query('SELECT 1 FROM report_revisions WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[actor.tenantId,caseId,before]);
        if(!cursor.rowCount) notFound();
      }
      const rows=await client.query(`SELECT id,digest,created_at FROM report_revisions
        WHERE tenant_id=$1 AND case_id=$2 AND ($3::uuid IS NULL OR (created_at,id)<(
          SELECT created_at,id FROM report_revisions WHERE tenant_id=$1 AND case_id=$2 AND id=$3))
        ORDER BY created_at DESC,id DESC LIMIT $4`,[actor.tenantId,caseId,before??null,limit+1]);
      return {items:rows.rows.slice(0,limit).map(row=>revisionReceipt(row,caseId)),nextBefore:rows.rows.length>limit?rows.rows[limit-1]!.id:null};
    });
    return reply.header('Cache-Control','no-store').send(page);
  });
  app.post('/api/cases/:caseId/report-revisions',{preHandler:requireCsrf,schema:{params:caseParamsSchema,
    body:{type:'object',required:['idempotencyKey'],additionalProperties:false,properties:{idempotencyKey:uuidSchema}}}},async request=>{
    const actor=request.actor!,{caseId}=request.params as {caseId:string},{idempotencyKey}=request.body as {idempotencyKey:string};
    return reportTransaction(async client=>{
      await reportAccess(client,actor,caseId);
      const old=await client.query('SELECT id,digest,created_at,report_bytes FROM report_revisions WHERE tenant_id=$1 AND case_id=$2 AND created_by=$3 AND idempotency_key=$4',[actor.tenantId,caseId,actor.userId,idempotencyKey]);
      if(old.rows[0]) {checkRevision(old.rows[0]);return revisionReceipt(old.rows[0],caseId);}
      const report=await buildReport(client,actor,caseId);
      const bytes=Buffer.from(JSON.stringify(report),'utf8');
      if(bytes.length>REPORT_MAX_BYTES) throw new ApiError(422,'Report byte limit exceeded.');
      const digest=createHash('sha256').update(bytes).digest('hex'),id=randomUUID();
      const inserted=await client.query(`INSERT INTO report_revisions (tenant_id,case_id,id,created_by,idempotency_key,report_bytes,digest)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id,case_id,created_by,idempotency_key) DO NOTHING RETURNING id,digest,created_at`,[actor.tenantId,caseId,id,actor.userId,idempotencyKey,bytes,digest]);
      if(!inserted.rows[0]) throw Object.assign(new Error('Concurrent revision retry'),{code:'40001'});
      await writeAudit(client,actor,caseId,'report.frozen','report_revision',id,'Internal draft revision frozen',{digest,findingIds:report.findings.map(f=>f.id)});
      return revisionReceipt(inserted.rows[0],caseId);
    });
  });
  function revisionReceipt(row: QueryResultRow,caseId:string) {
    return {id:row.id,caseId,status:'draft_not_released',sha256:row.digest.trim(),createdAt:iso(row.created_at)};
  }
  function checkRevision(row: QueryResultRow) {
    if(createHash('sha256').update(row.report_bytes).digest('hex')!==row.digest.trim()) throw new ApiError(409,'Stored report revision integrity failed.');
  }
  app.get('/api/cases/:caseId/report-revisions/:revisionId',{preHandler:authenticate,schema:{params:{type:'object',required:['caseId','revisionId'],additionalProperties:false,properties:{caseId:uuidSchema,revisionId:uuidSchema}}}},async(request,reply)=>{
    const actor=request.actor!,{caseId,revisionId}=request.params as {caseId:string;revisionId:string};
    const row=await reportTransaction(async client=>{
      await reportAccess(client,actor,caseId);
      const result=await client.query('SELECT * FROM report_revisions WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[actor.tenantId,caseId,revisionId]);
      if(!result.rows[0]) notFound();checkRevision(result.rows[0]);
      await writeAudit(client,actor,caseId,'report_revision.downloaded','report_revision',revisionId,'Frozen internal draft downloaded');
      return result.rows[0];
    });
    return reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff')
      .header('X-INVEOS-Report-SHA256',row.digest.trim()).header('Content-Disposition',`attachment; filename="report-${revisionId}.json"`)
      .type('application/json').send(row.report_bytes);
  });

  return app;
}
