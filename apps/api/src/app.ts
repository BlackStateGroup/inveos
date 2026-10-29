import {appendCaseStage,collectionOpen,registerCaseLifecycle,type LifecycleCase} from './case-lifecycle.js';
import {registerManualSources} from './manual-sources.js';
import {registerCaseGraph} from './case-graph.js';
import type {ChronologySource} from '@inveos/contracts';
import {registerWorkDiscussions} from './work-discussions.js';
import {registerCaseSearch} from './case-search.js';
import {identityRoutes} from './identity-routes.js';
import type {IdentityProvider} from './oidc.js';
import type {OriginalStore} from './original-encryption.js';
import {chronologyRows,registerChronology} from './chronology.js';
import {sessionEpoch} from './session-epoch.js';
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
import { registerInterviews } from './interviews.js';
import {buildReportPdf,reportPdfProfileDigest} from './report-pdf.js';

type Role = 'reviewer' | 'investigator' | 'client';

export type Actor = {
  tokenHash: string;
  csrfHash: string;
  tenantId: string;
  userId: string;
  displayName: string;
  role: Role;
};

type CaseRow = QueryResultRow & LifecycleCase & {
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
  identity?: IdentityProvider;
  pool: Pool;
  storageRoot: OriginalStore;
  allowedOrigins: string[];
  demoTenantId: string;
  demoUserId: string;
  sessionTtlSeconds: number;
  sessionEpoch?: string;
  documentLab?: boolean;
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
    lifecycle: {state:row.lifecycle_state,version:row.lifecycle_version,collectionOpen:collectionOpen(row)},
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

async function verifiedBytes(storageRoot: OriginalStore, evidence: EvidenceRow): Promise<Buffer> {
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
  const epoch=sessionEpoch(options.sessionEpoch);
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

  identityRoutes(app,{...options,epoch});

  const authenticate = async (request: AppRequest): Promise<void> => {
    const token = request.cookies[sessionCookieName];
    if (!token) {
      throw new ApiError(401, 'A valid session is required.');
    }
    const tokenHash = sha256(token);
    const result = await options.pool.query(
      `SELECT s.token_hash, s.csrf_hash, s.tenant_id, s.user_id, u.display_name, m.role
         FROM sessions s
         JOIN memberships m ON m.tenant_id = s.tenant_id AND m.user_id = s.user_id
         JOIN users u ON u.id = s.user_id
         LEFT JOIN identity_bindings ib ON ib.id=s.identity_id AND ib.tenant_id=s.tenant_id AND ib.user_id=s.user_id
        WHERE s.token_hash = $1 AND s.epoch=$2 AND s.revoked_at IS NULL AND s.expires_at > now()
          AND (($3::text IS NULL AND s.identity_id IS NULL) OR ($3::text IS NOT NULL AND ib.issuer=$3 AND ib.revoked_at IS NULL AND s.identity_profile_hash=$4))`,
      [tokenHash,epoch,options.identity?.issuer??null,options.identity?.fingerprint??null],
    );
    const row = result.rows[0] as QueryResultRow | undefined;
    if (!row) {
      throw new ApiError(401, 'A valid session is required.');
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

  const requireSessionCsrf = async (request: AppRequest): Promise<void> => {
    requireAllowedOrigin(request, options.allowedOrigins);
    jsonOnly(request);
    await authenticate(request);
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
  const requireCsrf = async (request: AppRequest): Promise<void> => {
    await requireSessionCsrf(request);
    rejectClientRole(request.actor!);
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

  const {reportDocumentFindings,documentReportExhibits}=registerIntegrityJobs(app, {documentLab: options.documentLab, pool: options.pool, storageRoot: options.storageRoot, authenticate, requireCsrf, findCase, audit: writeAudit});

  registerCaseWork(app, {
    pool: options.pool, authenticate, requireCsrf, findCase, audit: writeAudit,
    verifyDocumentFinding: async (client,actor,caseId,findingId) => {
      for await (const finding of reportDocumentFindings(client,actor,caseId,[findingId])) return finding;
      return notFound();
    },
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

  registerManualSources(app,{pool:options.pool,authenticate,requireCsrf,findCase,audit:writeAudit,original:async(c,a,caseId,id)=>{const row=await findEvidence(c,a,caseId,id);await verifiedBytes(options.storageRoot,row);return {id:row.id,filename:row.filename,sha256:row.digest.trim(),sourceTime:row.source_time,receivedTime:iso(row.received_time),authorityId:row.authority_id,authorityVersion:row.authority_version,status:row.status};}});
  registerWorkDiscussions(app,{pool:options.pool,authenticate,requireCsrf,findCase,audit:writeAudit});
  registerCaseSearch(app,{pool:options.pool,authenticate,requireCsrf,findCase,audit:writeAudit});
  const verifiedFinding=async(client:PoolClient,actor:Actor,caseId:string,reference:ChronologySource)=>{
      const kase=await findCase(client,actor,caseId);
      const table=reference.kind==='text_finding'?'findings':'document_findings';
      if(!(await client.query(`SELECT id FROM ${table} WHERE tenant_id=$1 AND case_id=$2 AND id=$3`,[actor.tenantId,caseId,reference.findingId])).rowCount)notFound();
      const selected=await buildReport(client,actor,caseId,reference.kind==='text_finding'?[reference.findingId]:[],reference.kind==='document_finding'?[reference.findingId]:[]);
      const finding=reference.kind==='text_finding'?selected.findings.find(f=>f.id===reference.findingId):selected.documentFindings?.find(f=>f.id===reference.findingId);
      if(!finding)notFound();
      const authorityVersion='policy' in finding.source?finding.source.policy.authorityVersion:finding.source.authorityVersion;
      if(kase.status!=='Active'||kase.authority_version!==authorityVersion)throw new ApiError(409,'The source requires current case authority. Historical entries remain available.');
      return finding;
  };
  const investigationServices={pool:options.pool,authenticate,requireCsrf,findCase,audit:writeAudit,source:verifiedFinding};
  registerChronology(app,investigationServices);
  registerCaseGraph(app,investigationServices);

  registerInterviews(app, {pool:options.pool,authenticate,requireCsrf,findCase,audit:writeAudit,original:async(c,a,caseId,id)=>{const row=await findEvidence(c,a,caseId,id);if(row.original_kind!=='original_utf8')throw new ApiError(422,'A preserved supplied transcript text original is required.');const bytes=await verifiedBytes(options.storageRoot,row);return {bytes,digest:row.digest.trim(),authorityVersion:row.authority_version,sourceTime:row.source_time,receivedTime:iso(row.received_time),filename:row.filename};}});

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
      if(options.identity)throw new ApiError(403,'Use provider sign-in. Demo sessions are disabled.');
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
          `INSERT INTO sessions (token_hash, id, csrf_hash, tenant_id, user_id, expires_at, epoch)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [sessionActor.tokenHash, sessionId, sessionActor.csrfHash, sessionActor.tenantId, sessionActor.userId, expiresAt, epoch],
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
    {preHandler: requireSessionCsrf, schema: {body: emptyBodySchema}},
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
          await writeAudit(client, actor, null, 'session.ended', 'session', revoked.rows[0].id, 'Session ended');
        }
      });
      reply.clearCookie(sessionCookieName, {path: '/', sameSite: 'strict'});
      reply.clearCookie(csrfCookieName, {path: '/', sameSite: 'strict'});
      return reply.send({ok: true});
    },
  );

  app.post('/api/session/end-others', {preHandler: requireSessionCsrf, schema: {body: emptyBodySchema}}, async request => {
    const actor=request.actor!;
    return inTransaction(options.pool,async client=>{
      // Serialise this user's competing revocations before checking the current session again.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[actor.tenantId,actor.userId]);
      const current=await client.query('SELECT id FROM sessions WHERE token_hash=$1 AND tenant_id=$2 AND user_id=$3 AND epoch=$4 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE',[actor.tokenHash,actor.tenantId,actor.userId,epoch]);
      if(!current.rows[0])throw new ApiError(401,'The current session is no longer valid.');
      const revoked=await client.query(`WITH selected AS (
        SELECT token_hash FROM sessions WHERE tenant_id=$1 AND user_id=$2 AND token_hash<>$3 AND epoch=$4
        AND revoked_at IS NULL AND expires_at>now() ORDER BY id LIMIT 100 FOR UPDATE
      ) UPDATE sessions s SET revoked_at=now() FROM selected WHERE s.token_hash=selected.token_hash RETURNING s.id`,[actor.tenantId,actor.userId,actor.tokenHash,epoch]);
      if(revoked.rows.length)await writeAudit(client,actor,null,'session.others_ended','session',current.rows[0].id,'Other sessions ended in this tenant',{revokedCount:revoked.rows.length});
      const more=await client.query('SELECT EXISTS(SELECT 1 FROM sessions WHERE tenant_id=$1 AND user_id=$2 AND token_hash<>$3 AND epoch=$4 AND revoked_at IS NULL AND expires_at>now()) AS remaining',[actor.tenantId,actor.userId,actor.tokenHash,epoch]);
      return {revokedCount:revoked.rows.length,moreRemaining:more.rows[0].remaining};
    });
  });

  app.get('/api/session/me',{preHandler:authenticate},async request=>({name:request.actor!.displayName,role:request.actor!.role,mode:options.identity?'provider':'demo'}));

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
      `SELECT l.*, x.reason AS withdrawal_reason, x.created_by AS withdrawn_by, x.created_at AS withdrawn_at FROM case_work_links l LEFT JOIN case_work_link_withdrawals x ON x.tenant_id=l.tenant_id AND x.case_id=l.case_id AND x.link_id=l.id JOIN case_memberships cm ON cm.tenant_id=l.tenant_id AND cm.case_id=l.case_id
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
        if(['Closed','Archived'].includes(kase.lifecycle_state))throw new ApiError(409,'Reopen the case for scope review before approving authority.');
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
        await appendCaseStage(client,actor,caseId,{...kase,authority_version:version},'Active','Reviewer approved a new version of case authority.','authority_approved');
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
            if (!collectionOpen(kase)) {
              throw new ApiError(409, 'Evidence intake requires approved authority and an open collection stage.');
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
  async function* reportRows(client: PoolClient, name: 'report_findings' | 'report_work' | 'report_document_work_links', sql: string, values: unknown[], message: string) {
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

  async function buildReport(client: PoolClient, actor: Actor, caseId: string, selectedFindings?:string[],selectedDocuments?:string[]): Promise<ReportDraft> {
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
          WHERE f.tenant_id = $1 AND f.case_id = $2 AND ($3::uuid[] IS NULL OR f.id=ANY($3))
          ORDER BY f.reviewed_at, f.id LIMIT 1001`,
        [actor.tenantId, caseId,selectedFindings??null],
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
      for await(const finding of reportDocumentFindings(client,actor,caseId,selectedDocuments)){
        if(!report.documentFindings){
          budget.add({documentFindings:[]},0,true);report.documentFindings=[];
          const note=' Document findings carry lineage fingerprints only: tools/verify_report.py and exhibit packaging reject this format until independent derivative verification is implemented. Client disclosure is blocked.';
          budget.add(note);report.limitations+=note;
        }
        if(report.findings.length+report.documentFindings.length>=REPORT_MAX_ITEMS)throw new ApiError(422,'Report finding limit exceeded.');
        budget.add(finding,0,report.documentFindings.length>0);report.documentFindings.push(finding);
      }
      if (!report.findings.length&&!report.documentFindings?.length) throw new ApiError(422, 'A report draft requires at least one accepted finding.');
      if(selectedFindings)return report; // Verification inspects only the frozen finding set, not later working context.
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
      const workIds = [...report.investigation!.objectives,...report.investigation!.questions,...report.investigation!.hypotheses,...report.investigation!.blockers].map(w=>w.id);
      for await(const row of reportRows(client,'report_document_work_links',
        'SELECT l.* FROM case_work_links l WHERE tenant_id=$1 AND case_id=$2 AND item_id=ANY($3::uuid[]) AND document_finding_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM case_work_link_withdrawals x WHERE x.tenant_id=l.tenant_id AND x.case_id=l.case_id AND x.link_id=l.id) ORDER BY created_at,id LIMIT 1001',
        [actor.tenantId,caseId,workIds],'Report document source link limit exceeded.')) {
        if(!report.documentFindings?.some(f=>f.id===row.document_finding_id))throw new ApiError(409,'Working context references an unavailable document finding.');
        const link=displayWorkLink(row);
        if(!('kind' in link))throw new ApiError(409,'Invalid document source type.');
        if(!report.investigation!.documentLinks){budget.add({documentLinks:[]},0,true);report.investigation!.documentLinks=[];}
        budget.add(link,0,report.investigation!.documentLinks.length>0);report.investigation!.documentLinks.push(link);
      }
      const chronology=await chronologyRows(client,actor,caseId);
      if(chronology.length){
        budget.add({chronology:[]},0,true);report.investigation.chronology=[];
        for(const event of chronology){
          const available=event.source.kind==='text_finding'?report.findings:report.documentFindings??[];
          if(!available.some(f=>f.id===event.source.findingId))throw new ApiError(409,'Chronology references an unavailable finding. Resolve the source before freezing.');
          budget.add(event,0,report.investigation.chronology.length>0);report.investigation.chronology.push(event);
        }
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
      await writeAudit(client,actor,caseId,'report.frozen','report_revision',id,'Internal draft revision frozen',{digest,findingIds:report.findings.map(f=>f.id),documentFindingIds:report.documentFindings?.map(f=>f.id)??[]});
      return revisionReceipt(inserted.rows[0],caseId);
    });
  });
  function revisionReceipt(row: QueryResultRow,caseId:string) {
    return {id:row.id,caseId,status:'draft_not_released',sha256:row.digest.trim(),createdAt:iso(row.created_at)};
  }
  function checkRevision(row: QueryResultRow) {
    if(createHash('sha256').update(row.report_bytes).digest('hex')!==row.digest.trim()) throw new ApiError(409,'Stored report revision integrity failed.');
  }
  async function verifyFrozenSources(client:PoolClient,actor:Actor,caseId:string,revisionId:string,expected:string){
      const revision=(await client.query('SELECT report_bytes,digest FROM report_revisions WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[actor.tenantId,caseId,revisionId])).rows[0];
      if(!revision)notFound();checkRevision(revision);
      if(expected!==revision.digest.trim())throw new ApiError(409,'Verification fingerprint does not match the frozen revision.');
      let frozen:ReportDraft;
      try{frozen=JSON.parse(revision.report_bytes.toString('utf8'));}catch{throw new ApiError(409,'Frozen report structure is invalid.');}
      if(!frozen||frozen.status!=='draft_not_released'||frozen.case?.id!==caseId||!Array.isArray(frozen.findings)||frozen.documentFindings!==undefined&&!Array.isArray(frozen.documentFindings))throw new ApiError(409,'Frozen report structure is invalid.');
      const ids=frozen.findings.map(f=>f?.id);
      const documentIds=frozen.documentFindings?.map(f=>f?.id)??[],allIds=[...ids,...documentIds];
      if(!allIds.length||allIds.length>1000||allIds.some(id=>typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))||new Set(allIds).size!==allIds.length)throw new ApiError(409,'Frozen finding identities are invalid.');
      const current=await buildReport(client,actor,caseId,ids,documentIds);
      // Preserve the exact frozen claim/review/source/policy representation, including byte spans and embedded originals.
      if(JSON.stringify(current.findings)!==JSON.stringify(frozen.findings))throw new ApiError(409,'Frozen findings no longer match their current source records.');
      if(JSON.stringify(current.documentFindings??[])!==JSON.stringify(frozen.documentFindings??[]))throw new ApiError(409,'Frozen document findings no longer match their current source records.');
      return {ids:allIds,revision};
  }
  const reviewParams={type:'object',required:['caseId','revisionId'],additionalProperties:false,properties:{caseId:uuidSchema,revisionId:uuidSchema}};
  async function buildDocumentPackage(client:PoolClient,actor:Actor,caseId:string,revisionId:string,expectedReportDigest?:string){
      const row=(await client.query('SELECT report_bytes,digest FROM report_revisions WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[actor.tenantId,caseId,revisionId])).rows[0];if(!row)notFound();
      const reportDigest=row.digest.trim();
      const {revision}=await verifyFrozenSources(client,actor,caseId,revisionId,expectedReportDigest??reportDigest);
      const report=JSON.parse(revision.report_bytes.toString('utf8')) as ReportDraft;
      if(!report.documentFindings?.length)throw new ApiError(422,'A document package requires document-backed findings.');
      const result={format:'inveos_document_report_package_v1',reportSha256:reportDigest,reportBase64:'',exhibits:[] as unknown[]};
      const budget=new ReportBudget(64*1024*1024);budget.add(result,4*Math.ceil(revision.report_bytes.length/3));result.reportBase64=revision.report_bytes.toString('base64');
      for await(const exhibit of documentReportExhibits(client,actor,caseId,report.documentFindings)){budget.add(exhibit,0,result.exhibits.length>0);result.exhibits.push(exhibit);}
      const encoded=Buffer.from(JSON.stringify(result));if(encoded.length>64*1024*1024)throw new ApiError(422,'Document package byte limit exceeded.');
      return {bytes:encoded,reportDigest,packageDigest:createHash('sha256').update(encoded).digest('hex'),documentFindings:result.exhibits.length};
  }
  app.get('/api/cases/:caseId/report-revisions/:revisionId/document-package',{preHandler:authenticate,schema:{params:reviewParams}},async(request,reply)=>{
    const actor=request.actor!,{caseId,revisionId}=request.params as {caseId:string;revisionId:string};
    const result=await reportTransaction(async client=>{
      await reportAccess(client,actor,caseId);const built=await buildDocumentPackage(client,actor,caseId,revisionId);
      await writeAudit(client,actor,caseId,'report.document_package_exported','report_revision',revisionId,'Internal document provenance package exported',{reportDigest:built.reportDigest,packageDigest:built.packageDigest,documentFindings:built.documentFindings});
      return built;
    });
    return reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('X-INVEOS-Package-SHA256',result.packageDigest).header('Content-Disposition',`attachment; filename="document-report-${revisionId}.json"`).type('application/json').send(result.bytes);
  });
  const renditionInputSchema={type:'object',additionalProperties:false,required:['idempotencyKey','redactedFindingIds'],properties:{idempotencyKey:uuidSchema,redactedFindingIds:{type:'array',maxItems:1000,items:uuidSchema},reason:{type:'string',maxLength:500}}};
  function renditionReceipt(row:QueryResultRow){return {id:row.id,caseId:row.case_id,revisionId:row.revision_id,status:'internal_rendition_not_released',format:'pdf',sourceReportSha256:row.source_report_digest.trim(),pdfSha256:row.pdf_digest.trim(),profileDigest:row.profile_digest.trim(),redactionSha256:row.redaction_digest.trim(),redactedFindingCount:(row.redaction_plan as {findingIds?:unknown[]}).findingIds?.length??0,createdAt:iso(row.created_at)};}
  function canonicalJson(value:unknown):string{return value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonicalJson).join(',')}]`:`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;}
  function checkedPdf(reportBytes:Buffer,row:QueryResultRow){
    const reportDigest=createHash('sha256').update(reportBytes).digest('hex');if(reportDigest!==row.source_report_digest.trim())throw new ApiError(409,'Rendition source report integrity failed.');
    let report:ReportDraft,plan:{findingIds?:string[];reason?:string};try{report=JSON.parse(reportBytes.toString('utf8'));plan=row.redaction_plan;}catch{throw new ApiError(409,'Rendition metadata is invalid.');}
    let built;try{built=buildReportPdf(report,reportDigest,{findingIds:plan.findingIds,reason:plan.reason});}catch{throw new ApiError(409,'Rendition cannot be reproduced from its immutable inputs.');}
    const bytes=row.pdf_bytes as Buffer;
    if(row.profile!=='inveos_report_pdf_v1'||row.profile_digest.trim()!==reportPdfProfileDigest||row.redaction_digest.trim()!==built.redactionDigest||row.content_digest.trim()!==built.contentDigest||canonicalJson(row.redaction_plan)!==canonicalJson(built.plan)||canonicalJson(row.content_model)!==canonicalJson(built.model)||row.pdf_digest.trim()!==built.digest||!bytes.equals(built.bytes)||createHash('sha256').update(bytes).digest('hex')!==built.digest)throw new ApiError(409,'Stored rendition integrity verification failed.');
    return built;
  }
  app.post('/api/cases/:caseId/report-revisions/:revisionId/renditions',{preHandler:requireCsrf,schema:{params:reviewParams,body:renditionInputSchema}},async(request,reply)=>{
    reply.header('Cache-Control','no-store');const actor=request.actor!,{caseId,revisionId}=request.params as {caseId:string;revisionId:string};if(actor.role!=='reviewer')throw new ApiError(403,'Reviewer required.');
    const input=request.body as {idempotencyKey:string;redactedFindingIds:string[];reason?:string};
    return reportTransaction(async client=>{await reportAccess(client,actor,caseId);const revision=(await client.query('SELECT report_bytes,digest FROM report_revisions WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[actor.tenantId,caseId,revisionId])).rows[0];if(!revision)notFound();checkRevision(revision);
      const reportDigest=revision.digest.trim();let built;try{built=buildReportPdf(JSON.parse(revision.report_bytes.toString('utf8')),reportDigest,{findingIds:input.redactedFindingIds,reason:input.reason});}catch(error){throw new ApiError(422,error instanceof Error?error.message:'Invalid rendition request.');}
      const old=(await client.query('SELECT * FROM report_renditions WHERE tenant_id=$1 AND case_id=$2 AND created_by=$3 AND idempotency_key=$4',[actor.tenantId,caseId,actor.userId,input.idempotencyKey])).rows[0];
      if(old){if(old.revision_id!==revisionId||old.pdf_digest.trim()!==built.digest||old.redaction_digest.trim()!==built.redactionDigest)throw new ApiError(409,'Rendition retry differs.');checkedPdf(revision.report_bytes,old);return renditionReceipt(old);}
      await verifyFrozenSources(client,actor,caseId,revisionId,reportDigest);
      const id=randomUUID(),inserted=(await client.query(`INSERT INTO report_renditions(tenant_id,case_id,revision_id,id,created_by,idempotency_key,source_report_digest,profile,profile_digest,redaction_plan,redaction_digest,content_model,content_digest,pdf_bytes,pdf_digest)
        VALUES($1,$2,$3,$4,$5,$6,$7,'inveos_report_pdf_v1',$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(tenant_id,case_id,created_by,idempotency_key) DO NOTHING RETURNING *`,[actor.tenantId,caseId,revisionId,id,actor.userId,input.idempotencyKey,reportDigest,built.profileDigest,built.plan,built.redactionDigest,built.model,built.contentDigest,built.bytes,built.digest])).rows[0];
      if(!inserted)throw Object.assign(new Error('Concurrent rendition retry'),{code:'40001'});
      await writeAudit(client,actor,caseId,'report.rendition_created','report_rendition',id,'Immutable internal PDF rendition created',{revisionId,sourceReportDigest:reportDigest,pdfDigest:built.digest,profileDigest:built.profileDigest,redactionDigest:built.redactionDigest,redactedFindingCount:built.plan.findingIds.length});return renditionReceipt(inserted);
    });
  });
  app.get('/api/cases/:caseId/report-revisions/:revisionId/renditions',{preHandler:authenticate,schema:{params:reviewParams,querystring:{type:'object',additionalProperties:false,properties:{before:uuidSchema,limit:{type:'integer',minimum:1,maximum:50,default:25}}}}},async(request,reply)=>{
    const actor=request.actor!,{caseId,revisionId}=request.params as {caseId:string;revisionId:string},{before,limit=25}=request.query as {before?:string;limit?:number};const page=await reportTransaction(async client=>{await reportAccess(client,actor,caseId);
      if(before&&!await client.query('SELECT 1 FROM report_renditions WHERE tenant_id=$1 AND case_id=$2 AND revision_id=$3 AND id=$4',[actor.tenantId,caseId,revisionId,before]).then(r=>r.rowCount))notFound();
      const rows=await client.query(`SELECT * FROM report_renditions WHERE tenant_id=$1 AND case_id=$2 AND revision_id=$3 AND ($4::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM report_renditions WHERE tenant_id=$1 AND case_id=$2 AND revision_id=$3 AND id=$4)) ORDER BY created_at DESC,id DESC LIMIT $5`,[actor.tenantId,caseId,revisionId,before??null,limit+1]);return {items:rows.rows.slice(0,limit).map(renditionReceipt),nextBefore:rows.rows.length>limit?rows.rows[limit-1]!.id:null};});return reply.header('Cache-Control','no-store').send(page);
  });
  const renditionParams={type:'object',additionalProperties:false,required:['caseId','revisionId','renditionId'],properties:{caseId:uuidSchema,revisionId:uuidSchema,renditionId:uuidSchema}};
  app.get('/api/cases/:caseId/report-revisions/:revisionId/renditions/:renditionId',{preHandler:authenticate,schema:{params:renditionParams}},async(request,reply)=>{
    const actor=request.actor!,{caseId,revisionId,renditionId}=request.params as {caseId:string;revisionId:string;renditionId:string};const built=await reportTransaction(async client=>{await reportAccess(client,actor,caseId);const row=(await client.query(`SELECT rr.*,r.report_bytes FROM report_renditions rr JOIN report_revisions r ON r.tenant_id=rr.tenant_id AND r.case_id=rr.case_id AND r.id=rr.revision_id WHERE rr.tenant_id=$1 AND rr.case_id=$2 AND rr.revision_id=$3 AND rr.id=$4`,[actor.tenantId,caseId,revisionId,renditionId])).rows[0];if(!row)notFound();const checked=checkedPdf(row.report_bytes,row);await writeAudit(client,actor,caseId,'report.rendition_downloaded','report_rendition',renditionId,'Verified internal PDF rendition downloaded',{revisionId,pdfDigest:checked.digest,redactionDigest:checked.redactionDigest});return checked;});
    return reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('X-INVEOS-PDF-SHA256',built.digest).header('X-INVEOS-Report-SHA256',built.model.sourceReportSha256).header('X-INVEOS-Redaction-SHA256',built.redactionDigest).header('Content-Disposition',`attachment; filename="internal-report-${renditionId}.pdf"`).type('application/pdf').send(built.bytes);
  });
  const disclosureParams={type:'object',additionalProperties:false,required:['caseId','disclosureId'],properties:{caseId:uuidSchema,disclosureId:uuidSchema}};
  const pdfDisclosureJoin=`LEFT JOIN report_disclosure_renditions dr ON dr.tenant_id=d.tenant_id AND dr.disclosure_id=d.id LEFT JOIN report_renditions pr ON pr.tenant_id=dr.tenant_id AND pr.case_id=dr.case_id AND pr.id=dr.rendition_id`;
  const disclosureReceipt=(r:QueryResultRow)=>{const reportSha256=r.digest.trim(),packageSha256=r.package_digest?.trim(),pdfSha256=r.pdf_digest?.trim();return {id:r.id,caseId:r.case_id,revisionId:r.revision_id,recipientId:r.recipient_id,sha256:pdfSha256??packageSha256??reportSha256,reportSha256,deliverable:pdfSha256?'report_pdf':packageSha256?'document_package':'report_json',...(r.rendition_id?{renditionId:r.rendition_id}:{}),authorityVersion:r.authority_version,expiresAt:iso(r.expires_at),createdAt:iso(r.created_at),status:'recipient_disclosure_grant'};};
  const pdfReviewReceipt=(r:QueryResultRow)=>({id:r.id,caseId:r.case_id,renditionId:r.rendition_id,reviewerId:r.reviewer_id,authorityVersion:r.authority_version,pdfSha256:r.pdf_digest.trim(),redactionSha256:r.redaction_digest.trim(),decision:r.decision,reason:r.reason,createdAt:iso(r.created_at),status:'rendition_review_not_release'});
  async function loadRendition(client:PoolClient,actor:Actor,caseId:string,revisionId:string,renditionId:string){
    await reportAccess(client,actor,caseId);
    const row=(await client.query(`SELECT rr.*,r.report_bytes,r.created_by AS report_created_by FROM report_renditions rr JOIN report_revisions r ON r.tenant_id=rr.tenant_id AND r.case_id=rr.case_id AND r.id=rr.revision_id WHERE rr.tenant_id=$1 AND rr.case_id=$2 AND rr.revision_id=$3 AND rr.id=$4`,[actor.tenantId,caseId,revisionId,renditionId])).rows[0];
    if(!row)notFound();const built=checkedPdf(row.report_bytes,row);return {row,built};
  }
  for(const method of ['GET','POST'] as const)app.route({method,url:'/api/cases/:caseId/report-revisions/:revisionId/renditions/:renditionId/reviews',preHandler:method==='GET'?authenticate:requireCsrf,
    schema:{params:renditionParams,...(method==='POST'?{body:{type:'object',additionalProperties:false,required:['pdfSha256','redactionSha256','decision','reason','confirmInspected'],properties:{pdfSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},redactionSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},decision:{enum:['accept_for_disclosure','request_changes']},reason:{type:'string',minLength:10,maxLength:2000},confirmInspected:{const:true}}}}:{})},handler:async(request,reply)=>{
      reply.header('Cache-Control','no-store');const actor=request.actor!,{caseId,revisionId,renditionId}=request.params as {caseId:string;revisionId:string;renditionId:string};rejectClientRole(actor);
      return reportTransaction(async client=>{const kase=await findCase(client,actor,caseId,method==='POST'),{row,built}=await loadRendition(client,actor,caseId,revisionId,renditionId);
        if(method==='GET'){const rows=await client.query('SELECT * FROM report_rendition_reviews WHERE tenant_id=$1 AND case_id=$2 AND rendition_id=$3 ORDER BY created_at,id LIMIT 51',[actor.tenantId,caseId,renditionId]);if(rows.rows.length>50)throw new ApiError(422,'Review listing limit exceeded.');return {items:rows.rows.map(pdfReviewReceipt)};}
        if(actor.role!=='reviewer')throw new ApiError(403,'Reviewer required.');
        if(row.created_by===actor.userId||row.report_created_by===actor.userId)throw new ApiError(403,'A different reviewer must inspect the PDF and redactions.');
        const input=request.body as {pdfSha256:string;redactionSha256:string;decision:string;reason:string};const reason=input.reason.trim();
        if(reason.length<10)throw new ApiError(422,'Explain the PDF and redaction review.');
        if(input.pdfSha256!==built.digest||input.redactionSha256!==built.redactionDigest)throw new ApiError(409,'PDF review fingerprint mismatch.');
        const prior=(await client.query('SELECT * FROM report_rendition_reviews WHERE tenant_id=$1 AND case_id=$2 AND rendition_id=$3 AND reviewer_id=$4',[actor.tenantId,caseId,renditionId,actor.userId])).rows[0];
        if(prior){if(prior.decision!==input.decision||prior.reason!==reason)throw new ApiError(409,'PDF review already recorded. Create a new rendition for a changed decision.');return pdfReviewReceipt(prior);}
        if(kase.status!=='Active'||!kase.authority_version||!['Active','Review','Released'].includes(kase.lifecycle_state))throw new ApiError(409,'Active approved authority and an open case stage required.');
        await verifyFrozenSources(client,actor,caseId,revisionId,built.model.sourceReportSha256);
        const reviewed=(await client.query(`INSERT INTO report_rendition_reviews(tenant_id,case_id,rendition_id,id,reviewer_id,authority_version,pdf_digest,redaction_digest,decision,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING *`,[actor.tenantId,caseId,renditionId,randomUUID(),actor.userId,kase.authority_version,built.digest,built.redactionDigest,input.decision,reason])).rows[0];
        if(!reviewed)throw Object.assign(new Error('Concurrent PDF review retry'),{code:'40001'});
        await writeAudit(client,actor,caseId,'report.rendition_reviewed','report_rendition',renditionId,'Exact PDF and redactions independently reviewed',{reviewId:reviewed.id,pdfDigest:built.digest,redactionDigest:built.redactionDigest,decision:input.decision,inspectionConfirmed:true});return pdfReviewReceipt(reviewed);
      });
    }});
  app.post('/api/cases/:caseId/report-revisions/:revisionId/renditions/:renditionId/disclosures',{preHandler:requireCsrf,schema:{params:renditionParams,body:{type:'object',additionalProperties:false,required:['pdfSha256','recipientId','idempotencyKey','expiresAt','reason','confirmReviewedDisclosure'],properties:{pdfSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},recipientId:uuidSchema,idempotencyKey:uuidSchema,expiresAt:{type:'string',maxLength:40},reason:{type:'string',minLength:10,maxLength:2000},confirmReviewedDisclosure:{const:true}}}}},async(request,reply)=>{
    reply.header('Cache-Control','no-store');const actor=request.actor!,{caseId,revisionId,renditionId}=request.params as {caseId:string;revisionId:string;renditionId:string};if(actor.role!=='reviewer')throw new ApiError(403,'Reviewer required.');
    const input=request.body as {pdfSha256:string;recipientId:string;idempotencyKey:string;expiresAt:string;reason:string},reason=input.reason.trim(),expiry=Date.parse(input.expiresAt);
    if(reason.length<10||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input.expiresAt)||!Number.isFinite(expiry))throw new ApiError(422,'Valid UTC expiry and disclosure reason required.');
    return reportTransaction(async client=>{const kase=await findCase(client,actor,caseId,true);const old=(await client.query(`SELECT d.*,dr.rendition_id,pr.pdf_digest FROM report_disclosures d ${pdfDisclosureJoin} WHERE d.tenant_id=$1 AND d.case_id=$2 AND d.created_by=$3 AND d.idempotency_key=$4`,[actor.tenantId,caseId,actor.userId,input.idempotencyKey])).rows[0];
      if(old){if(old.revision_id!==revisionId||old.rendition_id!==renditionId||old.pdf_digest?.trim()!==input.pdfSha256||old.recipient_id!==input.recipientId||iso(old.expires_at)!==new Date(expiry).toISOString()||old.reason!==reason)throw new ApiError(409,'Disclosure retry differs.');return disclosureReceipt(old);}
      if(kase.status!=='Active'||!kase.authority_version||!['Active','Review','Released'].includes(kase.lifecycle_state))throw new ApiError(409,'Active approved authority and an open case stage required.');
      const {built}=await loadRendition(client,actor,caseId,revisionId,renditionId);if(built.digest!==input.pdfSha256)throw new ApiError(409,'PDF disclosure fingerprint mismatch.');
      await verifyFrozenSources(client,actor,caseId,revisionId,built.model.sourceReportSha256);
      const clock=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime();if(expiry<=clock||expiry>clock+7*86400000)throw new ApiError(422,'Expiry must be within seven days.');
      if(!(await client.query("SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role='client'",[actor.tenantId,input.recipientId])).rowCount)throw new ApiError(422,'Recipient must be a client in this tenant.');
      const accepted=await client.query(`SELECT 1 FROM report_rendition_reviews rr JOIN memberships m ON m.tenant_id=rr.tenant_id AND m.user_id=rr.reviewer_id JOIN case_memberships cm ON cm.tenant_id=rr.tenant_id AND cm.case_id=rr.case_id AND cm.user_id=rr.reviewer_id WHERE rr.tenant_id=$1 AND rr.case_id=$2 AND rr.rendition_id=$3 AND rr.authority_version=$4 AND rr.pdf_digest=$5 AND rr.redaction_digest=$6 AND rr.decision='accept_for_disclosure' AND m.role='reviewer'`,[actor.tenantId,caseId,renditionId,kase.authority_version,built.digest,built.redactionDigest]);
      const rejected=await client.query("SELECT 1 FROM report_rendition_reviews WHERE tenant_id=$1 AND case_id=$2 AND rendition_id=$3 AND decision='request_changes'",[actor.tenantId,caseId,renditionId]);
      const narrative=await client.query("SELECT 1 FROM report_revision_reviews WHERE tenant_id=$1 AND case_id=$2 AND revision_id=$3 AND decision='request_changes'",[actor.tenantId,caseId,revisionId]);
      if(!accepted.rowCount||rejected.rowCount||narrative.rowCount)throw new ApiError(409,'Independent PDF acceptance and no change requests required.');
      const row=(await client.query(`INSERT INTO report_disclosures(tenant_id,case_id,id,revision_id,recipient_id,created_by,idempotency_key,authority_version,digest,reason,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING *`,[actor.tenantId,caseId,randomUUID(),revisionId,input.recipientId,actor.userId,input.idempotencyKey,kase.authority_version,built.model.sourceReportSha256,reason,new Date(expiry)])).rows[0];
      if(!row)throw Object.assign(new Error('Concurrent PDF disclosure retry'),{code:'40001'});
      await client.query('INSERT INTO report_disclosure_renditions(tenant_id,case_id,revision_id,disclosure_id,rendition_id) VALUES($1,$2,$3,$4,$5)',[actor.tenantId,caseId,revisionId,row.id,renditionId]);
      await writeAudit(client,actor,caseId,'report.disclosed','report_disclosure',row.id,'Independently reviewed PDF disclosure approved',{revisionId,renditionId,recipientId:input.recipientId,pdfDigest:built.digest,redactionDigest:built.redactionDigest,deliverable:'report_pdf'});return disclosureReceipt({...row,rendition_id:renditionId,pdf_digest:built.digest});
    });
  });
  app.post('/api/cases/:caseId/report-revisions/:revisionId/disclosures',{preHandler:requireCsrf,schema:{params:reviewParams,body:{type:'object',additionalProperties:false,required:['sha256','recipientId','idempotencyKey','expiresAt','reason','confirmFullDisclosure'],properties:{sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},recipientId:uuidSchema,idempotencyKey:uuidSchema,expiresAt:{type:'string',maxLength:40},reason:{type:'string',minLength:10,maxLength:2000},confirmFullDisclosure:{const:true},documentPackageSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},confirmDocumentPackageVerified:{const:true}}}}},async(request,reply)=>{
    reply.header('Cache-Control','no-store');const actor=request.actor!,{caseId,revisionId}=request.params as {caseId:string;revisionId:string};
    if(actor.role!=='reviewer')throw new ApiError(403,'Reviewer required.');
    const input=request.body as {sha256:string;recipientId:string;idempotencyKey:string;expiresAt:string;reason:string;documentPackageSha256?:string;confirmDocumentPackageVerified?:true};const reason=input.reason.trim(),expiry=Date.parse(input.expiresAt);
    if(reason.length<10||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input.expiresAt)||!Number.isFinite(expiry))throw new ApiError(422,'Valid UTC expiry and disclosure reason required.');
    return inTransaction(options.pool,async client=>{
      const kase=await findCase(client,actor,caseId,true);
      const old=(await client.query(`SELECT d.*,p.package_digest,dr.rendition_id FROM report_disclosures d LEFT JOIN report_disclosure_packages p ON p.tenant_id=d.tenant_id AND p.disclosure_id=d.id ${pdfDisclosureJoin} WHERE d.tenant_id=$1 AND d.case_id=$2 AND d.created_by=$3 AND d.idempotency_key=$4`,[actor.tenantId,caseId,actor.userId,input.idempotencyKey])).rows[0];
      if(old?.rendition_id)throw new ApiError(409,'Disclosure retry differs.');
      if(old){const packageDigest=old.package_digest?.trim();if(old.revision_id!==revisionId||old.recipient_id!==input.recipientId||old.digest.trim()!==input.sha256||iso(old.expires_at)!==new Date(expiry).toISOString()||old.reason!==reason||(packageDigest??undefined)!==input.documentPackageSha256||Boolean(packageDigest)!==(input.confirmDocumentPackageVerified===true))throw new ApiError(409,'Disclosure retry differs.');return disclosureReceipt(old);}
      if(kase.status!=='Active'||!kase.authority_version||!['Active','Review','Released'].includes(kase.lifecycle_state))throw new ApiError(409,'Active approved authority and an open case stage required.');
      const clock=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime();
      if(expiry<=clock||expiry>clock+7*86400000)throw new ApiError(422,'Expiry must be within seven days.');
      const recipient=await client.query("SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role='client'",[actor.tenantId,input.recipientId]);if(!recipient.rowCount)throw new ApiError(422,'Recipient must be a client in this tenant.');
      const reviews=await client.query(`SELECT r.* FROM report_revision_reviews r JOIN memberships m ON m.tenant_id=r.tenant_id AND m.user_id=r.reviewer_id
       JOIN case_memberships cm ON cm.tenant_id=r.tenant_id AND cm.case_id=r.case_id AND cm.user_id=r.reviewer_id
       WHERE r.tenant_id=$1 AND r.case_id=$2 AND r.revision_id=$3 AND m.role='reviewer' AND r.authority_version=$4 AND r.digest=$5`,[actor.tenantId,caseId,revisionId,kase.authority_version,input.sha256]);
      const rejected=await client.query("SELECT 1 FROM report_revision_reviews WHERE tenant_id=$1 AND case_id=$2 AND revision_id=$3 AND decision='request_changes' LIMIT 1",[actor.tenantId,caseId,revisionId]);
      if(rejected.rowCount||!reviews.rows.some(r=>r.decision==='accept_internal'))throw new ApiError(409,'Current independent acceptance and no change requests required.');
      const verified=await verifyFrozenSources(client,actor,caseId,revisionId,input.sha256);
      const documentFindings=(JSON.parse(verified.revision.report_bytes.toString('utf8')) as ReportDraft).documentFindings;
      let documentPackage:Awaited<ReturnType<typeof buildDocumentPackage>>|undefined;
      if(documentFindings?.length){
        if(!input.documentPackageSha256||input.confirmDocumentPackageVerified!==true)throw new ApiError(409,'Verify and confirm the exact document package before disclosure.');
        documentPackage=await buildDocumentPackage(client,actor,caseId,revisionId,input.sha256);
        if(documentPackage.packageDigest!==input.documentPackageSha256)throw new ApiError(409,'Document package fingerprint changed. Download and verify it again.');
      }else if(input.documentPackageSha256||input.confirmDocumentPackageVerified!==undefined)throw new ApiError(422,'A legacy report disclosure cannot attach a document package.');
      const row=(await client.query(`INSERT INTO report_disclosures(tenant_id,case_id,id,revision_id,recipient_id,created_by,idempotency_key,authority_version,digest,reason,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[actor.tenantId,caseId,randomUUID(),revisionId,input.recipientId,actor.userId,input.idempotencyKey,kase.authority_version,input.sha256,reason,new Date(expiry)])).rows[0];
      if(documentPackage)await client.query('INSERT INTO report_disclosure_packages(tenant_id,disclosure_id,report_digest,package_digest,package_bytes) VALUES($1,$2,$3,$4,$5)',[actor.tenantId,row.id,input.sha256,documentPackage.packageDigest,documentPackage.bytes]);
      await writeAudit(client,actor,caseId,'report.disclosed','report_disclosure',row.id,'Frozen deliverable disclosure approved',{revisionId,recipientId:input.recipientId,reportDigest:input.sha256,deliveryDigest:documentPackage?.packageDigest??input.sha256,deliverable:documentPackage?'document_package':'report_json',fullDisclosureConfirmed:true});return disclosureReceipt({...row,package_digest:documentPackage?.packageDigest});
    });
  });
  app.post('/api/cases/:caseId/disclosures/:disclosureId/revoke',{preHandler:requireCsrf,schema:{params:disclosureParams,body:{type:'object',additionalProperties:false,required:['reason'],properties:{reason:{type:'string',minLength:10,maxLength:2000}}}}},async(request,reply)=>{
    reply.header('Cache-Control','no-store');const actor=request.actor!,{caseId,disclosureId}=request.params as {caseId:string;disclosureId:string},reason=(request.body as {reason:string}).reason.trim();
    if(actor.role!=='reviewer')throw new ApiError(403,'Reviewer required.');if(reason.length<10)throw new ApiError(422,'Explain revocation.');
    return inTransaction(options.pool,async client=>{
      await findCase(client,actor,caseId,true);const row=(await client.query('SELECT * FROM report_disclosures WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[actor.tenantId,caseId,disclosureId])).rows[0];if(!row)notFound();
      const inserted=await client.query('INSERT INTO report_disclosure_revocations VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING disclosure_id',[actor.tenantId,disclosureId,actor.userId,reason]);
      if(inserted.rowCount)await writeAudit(client,actor,caseId,'report.disclosure_revoked','report_disclosure',disclosureId,'Recipient disclosure revoked');return {id:disclosureId,caseId,status:'revoked'};
    });
  });
  // Shared by discovery and download; discovery is not an integrity or delivery receipt.
  const disclosureEligibility=`c.status='Active' AND c.authority_version=d.authority_version
       AND NOT EXISTS(SELECT 1 FROM report_revision_reviews rr WHERE rr.tenant_id=d.tenant_id AND rr.case_id=d.case_id AND rr.revision_id=d.revision_id AND rr.decision='request_changes')
       AND EXISTS(SELECT 1 FROM memberships m JOIN case_memberships cm ON cm.tenant_id=m.tenant_id AND cm.user_id=m.user_id WHERE m.tenant_id=d.tenant_id AND m.user_id=d.created_by AND m.role='reviewer' AND cm.case_id=d.case_id)
       AND NOT EXISTS(SELECT 1 FROM report_disclosure_revocations v WHERE v.tenant_id=d.tenant_id AND v.disclosure_id=d.id)
       AND (dr.rendition_id IS NULL OR (
         EXISTS(SELECT 1 FROM report_rendition_reviews rr JOIN memberships rm ON rm.tenant_id=rr.tenant_id AND rm.user_id=rr.reviewer_id JOIN case_memberships rc ON rc.tenant_id=rr.tenant_id AND rc.user_id=rr.reviewer_id AND rc.case_id=rr.case_id
          WHERE rr.tenant_id=d.tenant_id AND rr.case_id=d.case_id AND rr.rendition_id=dr.rendition_id AND rr.authority_version=d.authority_version AND rr.pdf_digest=pr.pdf_digest AND rr.redaction_digest=pr.redaction_digest AND rr.decision='accept_for_disclosure' AND rm.role='reviewer')
         AND NOT EXISTS(SELECT 1 FROM report_rendition_reviews rr WHERE rr.tenant_id=d.tenant_id AND rr.case_id=d.case_id AND rr.rendition_id=dr.rendition_id AND rr.decision='request_changes')))`;
  registerCaseLifecycle(app,{pool:options.pool,authenticate,requireCsrf,findCase,audit:writeAudit,disclosures:async(c,a,caseId,id)=>(await c.query(`SELECT d.id,d.created_at AS "createdAt" FROM report_disclosures d JOIN cases c ON c.tenant_id=d.tenant_id AND c.id=d.case_id ${pdfDisclosureJoin} WHERE d.tenant_id=$1 AND d.case_id=$2 AND ($3::uuid IS NULL OR d.id=$3) AND d.expires_at>clock_timestamp() AND ${disclosureEligibility} AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=d.tenant_id AND m.user_id=d.recipient_id AND m.role='client') ORDER BY d.created_at DESC,d.id DESC LIMIT 50`,[a.tenantId,caseId,id??null])).rows});
  app.get('/api/cases/:caseId/disclosures',{preHandler:authenticate,schema:{params:caseParamsSchema,querystring:{type:'object',additionalProperties:false,properties:{before:uuidSchema,limit:{type:'integer',minimum:1,maximum:50,default:25}}}}},async(request,reply)=>{
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff');
    const actor=request.actor!,{caseId}=request.params as {caseId:string};
    if(actor.role!=='reviewer')throw new ApiError(403,'Reviewer required.');
    const {before,limit=25}=request.query as {before?:string;limit?:number};
    return reportTransaction(async client=>{
      await findCase(client,actor,caseId);
      if(before){const anchor=await client.query('SELECT 1 FROM report_disclosures WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[actor.tenantId,caseId,before]);if(!anchor.rowCount)notFound();}
      const rows=await client.query(`SELECT d.*,p.package_digest,dr.rendition_id,pr.pdf_digest,v.revoked_by,v.reason AS revocation_reason,v.created_at AS revoked_at,a.acknowledged_at,
        (d.expires_at>clock_timestamp() AND ${disclosureEligibility} AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=d.tenant_id AND m.user_id=d.recipient_id AND m.role='client')) AS access_policy_eligible
        FROM report_disclosures d JOIN cases c ON c.tenant_id=d.tenant_id AND c.id=d.case_id
        LEFT JOIN report_disclosure_packages p ON p.tenant_id=d.tenant_id AND p.disclosure_id=d.id ${pdfDisclosureJoin}
        LEFT JOIN report_disclosure_revocations v ON v.tenant_id=d.tenant_id AND v.disclosure_id=d.id
        LEFT JOIN report_disclosure_acknowledgements a ON a.tenant_id=d.tenant_id AND a.disclosure_id=d.id
        WHERE d.tenant_id=$1 AND d.case_id=$2 AND ($3::uuid IS NULL OR (d.created_at,d.id)<(SELECT created_at,id FROM report_disclosures WHERE tenant_id=$1 AND case_id=$2 AND id=$3))
        ORDER BY d.created_at DESC,d.id DESC LIMIT $4`,[actor.tenantId,caseId,before??null,limit+1]);
      return {items:rows.rows.slice(0,limit).map(r=>({...disclosureReceipt(r),createdBy:r.created_by,reason:r.reason,accessPolicyEligible:r.access_policy_eligible,acknowledgedAt:r.acknowledged_at?iso(r.acknowledged_at):null,revocation:r.revoked_at?{revokedBy:r.revoked_by,reason:r.revocation_reason,createdAt:iso(r.revoked_at)}:null})),nextBefore:rows.rows.length>limit?rows.rows[limit-1]!.id:null};
    });
  });
  app.get('/api/portal/disclosures',{preHandler:authenticate,schema:{querystring:{type:'object',additionalProperties:false,properties:{before:uuidSchema,limit:{type:'integer',minimum:1,maximum:50,default:25}}}}},async(request,reply)=>{
    reply.header('Cache-Control','no-store');reply.header('X-Content-Type-Options','nosniff');
    const actor=request.actor!;
    if(actor.role!=='client')throw new ApiError(403,'Client recipient required.');
    const {before,limit=25}=request.query as {before?:string;limit?:number};
    return reportTransaction(async client=>{
      // An owned historical anchor remains usable after expiry/revocation, but foreign anchors never do.
      if(before){const anchor=await client.query('SELECT 1 FROM report_disclosures WHERE tenant_id=$1 AND recipient_id=$2 AND id=$3',[actor.tenantId,actor.userId,before]);if(!anchor.rowCount)notFound();}
      const rows=await client.query(`SELECT d.id,d.revision_id,d.digest,p.package_digest,dr.rendition_id,pr.pdf_digest,d.created_at,d.expires_at
        FROM report_disclosures d JOIN cases c ON c.tenant_id=d.tenant_id AND c.id=d.case_id
        LEFT JOIN report_disclosure_packages p ON p.tenant_id=d.tenant_id AND p.disclosure_id=d.id ${pdfDisclosureJoin}
        WHERE d.tenant_id=$1 AND d.recipient_id=$2 AND d.expires_at>clock_timestamp()
        AND ${disclosureEligibility}
        AND ($3::uuid IS NULL OR (d.created_at,d.id)<(SELECT created_at,id FROM report_disclosures WHERE tenant_id=$1 AND recipient_id=$2 AND id=$3))
        ORDER BY d.created_at DESC,d.id DESC LIMIT $4`,[actor.tenantId,actor.userId,before??null,limit+1]);
      return {items:rows.rows.slice(0,limit).map(r=>({id:r.id,revisionId:r.revision_id,sha256:r.pdf_digest?.trim()??r.package_digest?.trim()??r.digest.trim(),reportSha256:r.digest.trim(),deliverable:r.rendition_id?'report_pdf':r.package_digest?'document_package':'report_json',createdAt:iso(r.created_at),expiresAt:iso(r.expires_at)})),nextBefore:rows.rows.length>limit?rows.rows[limit-1]!.id:null};
    });
  });
  async function disclosureDelivery(client:PoolClient,row:QueryResultRow){
    checkRevision(row);const reportDigest=row.digest.trim();
    if(row.rendition_id){
      if(row.package_bytes)throw new ApiError(409,'Disclosure has conflicting deliverables.');
      const rendition=(await client.query('SELECT * FROM report_renditions WHERE tenant_id=$1 AND case_id=$2 AND revision_id=$3 AND id=$4',[row.tenant_id,row.case_id,row.revision_id,row.rendition_id])).rows[0];
      if(!rendition)throw new ApiError(409,'Released PDF is missing.');const checked=checkedPdf(row.report_bytes,rendition);
      return {bytes:checked.bytes,digest:checked.digest,deliverable:'report_pdf' as const,header:'X-INVEOS-PDF-SHA256'};
    }
    if(!row.package_bytes)return {bytes:row.report_bytes as Buffer,digest:reportDigest,deliverable:'report_json' as const,header:'X-INVEOS-Report-SHA256'};
    const bytes=row.package_bytes as Buffer,packageDigest=row.package_digest?.trim();
    if(!packageDigest||row.report_digest?.trim()!==reportDigest||createHash('sha256').update(bytes).digest('hex')!==packageDigest)throw new ApiError(409,'Released document package integrity verification failed.');
    let value:Record<string,unknown>;try{value=JSON.parse(bytes.toString('utf8')) as Record<string,unknown>;}catch{throw new ApiError(409,'Released document package structure is invalid.');}
    if(value.format!=='inveos_document_report_package_v1'||value.reportSha256!==reportDigest||typeof value.reportBase64!=='string')throw new ApiError(409,'Released document package structure is invalid.');
    const encoded=value.reportBase64;if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))throw new ApiError(409,'Released document package structure is invalid.');
    const embedded=Buffer.from(encoded,'base64');if(embedded.toString('base64')!==encoded||!embedded.equals(row.report_bytes)||createHash('sha256').update(embedded).digest('hex')!==reportDigest)throw new ApiError(409,'Released document package report binding failed.');
    return {bytes,digest:packageDigest,deliverable:'document_package' as const,header:'X-INVEOS-Package-SHA256'};
  }
  app.post('/api/portal/disclosures/:disclosureId/acknowledge',{preHandler:requireSessionCsrf,schema:{params:{type:'object',additionalProperties:false,required:['disclosureId'],properties:{disclosureId:uuidSchema}},body:{type:'object',additionalProperties:false,required:['sha256','confirmReceipt'],properties:{sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},confirmReceipt:{const:true}}}}},async(request,reply)=>{
    reply.header('Cache-Control','no-store');const actor=request.actor!,{disclosureId}=request.params as {disclosureId:string};
    if(actor.role!=='client')throw new ApiError(403,'Client recipient required.');
    const {sha256:expected}=request.body as {sha256:string};
    return inTransaction(options.pool,async client=>{
      // Match recipient before locking, then serialise with case authority and grant revocation.
      const scope=await client.query('SELECT case_id FROM report_disclosures WHERE tenant_id=$1 AND recipient_id=$2 AND id=$3',[actor.tenantId,actor.userId,disclosureId]);
      if(!scope.rows[0])notFound();await client.query('SELECT id FROM cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[actor.tenantId,scope.rows[0].case_id]);
      const found=await client.query(`SELECT d.*,r.report_bytes,p.report_digest,p.package_digest,p.package_bytes,dr.rendition_id,pr.pdf_digest FROM report_disclosures d JOIN cases c ON c.tenant_id=d.tenant_id AND c.id=d.case_id
        JOIN report_revisions r ON r.tenant_id=d.tenant_id AND r.case_id=d.case_id AND r.id=d.revision_id
        LEFT JOIN report_disclosure_packages p ON p.tenant_id=d.tenant_id AND p.disclosure_id=d.id ${pdfDisclosureJoin}
        WHERE d.tenant_id=$1 AND d.recipient_id=$2 AND d.id=$3 AND d.expires_at>clock_timestamp() AND ${disclosureEligibility}`,[actor.tenantId,actor.userId,disclosureId]);
      const grant=found.rows[0];if(!grant)notFound();const delivery=await disclosureDelivery(client,grant);
      if(delivery.digest!==expected)throw new ApiError(409,'Disclosure fingerprint changed.');
      const inserted=await client.query(`INSERT INTO report_disclosure_acknowledgements(tenant_id,disclosure_id,recipient_id,digest) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING acknowledged_at`,[actor.tenantId,disclosureId,actor.userId,expected]);
      if(inserted.rowCount)await writeAudit(client,actor,grant.case_id,'report.disclosure_acknowledged','report_disclosure',disclosureId,'Recipient explicitly acknowledged receipt',{digest:expected});
      const receipt=inserted.rows[0]??(await client.query('SELECT acknowledged_at FROM report_disclosure_acknowledgements WHERE tenant_id=$1 AND disclosure_id=$2',[actor.tenantId,disclosureId])).rows[0];
      return {disclosureId,sha256:expected,acknowledgedAt:iso(receipt.acknowledged_at),status:'recipient_acknowledged_receipt'};
    });
  });
  app.get('/api/portal/disclosures/:disclosureId',{preHandler:authenticate,schema:{params:{type:'object',additionalProperties:false,required:['disclosureId'],properties:{disclosureId:uuidSchema}}}},async(request,reply)=>{
    reply.header('Cache-Control','no-store');reply.header('X-Content-Type-Options','nosniff');const actor=request.actor!,{disclosureId}=request.params as {disclosureId:string};
    if(actor.role!=='client')throw new ApiError(403,'Client recipient required.');
    const row=await inTransaction(options.pool,async client=>{
      const found=await client.query(`SELECT d.*,r.report_bytes,p.report_digest,p.package_digest,p.package_bytes,dr.rendition_id,pr.pdf_digest FROM report_disclosures d JOIN report_revisions r ON r.tenant_id=d.tenant_id AND r.case_id=d.case_id AND r.id=d.revision_id
       JOIN cases c ON c.tenant_id=d.tenant_id AND c.id=d.case_id
       LEFT JOIN report_disclosure_packages p ON p.tenant_id=d.tenant_id AND p.disclosure_id=d.id ${pdfDisclosureJoin}
       WHERE d.tenant_id=$1 AND d.id=$2 AND d.recipient_id=$3 AND d.expires_at>clock_timestamp()
       AND ${disclosureEligibility}`,[actor.tenantId,disclosureId,actor.userId]);
      const value=found.rows[0];if(!value)notFound();const delivery=await disclosureDelivery(client,value);
      await writeAudit(client,actor,value.case_id,'report.disclosure_downloaded','report_disclosure',disclosureId,'Recipient deliverable prepared for download',{reportDigest:value.digest.trim(),deliveryDigest:delivery.digest,deliverable:delivery.deliverable});return {...value,delivery};
    });
    if(row.delivery.deliverable==='report_pdf')reply.header('X-INVEOS-Report-SHA256',row.digest.trim());
    return reply.header('Content-Disposition',`attachment; filename="disclosure-${disclosureId}.${row.delivery.deliverable==='report_pdf'?'pdf':'json'}"`).header(row.delivery.header,row.delivery.digest).type(row.delivery.deliverable==='report_pdf'?'application/pdf':'application/json').send(row.delivery.bytes);
  });
  app.post('/api/cases/:caseId/report-revisions/:revisionId/verify-sources',{preHandler:requireCsrf,schema:{params:reviewParams,body:{type:'object',additionalProperties:false,required:['sha256'],properties:{sha256:{type:'string',pattern:'^[a-f0-9]{64}$'}}}}},async(request,reply)=>{
    reply.header('Cache-Control','no-store');reply.header('X-Content-Type-Options','nosniff');
    const actor=request.actor!,{caseId,revisionId}=request.params as {caseId:string;revisionId:string},{sha256:expected}=request.body as {sha256:string};
    return reportTransaction(async client=>{
      await reportAccess(client,actor,caseId);
      const {ids}=await verifyFrozenSources(client,actor,caseId,revisionId,expected);
      const verificationId=randomUUID();
      await writeAudit(client,actor,caseId,'report_revision.sources_verified','report_revision',revisionId,'Frozen cited sources reverified; not a release',{verificationId,digest:expected,findingCount:ids.length});
      return {verificationId,caseId,revisionId,sha256:expected,findingCount:ids.length,status:'snapshot_sources_verified_not_released'};
    });
  });
  for(const method of ['GET','POST'] as const)app.route({method,url:'/api/cases/:caseId/report-revisions/:revisionId/reviews',preHandler:method==='GET'?authenticate:requireCsrf,
    schema:{params:reviewParams,...(method==='GET'?{}:{body:{type:'object',additionalProperties:false,required:['sha256','decision','reason'],properties:{sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},decision:{type:'string',enum:['accept_internal','request_changes']},reason:{type:'string',minLength:10,maxLength:2000}}}})},handler:async(request,reply)=>{
    reply.header('Cache-Control','no-store');const actor=request.actor!,{caseId,revisionId}=request.params as {caseId:string;revisionId:string};
    return inTransaction(options.pool,async client=>{
      await reportAccess(client,actor,caseId);
      const kase=await findCase(client,actor,caseId,method==='POST');
      const revision=(await client.query('SELECT * FROM report_revisions WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[actor.tenantId,caseId,revisionId])).rows[0];
      if(!revision)notFound();checkRevision(revision);
      const receipt=(row:QueryResultRow)=>({id:row.id,revisionId,caseId,reviewerId:row.reviewer_id,authorityVersion:row.authority_version,sha256:row.digest.trim(),decision:row.decision,reason:row.reason,createdAt:iso(row.created_at),status:'internal_review_not_release'});
      if(method==='GET'){
        const rows=await client.query('SELECT * FROM report_revision_reviews WHERE tenant_id=$1 AND case_id=$2 AND revision_id=$3 ORDER BY created_at,id LIMIT 51',[actor.tenantId,caseId,revisionId]);
        if(rows.rows.length>50)throw new ApiError(422,'Review listing limit exceeded.');
        return {items:rows.rows.map(receipt)};
      }
      if(actor.role!=='reviewer')throw new ApiError(403,'Reviewer required.');
      if(revision.created_by===actor.userId)throw new ApiError(403,'A different reviewer must review this frozen revision.');
      const input=request.body as {sha256:string;decision:string;reason:string};const reason=input.reason.trim();
      if(reason.length<10)throw new ApiError(422,'Explain the internal review decision.');
      if(input.sha256!==revision.digest.trim())throw new ApiError(409,'Review fingerprint does not match the frozen revision.');
      const keys=[actor.tenantId,caseId,revisionId,actor.userId];
      const prior=(await client.query('SELECT * FROM report_revision_reviews WHERE tenant_id=$1 AND case_id=$2 AND revision_id=$3 AND reviewer_id=$4',keys)).rows[0];
      if(prior){if(prior.decision!==input.decision||prior.reason!==reason)throw new ApiError(409,'Review already recorded. Freeze a new revision for a changed decision.');return receipt(prior);}
      if(kase.status!=='Active'||!kase.authority_version)throw new ApiError(409,'Active approved case authority required.');
      const row=(await client.query(`INSERT INTO report_revision_reviews(tenant_id,case_id,revision_id,reviewer_id,id,authority_version,digest,decision,reason)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[...keys,randomUUID(),kase.authority_version,input.sha256,input.decision,reason])).rows[0];
      await writeAudit(client,actor,caseId,'report_revision.reviewed','report_revision',revisionId,'Frozen internal draft reviewed; not released',{reviewId:row.id,digest:input.sha256,decision:input.decision,authorityVersion:kase.authority_version});
      return receipt(row);
    });
  }});
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
