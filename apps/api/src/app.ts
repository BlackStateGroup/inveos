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
import { ApiError, notFound } from './errors.js';
import { inTransaction } from './db.js';
import { readOriginal, writeOriginal, type StoredOriginal } from './storage.js';

type Role = 'reviewer' | 'investigator' | 'client';

type Actor = {
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
    bytes = await readOriginal(storageRoot, evidence.object_path);
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

  app.get('/api/workspace', {preHandler: authenticate}, async (request) => {
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
    const workspace: Workspace = {cases: casesResult.rows.map(displayCase), evidence: [], claims: [], findings: [], activity: []};
    if (!caseIds.length) {
      return workspace;
    }

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
        const bytes = await readOriginal(options.storageRoot, row.object_path);
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

  for (const binary of [false, true]) {
    app.post(
      binary ? '/api/cases/:caseId/evidence/binary' : '/api/cases/:caseId/evidence',
      {preHandler: requireCsrf, schema: {params: caseParamsSchema, body: binary ? binaryEvidenceBodySchema : evidenceBodySchema}},
      async (request) => {
        const actor = request.actor!;
        rejectClientRole(actor);
        const {caseId} = request.params as {caseId: string};
        const input = request.body as EvidenceInput | BinaryEvidenceInput;
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
              const existingBytes = await verifiedBytes(options.storageRoot, prior.rows[0]);
              return {row: prior.rows[0], bytes: existingBytes};
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
      },
    );
  }

  app.get(
    '/api/cases/:caseId/evidence/:evidenceId/original',
    {preHandler: authenticate, schema: {params: evidenceParamsSchema}},
    async (request, reply) => {
      const actor = request.actor!;
      rejectClientRole(actor);
      const {caseId, evidenceId} = request.params as {caseId: string; evidenceId: string};
      const evidence = await inTransaction(options.pool, async (client) => {
        await findCase(client, actor, caseId);
        return findEvidence(client, actor, caseId, evidenceId);
      });
      const bytes = await verifiedBytes(options.storageRoot, evidence);
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
        const sourceText = bytes.toString('utf8');
        if (!Buffer.from(sourceText, 'utf8').equals(bytes)) {
          throw new ApiError(409, 'The cited original is not valid UTF-8 text.');
        }
        const charOffset = sourceText.indexOf(input.quote);
        if (charOffset < 0) {
          throw new ApiError(422, 'The quoted source text is not an exact substring of the original.');
        }
        const startByte = Buffer.byteLength(sourceText.slice(0, charOffset), 'utf8');
        const endByte = startByte + Buffer.byteLength(input.quote, 'utf8');
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
              || bytes.subarray(claim.source_start_byte, claim.source_end_byte).toString('utf8') !== claim.quote
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
          const quoteBytes = Buffer.from(claim.quote, 'utf8');
          const span = bytes.subarray(claim.source_start_byte, claim.source_end_byte);
          if (
            evidence.digest.trim() !== claim.source_digest.trim()
            || span.length !== quoteBytes.length
            || !span.equals(quoteBytes)
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

  app.get(
    '/api/cases/:caseId/report',
    {preHandler: authenticate, schema: {params: caseParamsSchema}},
    async (request): Promise<ReportDraft> => {
      const actor = request.actor!;
      rejectClientRole(actor);
      const {caseId} = request.params as {caseId: string};
      await inTransaction(options.pool, async (client) => findCase(client, actor, caseId));
      const result = await options.pool.query(
        `SELECT f.id AS finding_id, f.text AS finding_text, f.reviewed_at, reviewer.display_name AS reviewer,
                cl.evidence_id, cl.quote, cl.source_start_byte, cl.source_end_byte, cl.source_digest,
                e.filename, e.byte_length, e.source_time, e.received_time, e.digest, e.object_path, e.original_kind, e.status,
                e.authority_id, e.authority_version, a.purpose, a.lawful_basis, a.scope,
                a.retention_days, a.minimisation, a.approved_at, policy_user.display_name AS approved_by
           FROM findings f
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
          ORDER BY f.reviewed_at, f.id`,
        [actor.tenantId, caseId],
      );
      if (!result.rows.length) {
        throw new ApiError(422, 'A report draft requires at least one accepted finding.');
      }
      const caseResult = await options.pool.query<CaseRow>(
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

      const sources = new Map<string, ReportDraft['findings'][number]['source']>();
      const findings: ReportDraft['findings'] = [];
      for (const row of result.rows) {
        const evidence = row as EvidenceRow;
        requireTextOriginal(evidence);
        const bytes = await verifiedBytes(options.storageRoot, evidence);
        const quoteBytes = Buffer.from(row.quote, 'utf8') as Buffer;
        const span = bytes.subarray(row.source_start_byte, row.source_end_byte);
        if (
          row.source_digest.trim() !== evidence.digest.trim()
          || span.length !== quoteBytes.length
          || !span.equals(quoteBytes)
        ) {
          throw new ApiError(409, 'A cited source link no longer verifies.');
        }
        sources.set(row.evidence_id, {
          id: row.evidence_id,
          filename: row.filename,
          sha256: row.digest.trim(),
          sourceTime: row.source_time,
          receivedTime: iso(row.received_time),
          quote: row.quote,
          startByte: row.source_start_byte,
          endByte: row.source_end_byte,
          contentBase64: bytes.toString('base64'),
          policy: {
            authorityId: row.authority_id,
            authorityVersion: row.authority_version,
            purpose: row.purpose,
            lawfulBasis: row.lawful_basis,
            scope: row.scope,
            retentionDays: row.retention_days,
            minimisation: row.minimisation,
          },
        });
        findings.push({
          id: row.finding_id,
          text: row.finding_text,
          reviewer: row.reviewer,
          reviewedAt: iso(row.reviewed_at),
          source: sources.get(row.evidence_id)!,
        });
      }
      return {
        status: 'draft_not_released',
        case: {
          id: caseRow.id,
          ref: caseRow.ref,
          title: caseRow.title,
          client: caseRow.client,
          scope: caseRow.scope,
          jurisdiction: caseRow.jurisdiction,
        },
        findings,
        limitations: 'Internal synthetic-lab JSON draft only. Not a signed custody certificate, independent verifier, PDF, or client release.',
      };
    },
  );

  return app;
}
