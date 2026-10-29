import {createServer,request as proxyRequest} from 'node:http';
import {launchBrowser,eventually} from './support/browser.js';
import {uploadBinaryChunks} from '../../web/src/chunkUpload.js';
import {prepareBinary,binaryIntakeScope,sendBinaryRecoverably} from '../../web/src/binaryIntake.js';
import { fileURLToPath } from 'node:url';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { finishRasterJob, finishDocumentJob, claimIntegrityJob, renewIntegrityJob, dispatchIntegrityJobs, finishIntegrityJob, runIntegrityJob } from '../src/integrity-jobs.js';
import { createApp } from '../src/app.js';
import { runLeasedWorker } from '../src/leased-worker.js';
import {jobRequestScope,queueRecoverably} from '../../web/src/jobRequest.js';
import { inspectTextDerivative, type InspectionJob } from '../../web/src/derivativeInspection.js';
import { recoverableReportFreeze, reportRecoveryScope, type RecoveryStore } from '../../web/src/reportRecovery.js';
import { createPool, runMigrations } from '../src/db.js';
import type { Case, Evidence, ReportDraft, Workspace, WorkInput, WorkItem, WorkEdit, WorkLink, WorkRevision } from '@inveos/contracts';

type TestSession = {cookie: string; csrf: string};
type ApiContext = {
  app: FastifyInstance;
  pool: Pool;
  adminPool: Pool;
  schemaAdminPool: Pool;
  schema: string;
  storageRoot: string;
  demo: TestSession;
};
type ApiMethod = 'GET' | 'POST';
type ApiRequestOptions = {
  payload?: object | string | Buffer;
  csrfHeader?: boolean;
  contentType?: string;
  origin?: string;
  cookie?: string;
};
type SeededCase = {caseId: string; evidenceId: string; claimId: string};
type TestRole = 'reviewer' | 'investigator' | 'client';

const demoTenantId = '00000000-0000-4000-8000-000000000001';
const demoUserId = '00000000-0000-4000-8000-000000000002';
const localOrigin = 'http://localhost:5173';
const allowedOrigins = [localOrigin, 'http://127.0.0.1:5173'];
const databaseUrl = process.env.INVEOS_TEST_DATABASE_URL;
const adminDatabaseUrl = process.env.INVEOS_TEST_ADMIN_DATABASE_URL;
const context: Partial<ApiContext> = {};

function digest(value: string): string {
  return createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

function parseBody<T>(response: {body: string}): T {
  return JSON.parse(response.body) as T;
}

function assertError(response: {statusCode: number; body: string}, statusCode: number): void {
  assert.equal(response.statusCode, statusCode, response.body);
  const body = parseBody<Record<string, unknown>>(response);
  assert.equal(typeof body.error, 'string');
}

async function createAppInstance(epoch?:string): Promise<FastifyInstance> {
  const app = await createApp({
    pool: context.pool!,
    storageRoot: context.storageRoot!,
    allowedOrigins,
    demoTenantId,
    demoUserId,
    sessionTtlSeconds: 3600,
    sessionEpoch: epoch,
  });
  await app.ready();
  return app;
}

async function request(
  method: ApiMethod,
  url: string,
  session?: TestSession,
  options: ApiRequestOptions = {},
) {
  const headers: Record<string, string> = {};
  if (options.origin) {
    headers.origin = options.origin;
  } else if (method === 'POST') {
    headers.origin = localOrigin;
  }
  if (session) {
    headers.cookie = options.cookie ?? session.cookie;
    if (options.csrfHeader !== false && method === 'POST') {
      headers['x-csrf-token'] = session.csrf;
    }
  }
  if (method === 'POST' && options.contentType !== '') {
    headers['content-type'] = options.contentType ?? 'application/json';
  }
  return await context.app!.inject({
    method,
    url,
    headers,
    ...(options.payload === undefined ? {} : {payload: options.payload}),
  });
}

async function startDemoSession(): Promise<TestSession> {
  const response = await context.app!.inject({
    method: 'POST',
    url: '/api/session/start',
    headers: {origin: localOrigin, 'content-type': 'application/json'},
    payload: {},
  });
  assert.equal(response.statusCode, 200, response.body);
  const cookieHeaders = response.headers['set-cookie'];
  const cookieLines = Array.isArray(cookieHeaders) ? cookieHeaders : [cookieHeaders];
  const cookieParts = cookieLines
    .filter((value): value is string => Boolean(value))
    .map((value) => value.split(';', 1)[0]);
  assert.equal(cookieParts.length, 2);
  assert.match(cookieLines.join(' '), /inveos_session=.*HttpOnly/i);
  assert.match(cookieLines.join(' '), /SameSite=Strict/i);
  return {cookie: cookieParts.join('; '), csrf: parseBody<{csrf: string}>(response).csrf};
}

async function issueTestSession(userId: string, tenantId = demoTenantId): Promise<TestSession> {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(32).toString('base64url');
  await context.schemaAdminPool!.query(
    `INSERT INTO sessions (token_hash, id, csrf_hash, tenant_id, user_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + interval '1 hour')`,
    [digest(token), randomUUID(), digest(csrf), tenantId, userId],
  );
  return {cookie: `inveos_session=${token}; inveos_csrf=${csrf}`, csrf};
}

async function createMember(tenantId: string, role: TestRole, name: string): Promise<string> {
  const userId = randomUUID();
  await context.schemaAdminPool!.query('INSERT INTO users (id, display_name) VALUES ($1, $2)', [userId, name]);
  await context.schemaAdminPool!.query(
    'INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3)',
    [tenantId, userId, role],
  );
  return userId;
}

async function createCase(session = context.demo!, overrides: Partial<Case> = {}): Promise<Case> {
  const response = await request('POST', '/api/cases', session, {
    payload: {
      title: overrides.title ?? `Fictional review ${randomUUID().slice(0, 8)}`,
      client: overrides.client ?? 'Northstar Paperworks Ltd (fictional)',
      scope: overrides.scope ?? 'Review a synthetic supplier dispatch note.',
      jurisdiction: overrides.jurisdiction ?? 'England and Wales',
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  return parseBody<Case>(response);
}

function authorityInput(overrides: Record<string, unknown> = {}) {
  return {
    purpose: 'Review fictional supplier dispatch records',
    lawfulBasis: 'Synthetic demonstration only; no real data is processed.',
    scope: 'Review only the fictional dispatch note supplied for this test.',
    retentionDays: 365,
    minimisation: 'Use only the quoted synthetic dispatch detail needed for this test.',
    ...overrides,
  };
}

async function approveAuthority(
  caseId: string,
  session = context.demo!,
  overrides: Record<string, unknown> = {},
) {
  return request('POST', `/api/cases/${caseId}/authority`, session, {payload: authorityInput(overrides)});
}

function sourceText(): string {
  return '\uFEFFNorthstar dispatch note states:\n  batch NW-104 was packed on 2026-01-12.\n';
}

function evidenceInput(overrides: Record<string, unknown> = {}) {
  const text = sourceText();
  return {
    filename: 'fictional-dispatch-note.txt',
    text,
    expectedSha256: digest(text),
    sourceTime: '2026-01-12T09:00:00Z',
    method: 'Fictional commissioning-party text fixture',
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

async function uploadEvidence(
  caseId: string,
  session = context.demo!,
  input: ReturnType<typeof evidenceInput> = evidenceInput(),
) {
  return request('POST', `/api/cases/${caseId}/evidence`, session, {payload: input});
}

async function createClaim(caseId: string, evidenceId: string, session = context.demo!, quote?: string) {
  return request('POST', `/api/cases/${caseId}/claims`, session, {
    payload: {
      evidenceId,
      text: 'The fictional dispatch note records batch NW-104 as packed on the stated date.',
      quote: quote ?? '\n  batch NW-104 was packed on 2026-01-12.\n',
    },
  });
}

/** Administrative corruption fixture only; normal application permissions retain the guard. */
async function corruptClaim(sql: string, values: unknown[]) {
  await context.schemaAdminPool!.query('ALTER TABLE claims DISABLE TRIGGER claim_source_identity');
  try {await context.schemaAdminPool!.query(sql,values);} finally {
    await context.schemaAdminPool!.query('ALTER TABLE claims ENABLE TRIGGER claim_source_identity');
  }
}

async function createAssignedCase(
  tenantId: string,
  assignedUserId: string,
  ownerUserId = assignedUserId,
): Promise<SeededCase> {
  const caseId = randomUUID();
  const authorityId = randomUUID();
  const evidenceId = randomUUID();
  const claimId = randomUUID();
  const ref = `INV-TEST-${caseId.slice(0, 8)}`;
  await context.schemaAdminPool!.query(
    `INSERT INTO cases
       (tenant_id, id, ref, title, client, owner_user_id, scope, jurisdiction, status, authority_version)
     VALUES ($1, $2, $3, 'Fictional access boundary case', 'Synthetic tenant', $4,
             'Synthetic access boundary test only.', 'England and Wales', 'Active', NULL)`,
    [tenantId, caseId, ref, ownerUserId],
  );
  await context.schemaAdminPool!.query(
    'INSERT INTO case_memberships (tenant_id, case_id, user_id) VALUES ($1, $2, $3)',
    [tenantId, caseId, assignedUserId],
  );
  await context.schemaAdminPool!.query(
    `INSERT INTO authority_records
       (tenant_id, case_id, id, version, purpose, lawful_basis, scope, retention_days, minimisation, approved_by)
     VALUES ($1, $2, $3, 1, 'Fictional access-boundary test', 'Synthetic fixture only; no real data.',
             'Synthetic access boundary test only.', 30, 'Only synthetic records needed for this access test.', $4)`,
    [tenantId, caseId, authorityId, ownerUserId],
  );
  await context.schemaAdminPool!.query(
    'UPDATE cases SET authority_version = 1 WHERE tenant_id = $1 AND id = $2',
    [tenantId, caseId],
  );
  await context.schemaAdminPool!.query(
    `INSERT INTO evidence
       (tenant_id, case_id, id, authority_id, authority_version, filename, byte_length, source_time,
        method, digest, object_path, status, idempotency_key, request_hash, created_by)
     VALUES ($1, $2, $3, $4, 1, 'boundary-fixture.txt', 1, '2026-01-01T00:00:00Z',
             'Synthetic boundary fixture', $5, $6, 'Verified', $7, $8, $9)`,
    [
      tenantId,
      caseId,
      evidenceId,
      authorityId,
      'a'.repeat(64),
      `unavailable/${caseId}/${evidenceId}.txt`,
      randomUUID(),
      'b'.repeat(64),
      ownerUserId,
    ],
  );
  await context.schemaAdminPool!.query(
    `INSERT INTO claims
       (tenant_id, case_id, id, evidence_id, authority_id, authority_version, text, quote,
        source_start_byte, source_end_byte, source_digest, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 1, 'Synthetic boundary claim', 'x', 0, 1, $6, 'Under review', $7)`,
    [tenantId, caseId, claimId, evidenceId, authorityId, 'a'.repeat(64), ownerUserId],
  );
  return {caseId, evidenceId, claimId};
}

before(async () => {
  assert.ok(databaseUrl, 'INVEOS_TEST_DATABASE_URL must point to inveos_test');
  assert.ok(adminDatabaseUrl, 'INVEOS_TEST_ADMIN_DATABASE_URL must point to inveos_test');
  assert.match(databaseUrl, /\/inveos_test(?:\?|$)/);
  assert.match(adminDatabaseUrl, /\/inveos_test(?:\?|$)/);
  context.schema = `api_test_${randomUUID().replaceAll('-', '')}`;
  const localData = join(process.cwd(), '.local-data', 'objects-test');
  await mkdir(localData, {recursive: true, mode: 0o700});
  context.storageRoot = await mkdtemp(join(localData, 'run-'));
  context.adminPool = createPool(adminDatabaseUrl, 'public', 2);
  await runMigrations(context.adminPool, context.schema);
  context.schemaAdminPool = createPool(adminDatabaseUrl, context.schema, 4);
  context.pool = createPool(databaseUrl, context.schema, 8);
  context.app = await createAppInstance();
  context.demo = await startDemoSession();
});

after(async () => {
  await context.app?.close();
  await context.pool?.end();
  await context.schemaAdminPool?.end();
  if (context.schema) {
    await context.adminPool?.query(`DROP SCHEMA IF EXISTS "${context.schema}" CASCADE`);
  }
  await context.adminPool?.end();
  if (context.storageRoot) {
    await rm(context.storageRoot, {recursive: true, force: true});
  }
});

test('case, versioned authority, verified evidence, exact quote, review, report, and restart persist', async () => {
  const kase = await createCase();
  assert.equal(kase.status, 'Scope review');
  assert.equal(kase.authority, false);
  assert.equal(kase.owner, 'Synthetic reviewer');
  assert.equal(kase.due, 'Not set');
  assert.match(kase.ref, /^INV-\d{4}-[A-F0-9]{8}$/);

  const firstAuthorityResponse = await approveAuthority(kase.id);
  assert.equal(firstAuthorityResponse.statusCode, 200, firstAuthorityResponse.body);
  const firstAuthority = parseBody<{id: string; version: number}>(firstAuthorityResponse);
  assert.equal(firstAuthority.version, 1);

  const firstUploadInput = evidenceInput();
  const evidenceResponse = await uploadEvidence(kase.id, context.demo!, firstUploadInput);
  assert.equal(evidenceResponse.statusCode, 200, evidenceResponse.body);
  const evidence = parseBody<Evidence>(evidenceResponse);
  assert.equal(evidence.status, 'Verified');
  assert.equal(evidence.text, firstUploadInput.text);
  assert.equal(evidence.sourceTime, firstUploadInput.sourceTime);
  assert.notEqual(evidence.receivedTime, evidence.sourceTime);

  const row = await context.pool!.query(
    'SELECT object_path, authority_id, authority_version FROM evidence WHERE tenant_id = $1 AND case_id = $2 AND id = $3',
    [demoTenantId, kase.id, evidence.id],
  );
  assert.equal(row.rows[0].authority_id, firstAuthority.id);
  assert.equal(row.rows[0].authority_version, 1);
  const objectPath = resolve(context.storageRoot!, row.rows[0].object_path);
  assert.equal((await stat(objectPath)).mode & 0o777, 0o600);
  assert.equal((await stat(join(objectPath, '..'))).mode & 0o777, 0o700);

  const secondAuthorityResponse = await approveAuthority(kase.id, context.demo!, authorityInput({
    scope: 'A later and narrower fictional supplier inquiry.',
    retentionDays: 730,
    minimisation: 'Retain only the minimum source-linked fictional details for the later review.',
  }));
  assert.equal(secondAuthorityResponse.statusCode, 200, secondAuthorityResponse.body);
  assert.equal(parseBody<{version: number}>(secondAuthorityResponse).version, 2);

  const uncitedResponse = await uploadEvidence(kase.id, context.demo!, evidenceInput({
    filename: 'fictional-uncited-note.txt',
    text: 'A second fictional note with no claim or finding.',
    expectedSha256: digest('A second fictional note with no claim or finding.'),
    idempotencyKey: randomUUID(),
  }));
  assert.equal(uncitedResponse.statusCode, 200, uncitedResponse.body);

  const quote = '\n  batch NW-104 was packed on 2026-01-12.\n';
  const claimResponse = await createClaim(kase.id, evidence.id, context.demo!, quote);
  assert.equal(claimResponse.statusCode, 200, claimResponse.body);
  const claim = parseBody<{id: string; status: string}>(claimResponse);
  assert.equal(claim.status, 'Under review');
  const startByte = Buffer.byteLength(firstUploadInput.text.slice(0, firstUploadInput.text.indexOf(quote)), 'utf8');
  const storedClaim = await context.pool!.query(
    'SELECT source_start_byte, source_end_byte FROM claims WHERE tenant_id = $1 AND case_id = $2 AND id = $3',
    [demoTenantId, kase.id, claim.id],
  );
  assert.equal(storedClaim.rows[0].source_start_byte, startByte);
  assert.equal(storedClaim.rows[0].source_end_byte, startByte + Buffer.byteLength(quote, 'utf8'));

  const reviewResponse = await request('POST', `/api/cases/${kase.id}/claims/${claim.id}/review`, context.demo!, {
    payload: {accepted: true, reason: 'The exact synthetic source span supports this claim.'},
  });
  assert.equal(reviewResponse.statusCode, 200, reviewResponse.body);

  const reportResponse = await request('GET', `/api/cases/${kase.id}/report`, context.demo!);
  assert.equal(reportResponse.statusCode, 200, reportResponse.body);
  const report = parseBody<ReportDraft>(reportResponse);
  const reportFinding = report.findings[0]!;
  assert.equal(report.status, 'draft_not_released');
  assert.equal(report.findings.length, 1);
  assert.equal(reportFinding.source.id, evidence.id);
  assert.equal(reportFinding.source.quote, quote);
  assert.equal(reportFinding.source.startByte, startByte);
  assert.equal(reportFinding.source.contentBase64, Buffer.from(firstUploadInput.text).toString('base64'));
  assert.equal(reportFinding.source.policy.authorityId, firstAuthority.id);
  assert.equal(reportFinding.source.policy.authorityVersion, 1);
  assert.equal(reportFinding.source.policy.retentionDays, 365);
  assert.equal(reportFinding.source.policy.minimisation, authorityInput().minimisation);
  assert.notEqual(report.case.scope, reportFinding.source.policy.scope);
  assert.equal(JSON.stringify(report).includes('fictional-uncited-note.txt'), false);
  assert.equal(JSON.stringify(report).includes(context.storageRoot!), false);
  assert.match(report.limitations, /not a signed custody certificate/i);

  // Verify the actual API response outside Node, without database access.
  const reportPath = join(context.storageRoot!, 'synthetic-report.json');
  await writeFile(reportPath, reportResponse.body, 'utf8');
  const verifier = new URL('../../../tools/verify_report.py', import.meta.url);
  const verifyArgs = [fileURLToPath(verifier), reportPath, '--expected-sha256', digest(reportResponse.body),
    '--expected-case-id', kase.id];
  const verified = spawnSync('python3', verifyArgs, {encoding: 'utf8'});
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).trustedReportDigestMatched, true);
  // Package the real API export, then verify offline without extracting it.
  const packager = fileURLToPath(new URL('../../../tools/report_package.py', import.meta.url));
  const packagePath = join(context.storageRoot!, 'synthetic-exhibits.zip');
  const packaged = spawnSync('python3', [packager, 'build', reportPath, packagePath,
    '--expected-report-sha256', digest(reportResponse.body), '--expected-case-id', kase.id], {encoding: 'utf8'});
  assert.equal(packaged.status, 0, packaged.stderr);
  const packageReceipt = JSON.parse(packaged.stdout);
  assert.equal(packageReceipt.status, 'package_created');
  assert.equal((await stat(packagePath)).mode & 0o777, 0o600);
  const packageArgs = [packager, 'verify', packagePath,
    '--expected-manifest-sha256', packageReceipt.manifestSha256, '--expected-case-id', kase.id];
  const packageVerified = spawnSync('python3', packageArgs, {encoding: 'utf8'});
  assert.equal(packageVerified.status, 0, packageVerified.stderr);
  assert.equal(JSON.parse(packageVerified.stdout).originalsChecked, 1);
  assert.equal(JSON.parse(packageVerified.stdout).trustedManifestDigestMatched, true);
  const corruptedPackage = await readFile(packagePath);
  const originalOffset = corruptedPackage.indexOf(Buffer.from(firstUploadInput.text));
  assert.notEqual(originalOffset, -1);
  corruptedPackage[originalOffset] = corruptedPackage[originalOffset]! ^ 1;
  await writeFile(packagePath, corruptedPackage);
  const packageRejected = spawnSync('python3', packageArgs, {encoding: 'utf8'});
  assert.equal(packageRejected.status, 1, packageRejected.stderr);
  assert.equal(JSON.parse(packageRejected.stderr).status, 'package_operation_failed');
  assert.equal(await readFile(reportPath, 'utf8'), reportResponse.body);

  const changedReport = structuredClone(report);
  changedReport.findings[0]!.text = 'Altered fictional narrative';
  await writeFile(reportPath, JSON.stringify(changedReport), 'utf8');
  const rejected = spawnSync('python3', verifyArgs, {encoding: 'utf8'});
  assert.equal(rejected.status, 1, rejected.stderr);
  assert.equal(JSON.parse(rejected.stderr).error, 'Report digest mismatch');


  const audit = await context.pool!.query(
    'SELECT count(*)::int AS count FROM audit_events WHERE tenant_id = $1 AND case_id = $2',
    [demoTenantId, kase.id],
  );
  assert.equal(audit.rows[0].count, 7);
  await assert.rejects(
    context.schemaAdminPool!.query(
      'UPDATE evidence SET filename = $4 WHERE tenant_id = $1 AND case_id = $2 AND id = $3',
      [demoTenantId, kase.id, evidence.id, 'changed.txt'],
    ),
    (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === '55000'),
  );

  const workspaceResponse = await request('GET', '/api/workspace', context.demo!);
  assert.equal(workspaceResponse.statusCode, 200, workspaceResponse.body);
  const workspace = parseBody<Workspace>(workspaceResponse);
  assert.equal(workspace.cases.some((item) => item.id === kase.id && item.authority), true);
  assert.equal(workspace.evidence.length, 2);
  assert.equal(workspace.activity.length, 7);
  assert.equal(JSON.stringify(workspace).includes(context.storageRoot!), false);

  await context.app!.close();
  context.app = await createAppInstance();
  const restartedReport = await request('GET', `/api/cases/${kase.id}/report`, context.demo!);
  assert.equal(restartedReport.statusCode, 200, restartedReport.body);
  assert.equal(parseBody<ReportDraft>(restartedReport).findings[0]!.source.policy.authorityVersion, 1);
});

test('session, Origin, CSRF, JSON schema, scope, hash, text, and authority bounds fail closed', async () => {
  assertError(await request('GET', '/api/workspace'), 401);
  const badOrigin = await context.app!.inject({
    method: 'POST',
    url: '/api/session/start',
    headers: {origin: 'https://untrusted.example', 'content-type': 'application/json'},
    payload: {},
  });
  assertError(badOrigin, 403);
  const missingOrigin = await context.app!.inject({
    method: 'POST',
    url: '/api/session/start',
    headers: {'content-type': 'application/json'},
    payload: {},
  });
  assertError(missingOrigin, 403);
  const selectableIdentity = await context.app!.inject({
    method: 'POST',
    url: '/api/session/start',
    headers: {origin: localOrigin, 'content-type': 'application/json'},
    payload: {tenantId: randomUUID()},
  });
  assertError(selectableIdentity, 422);

  const noCsrf = await request('POST', '/api/cases', context.demo!, {
    csrfHeader: false,
    payload: {
      title: 'Fictional missing CSRF case',
      client: 'Synthetic client',
      scope: 'Fictional test scope description.',
      jurisdiction: 'England and Wales',
    },
  });
  assertError(noCsrf, 403);
  const mismatchedCsrfCookie = await request('POST', '/api/cases', context.demo!, {
    cookie: `${context.demo!.cookie.split('; ')[0]}; inveos_csrf=not-the-session-token`,
    payload: {
      title: 'Fictional mismatched CSRF case',
      client: 'Synthetic client',
      scope: 'Fictional test scope description.',
      jurisdiction: 'England and Wales',
    },
  });
  assertError(mismatchedCsrfCookie, 403);

  const nonJson = await request('POST', '/api/cases', context.demo!, {
    contentType: 'text/plain',
    payload: 'not-json',
  });
  assertError(nonJson, 415);
  const malformedJson = await request('POST', '/api/cases', context.demo!, {
    payload: '{"title":',
  });
  assertError(malformedJson, 400);

  const noAuthorityCase = await createCase();
  assertError(await uploadEvidence(noAuthorityCase.id), 409);
  const invalidAuthority = await approveAuthority(noAuthorityCase.id, context.demo!, {retentionDays: 0});
  assertError(invalidAuthority, 422);
  const authorityResponse = await approveAuthority(noAuthorityCase.id);
  assert.equal(authorityResponse.statusCode, 200, authorityResponse.body);

  const hashInput = evidenceInput({expectedSha256: '0'.repeat(64)});
  assertError(await uploadEvidence(noAuthorityCase.id, context.demo!, hashInput), 422);
  const invalidUnicodeText = '\uD800';
  const invalidUnicode = evidenceInput({
    text: invalidUnicodeText,
    expectedSha256: digest('\uFFFD'),
  });
  assertError(await uploadEvidence(noAuthorityCase.id, context.demo!, invalidUnicode), 422);
  assertError(
    await uploadEvidence(noAuthorityCase.id, context.demo!, evidenceInput({filename: 'not-a-source.pdf'})),
    422,
  );
  assertError(
    await uploadEvidence(noAuthorityCase.id, context.demo!, evidenceInput({sourceTime: 'not-a-timestamp'})),
    422,
  );
  assertError(
    await uploadEvidence(noAuthorityCase.id, context.demo!, evidenceInput({sourceTime: '2026-02-30T09:00:00Z'})),
    422,
  );
  assertError(
    await uploadEvidence(noAuthorityCase.id, context.demo!, evidenceInput({sourceTime: '2026/02/28 09:00:00Z'})),
    422,
  );
  const offsetCase = await createCase();
  assert.equal((await approveAuthority(offsetCase.id)).statusCode, 200);
  const offsetTimestamp = '2026-01-12T10:30:00+01:30';
  const offsetEvidence = await uploadEvidence(offsetCase.id, context.demo!, evidenceInput({sourceTime: offsetTimestamp}));
  assert.equal(offsetEvidence.statusCode, 200, offsetEvidence.body);
  assert.equal(parseBody<Evidence>(offsetEvidence).sourceTime, offsetTimestamp);
  const tooLarge = evidenceInput({text: 'x'.repeat(256 * 1024 + 1)});
  tooLarge.expectedSha256 = digest(String(tooLarge.text));
  assertError(await uploadEvidence(noAuthorityCase.id, context.demo!, tooLarge), 422);
  const controlInput = evidenceInput({text: 'invalid\u0000source'});
  controlInput.expectedSha256 = digest(String(controlInput.text));
  assertError(await uploadEvidence(noAuthorityCase.id, context.demo!, controlInput), 422);
  const oversizedJson = await request('POST', '/api/cases', context.demo!, {
    payload: {
      title: 'Fictional oversized JSON request',
      client: 'Synthetic client',
      scope: 'Fictional test scope description.',
      jurisdiction: 'England and Wales',
      extra: 'x'.repeat(2 * 1024 * 1024),
    },
  });
  assertError(oversizedJson, 413);

  const count = await context.pool!.query(
    'SELECT count(*)::int AS count FROM evidence WHERE tenant_id = $1 AND case_id = $2',
    [demoTenantId, noAuthorityCase.id],
  );
  assert.equal(count.rows[0].count, 0);
});

test('session, Origin rate-limit responses keep retry headers and safe JSON', async () => {
  const app = await createAppInstance();
  const startSession = () => app.inject({
    method: 'POST',
    url: '/api/session/start',
    headers: {origin: localOrigin, 'content-type': 'application/json'},
    payload: {},
  });

  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await startSession();
      assert.equal(response.statusCode, 200, response.body);
    }
    const limited = await startSession();
    assertError(limited, 429);
    assert.match(limited.headers['retry-after'] ?? '', /^\d+$/);
    assert.deepEqual(Object.keys(parseBody<Record<string, unknown>>(limited)), ['error']);
  } finally {
    await app.close();
  }
});

test('identical idempotent uploads replay one receipt and changed retries conflict', async () => {
  const kase = await createCase();
  assert.equal((await approveAuthority(kase.id)).statusCode, 200);
  const input = evidenceInput();
  const concurrent = await Promise.all([
    uploadEvidence(kase.id, context.demo!, input),
    uploadEvidence(kase.id, context.demo!, input),
  ]);
  assert.deepEqual(concurrent.map((response) => response.statusCode), [200, 200]);
  const ids = concurrent.map((response) => parseBody<Evidence>(response).id);
  assert.equal(ids[0], ids[1]);
  const replay = await uploadEvidence(kase.id, context.demo!, input);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(parseBody<Evidence>(replay).id, ids[0]);

  const changedText = 'Changed fictional source text using the same idempotency key.';
  const changedRequest = evidenceInput({
    ...input,
    text: changedText,
    expectedSha256: digest(changedText),
  });
  assertError(await uploadEvidence(kase.id, context.demo!, changedRequest), 409);
  const count = await context.pool!.query(
    'SELECT count(*)::int AS count FROM evidence WHERE tenant_id = $1 AND case_id = $2',
    [demoTenantId, kase.id],
  );
  assert.equal(count.rows[0].count, 1);
});

test('exact source links, reviewer roles, serialized decisions, unsupported claims, and rejection are enforced', async () => {
  const kase = await createCase();
  assert.equal((await approveAuthority(kase.id)).statusCode, 200);
  const evidence = parseBody<Evidence>(await uploadEvidence(kase.id));

  const wrongQuote = await createClaim(kase.id, evidence.id, context.demo!, 'batch NW-104 was not packed');
  assertError(wrongQuote, 422);
  const whitespaceQuote = await createClaim(kase.id, evidence.id, context.demo!, ' \n\t ');
  assertError(whitespaceQuote, 422);

  const claim = parseBody<{id: string}>(await createClaim(kase.id, evidence.id));
  const investigatorId = await createMember(demoTenantId, 'investigator', 'Synthetic investigator');
  await context.schemaAdminPool!.query(
    'INSERT INTO case_memberships (tenant_id, case_id, user_id) VALUES ($1, $2, $3)',
    [demoTenantId, kase.id, investigatorId],
  );
  const investigator = await issueTestSession(investigatorId);
  assertError(await approveAuthority(kase.id, investigator), 403);
  assertError(
    await request('POST', `/api/cases/${kase.id}/claims/${claim.id}/review`, investigator, {
      payload: {accepted: true, reason: 'Investigator cannot decide findings.'},
    }),
    403,
  );

  const simultaneous = await Promise.all([
    request('POST', `/api/cases/${kase.id}/claims/${claim.id}/review`, context.demo!, {
      payload: {accepted: true, reason: 'Exact source span reviewed.'},
    }),
    request('POST', `/api/cases/${kase.id}/claims/${claim.id}/review`, context.demo!, {
      payload: {accepted: true, reason: 'Exact source span reviewed.'},
    }),
  ]);
  assert.deepEqual(simultaneous.map((response) => response.statusCode), [200, 200]);
  const decisionIds = simultaneous.map((response) => parseBody<{id: string; findingId: string}>(response));
  assert.equal(decisionIds[0]!.id, decisionIds[1]!.id);
  assert.equal(decisionIds[0]!.findingId, decisionIds[1]!.findingId);
  assertError(
    await request('POST', `/api/cases/${kase.id}/claims/${claim.id}/review`, context.demo!, {
      payload: {accepted: false, reason: 'Conflicting second decision.'},
    }),
    409,
  );

  const unsupported = parseBody<{id: string}>(await createClaim(kase.id, evidence.id, context.demo!, 'Northstar'));
  await corruptClaim(
    'UPDATE claims SET quote = $4 WHERE tenant_id = $1 AND case_id = $2 AND id = $3',
    [demoTenantId, kase.id, unsupported.id, 'This text is not in the original.'],
  );
  assertError(
    await request('POST', `/api/cases/${kase.id}/claims/${unsupported.id}/review`, context.demo!, {
      payload: {accepted: true, reason: 'Unsupported source quote must fail.'},
    }),
    409,
  );
  const unsupportedReview = await context.pool!.query(
    'SELECT count(*)::int AS count FROM reviews WHERE tenant_id = $1 AND case_id = $2 AND claim_id = $3',
    [demoTenantId, kase.id, unsupported.id],
  );
  assert.equal(unsupportedReview.rows[0].count, 0);

  const rejectedClaim = parseBody<{id: string}>(await createClaim(kase.id, evidence.id, context.demo!, 'Northstar dispatch note'));
  const rejected = await request('POST', `/api/cases/${kase.id}/claims/${rejectedClaim.id}/review`, context.demo!, {
    payload: {accepted: false, reason: 'Rejected for this synthetic review test.'},
  });
  assert.equal(rejected.statusCode, 200, rejected.body);
  assert.equal(parseBody<{findingId?: string}>(rejected).findingId, undefined);
  const findings = await context.pool!.query(
    'SELECT count(*)::int AS count FROM findings WHERE tenant_id = $1 AND case_id = $2',
    [demoTenantId, kase.id],
  );
  assert.equal(findings.rows[0].count, 1);
  const reviews = await context.pool!.query(
    'SELECT count(*)::int AS count FROM reviews WHERE tenant_id = $1 AND case_id = $2',
    [demoTenantId, kase.id],
  );
  assert.equal(reviews.rows[0].count, 2);
});

test('foreign-tenant and same-tenant unassigned cases cannot leak originals, reviews, or reports', async () => {
  const unassignedUser = await createMember(demoTenantId, 'investigator', 'Synthetic assigned owner');
  const unassigned = await createAssignedCase(demoTenantId, unassignedUser);

  const foreignTenantId = randomUUID();
  await context.schemaAdminPool!.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [
    foreignTenantId,
    'Fictional isolated tenant',
  ]);
  const foreignUser = await createMember(foreignTenantId, 'reviewer', 'Synthetic foreign reviewer');
  const foreign = await createAssignedCase(foreignTenantId, foreignUser);

  for (const item of [unassigned, foreign]) {
    assertError(
      await request('GET', `/api/cases/${item.caseId}/evidence/${item.evidenceId}/original`, context.demo!),
      404,
    );
    assertError(
      await request('POST', `/api/cases/${item.caseId}/claims/${item.claimId}/review`, context.demo!, {
        payload: {accepted: true, reason: 'Unauthorized boundary check.'},
      }),
      404,
    );
    assertError(await request('GET', `/api/cases/${item.caseId}/report`, context.demo!), 404);
    assertError(await request('POST', `/api/cases/${item.caseId}/evidence/binary`, context.demo!, {
      payload: {filename: 'fictional-boundary.bin', contentBase64: 'YQ==', expectedSha256: digest('a'),
        sourceTime: '2026-01-01T00:00:00Z', method: 'Fictional boundary fixture', idempotencyKey: randomUUID()},
    }), 404);
  }

  const clientId = await createMember(demoTenantId, 'client', 'Synthetic internal API client');
  const clientSession = await issueTestSession(clientId);
  assertError(await request('GET', '/api/workspace', clientSession), 403);
});

test('binary originals persist byte-for-byte, remain quarantined, and cannot become text claims', async () => {
  const kase = await createCase();
  const original = Buffer.concat([Buffer.from('SYNTHETIC BINARY PAYLOAD: fictional only\n'), Buffer.from([0, 255, 128, 13, 10])]);
  const input = {
    filename: 'fictional-opaque-source.bin', contentBase64: original.toString('base64'),
    expectedSha256: createHash('sha256').update(original).digest('hex'),
    sourceTime: '2026-01-12T10:30:00+01:30', method: 'Fictional binary fixture, no parser', idempotencyKey: randomUUID(),
  };
  const url = `/api/cases/${kase.id}/evidence/binary`;
  assertError(await request('POST', url, context.demo!, {payload: input}), 409);
  const authority = parseBody<{id: string}>(await approveAuthority(kase.id));
  const responses = await Promise.all([request('POST', url, context.demo!, {payload: input}), request('POST', url, context.demo!, {payload: input})]);
  for (const response of responses) assert.equal(response.statusCode, 200, response.body);
  const receipt = parseBody<Evidence>(responses[0]!);
  assert.equal(parseBody<Evidence>(responses[1]!).id, receipt.id);
  assert.equal(receipt.status, 'Quarantined');
  assert.equal(receipt.originalKind, 'opaque_binary');
  assert.equal(receipt.text, '');
  assert.equal(receipt.bytes, original.length);
  assert.equal(receipt.digest, input.expectedSha256);
  assert.equal(receipt.sourceTime, input.sourceTime);
  assert.equal(receipt.authorityId, authority.id);
  assert.equal(receipt.authorityVersion, 1);
  assert.notEqual(receipt.receivedTime, input.sourceTime);

  const download = await request('GET', `/api/cases/${kase.id}/evidence/${receipt.id}/original`, context.demo!);
  assert.equal(download.statusCode, 200);
  assert.deepEqual(download.rawPayload, original);
  assert.equal(download.headers['content-type'], 'application/octet-stream');
  assert.equal(download.headers['x-content-type-options'], 'nosniff');
  assert.equal(download.headers['x-inveos-original-state'], 'Quarantined');
  assert.match(download.headers['content-disposition']!, /^attachment;/);
  const row = (await context.pool!.query('SELECT * FROM evidence WHERE tenant_id=$1 AND case_id=$2 AND id=$3', [demoTenantId, kase.id, receipt.id])).rows[0];
  assert.match(row.object_path, /\.bin$/);
  assert.equal((await stat(resolve(context.storageRoot!, row.object_path))).mode & 0o777, 0o600);
  const receivedEvents = await context.pool!.query("SELECT * FROM audit_events WHERE tenant_id=$1 AND case_id=$2 AND action='evidence.received'", [demoTenantId, kase.id]);
  assert.equal(receivedEvents.rows.length, 1);
  assert.equal(receivedEvents.rows[0].metadata.originalKind, 'opaque_binary');
  assert.equal(receivedEvents.rows[0].metadata.sha256, input.expectedSha256);

  assert.equal((await approveAuthority(kase.id)).statusCode, 200);
  const replay = await request('POST', url, context.demo!, {payload: input});
  assert.equal(replay.statusCode, 200);
  assert.equal(parseBody<Evidence>(replay).authorityVersion, 1);
  assertError(await request('POST', url, context.demo!, {payload: {...input, filename: 'changed.bin'}}), 409);
  const separate = await request('POST', url, context.demo!, {payload: {...input, idempotencyKey: randomUUID()}});
  assert.equal(separate.statusCode, 200);
  assert.notEqual(parseBody<Evidence>(separate).id, receipt.id);
  assert.equal(parseBody<Evidence>(separate).authorityVersion, 2);
  assertError(await createClaim(kase.id, receipt.id, context.demo!, 'SYNTHETIC BINARY PAYLOAD'), 409);
  assertError(await request('GET', `/api/cases/${kase.id}/report`, context.demo!), 422);
  // Even UTF-8 bytes received as binary cannot bypass the citation boundary.
  const textBinary = await request('POST', url, context.demo!, {payload: {...input, contentBase64: Buffer.from(sourceText()).toString('base64'), expectedSha256: digest(sourceText()), idempotencyKey: randomUUID()}});
  assert.equal(textBinary.statusCode, 200);
  assertError(await createClaim(kase.id, parseBody<Evidence>(textBinary).id), 409);
  await assert.rejects(context.pool!.query(
    `INSERT INTO claims (tenant_id,case_id,id,evidence_id,authority_id,authority_version,text,quote,source_start_byte,source_end_byte,source_digest,status,created_by)
     VALUES ($1,$2,$3,$4,$5,1,'Fictional invalid binary claim','SYNTHETIC',0,9,$6,'Under review',$7)`,
    [demoTenantId, kase.id, randomUUID(), receipt.id, authority.id, input.expectedSha256, demoUserId],
  ), (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23514'));
  await assert.rejects(context.schemaAdminPool!.query(
    'UPDATE evidence SET status=$4 WHERE tenant_id=$1 AND case_id=$2 AND id=$3', [demoTenantId, kase.id, receipt.id, 'Verified'],
  ), (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === '55000'));

  const workspace = parseBody<Workspace>(await request('GET', '/api/workspace', context.demo!));
  const shown = workspace.evidence.find((item) => item.id === receipt.id)!;
  assert.equal(shown.status, 'Quarantined');
  assert.equal(shown.text, '');
  assert.equal(JSON.stringify(workspace).includes('SYNTHETIC BINARY PAYLOAD'), false);
  await context.app!.close();
  await runMigrations(context.adminPool!, context.schema!); // repeated migration on populated storage
  context.app = await createAppInstance();
  const restarted = await request('GET', `/api/cases/${kase.id}/evidence/${receipt.id}/original`, context.demo!);
  assert.deepEqual(restarted.rawPayload, original);
  await writeFile(resolve(context.storageRoot!, row.object_path), Buffer.from('corrupted fictional binary'));
  assertError(await request('GET', `/api/cases/${kase.id}/evidence/${receipt.id}/original`, context.demo!), 409);
  assertError(await request('POST', url, context.demo!, {payload: input}), 409);
});

test('binary intake enforces encoding, scope, CSRF, type separation and tenant boundaries', async () => {
  const kase = await createCase();
  assert.equal((await approveAuthority(kase.id)).statusCode, 200);
  const url = `/api/cases/${kase.id}/evidence/binary`;
  const input = {filename: 'fictional.bin', contentBase64: 'YQ==', expectedSha256: digest('a'), sourceTime: '2026-01-12T09:00:00Z', method: 'Fictional fixture', idempotencyKey: randomUUID()};
  assertError(await request('POST', url, undefined, {payload: input}), 401);
  assertError(await request('POST', url, context.demo!, {payload: input, csrfHeader: false}), 403);
  for (const change of [
    {contentBase64: 'YR=='}, {contentBase64: 'YQ==\n'}, {contentBase64: '!!!!'}, {contentBase64: ''},
    {contentBase64: Buffer.alloc(262145).toString('base64')}, {expectedSha256: '0'.repeat(64)},
    {filename: '../fictional.bin'}, {filename: 'a\n.bin'}, {filename: 'bad\uD800.bin'}, {sourceTime: '2026-02-30T00:00:00Z'},
    {text: 'Must not mix representations'}, {originalKind: 'original_utf8'}, {status: 'Verified'},
  ]) assertError(await request('POST', url, context.demo!, {payload: {...input, ...change}}), 422);
  assertError(await request('POST', `/api/cases/${kase.id}/evidence`, context.demo!, {payload: input}), 422);
  const textInput = evidenceInput({idempotencyKey: input.idempotencyKey});
  assert.equal((await uploadEvidence(kase.id, context.demo!, textInput)).statusCode, 200);
  assertError(await request('POST', url, context.demo!, {payload: input}), 409);

  const clientId = await createMember(demoTenantId, 'client', 'Fictional client binary denial');
  const clientSession = await issueTestSession(clientId);
  assertError(await request('POST', url, clientSession, {payload: input}), 403);
  const owner = await createMember(demoTenantId, 'investigator', 'Fictional unrelated binary owner');
  const unassigned = await createAssignedCase(demoTenantId, owner);
  assertError(await request('POST', `/api/cases/${unassigned.caseId}/evidence/binary`, context.demo!, {payload: input}), 404);
  const ownBinary = await request('POST', url, context.demo!, {payload: {...input, idempotencyKey: randomUUID()}});
  assert.equal(ownBinary.statusCode, 200);
  const ownId = parseBody<Evidence>(ownBinary).id;
  const unrelatedSession = await issueTestSession(owner);
  assertError(await request('GET', `/api/cases/${kase.id}/evidence/${ownId}/original`, unrelatedSession), 404);
  assertError(await request('GET', `/api/cases/${kase.id}/evidence/${ownId}/original`, clientSession), 403);
  const otherCase = await createCase();
  assertError(await request('GET', `/api/cases/${otherCase.id}/evidence/${ownId}/original`, context.demo!), 404);
  const count = await context.pool!.query('SELECT count(*)::int AS count FROM evidence WHERE tenant_id=$1 AND case_id=$2', [demoTenantId, kase.id]);
  assert.equal(count.rows[0].count, 2); // one original text and one binary, nothing from failed requests
});

test('binary migration upgrades a populated text-only foundation without relabelling originals', async () => {
  const schema = `upgrade_test_${randomUUID().replaceAll('-', '')}`;
  const legacy = await readFile(new URL('../migrations/001_foundation.sql', import.meta.url), 'utf8');
  const client = await context.adminPool!.connect();
  const caseId = randomUUID(); const authorityId = randomUUID(); const evidenceId = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await client.query(legacy);
    await client.query(`INSERT INTO cases (tenant_id,id,ref,title,client,owner_user_id,scope,jurisdiction,status)
      VALUES ($1,$2,'SYN-UPGRADE','Fictional upgrade case','Fictional client',$3,'Fictional upgrade scope','Test','Scope review')`, [demoTenantId, caseId, demoUserId]);
    await client.query(`INSERT INTO authority_records (tenant_id,case_id,id,version,purpose,lawful_basis,scope,retention_days,minimisation,approved_by)
      VALUES ($1,$2,$3,1,'Fictional purpose','Fictional basis','Fictional scope',30,'Fictional minimum',$4)`, [demoTenantId, caseId, authorityId, demoUserId]);
    await client.query(`INSERT INTO evidence (tenant_id,case_id,id,authority_id,authority_version,filename,byte_length,source_time,method,digest,object_path,status,idempotency_key,request_hash,created_by)
      VALUES ($1,$2,$3,$4,1,'fictional-legacy.txt',1,'2026-01-01T00:00:00Z','Fictional fixture',$5,'fictional-legacy-object.txt','Verified',$6,$5,$7)`, [demoTenantId, caseId, evidenceId, authorityId, digest('a'), randomUUID(), demoUserId]);
    await client.query('COMMIT');
    await runMigrations(context.adminPool!, schema);
    await runMigrations(context.adminPool!, schema);
    const result = await client.query(`SELECT original_kind,status,digest,object_path FROM "${schema}".evidence WHERE id=$1`, [evidenceId]);
    assert.equal(result.rows[0].original_kind, 'original_utf8');
    assert.equal(result.rows[0].status, 'Verified');
    assert.equal(result.rows[0].digest.trim(), digest('a'));
    assert.equal(result.rows[0].object_path, 'fictional-legacy-object.txt');
  } finally {
    await client.query('ROLLBACK');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release();
  }
});

test('binary intake rolls back database receipts and removes newly written objects on failure', async () => {
  const kase = await createCase();
  assert.equal((await approveAuthority(kase.id)).statusCode, 200);
  const input = {filename: 'fictional-insert-failure.bin', contentBase64: 'YQ==', expectedSha256: digest('a'), sourceTime: '2026-01-12T09:00:00Z', method: 'Fictional rollback fixture', idempotencyKey: randomUUID()};
  await context.schemaAdminPool!.query("ALTER TABLE evidence ADD CONSTRAINT synthetic_insert_failure CHECK (filename <> 'fictional-insert-failure.bin')");
  try {
    assertError(await request('POST', `/api/cases/${kase.id}/evidence/binary`, context.demo!, {payload: input}), 500);
  } finally {
    await context.schemaAdminPool!.query('ALTER TABLE evidence DROP CONSTRAINT synthetic_insert_failure');
  }
  const records = await context.pool!.query('SELECT count(*)::int AS count FROM evidence WHERE tenant_id=$1 AND case_id=$2', [demoTenantId, kase.id]);
  assert.equal(records.rows[0].count, 0);
  const events = await context.pool!.query("SELECT count(*)::int AS count FROM audit_events WHERE tenant_id=$1 AND case_id=$2 AND action='evidence.received'", [demoTenantId, kase.id]);
  assert.equal(events.rows[0].count, 0);
  assert.deepEqual(await readdir(join(context.storageRoot!, demoTenantId, kase.id)), []);
  // A retry after the transient failure receives one normal durable receipt.
  const retry = await request('POST', `/api/cases/${kase.id}/evidence/binary`, context.demo!, {payload: input});
  assert.equal(retry.statusCode, 200, retry.body);
  assert.equal(parseBody<Evidence>(retry).status, 'Quarantined');
});

test('casework context and quarantined inventory coexist with independently verified report packages', async () => {
  const kase = await createCase(); await approveAuthority(kase.id);
  const source = parseBody<Evidence>(await uploadEvidence(kase.id));
  const claim = parseBody<{id: string}>(await createClaim(kase.id, source.id));
  assert.equal((await request('POST', `/api/cases/${kase.id}/claims/${claim.id}/review`, context.demo!, {
    payload: {accepted: true, reason: 'Reviewed fictional exact source.'},
  })).statusCode, 200);
  const question = parseBody<WorkItem>(await createWork(kase.id));
  await createWork(kase.id, workInput({kind: 'note', title: 'PRIVATE FICTIONAL NOTE OMITTED'}));
  assert.equal((await request('POST', `/api/cases/${kase.id}/evidence/binary`, context.demo!, {payload: {
    filename: 'uncited-fictional.bin', contentBase64: 'YQ==', expectedSha256: digest('a'),
    sourceTime: '2026-01-01T00:00:00Z', method: 'Fictional binary fixture', idempotencyKey: randomUUID(),
  }})).statusCode, 200);
  const response = await request('GET', `/api/cases/${kase.id}/report`, context.demo!);
  assert.equal(response.statusCode, 200, response.body);
  assert.ok(response.body.includes(question.id));
  assert.equal(response.body.includes('PRIVATE FICTIONAL NOTE OMITTED'), false);
  assert.equal(response.body.includes('uncited-fictional.bin'), false);
  const path = join(context.storageRoot!, 'casework-report.json');
  const archive = join(context.storageRoot!, 'casework-report.zip');
  await writeFile(path, response.body);
  const script = fileURLToPath(new URL('../../../tools/report_package.py', import.meta.url));
  const built = spawnSync('python3', [script, 'build', path, archive], {encoding: 'utf8'});
  assert.equal(built.status, 0, built.stderr);
  const checked = spawnSync('python3', [script, 'verify', archive, '--expected-manifest-sha256',
    JSON.parse(built.stdout).manifestSha256, '--expected-case-id', kase.id], {encoding: 'utf8'});
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).originalsChecked, 1);
});

test('tampered originals block acceptance and export, and logout revokes the session', async () => {
  const kase = await createCase();
  assert.equal((await approveAuthority(kase.id)).statusCode, 200);
  const evidence = parseBody<Evidence>(await uploadEvidence(kase.id));
  const claim = parseBody<{id: string}>(await createClaim(kase.id, evidence.id));
  const secondClaim = parseBody<{id: string}>(await createClaim(
    kase.id,
    evidence.id,
    context.demo!,
    'batch NW-104 was packed',
  ));
  const accepted = await request('POST', `/api/cases/${kase.id}/claims/${claim.id}/review`, context.demo!, {
    payload: {accepted: true, reason: 'Accept before testing later original mutation.'},
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  const path = await context.pool!.query(
    'SELECT object_path FROM evidence WHERE tenant_id = $1 AND case_id = $2 AND id = $3',
    [demoTenantId, kase.id, evidence.id],
  );
  await writeFile(resolve(context.storageRoot!, path.rows[0].object_path), Buffer.from('mutated synthetic original'));

  assertError(
    await request('POST', `/api/cases/${kase.id}/claims/${claim.id}/review`, context.demo!, {
      payload: {accepted: true, reason: 'Conflicting repeated decision.'},
    }),
    409,
  );
  assertError(
    await request('POST', `/api/cases/${kase.id}/claims/${secondClaim.id}/review`, context.demo!, {
      payload: {accepted: true, reason: 'Mutation must block acceptance.'},
    }),
    409,
  );
  assertError(await request('GET', `/api/cases/${kase.id}/evidence/${evidence.id}/original`, context.demo!), 409);
  assertError(await request('GET', `/api/cases/${kase.id}/report`, context.demo!), 409);

  const logout = await request('POST', '/api/session/end', context.demo!, {payload: {}});
  assert.equal(logout.statusCode, 200, logout.body);
  assert.equal(parseBody<{ok: boolean}>(logout).ok, true);
  assertError(await request('GET', '/api/workspace', context.demo!), 401);

  const fixture = await readFile(new URL('../fixtures/fictional_supplier_note.txt', import.meta.url), 'utf8');
  assert.match(fixture, /SYNTHETIC FIXTURE — FICTIONAL ONLY/);
});

function workInput(overrides: Partial<WorkInput> = {}): WorkInput {
  return {id: randomUUID(), kind: 'question', title: 'Do the fictional supplier records agree?',
    body: 'Compare the supplied fictional declaration with the older extract. Preserve alternative explanations.',
    ownerId: demoUserId, dueDate: '2026-11-02', parentId: null, ...overrides};
}
async function createWork(caseId: string, input = workInput(), session = context.demo!) {
  return request('POST', `/api/cases/${caseId}/work`, session, {payload: input});
}
function workEdit(item: WorkItem, overrides: Partial<WorkEdit> = {}): WorkEdit {
  return {expectedVersion: item.version, title: item.title, body: item.body, status: item.status,
    ownerId: item.ownerId, dueDate: item.dueDate, reason: 'Synthetic investigator revision after checking the case.', ...overrides};
}
async function reviseWork(item: WorkItem, input = workEdit(item), session = context.demo!) {
  return request('POST', `/api/cases/${item.caseId}/work/${item.id}/revise`, session, {payload: input});
}


test('assigned work queue is bounded, role-gated and loses work when case access is removed', async () => {
  await context.app!.close();context.app=await createAppInstance();
  context.demo = await issueTestSession(demoUserId);
  const kase = await createCase();
  const colleagueId = await createMember(demoTenantId, 'investigator', 'Fictional queue investigator');
  await context.schemaAdminPool!.query(
    'INSERT INTO case_memberships(tenant_id,case_id,user_id) VALUES($1,$2,$3)',
    [demoTenantId, kase.id, colleagueId],
  );
  const colleague = await issueTestSession(colleagueId);
  const assigned = parseBody<WorkItem>(await createWork(kase.id, workInput({
    title: 'Check fictional supplier declaration',
    ownerId: colleagueId,
    dueDate: '2026-10-30',
  })));
  const own = parseBody<WorkItem>(await createWork(kase.id, workInput({
    title: 'Keep this fictional reviewer work private to its owner',
    ownerId: demoUserId,
    dueDate: '2026-10-31',
  })));
  const queue = await request('GET', '/api/work/queue', colleague);
  assert.equal(queue.statusCode, 200, queue.body);
  const body = parseBody<{items: Array<WorkItem & {caseRef:string;caseTitle:string}>; more:boolean; interpretation:string}>(queue);
  assert.equal(body.interpretation, 'assigned_work_not_a_finding');
  assert.ok(body.items.some(item => item.id === assigned.id && item.caseId === kase.id && item.caseRef === kase.ref));
  assert.equal(body.items.some(item => item.id === own.id), false);
  const clientId = await createMember(demoTenantId, 'client', 'Fictional excluded queue client');
  const client = await issueTestSession(clientId);
  assertError(await request('GET', '/api/work/queue', client), 403);
  await context.schemaAdminPool!.query(
    'DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',
    [demoTenantId, kase.id, colleagueId],
  );
  const revoked = parseBody<{items: WorkItem[]}>(await request('GET', '/api/work/queue', colleague));
  assert.equal(revoked.items.some(item => item.id === assigned.id), false);
});

test('assigned queue pages all dated and undated work, filters current records and enforces tenant boundaries',async()=>{
 await context.app!.close();context.app=await createAppInstance();context.demo=await issueTestSession(demoUserId);
 const kase=await createCase(),ids=Array.from({length:201},()=>randomUUID());
 await context.schemaAdminPool!.query(`INSERT INTO case_work_items(tenant_id,case_id,id,kind,title,body,status,owner_id,due_date,request_hash,created_by)
  SELECT $1,$2,id,'task','Fictional bounded queue entry',repeat('Fictional assigned work. ',30),CASE WHEN n%2=0 THEN 'Complete' ELSE 'Blocked' END,$3,CASE WHEN n<=90 THEN '2026-01-01'::date WHEN n<=150 THEN '2026-02-01'::date ELSE NULL END,$4,$3 FROM unnest($5::uuid[]) WITH ORDINALITY AS rows(id,n)`,[demoTenantId,kase.id,demoUserId,'a'.repeat(64),ids]);
 // Other cases can already exist in this suite; use an isolated assigned member for exact page counts.
 const member=await createMember(demoTenantId,'investigator','Fictional pagination owner');await context.schemaAdminPool!.query('INSERT INTO case_memberships(tenant_id,case_id,user_id) VALUES($1,$2,$3)',[demoTenantId,kase.id,member]);await context.schemaAdminPool!.query('UPDATE case_work_items SET owner_id=$1 WHERE case_id=$2',[member,kase.id]);const session=await issueTestSession(member);
 const page=async(query='')=>{const r=await request('GET','/api/work/queue'+query,session);assert.equal(r.statusCode,200,r.body);return r.json();};
 const first=await page();assert.equal(first.items.length,100);assert.equal(first.more,true);assert.equal(first.items[0].dueDate,'2026-01-01');assert.equal(first.items[0].excerpt.length,260);assert.equal('body' in first.items[0],false);
 const query=(next:{id:string;dueDate:string|null})=>'?afterId='+next.id+'&afterDue='+(next.dueDate??'none'),second=await page(query(first.next)),third=await page(query(second.next));assert.equal(second.items.length,100);assert.equal(third.items.length,1);assert.equal(third.items[0].dueDate,null);assert.equal(third.next,null);assert.equal(third.more,false);assert.deepEqual([...first.items,...second.items,...third.items].map((i:{id:string})=>i.id).sort(),ids.sort());
 const filtered=await page('?kind=task&status=Complete');assert.equal(filtered.items.length,100);assert.ok(filtered.items.every((i:{status:string})=>i.status==='Complete'));assert.equal(filtered.more,false);assert.equal((await page('?kind=question')).items.length,0);
 for(const query of ['?afterId='+randomUUID(),'?afterDue=none','?afterId='+randomUUID()+'&afterDue=2026-02-30','?kind=unknown','?status=unknown','?tenantId='+demoTenantId])assertError(await request('GET','/api/work/queue'+query,session),422);
 const tenant=randomUUID();await context.schemaAdminPool!.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenant,'Fictional separate queue tenant']);await context.schemaAdminPool!.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'investigator')",[tenant,member]);const foreign=await issueTestSession(member,tenant),foreignCase=await createCase(foreign),foreignItem=parseBody<WorkItem>(await createWork(foreignCase.id,workInput({ownerId:member,title:'Fictional separate tenant work'}),foreign));
 const foreignQueue=await request('GET','/api/work/queue',foreign);assert.equal(foreignQueue.statusCode,200,foreignQueue.body);assert.deepEqual(foreignQueue.json().items.map((i:{id:string})=>i.id),[foreignItem.id]);assert.equal((await page()).items.some((i:{id:string})=>i.id===foreignItem.id),false);
 await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,kase.id,member]);assert.deepEqual((await page(query(first.next))).items,[]);
});

test('assigned queue reflects reassignment, deadline corrections and current role immediately',async()=>{
 await context.app!.close();context.app=await createAppInstance();context.demo=await issueTestSession(demoUserId);const kase=await createCase(),member=await createMember(demoTenantId,'investigator','Fictional changing queue owner');await context.schemaAdminPool!.query('INSERT INTO case_memberships(tenant_id,case_id,user_id) VALUES($1,$2,$3)',[demoTenantId,kase.id,member]);const session=await issueTestSession(member),item=parseBody<WorkItem>(await createWork(kase.id,workInput({ownerId:member,dueDate:null})));
 const initial=await request('GET','/api/work/queue',session);assert.equal(initial.json().items[0].dueDate,null);const correction=parseBody<WorkItem>(await reviseWork(item,workEdit(item,{dueDate:'2026-02-01'})));assert.equal((await request('GET','/api/work/queue',session)).json().items[0].dueDate,'2026-02-01');assert.equal((await reviseWork(correction,workEdit(correction,{ownerId:demoUserId}))).statusCode,200);assert.deepEqual((await request('GET','/api/work/queue',session)).json().items,[]);
 await context.schemaAdminPool!.query("UPDATE memberships SET role='client' WHERE tenant_id=$1 AND user_id=$2",[demoTenantId,member]);assertError(await request('GET','/api/work/queue',session),403);
});

test('real browser filters personal assignments, opens the correct case and clears revoked work',{skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:90000},async()=>{
 await context.app!.close();context.app=await createAppInstance();context.demo=await issueTestSession(demoUserId);const firstCase=await createCase(context.demo!,{title:'Fictional first queue case'}),secondCase=await createCase(context.demo!,{title:'Fictional second queue case'});await approveAuthority(firstCase.id);await approveAuthority(secondCase.id);
 const first=parseBody<WorkItem>(await createWork(firstCase.id,workInput({title:'Fictional first assigned task',ownerId:demoUserId,dueDate:'2026-01-01'}))),second=parseBody<WorkItem>(await createWork(secondCase.id,workInput({title:'Fictional second assigned task',ownerId:demoUserId,dueDate:'2026-02-01'})));await reviseWork(second,workEdit(second,{status:'Complete'}));
 const extra=Array.from({length:101},()=>randomUUID());await context.schemaAdminPool!.query(`INSERT INTO case_work_items(tenant_id,case_id,id,kind,title,body,status,owner_id,request_hash,created_by) SELECT $1,$2,id,'task','Fictional undated queue fixture','Fictional pagination context','To do',$3,$4,$3 FROM unnest($5::uuid[]) id`,[demoTenantId,firstCase.id,demoUserId,'a'.repeat(64),extra]);
 await withBrowserApp(async(b,origin)=>{const ui=await binaryBrowserControls(b,origin,firstCase.id);await ui.click('Assignments');await eventually(async()=>(await ui.text()).includes('Your assigned work.')&&(await ui.text()).includes(first.title)&&(await ui.text()).includes(second.title),'cross-case own queue');await ui.click('Next assignments');await eventually(async()=>(await ui.text()).includes('Previous assignments')&&!(await ui.text()).includes(first.title),'next assignment page');await ui.click('Previous assignments');await eventually(async()=>(await ui.text()).includes(first.title)&&(await ui.text()).includes(second.title),'previous assignment page');
  await b.evaluate(`(()=>{const field=[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('Work status')).querySelector('select');field.value='Complete';field.dispatchEvent(new Event('change',{bubbles:true}));})()`);await eventually(async()=>(await ui.text()).includes(second.title)&&!(await ui.text()).includes(first.title),'queue status filter');await ui.click('Open assigned work: '+second.title);await eventually(async()=>await b.evaluate<boolean>(`location.hash.includes(${JSON.stringify('case='+secondCase.id)})&&!!document.getElementById(${JSON.stringify('work-'+second.id)})`),'correct case work opened');
  await ui.click('Assignments');await eventually(async()=>(await ui.text()).includes(first.title)&&(await ui.text()).includes(second.title),'queue return');const previous=await b.evaluate<number>('performance.timeOrigin');await b.send('Page.reload');await eventually(async()=>await b.evaluate<number>('performance.timeOrigin')!==previous&&(await ui.text()).includes('Your assigned work.')&&(await ui.text()).includes(second.title),'queue reload');
  const artifact=fileURLToPath(new URL('../../../output/evals/assigned-work-desktop.png',import.meta.url));await mkdir(resolve(artifact,'..'),{recursive:true});const shot=await b.send<{data:string}>('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(artifact,Buffer.from(shot.data,'base64'));
  await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.ok(await b.evaluate<boolean>('document.documentElement.scrollWidth<=window.innerWidth+1'));
  await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,secondCase.id,demoUserId]);await ui.click('Refresh assignments');await eventually(async()=>(await ui.text()).includes(first.title)&&!(await ui.text()).includes(second.title),'revoked case removed from queue');
 });
});

test('persistent objectives, questions, hypotheses, tasks, notes and handovers share case state and survive restart', async () => {
  context.demo = await issueTestSession(demoUserId);
  const kase = await createCase();
  const question = parseBody<WorkItem>(await createWork(kase.id));
  assert.equal(question.status, 'Open');
  assert.equal(question.dueDate, '2026-11-02');
  assert.equal(question.version, 1);
  for (const kind of ['objective', 'hypothesis', 'task', 'note', 'handover'] as const) {
    const response = await createWork(kase.id, workInput({kind, parentId: kind === 'hypothesis' ? question.id : null,
      body: 'FICTIONAL: ownership may have changed. Português — £50; العربية.'}));
    assert.equal(response.statusCode, 200, response.body);
  }
  await context.app!.close();
  context.app = await createAppInstance();
  const workspace = parseBody<Workspace>(await request('GET', '/api/workspace', context.demo!));
  assert.equal(workspace.workItems.filter(w => w.caseId === kase.id).length, 6);
  assert.ok(workspace.workItems.some(w => w.body.includes('العربية')));
  assert.ok(workspace.members.some(m => m.caseId === kase.id && m.userId === demoUserId));
  const history = await request('GET', `/api/cases/${kase.id}/work/${question.id}/history`, context.demo!);
  assert.equal(history.statusCode, 200);
  assert.equal(parseBody<WorkRevision[]>(history)[0]!.item.title, question.title);
});

test('case work retries do not duplicate records and changed retries conflict', async () => {
  const kase = await createCase(); const input = workInput();
  const responses = await Promise.all([createWork(kase.id, input), createWork(kase.id, input)]);
  assert.deepEqual(responses.map(r => r.statusCode), [200, 200]);
  assert.equal(parseBody<WorkItem>(responses[0]!).id, parseBody<WorkItem>(responses[1]!).id);
  assertError(await createWork(kase.id, {...input, title: 'A changed fictional question'}), 409);
  const audit = await context.pool!.query('SELECT count(*)::int AS count FROM audit_events WHERE tenant_id=$1 AND case_id=$2 AND action=$3', [demoTenantId, kase.id, 'work.created']);
  assert.equal(audit.rows[0].count, 1);
});

test('concurrent case work edits reject stale versions and preserve immutable history', async () => {
  const kase = await createCase(); const item = parseBody<WorkItem>(await createWork(kase.id, workInput({kind: 'task'})));
  const results = await Promise.all([
    reviseWork(item, workEdit(item, {status: 'Blocked', body: 'Fictional clarification is outstanding.'})),
    reviseWork(item, workEdit(item, {status: 'Complete', body: 'Conflicting fictional completion.'})),
  ]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  const history = parseBody<WorkRevision[]>(await request('GET', `/api/cases/${kase.id}/work/${item.id}/history`, context.demo!));
  assert.deepEqual(history.map(r => r.version), [2, 1]);
  assert.equal(history[1]!.item.body, item.body);
  assert.equal(history[0]!.actor, 'Synthetic reviewer');
  await assert.rejects(context.pool!.query('UPDATE case_work_revisions SET reason=$1 WHERE tenant_id=$2 AND case_id=$3', ['Rewrite history', demoTenantId, kase.id]), /permission denied/);
  await assert.rejects(context.schemaAdminPool!.query('UPDATE case_work_revisions SET reason=$1 WHERE tenant_id=$2 AND case_id=$3', ['Rewrite history', demoTenantId, kase.id]), /append-only/);
});

test('case work validates blank text, real calendar dates, control characters, kinds, statuses and owner scope', async () => {
  const kase = await createCase();
  const outsider = await createMember(demoTenantId, 'investigator', 'Fictional unassigned contractor');
  const client = await createMember(demoTenantId, 'client', 'Fictional client');
  await context.schemaAdminPool!.query('INSERT INTO case_memberships (tenant_id,case_id,user_id) VALUES ($1,$2,$3)', [demoTenantId, kase.id, client]);
  const invalid = [
    {title: '   '}, {dueDate: '2026-02-30'}, {dueDate: '2026-13-01'}, {dueDate: '2026-01-32'},
    {dueDate: '2027-02-29'}, {dueDate: '0000-01-01'}, {body: 'Control\u0000text'},
    {body: 'Broken surrogate \ud800'}, {kind: 'finding'}, {ownerId: outsider}, {ownerId: client},
    {tenantId: randomUUID()}, {body: 'x'.repeat(12001)},
  ];
  for (const override of invalid) {
    const response = await request('POST', `/api/cases/${kase.id}/work`, context.demo!, {payload: {...workInput(), ...override}});
    assertError(response, 422);
  }
  const leap = await createWork(kase.id, workInput({dueDate: '2028-02-29'}));
  assert.equal(leap.statusCode, 200, leap.body);
  const item = parseBody<WorkItem>(leap);
  assertError(await reviseWork(item, workEdit(item, {status: 'Accepted' as WorkEdit['status']})), 422);
  assertError(await reviseWork(item, workEdit(item, {reason: '   '})), 422);
  assertError(await reviseWork(item, workEdit(item, {status: 'Acknowledged'})), 422);
});

test('hypotheses require a same-case investigation question, not an objective or arbitrary parent', async () => {
  const kase = await createCase(); const other = await createCase();
  const objective = parseBody<WorkItem>(await createWork(kase.id, workInput({kind: 'objective'})));
  const foreignQuestion = parseBody<WorkItem>(await createWork(other.id));
  assertError(await createWork(kase.id, workInput({kind: 'hypothesis'})), 422);
  assertError(await createWork(kase.id, workInput({kind: 'hypothesis', parentId: objective.id})), 422);
  assertError(await createWork(kase.id, workInput({kind: 'hypothesis', parentId: foreignQuestion.id})), 404);
});

test('supporting and contrary source links verify originals and do not create findings', async () => {
  const kase = await createCase(); await approveAuthority(kase.id);
  const evidence = parseBody<Evidence>(await uploadEvidence(kase.id));
  const claim = parseBody<{id: string}>(await createClaim(kase.id, evidence.id));
  const question = parseBody<WorkItem>(await createWork(kase.id));
  const hypothesis = parseBody<WorkItem>(await createWork(kase.id, workInput({kind: 'hypothesis', parentId: question.id})));
  assertError(await reviseWork(hypothesis, workEdit(hypothesis, {status: 'Supported'})), 422);
  const input = {id: randomUUID(), claimId: claim.id, relation: 'supports', reason: 'The supplied fictional note supports this candidate explanation.'};
  const linked = await request('POST', `/api/cases/${kase.id}/work/${hypothesis.id}/links`, context.demo!, {payload: input});
  assert.equal(linked.statusCode, 200, linked.body);
  const replay = await request('POST', `/api/cases/${kase.id}/work/${hypothesis.id}/links`, context.demo!, {payload: input});
  assert.equal(parseBody<WorkLink>(replay).id, parseBody<WorkLink>(linked).id);
  const supported = await reviseWork(hypothesis, workEdit(hypothesis, {status: 'Supported'}));
  assert.equal(supported.statusCode, 200, supported.body);
  assertError(await reviseWork(parseBody<WorkItem>(supported), workEdit(parseBody<WorkItem>(supported), {status: 'Disputed'})), 422);
  const contrary = await request('POST', `/api/cases/${kase.id}/work/${hypothesis.id}/links`, context.demo!, {payload: {...input, id: randomUUID(), relation: 'contradicts', reason: 'A separate analyst interpretation disputes the candidate; it is not a finding.'}});
  assert.equal(contrary.statusCode, 200, contrary.body);
  const workspace = parseBody<Workspace>(await request('GET', '/api/workspace', context.demo!));
  assert.equal(workspace.workLinks.filter(l => l.itemId === hypothesis.id).length, 2);
  assert.equal(workspace.findings.filter(f => f.caseId === kase.id).length, 0);
  assert.equal(workspace.claims.find(c => c.id === claim.id)!.status, 'Under review');
});

test('source mutation and cross-case citations block links and hypothesis promotion', async () => {
  const kase = await createCase(); const other = await createCase(); await approveAuthority(kase.id);
  const evidence = parseBody<Evidence>(await uploadEvidence(kase.id));
  const claim = parseBody<{id: string}>(await createClaim(kase.id, evidence.id));
  const question = parseBody<WorkItem>(await createWork(kase.id));
  const otherQuestion = parseBody<WorkItem>(await createWork(other.id));
  const hypothesis = parseBody<WorkItem>(await createWork(kase.id, workInput({kind: 'hypothesis', parentId: question.id})));
  const input = {id: randomUUID(), claimId: claim.id, relation: 'supports', reason: 'Fictional supporting passage needs independent re-verification.'};
  assertError(await request('POST', `/api/cases/${other.id}/work/${otherQuestion.id}/links`, context.demo!, {payload: input}), 404);
  assert.equal((await request('POST', `/api/cases/${kase.id}/work/${hypothesis.id}/links`, context.demo!, {payload: input})).statusCode, 200);
  const source = await context.pool!.query('SELECT object_path FROM evidence WHERE tenant_id=$1 AND case_id=$2 AND id=$3', [demoTenantId, kase.id, evidence.id]);
  await writeFile(resolve(context.storageRoot!, source.rows[0].object_path), 'Mutated fictional original');
  assertError(await request('POST', `/api/cases/${kase.id}/work/${question.id}/links`, context.demo!, {payload: {...input, id: randomUUID()}}), 409);
  assertError(await reviseWork(hypothesis, workEdit(hypothesis, {status: 'Supported'})), 409);
});

test('client, other tenant, unassigned and revoked memberships cannot read or mutate case work', async () => {
  const kase = await createCase(); const item = parseBody<WorkItem>(await createWork(kase.id));
  const outsiderId = await createMember(demoTenantId, 'investigator', 'Fictional unrelated contractor');
  const outsider = await issueTestSession(outsiderId);
  const tenantId = randomUUID(); await context.schemaAdminPool!.query('INSERT INTO tenants (id,name) VALUES ($1,$2)', [tenantId, 'Fictional second agency']);
  const foreignId = await createMember(tenantId, 'reviewer', 'Fictional second-agency reviewer');
  const foreign = await issueTestSession(foreignId, tenantId);
  const clientId = await createMember(demoTenantId, 'client', 'Fictional portal viewer');
  const client = await issueTestSession(clientId);
  for (const [session, denied] of [[outsider, 404], [foreign, 404], [client, 403]] as const) {
    assertError(await createWork(kase.id, workInput(), session), denied);
    assertError(await reviseWork(item, workEdit(item), session), denied);
    assertError(await request('GET', `/api/cases/${kase.id}/work/${item.id}/history`, session), denied);
    assertError(await request('POST', `/api/cases/${kase.id}/work/${item.id}/links`, session, {payload: {id: randomUUID(), claimId: randomUUID(), relation: 'context', reason: 'Fictional denied reference'}}), denied);
  }
  await context.schemaAdminPool!.query('INSERT INTO case_memberships (tenant_id,case_id,user_id) VALUES ($1,$2,$3)', [demoTenantId, kase.id, outsiderId]);
  assert.equal((await request('GET', `/api/cases/${kase.id}/work/${item.id}/history`, outsider)).statusCode, 200);
  assert.equal((await reviseWork(item, workEdit(item, {ownerId: outsiderId}), context.demo!)).statusCode, 200);
  await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3', [demoTenantId, kase.id, outsiderId]);
  assertError(await request('GET', `/api/cases/${kase.id}/work/${item.id}/history`, outsider), 404);
  const workspace = parseBody<Workspace>(await request('GET', '/api/workspace', outsider));
  assert.equal(workspace.workItems.length, 0); assert.equal(workspace.workLinks.length, 0); assert.equal(workspace.members.length, 0);
});

test('only the assigned handover recipient acknowledges it and cannot combine acknowledgement with reassignment', async () => {
  const kase = await createCase();
  const userId = await createMember(demoTenantId, 'investigator', 'Fictional handover recipient');
  await context.schemaAdminPool!.query('INSERT INTO case_memberships (tenant_id,case_id,user_id) VALUES ($1,$2,$3)', [demoTenantId, kase.id, userId]);
  const recipient = await issueTestSession(userId);
  const handover = parseBody<WorkItem>(await createWork(kase.id, workInput({kind: 'handover', ownerId: userId})));
  assertError(await reviseWork(handover, workEdit(handover, {status: 'Acknowledged'})), 403);
  assertError(await reviseWork(handover, workEdit(handover, {status: 'Acknowledged', ownerId: demoUserId}), recipient), 422);
  const response = await reviseWork(handover, workEdit(handover, {status: 'Acknowledged', reason: 'I have reviewed the fictional context and accepted the next actions.'}), recipient);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(parseBody<WorkItem>(response).status, 'Acknowledged');
});

test('case work mutations require CSRF and reject unknown tenant fields', async () => {
  const kase = await createCase();
  assertError(await request('POST', `/api/cases/${kase.id}/work`, context.demo!, {payload: workInput(), csrfHeader: false}), 403);
  assertError(await request('POST', `/api/cases/${kase.id}/work`, context.demo!, {payload: {...workInput(), tenantId: randomUUID()}}), 422);
});

test('ordered migrations upgrade a pre-ledger foundation database, rerun safely and reject modified migration checksums', async () => {
  const schema = `upgrade_test_${randomUUID().replaceAll('-', '')}`;
  const client = await context.adminPool!.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await client.query(await readFile(new URL('../migrations/001_foundation.sql', import.meta.url), 'utf8'));
    await client.query('COMMIT');
    await runMigrations(context.adminPool!, schema);
    await runMigrations(context.adminPool!, schema);
    const result = await client.query(`SELECT filename,sha256 FROM "${schema}".schema_migrations ORDER BY filename`);
    assert.deepEqual(result.rows.map(r => r.filename), ['001_foundation.sql', '002_casework.sql', '003_binary_originals.sql', '004_integrity_jobs.sql', '005_text_derivatives.sql', '006_claim_source_identity.sql', '007_report_revisions.sql', '008_report_revision_listing.sql', '009_job_history_indexes.sql', '010_dispatch_candidates.sql', '011_upload_reservations.sql', '012_upload_maintenance.sql', '013_upload_history.sql', '014_report_review.sql', '015_report_disclosures.sql', '016_disclosure_recipient_index.sql', '017_disclosure_acknowledgements.sql', '018_disclosure_case_history.sql', '019_session_owner_index.sql', '020_session_epoch.sql', '021_job_lease_deadline.sql', '022_document_derivatives.sql', '023_raster_derivatives.sql', '024_document_citation_candidates.sql', '025_document_citation_reviews.sql', '026_document_derived_findings.sql', '027_document_disclosure_packages.sql', '028_report_renditions.sql', '029_reviewed_pdf_disclosures.sql', '030_ocr_document_derivatives.sql', '031_document_work_links.sql', '032_chronology.sql', '033_provider_identity.sql', '034_saved_case_views.sql', '035_work_discussions.sql', '036_case_graph.sql', '037_manual_sources.sql', '038_assigned_work_queue_index.sql']);
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM "${schema}".users`)).rows[0].count, 1);
    await client.query(`UPDATE "${schema}".schema_migrations SET sha256=$1 WHERE filename='002_casework.sql'`, ['0'.repeat(64)]);
    await assert.rejects(runMigrations(context.adminPool!, schema), /Applied migration was modified/);
  } finally {
    await client.query('ROLLBACK');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release();
  }
});

test('case work rejects a Unicode citation pointing into the middle of a UTF-8 character', async () => {
  const kase = await createCase(); await approveAuthority(kase.id);
  const text = 'FICTIONAL: á and a literal replacement character �.';
  const evidence = parseBody<Evidence>(await uploadEvidence(kase.id, context.demo!, evidenceInput({text, expectedSha256: digest(text)})));
  const claim = parseBody<{id: string}>(await createClaim(kase.id, evidence.id, context.demo!, '�'));
  const question = parseBody<WorkItem>(await createWork(kase.id));
  const midpoint = Buffer.from(text).indexOf(Buffer.from('á')) + 1;
  await corruptClaim('UPDATE claims SET source_start_byte=$4, source_end_byte=$5 WHERE tenant_id=$1 AND case_id=$2 AND id=$3', [demoTenantId, kase.id, claim.id, midpoint, midpoint + 1]);
  assertError(await request('POST', `/api/cases/${kase.id}/work/${question.id}/links`, context.demo!, {
    payload: {id: randomUUID(), claimId: claim.id, relation: 'context', reason: 'A corrupted Unicode byte range must not be accepted.'},
  }), 409);
});


test('combined casework flow runs over TCP HTTP and its exported report verifies offline', async () => {
  const app = await createAppInstance();
  try {
    const address = await app.listen({host: '127.0.0.1', port: 0});
    const output = join(context.storageRoot!, 'http-integration');
    const script = fileURLToPath(new URL('../../../tools/verify_casework.py', import.meta.url));
    // Async child execution keeps the actual HTTP server event loop responsive.
    const {stdout} = await promisify(execFile)('python3', [script, '--base-url', address, '--output', output],
      {timeout: 60000, maxBuffer: 65536});
    const receipt = JSON.parse(stdout);
    assert.equal(receipt.checks, 32);
    assert.equal(receipt.passed, 32);
    const report = await readFile(join(output, 'draft.json'), 'utf8');
    assert.equal(digest(report), receipt.report_sha256);
    const packager = fileURLToPath(new URL('../../../tools/report_package.py', import.meta.url));
    const archive = join(output, 'exhibits.zip');
    const built = await promisify(execFile)('python3', [packager, 'build', join(output, 'draft.json'), archive,
      '--expected-report-sha256', receipt.report_sha256], {timeout: 10000});
    const checked = await promisify(execFile)('python3', [packager, 'verify', archive,
      '--expected-manifest-sha256', JSON.parse(built.stdout).manifestSha256], {timeout: 10000});
    assert.equal(JSON.parse(checked.stdout).originalsChecked, 2);
  } finally {
    await app.close();
  }
});


test('durable integrity jobs replay, survive restart and verify original bytes without creating findings', async () => {
  context.demo = await issueTestSession(demoUserId);
  const kase = await createCase(); await approveAuthority(kase.id);
  const evidence = parseBody<Evidence>(await uploadEvidence(kase.id));
  const input = {evidenceId:evidence.id,idempotencyKey:randomUUID()};
  const url = `/api/cases/${kase.id}/integrity-jobs`;
  const replies = await Promise.all([request('POST',url,context.demo!,{payload:input}),request('POST',url,context.demo!,{payload:input})]);
  replies.forEach(r=>assert.equal(r.statusCode,200,r.body));
  const job = JSON.parse(replies[0]!.body);
  assert.equal(job.id,JSON.parse(replies[1]!.body).id);
  assert.equal(job.status,'queued');
  assert.equal(job.sourceDigest,evidence.digest);
  assert.equal(job.authorityVersion,1);
  assert.equal('leaseToken' in job,false);
  await context.app!.close(); context.app=await createAppInstance();
  const scope={tenantId:demoTenantId,caseId:kase.id,jobId:job.id};
  const completed=await runIntegrityJob(context.pool!,context.storageRoot!,scope);
  assert.equal(completed?.status,'succeeded');
  assert.equal(await runIntegrityJob(context.pool!,context.storageRoot!,scope),null);
  const replay=await request('POST',url,context.demo!,{payload:input});
  assert.equal(JSON.parse(replay.body).status,'succeeded');
  const events=await context.pool!.query('SELECT status FROM integrity_job_events WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3 ORDER BY id',[demoTenantId,kase.id,job.id]);
  assert.deepEqual(events.rows.map(r=>r.status),['queued','running','succeeded']);
  const binaryResponse=await request('POST',`/api/cases/${kase.id}/evidence/binary`,context.demo!,{payload:{filename:'fictional-job.bin',contentBase64:'YQ==',expectedSha256:digest('a'),sourceTime:'2026-01-01T00:00:00Z',method:'Fictional checksum fixture',idempotencyKey:randomUUID()}});
  assert.equal(binaryResponse.statusCode,200,binaryResponse.body);
  const binary=JSON.parse(binaryResponse.body);
  const binaryJob=await request('POST',url,context.demo!,{payload:{evidenceId:binary.id,idempotencyKey:randomUUID()}});
  assert.equal(binaryJob.statusCode,200,binaryJob.body);
  assert.equal((await runIntegrityJob(context.pool!,context.storageRoot!,{...scope,jobId:JSON.parse(binaryJob.body).id}))?.status,'succeeded');
  const workspace=JSON.parse((await request('GET','/api/workspace',context.demo!)).body);
  assert.equal(workspace.evidence.find((e: Evidence)=>e.id===binary.id).status,'Quarantined');
  assert.equal(workspace.findings.filter((f: {caseId:string})=>f.caseId===kase.id).length,0);
  await assert.rejects(context.pool!.query('UPDATE integrity_jobs SET source_digest=$2 WHERE id=$1',[job.id,'0'.repeat(64)]),/immutable/);
  await assert.rejects(context.schemaAdminPool!.query('DELETE FROM integrity_job_events WHERE job_id=$1',[job.id]),/append-only/);
  const other=await createCase();
  assertError(await request('GET',`/api/cases/${other.id}/integrity-jobs/${job.id}`,context.demo!),404);
  assert.equal(await claimIntegrityJob(context.pool!,{...scope,tenantId:randomUUID()}),null);
  assertError(await request('POST',url,context.demo!,{payload:{...input,evidenceId:randomUUID()}}),409);
  assertError(await request('POST',url,context.demo!,{payload:input,csrfHeader:false}),403);
  const outsider=await createMember(demoTenantId,'investigator','Fictional job outsider');
  assertError(await request('GET',`${url}/${job.id}`,await issueTestSession(outsider)),404);
  const client=await createMember(demoTenantId,'client','Fictional job client');
  assertError(await request('GET',`${url}/${job.id}`,await issueTestSession(client)),403);
  assertError(await request('POST',url,await issueTestSession(client),{payload:input}),403);
});

test('job leases fence stale completion, cancellation and exhausted attempts', async () => {
  context.demo=await issueTestSession(demoUserId);
  const kase=await createCase();await approveAuthority(kase.id);
  const evidence=parseBody<Evidence>(await uploadEvidence(kase.id));
  const url=`/api/cases/${kase.id}/integrity-jobs`;
  async function enqueue(){const r=await request('POST',url,context.demo!,{payload:{evidenceId:evidence.id,idempotencyKey:randomUUID()}});assert.equal(r.statusCode,200,r.body);return {tenantId:demoTenantId,caseId:kase.id,jobId:JSON.parse(r.body).id};}
  const scope=await enqueue();
  const leases=await Promise.all([claimIntegrityJob(context.pool!,scope),claimIntegrityJob(context.pool!,scope)]);
  assert.equal(leases.filter(Boolean).length,1);
  const first=leases.find(Boolean)!;
  await context.schemaAdminPool!.query("UPDATE integrity_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[scope.jobId]);
  assert.equal(await finishIntegrityJob(context.pool!,scope,first.token,null),null);
  const second=await claimIntegrityJob(context.pool!,scope);assert.ok(second);
  assert.notEqual(first.token,second.token);
  assert.equal(await finishIntegrityJob(context.pool!,scope,first.token,null),null);
  assert.equal((await request('POST',`${url}/${scope.jobId}/cancel`,context.demo!,{payload:{}})).statusCode,200);
  assert.equal(await finishIntegrityJob(context.pool!,scope,second.token,null),null);
  const exhausted=await enqueue();
  for(let i=0;i<3;i++){
    assert.ok(await claimIntegrityJob(context.pool!,exhausted));
    await context.schemaAdminPool!.query("UPDATE integrity_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[exhausted.jobId]);
  }
  assert.equal(await claimIntegrityJob(context.pool!,exhausted),null);
  const response=await request('GET',`${url}/${exhausted.jobId}`,context.demo!);
  assert.equal(JSON.parse(response.body).failureCode,'attempts_exhausted');
  assert.equal(JSON.parse(response.body).attempt,3);
});

test('jobs recheck authority and membership and fail safely on missing or corrupt originals', async () => {
  context.demo=await issueTestSession(demoUserId);
  const kase=await createCase();await approveAuthority(kase.id);
  const evidence=parseBody<Evidence>(await uploadEvidence(kase.id));
  const url=`/api/cases/${kase.id}/integrity-jobs`;
  async function enqueue(){const r=await request('POST',url,context.demo!,{payload:{evidenceId:evidence.id,idempotencyKey:randomUUID()}});assert.equal(r.statusCode,200,r.body);return {tenantId:demoTenantId,caseId:kase.id,jobId:JSON.parse(r.body).id};}
  const stale=await enqueue();await approveAuthority(kase.id);
  assert.equal(await runIntegrityJob(context.pool!,context.storageRoot!,stale),null);
  assert.equal(JSON.parse((await request('GET',`${url}/${stale.jobId}`,context.demo!)).body).failureCode,'scope_changed');
  const revoked=await enqueue(); const lease=await claimIntegrityJob(context.pool!,revoked);assert.ok(lease);
  await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,kase.id,demoUserId]);
  assert.equal((await finishIntegrityJob(context.pool!,revoked,lease.token,null))?.status,'cancelled');
  assertError(await request('GET',`${url}/${revoked.jobId}`,context.demo!),404);
  await context.schemaAdminPool!.query('INSERT INTO case_memberships (tenant_id,case_id,user_id) VALUES ($1,$2,$3)',[demoTenantId,kase.id,demoUserId]);
  const row=(await context.pool!.query('SELECT object_path FROM evidence WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[demoTenantId,kase.id,evidence.id])).rows[0];
  const path=resolve(context.storageRoot!,row.object_path);
  await writeFile(path,Buffer.from('corrupt fictional bytes'));
  assert.equal((await runIntegrityJob(context.pool!,context.storageRoot!,await enqueue()))?.failureCode,'digest_mismatch');
  await writeFile(path,Buffer.alloc(262145));
  assert.equal((await runIntegrityJob(context.pool!,context.storageRoot!,await enqueue()))?.failureCode,'original_unavailable');
  await rm(path);
  assert.equal((await runIntegrityJob(context.pool!,context.storageRoot!,await enqueue()))?.failureCode,'original_unavailable');
  await symlink('/dev/zero',path);
  assert.equal((await runIntegrityJob(context.pool!,context.storageRoot!,await enqueue()))?.failureCode,'original_unavailable');
  await rm(path);
});

test('durable text extraction commits immutable lineage and serves reverified derivatives over HTTP', async () => {
  context.demo=await issueTestSession(demoUserId);
  const kase=await createCase();await approveAuthority(kase.id);
  const text='\uFEFFFictional supplier á😀\r\nRepeated\nRepeated\rمورد';
  const evidence=parseBody<Evidence>(await uploadEvidence(kase.id,context.demo!,evidenceInput({text,expectedSha256:digest(text)})));
  await approveAuthority(kase.id); // Processing authority is separate from acquisition authority.
  const url=`/api/cases/${kase.id}/integrity-jobs`;
  const input={evidenceId:evidence.id,idempotencyKey:randomUUID(),kind:'utf8_line_index_v1'};
  const queued=await request('POST',url,context.demo!,{payload:input});assert.equal(queued.statusCode,200,queued.body);
  const job=JSON.parse(queued.body);assert.equal(job.authorityVersion,2);
  assertError(await request('GET',`${url}/${job.id}/derivative`,context.demo!),404);
  assertError(await request('POST',url,context.demo!,{payload:{...input,kind:'original_sha256_v1'}}),409);
  const scope={tenantId:demoTenantId,caseId:kase.id,jobId:job.id};
  const outcomes=await Promise.all([runIntegrityJob(context.pool!,context.storageRoot!,scope),runIntegrityJob(context.pool!,context.storageRoot!,scope)]);
  assert.equal(outcomes.filter(x=>x?.status==='succeeded').length,1);
  assert.equal(await runIntegrityJob(context.pool!,context.storageRoot!,scope),null);
  await context.app!.close();context.app=await createAppInstance();
  const response=await request('GET',`${url}/${job.id}/derivative`,context.demo!);assert.equal(response.statusCode,200,response.body);
  const result=JSON.parse(response.body);
  assert.equal(result.status,'unreviewed_derivative');assert.equal(result.sourceDigest,digest(text));
  assert.equal(result.authorityVersion,2);assert.equal(evidence.authorityVersion,1);
  assert.equal(result.derivative.text,text);assert.equal(result.derivative.lines.length,4);
  assert.equal(result.sourceTime,evidence.sourceTime);assert.equal(result.receivedAt,evidence.receivedTime);
  assert.equal(result.derivativeDigest,digest(JSON.stringify(result.derivative)));
  assert.equal(result.processorDigest,createHash('sha256').update(await readFile(new URL('../src/text-derivative.ts',import.meta.url))).digest('hex'));
  assert.equal('object_path' in result,false);assert.equal('lease_token' in result,false);
  const rows=await context.pool!.query('SELECT * FROM text_derivatives WHERE tenant_id=$1 AND case_id=$2 AND job_id=$3',[demoTenantId,kase.id,job.id]);
  assert.equal(rows.rowCount,1);assert.equal(rows.rows[0].attempt,1);
  await assert.rejects(context.pool!.query('UPDATE text_derivatives SET runtime=$2 WHERE job_id=$1',[job.id,'forged']),/permission denied/);
  await assert.rejects(context.schemaAdminPool!.query('DELETE FROM text_derivatives WHERE job_id=$1',[job.id]),/append-only/);
  const app=await createAppInstance();
  try {
    const address=await app.listen({host:'127.0.0.1',port:0});
    const overHttp=await fetch(`${address}${url}/${job.id}/derivative`,{headers:{cookie:context.demo!.cookie}});
    assert.equal(overHttp.status,200);assert.deepEqual(await overHttp.json(),result);
  } finally {await app.close();}
  const workspace=JSON.parse((await request('GET','/api/workspace',context.demo!)).body);
  assert.equal(workspace.findings.filter((f:{caseId:string})=>f.caseId===kase.id).length,0);
  const original=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[evidence.id])).rows[0];
  assert.equal((await readFile(resolve(context.storageRoot!,original.object_path))).toString('utf8'),text);
  const audit=await context.pool!.query("SELECT count(*)::int AS count FROM audit_events WHERE case_id=$1 AND action='derivative.read'",[kase.id]);
  assert.equal(audit.rows[0].count,2);
});

test('text derivation rejects binary inputs, scope changes, cancellation and invalid job kinds', async () => {
  context.demo=await issueTestSession(demoUserId);
  const kase=await createCase();await approveAuthority(kase.id);
  const evidence=parseBody<Evidence>(await uploadEvidence(kase.id));
  const url=`/api/cases/${kase.id}/integrity-jobs`;
  const input={evidenceId:evidence.id,idempotencyKey:randomUUID(),kind:'utf8_line_index_v1'};
  assertError(await request('POST',url,context.demo!,{payload:{...input,kind:'docling'}}),422);
  assertError(await request('POST',url,context.demo!,{payload:{...input,processorDigest:'f'.repeat(64)}}),422);
  const binary=await request('POST',`/api/cases/${kase.id}/evidence/binary`,context.demo!,{payload:{filename:'fictional.bin',contentBase64:'YQ==',expectedSha256:digest('a'),sourceTime:'2026-01-01T00:00:00Z',method:'Fictional binary fixture',idempotencyKey:randomUUID()}});
  assert.equal(binary.statusCode,200,binary.body);
  assertError(await request('POST',url,context.demo!,{payload:{...input,evidenceId:JSON.parse(binary.body).id}}),409);
  const queued=await request('POST',url,context.demo!,{payload:input});assert.equal(queued.statusCode,200,queued.body);
  const scope={tenantId:demoTenantId,caseId:kase.id,jobId:JSON.parse(queued.body).id};
  await approveAuthority(kase.id);
  assert.equal(await runIntegrityJob(context.pool!,context.storageRoot!,scope),null);
  assertError(await request('GET',`${url}/${scope.jobId}/derivative`,context.demo!),404);
  const next=await request('POST',url,context.demo!,{payload:{...input,idempotencyKey:randomUUID()}});
  assert.equal(next.statusCode,200,next.body);const nextId=JSON.parse(next.body).id;
  assert.equal((await request('POST',`${url}/${nextId}/cancel`,context.demo!,{payload:{}})).statusCode,200);
  assert.equal(await runIntegrityJob(context.pool!,context.storageRoot!,{...scope,jobId:nextId}),null);
  assert.equal((await context.pool!.query('SELECT count(*)::int AS count FROM text_derivatives WHERE case_id=$1',[kase.id])).rows[0].count,0);
});

test('derivative publication is atomic with successful jobs and failures leave no result', async () => {
  context.demo=await issueTestSession(demoUserId);
  const kase=await createCase();await approveAuthority(kase.id);
  const evidence=parseBody<Evidence>(await uploadEvidence(kase.id));
  const url=`/api/cases/${kase.id}/integrity-jobs`;
  async function enqueue(evidenceId=evidence.id) {
    const r=await request('POST',url,context.demo!,{payload:{evidenceId,idempotencyKey:randomUUID(),kind:'utf8_line_index_v1'}});
    assert.equal(r.statusCode,200,r.body);return {tenantId:demoTenantId,caseId:kase.id,jobId:JSON.parse(r.body).id};
  }
  const scope=await enqueue(),lease=await claimIntegrityJob(context.pool!,scope);assert.ok(lease);
  await assert.rejects(finishIntegrityJob(context.pool!,scope,lease.token,null),/requires immutable derivative/);
  assert.equal(JSON.parse((await request('GET',`${url}/${scope.jobId}`,context.demo!)).body).status,'running');
  await context.schemaAdminPool!.query("UPDATE integrity_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[scope.jobId]);
  assert.equal((await runIntegrityJob(context.pool!,context.storageRoot!,scope))?.status,'succeeded');
  assert.equal(await finishIntegrityJob(context.pool!,scope,lease.token,null),null);
  assert.equal((await context.pool!.query('SELECT attempt FROM text_derivatives WHERE job_id=$1',[scope.jobId])).rows[0].attempt,2);
  const large='Fictional lines\n'+'\n'.repeat(4096);
  const many=parseBody<Evidence>(await uploadEvidence(kase.id,context.demo!,evidenceInput({text:large,expectedSha256:digest(large)})));
  const failed=await enqueue(many.id);
  assert.equal((await runIntegrityJob(context.pool!,context.storageRoot!,failed))?.failureCode,'text_limits');
  assertError(await request('GET',`${url}/${failed.jobId}/derivative`,context.demo!),404);
  // Force a storage failure after terminal update; transaction must retain the lease and omit its success event.
  const rollback=await enqueue();
  await context.schemaAdminPool!.query(`CREATE FUNCTION deny_derivative_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional derivative failure'; END $$`);
  await context.schemaAdminPool!.query('CREATE TRIGGER deny_derivative_test BEFORE INSERT ON text_derivatives FOR EACH ROW EXECUTE FUNCTION deny_derivative_test()');
  try {await assert.rejects(runIntegrityJob(context.pool!,context.storageRoot!,rollback),/fictional derivative failure/);} finally {
    await context.schemaAdminPool!.query('DROP TRIGGER deny_derivative_test ON text_derivatives');await context.schemaAdminPool!.query('DROP FUNCTION deny_derivative_test()');
  }
  assert.equal(JSON.parse((await request('GET',`${url}/${rollback.jobId}`,context.demo!)).body).status,'running');
  const events=await context.pool!.query('SELECT status FROM integrity_job_events WHERE job_id=$1 ORDER BY id',[rollback.jobId]);
  assert.deepEqual(events.rows.map(r=>r.status),['queued','running']);
  await context.schemaAdminPool!.query("UPDATE integrity_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[rollback.jobId]);
  assert.equal((await runIntegrityJob(context.pool!,context.storageRoot!,rollback))?.status,'succeeded');
});

test('derivative reads deny foreign scopes and revoked access and fail closed on original or output tampering', async () => {
  context.demo=await issueTestSession(demoUserId);
  const kase=await createCase();await approveAuthority(kase.id);
  const evidence=parseBody<Evidence>(await uploadEvidence(kase.id));
  const queued=await request('POST',`/api/cases/${kase.id}/integrity-jobs`,context.demo!,{payload:{evidenceId:evidence.id,idempotencyKey:randomUUID(),kind:'utf8_line_index_v1'}});
  assert.equal(queued.statusCode,200,queued.body);const jobId=JSON.parse(queued.body).id;
  await runIntegrityJob(context.pool!,context.storageRoot!,{tenantId:demoTenantId,caseId:kase.id,jobId});
  const url=`/api/cases/${kase.id}/integrity-jobs/${jobId}/derivative`;
  const other=await createCase();assertError(await request('GET',`/api/cases/${other.id}/integrity-jobs/${jobId}/derivative`,context.demo!),404);
  const outsider=await createMember(demoTenantId,'investigator','Fictional derivative outsider');
  assertError(await request('GET',url,await issueTestSession(outsider)),404);
  const client=await createMember(demoTenantId,'client','Fictional derivative client');
  assertError(await request('GET',url,await issueTestSession(client)),403);
  const foreignTenant=randomUUID();await context.schemaAdminPool!.query('INSERT INTO tenants (id,name) VALUES ($1,$2)',[foreignTenant,'Fictional derivative foreign agency']);
  const foreign=await createMember(foreignTenant,'reviewer','Fictional foreign reviewer');
  assertError(await request('GET',url,await issueTestSession(foreign,foreignTenant)),404);
  await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,kase.id,demoUserId]);
  assertError(await request('GET',url,context.demo!),404);
  await context.schemaAdminPool!.query('INSERT INTO case_memberships (tenant_id,case_id,user_id) VALUES ($1,$2,$3)',[demoTenantId,kase.id,demoUserId]);
  const row=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[evidence.id])).rows[0];
  const path=resolve(context.storageRoot!,row.object_path),original=await readFile(path);
  await writeFile(path,'corrupt');assertError(await request('GET',url,context.demo!),409);await writeFile(path,original);
  // Deliberate administrator corruption fixture: prove re-verification even when both output and its digest change.
  await context.schemaAdminPool!.query('ALTER TABLE text_derivatives DISABLE TRIGGER text_derivatives_append_only');
  try {
    const d=(await context.pool!.query('SELECT output_bytes FROM text_derivatives WHERE job_id=$1',[jobId])).rows[0];
    const forged=JSON.parse(d.output_bytes.toString());forged.lines[0].endByte=1;
    const raw=JSON.stringify(forged);
    await context.schemaAdminPool!.query('UPDATE text_derivatives SET output_bytes=$2,output_digest=$3 WHERE job_id=$1',[jobId,Buffer.from(raw),digest(raw)]);
  } finally {await context.schemaAdminPool!.query('ALTER TABLE text_derivatives ENABLE TRIGGER text_derivatives_append_only');}
  assertError(await request('GET',url,context.demo!),409);
});

test('explicit original-byte citations select repeated Unicode passages and survive review and offline export', async () => {
  context.demo=await issueTestSession(demoUserId);
  const kase=await createCase();await approveAuthority(kase.id);
  const text='\uFEFFFictional first: á😀 repeat\r\nFictional second: á😀 repeat\n';
  const quote='á😀 repeat';
  const evidence=parseBody<Evidence>(await uploadEvidence(kase.id,context.demo!,evidenceInput({text,expectedSha256:digest(text)})));
  const url=`/api/cases/${kase.id}/claims`;
  const input={evidenceId:evidence.id,text:'The second fictional record repeats the same wording.',quote};
  assertError(await request('POST',url,context.demo!,{payload:input}),422);
  const start=Buffer.byteLength(text.slice(0,text.lastIndexOf(quote)),'utf8'),end=start+Buffer.byteLength(quote,'utf8');
  const response=await request('POST',url,context.demo!,{payload:{...input,sourceStartByte:start,sourceEndByte:end}});
  assert.equal(response.statusCode,200,response.body);const claim=JSON.parse(response.body);
  assert.equal(claim.sourceStartByte,start);assert.equal(claim.sourceEndByte,end);assert.equal(claim.sourceDigest,digest(text));
  assert.equal(claim.status,'Under review');
  const reviewUrl=`${url}/${claim.id}/review`,decision={accepted:true,reason:'Reviewed the second fictional occurrence in context.'};
  assert.equal((await request('POST',reviewUrl,context.demo!,{payload:decision})).statusCode,200);
  assert.equal((await request('POST',reviewUrl,context.demo!,{payload:decision})).statusCode,200);
  const reportResponse=await request('GET',`/api/cases/${kase.id}/report`,context.demo!);assert.equal(reportResponse.statusCode,200,reportResponse.body);
  const report=JSON.parse(reportResponse.body);assert.equal(report.findings[0].source.startByte,start);assert.equal(report.findings[0].source.endByte,end);
  const path=join(context.storageRoot!,`explicit-span-${randomUUID()}.json`);await writeFile(path,reportResponse.body);
  const verify=fileURLToPath(new URL('../../../tools/verify_report.py',import.meta.url));
  const verified=await promisify(execFile)('python3',[verify,path,'--expected-sha256',digest(reportResponse.body)],{timeout:10000});
  assert.equal(JSON.parse(verified.stdout).reportSha256,digest(reportResponse.body));
  assert.equal(JSON.parse(verified.stdout).trustedReportDigestMatched,true);
  const workspace=JSON.parse((await request('GET','/api/workspace',context.demo!)).body);
  assert.equal(workspace.claims.find((c:{id:string})=>c.id===claim.id).sourceStartByte,start);
});

test('claim ranges reject incomplete, invalid, split-Unicode and fabricated source selections', async () => {
  context.demo=await issueTestSession(demoUserId);
  const kase=await createCase();await approveAuthority(kase.id);
  const text='Fictional: á😀 and literal �. aaaa';
  const evidence=parseBody<Evidence>(await uploadEvidence(kase.id,context.demo!,evidenceInput({text,expectedSha256:digest(text)})));
  const url=`/api/cases/${kase.id}/claims`;
  const input={evidenceId:evidence.id,text:'A fictional passage used for validation.',quote:'á'};
  const start=Buffer.from(text).indexOf(Buffer.from('á'));
  for(const invalid of [
    {sourceStartByte:start},{sourceEndByte:start+2},{sourceStartByte:-1,sourceEndByte:2},
    {sourceStartByte:start+1,sourceEndByte:start+2},{sourceStartByte:start,sourceEndByte:start},
    {sourceStartByte:start,sourceEndByte:262145},{sourceStartByte:0.5,sourceEndByte:2},
    {sourceStartByte:start,sourceEndByte:start+2,quote:'�'},
    {sourceStartByte:start,sourceEndByte:start+2,quote:'\ud83d'},
  ]) assertError(await request('POST',url,context.demo!,{payload:{...input,...invalid}}),422);
  assertError(await request('POST',url,context.demo!,{payload:{...input,quote:'aa'}}),422); // Overlapping occurrences count.
  assertError(await request('POST',url,context.demo!,{payload:{...input,quote:'\ud83d'}}),422);
  assert.equal((await request('POST',url,context.demo!,{payload:input})).statusCode,200); // Unique old callers still work.
  assert.equal((await context.pool!.query('SELECT count(*)::int AS count FROM claims WHERE case_id=$1',[kase.id])).rows[0].count,1);
});

test('claim source identity is immutable and review replay or reports reject changed reviewed ranges', async () => {
  context.demo=await issueTestSession(demoUserId);
  const kase=await createCase();await approveAuthority(kase.id);
  const text='Fictional á then � and another �.';
  const evidence=parseBody<Evidence>(await uploadEvidence(kase.id,context.demo!,evidenceInput({text,expectedSha256:digest(text)})));
  const quote='�',first=Buffer.from(text).indexOf(Buffer.from(quote));
  const url=`/api/cases/${kase.id}/claims`;
  const created=await request('POST',url,context.demo!,{payload:{evidenceId:evidence.id,text:'Fictional literal replacement character at the selected position.',quote,sourceStartByte:first,sourceEndByte:first+3}});
  assert.equal(created.statusCode,200,created.body);const id=JSON.parse(created.body).id;
  for (const [field,value] of [['text','Changed fictional narrative'],['quote','Changed quote'],['source_start_byte',first+1],['source_digest','0'.repeat(64)]] as const) {
    await assert.rejects(context.pool!.query(`UPDATE claims SET ${field}=$2 WHERE id=$1`,[id,value]),/immutable/);
  }
  const decision={accepted:true,reason:'Reviewed the first literal replacement character.'};
  const review=`${url}/${id}/review`;
  assert.equal((await request('POST',review,context.demo!,{payload:decision})).statusCode,200);
  const second=Buffer.from(text).lastIndexOf(Buffer.from(quote));
  await corruptClaim('UPDATE claims SET source_start_byte=$2,source_end_byte=$3 WHERE id=$1',[id,second,second+3]);
  assertError(await request('POST',review,context.demo!,{payload:decision}),409); // Valid quote but different reviewed occurrence.
  assertError(await request('GET',`/api/cases/${kase.id}/report`,context.demo!),409);
  const midpoint=Buffer.from(text).indexOf(Buffer.from('á'))+1;
  await corruptClaim('UPDATE claims SET source_start_byte=$2,source_end_byte=$3 WHERE id=$1',[id,midpoint,midpoint+1]);
  assertError(await request('POST',review,context.demo!,{payload:decision}),409); // Replacement decoding must not pass.
  assertError(await request('GET',`/api/cases/${kase.id}/report`,context.demo!),409);
});

async function reportFixture() {
  context.demo=await issueTestSession(demoUserId);
  const kase=await createCase();await approveAuthority(kase.id);
  const evidence=parseBody<Evidence>(await uploadEvidence(kase.id));
  const claim=JSON.parse((await createClaim(kase.id,evidence.id)).body);
  const review=await request('POST',`/api/cases/${kase.id}/claims/${claim.id}/review`,context.demo!,{payload:{accepted:true,reason:'Reviewed fictional original for frozen report.'}});
  assert.equal(review.statusCode,200,review.body);
  return {kase,evidence,url:`/api/cases/${kase.id}/report-revisions`};
}

test('frozen reports deduplicate concurrent requests, survive restart and preserve independently verifiable bytes',async()=>{
  const {kase,evidence,url}=await reportFixture();
  const input={idempotencyKey:randomUUID()};
  const replies=await Promise.all([request('POST',url,context.demo!,{payload:input}),request('POST',url,context.demo!,{payload:input})]);
  replies.forEach(r=>assert.equal(r.statusCode,200,r.body));
  const receipt=JSON.parse(replies[0]!.body);assert.deepEqual(JSON.parse(replies[1]!.body),receipt);
  const download=await request('GET',`${url}/${receipt.id}`,context.demo!);
  assert.equal(download.statusCode,200,download.body);assert.equal(digest(download.body),receipt.sha256);
  assert.equal(download.headers['cache-control'],'no-store');assert.equal(download.headers['x-inveos-report-sha256'],receipt.sha256);
  await createWork(kase.id,workInput({kind:'question',title:'New fictional question after freeze'}));
  const next=await request('POST',url,context.demo!,{payload:{idempotencyKey:randomUUID()}});assert.equal(next.statusCode,200,next.body);
  assert.notEqual(JSON.parse(next.body).sha256,receipt.sha256);
  await context.app!.close();context.app=await createAppInstance();
  assert.equal((await request('GET',`${url}/${receipt.id}`,context.demo!)).body,download.body);
  const original=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[evidence.id])).rows[0];
  await writeFile(resolve(context.storageRoot!,original.object_path),'corrupt fictional original after export');
  assertError(await request('POST',url,context.demo!,{payload:{idempotencyKey:randomUUID()}}),409);
  assert.deepEqual(JSON.parse((await request('POST',url,context.demo!,{payload:input})).body),receipt);
  assert.equal((await request('GET',`${url}/${receipt.id}`,context.demo!)).body,download.body);
  const file=join(context.storageRoot!,`frozen-${receipt.id}.json`);await writeFile(file,download.body);
  const verifier=fileURLToPath(new URL('../../../tools/verify_report.py',import.meta.url));
  const verified=await promisify(execFile)('python3',[verifier,file,'--expected-sha256',receipt.sha256,'--expected-case-id',kase.id]);
  assert.equal(JSON.parse(verified.stdout).trustedReportDigestMatched,true);
  const count=await context.pool!.query("SELECT count(*)::int AS n FROM audit_events WHERE case_id=$1 AND action='report.frozen'",[kase.id]);assert.equal(count.rows[0].n,2);
});

test('frozen reports enforce case and role boundaries, CSRF, immutable storage and corruption detection',async()=>{
  const {kase,url}=await reportFixture(),input={idempotencyKey:randomUUID()};
  assertError(await request('POST',url,context.demo!,{payload:input,csrfHeader:false}),403);
  assertError(await request('POST',url,context.demo!,{payload:{...input,report:{}}}),422);
  const created=await request('POST',url,context.demo!,{payload:input});assert.equal(created.statusCode,200,created.body);
  const id=JSON.parse(created.body).id;
  const outsider=await createMember(demoTenantId,'investigator','Fictional frozen-report outsider');
  const client=await createMember(demoTenantId,'client','Fictional frozen-report client');
  for(const [session,code] of [[await issueTestSession(outsider),404],[await issueTestSession(client),403]] as const){
    assertError(await request('GET',`${url}/${id}`,session),code);assertError(await request('POST',url,session,{payload:input}),code);
  }
  const other=await createCase();assertError(await request('GET',`/api/cases/${other.id}/report-revisions/${id}`,context.demo!),404);
  await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,kase.id,demoUserId]);
  assertError(await request('GET',`${url}/${id}`,context.demo!),404);
  await context.schemaAdminPool!.query('INSERT INTO case_memberships (tenant_id,case_id,user_id) VALUES ($1,$2,$3)',[demoTenantId,kase.id,demoUserId]);
  await assert.rejects(context.pool!.query('UPDATE report_revisions SET digest=$2 WHERE id=$1',[id,'0'.repeat(64)]),/permission denied/);
  await assert.rejects(context.schemaAdminPool!.query('DELETE FROM report_revisions WHERE id=$1',[id]),/append-only/);
  await context.schemaAdminPool!.query('ALTER TABLE report_revisions DISABLE TRIGGER report_revisions_append_only');
  try {await context.schemaAdminPool!.query('UPDATE report_revisions SET report_bytes=$2 WHERE id=$1',[id,Buffer.from('{}')]);}
  finally {await context.schemaAdminPool!.query('ALTER TABLE report_revisions ENABLE TRIGGER report_revisions_append_only');}
  assertError(await request('GET',`${url}/${id}`,context.demo!),409);
  assertError(await request('POST',url,context.demo!,{payload:input}),409);
});

test('freezing requires reviewed findings and rolls back its revision when audit insertion fails',async()=>{
  context.demo=await issueTestSession(demoUserId);const empty=await createCase();
  assertError(await request('POST',`/api/cases/${empty.id}/report-revisions`,context.demo!,{payload:{idempotencyKey:randomUUID()}}),422);
  const {kase,url}=await reportFixture(),input={idempotencyKey:randomUUID()};
  await context.schemaAdminPool!.query(`CREATE FUNCTION fail_report_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='report.frozen' THEN
      IF current_setting('transaction_isolation')<>'repeatable read' THEN RAISE EXCEPTION 'wrong isolation'; END IF;
      RAISE EXCEPTION 'fictional audit failure'; END IF; RETURN NEW; END $$`);
  await context.schemaAdminPool!.query('CREATE TRIGGER fail_report_audit_test BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_report_audit_test()');
  try {assertError(await request('POST',url,context.demo!,{payload:input}),500);} finally {
    await context.schemaAdminPool!.query('DROP TRIGGER fail_report_audit_test ON audit_events');await context.schemaAdminPool!.query('DROP FUNCTION fail_report_audit_test()');
  }
  assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM report_revisions WHERE case_id=$1',[kase.id])).rows[0].n,0);
  const retried=await request('POST',url,context.demo!,{payload:input});assert.equal(retried.statusCode,200,retried.body);
});

test('report freeze keeps one real database snapshot when a case edit commits between assembler queries',async()=>{
  const {kase,url}=await reportFixture();
  const scopeBefore=JSON.parse((await request('GET',`/api/cases/${kase.id}/report`,context.demo!)).body).case.scope;
  const pool=context.pool!;
  const originals=new Map<import('pg').PoolClient,import('pg').PoolClient['query']>();
  let edited=false;
  // Commit on a second connection after access establishes the snapshot, before assembly.
  // No query results are mocked; restore the instrumented client before returning it to the pool.
  const instrument=(client: import('pg').PoolClient)=>{
    if(originals.has(client)) return;
    const query=client.query.bind(client);originals.set(client,query);
    client.query=((...args: unknown[])=>{
      const result=(query as (...args:unknown[])=>Promise<unknown>)(...args);
      if(!edited && typeof args[0]==='string' && args[0].includes("SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role")) {
        edited=true;
        return result.then(async rows=>{
          await context.schemaAdminPool!.query('UPDATE cases SET scope=$2 WHERE id=$1',[kase.id,'Fictional scope edited during report assembly']);
          return rows;
        });
      }
      return result;
    }) as typeof client.query;
  };
  pool.on('acquire',instrument);
  let frozen;
  try {frozen=await request('POST',url,context.demo!,{payload:{idempotencyKey:randomUUID()}});} finally {pool.off('acquire',instrument);for(const [client,query] of originals) client.query=query;}
  assert.equal(frozen.statusCode,200,frozen.body);assert.equal(edited,true);
  const id=JSON.parse(frozen.body).id;
  const app=await createAppInstance();
  try {
    const address=await app.listen({host:'127.0.0.1',port:0});
    const response=await fetch(`${address}${url}/${id}`,{headers:{cookie:context.demo!.cookie}});
    assert.equal(response.status,200);
    const raw=await response.text();assert.equal(digest(raw),JSON.parse(frozen.body).sha256);
    assert.equal(JSON.parse(raw).case.scope,scopeBefore);
  } finally {await app.close();}
  const current=await request('GET',`/api/cases/${kase.id}/report`,context.demo!);
  assert.equal(JSON.parse(current.body).case.scope,'Fictional scope edited during report assembly');
});

test('revision history paginates scoped receipts without report content and survives a newer insertion',async()=>{
  const {url}=await reportFixture();const ids:string[]=[];
  for(let i=0;i<5;i++){const r=await request('POST',url,context.demo!,{payload:{idempotencyKey:randomUUID()}});assert.equal(r.statusCode,200,r.body);ids.unshift(JSON.parse(r.body).id);}
  const first=await request('GET',`${url}?limit=2`,context.demo!);assert.equal(first.statusCode,200,first.body);
  const page=JSON.parse(first.body);assert.deepEqual(page.items.map((x:{id:string})=>x.id),ids.slice(0,2));assert.equal(page.nextBefore,ids[1]);
  assert.equal(first.headers['cache-control'],'no-store');
  for(const item of page.items)assert.deepEqual(Object.keys(item).sort(),['caseId','createdAt','id','sha256','status'].sort());
  const newer=await request('POST',url,context.demo!,{payload:{idempotencyKey:randomUUID()}});assert.equal(newer.statusCode,200,newer.body);
  const second=JSON.parse((await request('GET',`${url}?limit=2&before=${page.nextBefore}`,context.demo!)).body);
  const third=JSON.parse((await request('GET',`${url}?limit=2&before=${second.nextBefore}`,context.demo!)).body);
  assert.deepEqual([...page.items,...second.items,...third.items].map((x:{id:string})=>x.id),ids);assert.equal(third.nextBefore,null);
  const refreshed=JSON.parse((await request('GET',`${url}?limit=1`,context.demo!)).body);assert.equal(refreshed.items[0].id,JSON.parse(newer.body).id);
  const app=await createAppInstance();try {
    const address=await app.listen({host:'127.0.0.1',port:0});
    const overHttp=await fetch(`${address}${url}?limit=2`,{headers:{cookie:context.demo!.cookie}});assert.equal(overHttp.status,200);assert.equal(((await overHttp.json()) as {items:unknown[]}).items.length,2);
  }finally{await app.close();}
});

test('revision listing rejects foreign cursors, invalid pagination, client and revoked access',async()=>{
  const {kase,url}=await reportFixture();
  const own=JSON.parse((await request('POST',url,context.demo!,{payload:{idempotencyKey:randomUUID()}})).body);
  const other=await reportFixture();
  const foreign=JSON.parse((await request('POST',other.url,context.demo!,{payload:{idempotencyKey:randomUUID()}})).body);
  assertError(await request('GET',`${url}?before=${foreign.id}`,context.demo!),404);
  for(const suffix of ['?limit=0','?limit=51','?limit=1.5','?before=invalid','?tenantId=x'])assertError(await request('GET',url+suffix,context.demo!),422);
  const outsider=await createMember(demoTenantId,'investigator','Fictional history outsider');
  assertError(await request('GET',url,await issueTestSession(outsider)),404);
  const client=await createMember(demoTenantId,'client','Fictional history client');
  assertError(await request('GET',url,await issueTestSession(client)),403);
  const tenant=randomUUID();await context.schemaAdminPool!.query('INSERT INTO tenants (id,name) VALUES ($1,$2)',[tenant,'Fictional history foreign tenant']);
  const foreignUser=await createMember(tenant,'reviewer','Fictional foreign history reviewer');
  assertError(await request('GET',`${url}?before=${own.id}`,await issueTestSession(foreignUser,tenant)),404);
  await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,kase.id,demoUserId]);
  assertError(await request('GET',url,context.demo!),404);
  const empty=await createCase();const emptyPage=await request('GET',`/api/cases/${empty.id}/report-revisions`,context.demo!);
  assert.deepEqual(JSON.parse(emptyPage.body),{items:[],nextBefore:null});
});

// Administrative bulk fixture only: clone a real API-created reviewed finding's
// lineage with fresh claim/review/finding IDs. Never amend its accepted provenance.
async function duplicateReportFinding(caseId: string, copies: number) {
  const ids = Array.from({length: copies}, () => randomUUID());
  await context.schemaAdminPool!.query(`INSERT INTO claims
    (tenant_id,case_id,id,evidence_id,authority_id,authority_version,text,quote,source_start_byte,source_end_byte,source_digest,status,reason,created_by)
    SELECT c.tenant_id,c.case_id,new_id,c.evidence_id,c.authority_id,c.authority_version,c.text,c.quote,c.source_start_byte,c.source_end_byte,c.source_digest,c.status,c.reason,c.created_by
    FROM (SELECT * FROM claims WHERE case_id=$1 ORDER BY created_at,id LIMIT 1) c CROSS JOIN unnest($2::uuid[]) new_id`,[caseId,ids]);
  await context.schemaAdminPool!.query(`INSERT INTO reviews
    (tenant_id,case_id,id,claim_id,accepted,reason,reviewed_by,source_digest,source_start_byte,source_end_byte)
    SELECT tenant_id,case_id,gen_random_uuid(),id,true,'Fictional bulk regression review',created_by,source_digest,source_start_byte,source_end_byte
    FROM claims WHERE case_id=$1 AND id=ANY($2::uuid[])`,[caseId,ids]);
  await context.schemaAdminPool!.query(`INSERT INTO findings
    (tenant_id,case_id,id,claim_id,review_id,text,reviewer_user_id,reviewed_at)
    SELECT r.tenant_id,r.case_id,gen_random_uuid(),r.claim_id,r.id,c.text,r.reviewed_by,r.reviewed_at
    FROM reviews r JOIN claims c ON c.tenant_id=r.tenant_id AND c.case_id=r.case_id AND c.id=r.claim_id
    WHERE r.case_id=$1 AND r.claim_id=ANY($2::uuid[])`,[caseId,ids]);
}

async function assertNoFrozenReport(caseId: string) {
  const rows=await context.pool!.query(`SELECT
    (SELECT count(*)::int FROM report_revisions WHERE case_id=$1) AS revisions,
    (SELECT count(*)::int FROM audit_events WHERE case_id=$1 AND action='report.frozen') AS audits`,[caseId]);
  assert.deepEqual(rows.rows[0],{revisions:0,audits:0});
}

test('report byte budget counts repeated originals and rejects live and frozen exports without partial receipts',async()=>{
  context.demo=await issueTestSession(demoUserId);
  const kase=await createCase();await approveAuthority(kase.id);
  const text=sourceText()+'F'.repeat(262144-Buffer.byteLength(sourceText()));
  const upload=await uploadEvidence(kase.id,context.demo!,evidenceInput({text,expectedSha256:digest(text)}));
  assert.equal(upload.statusCode,200,upload.body);
  const claim=JSON.parse((await createClaim(kase.id,JSON.parse(upload.body).id)).body);
  const review=await request('POST',`/api/cases/${kase.id}/claims/${claim.id}/review`,context.demo!,{payload:{accepted:true,reason:'Reviewed fictional large source.'}});
  assert.equal(review.statusCode,200,review.body);
  await duplicateReportFinding(kase.id,100);
  const url=`/api/cases/${kase.id}/report-revisions`,key=randomUUID();
  const app=await createAppInstance();
  try {
    const address=await app.listen({host:'127.0.0.1',port:0});
    const live=await fetch(`${address}/api/cases/${kase.id}/report`,{headers:{cookie:context.demo!.cookie}});
    assert.equal(live.status,422);assert.match(await live.text(),/Report byte limit exceeded/);
  } finally {await app.close();}
  for(let i=0;i<2;i++) {
    const frozen=await request('POST',url,context.demo!,{payload:{idempotencyKey:key}});
    assertError(frozen,422);assert.match(frozen.body,/Report byte limit exceeded/);
  }
  await assertNoFrozenReport(kase.id);
  // A failed cursor/budget transaction must not poison the next request's connection.
  const small=await reportFixture();
  assert.equal((await request('POST',small.url,context.demo!,{payload:{idempotencyKey:randomUUID()}})).statusCode,200);
});

test('report finding cap crosses cursor batches and rejects 1001 without silently truncating',async()=>{
  const {kase,url}=await reportFixture();
  await duplicateReportFinding(kase.id,999);
  const valid=await request('GET',`/api/cases/${kase.id}/report`,context.demo!);
  assert.equal(valid.statusCode,200,valid.body);assert.equal(JSON.parse(valid.body).findings.length,1000);
  await duplicateReportFinding(kase.id,1);
  const invalid=await request('POST',url,context.demo!,{payload:{idempotencyKey:randomUUID()}});
  assertError(invalid,422);assert.match(invalid.body,/Report finding limit exceeded/);
  await assertNoFrozenReport(kase.id);
});

test('report context cap includes only disclosed working items and fails closed without partial revisions',async()=>{
  const {kase,url}=await reportFixture();
  // Excluded private notes must never be materialised into the report or consume its item cap.
  await context.schemaAdminPool!.query(`INSERT INTO case_work_items
    (tenant_id,case_id,id,kind,title,body,status,request_hash,created_by)
    SELECT $1,$2,gen_random_uuid(),'note','Fictional private note',repeat('N',12000),'Recorded',$3,$4 FROM generate_series(1,1001)`,[demoTenantId,kase.id,'a'.repeat(64),demoUserId]);
  const work=await createWork(kase.id,workInput({title:'Fictional "quoted" question',body:'Multilingual á😀\nSecond line'}));assert.equal(work.statusCode,200,work.body);
  await context.schemaAdminPool!.query(`INSERT INTO case_work_items
    (tenant_id,case_id,id,kind,title,body,status,request_hash,created_by)
    SELECT $1,$2,gen_random_uuid(),'question','Fictional bounded question','Fictional only','Open',$3,$4 FROM generate_series(1,999)`,[demoTenantId,kase.id,'b'.repeat(64),demoUserId]);
  const valid=await request('GET',`/api/cases/${kase.id}/report`,context.demo!);
  assert.equal(valid.statusCode,200,valid.body);
  assert.equal(JSON.parse(valid.body).investigation.questions.length,1000);
  assert.ok(!valid.body.includes('Fictional private note'));
  assert.equal((await createWork(kase.id)).statusCode,200);
  for(const response of [await request('GET',`/api/cases/${kase.id}/report`,context.demo!),await request('POST',url,context.demo!,{payload:{idempotencyKey:randomUUID()}})]) {
    assertError(response,422);assert.match(response.body,/Report working-context limit exceeded/);
  }
  await assertNoFrozenReport(kase.id);
});

test('report assembly rejects oversized and symlink replacement originals with no frozen receipt',async()=>{
  const {kase,evidence,url}=await reportFixture();
  const row=await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[evidence.id]);
  const path=join(context.storageRoot!,row.rows[0].object_path);
  const original=await readFile(path);
  await writeFile(path,Buffer.alloc(262145,65));
  assertError(await request('POST',url,context.demo!,{payload:{idempotencyKey:randomUUID()}}),409);
  const target=join(context.storageRoot!,`fictional-replacement-${randomUUID()}.txt`);await writeFile(target,original);
  await rm(path);await symlink(target,path);
  assertError(await request('GET',`/api/cases/${kase.id}/report`,context.demo!),409);
  await assertNoFrozenReport(kase.id);
  await rm(path);await writeFile(path,original);
  assert.equal((await request('POST',url,context.demo!,{payload:{idempotencyKey:randomUUID()}})).statusCode,200);
});


test('client freeze recovery retries a committed but unacknowledged HTTP request after local remount and case edit',async()=>{
  const {kase,url}=await reportFixture();
  const scope=await reportRecoveryScope(context.demo!.csrf,kase.id);
  const records=new Map<string,string>();
  const store=():RecoveryStore=>({getItem:key=>records.get(key)??null,setItem:(key,value)=>{records.set(key,value);},removeItem:key=>{records.delete(key);}});
  const app=await createAppInstance();
  try {
    const address=await app.listen({host:'127.0.0.1',port:0});
    const send=async(key:string)=>{
      const response=await fetch(`${address}${url}`,{method:'POST',headers:{cookie:context.demo!.cookie,origin:localOrigin,'content-type':'application/json','x-csrf-token':context.demo!.csrf},body:JSON.stringify({idempotencyKey:key})});
      assert.equal(response.status,200);return await response.json();
    };
    let committed:unknown;
    await assert.rejects(recoverableReportFreeze(store(),scope,kase.id,async key=>{
      committed=await send(key);throw new Error('Fictional receipt lost after server commit');
    }),/receipt lost/);
    assert.equal(records.size,1);
    await context.schemaAdminPool!.query('UPDATE cases SET title=$2 WHERE id=$1',[kase.id,'Fictional title changed before retry']);
    // Fresh client helper/store wrapper; only the saved UUID survives, not component state.
    const recovered=await recoverableReportFreeze(store(),await reportRecoveryScope(context.demo!.csrf,kase.id),kase.id,send);
    assert.deepEqual(recovered,committed);assert.equal(records.size,0);
    const download=await fetch(`${address}${url}/${recovered.id}`,{headers:{cookie:context.demo!.cookie}});
    assert.equal(download.status,200);
    const bytes=await download.text();assert.equal(digest(bytes),recovered.sha256);
    assert.equal(JSON.parse(bytes).case.title,kase.title);
    const count=await context.pool!.query("SELECT count(*)::int AS n FROM audit_events WHERE case_id=$1 AND action='report.frozen'",[kase.id]);assert.equal(count.rows[0].n,1);
    const fresh=await recoverableReportFreeze(store(),scope,kase.id,send);assert.notEqual(fresh.id,recovered.id);
  } finally {await app.close();}
});

test('job history paginates stable case receipts and actual worker attempts over HTTP without worker credentials',async()=>{
  // Fresh server instance isolates this scenario's rate-limit budget; retain all application limits.
  await context.app!.close();context.app=await createAppInstance();
  const {kase,evidence}=await reportFixture(),url=`/api/cases/${kase.id}/integrity-jobs`;
  const queue=async()=>{const r=await request('POST',url,context.demo!,{payload:{evidenceId:evidence.id,idempotencyKey:randomUUID()}});assert.equal(r.statusCode,200,r.body);return JSON.parse(r.body);};
  const jobs=[];for(let i=0;i<4;i++)jobs.unshift(await queue());
  const first=await request('GET',`${url}?limit=2`,context.demo!);assert.equal(first.statusCode,200,first.body);assert.equal(first.headers['cache-control'],'no-store');
  const page=JSON.parse(first.body);assert.deepEqual(page.items.map((x:{id:string})=>x.id),jobs.slice(0,2).map(x=>x.id));
  assert.ok(!first.body.includes('lease_token'));assert.ok(!first.body.includes('idempotency_key'));assert.ok(!first.body.includes('requested_by'));
  await queue();
  const older=JSON.parse((await request('GET',`${url}?limit=2&before=${page.nextBefore}`,context.demo!)).body);
  assert.deepEqual(older.items.map((x:{id:string})=>x.id),jobs.slice(2).map(x=>x.id));assert.equal(older.nextBefore,null);
  const scope={tenantId:demoTenantId,caseId:kase.id,jobId:jobs[0].id};
  assert.equal((await runIntegrityJob(context.pool!,context.storageRoot!,scope))?.status,'succeeded');
  const app=await createAppInstance();
  try {
    const address=await app.listen({host:'127.0.0.1',port:0});
    const response=await fetch(`${address}${url}/${scope.jobId}/events?limit=2`,{headers:{cookie:context.demo!.cookie}});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    const events=await response.json() as {items:{id:string;status:string;attempt:number}[];nextAfter:string};
    assert.deepEqual(events.items.map(x=>[x.status,x.attempt]),[['queued',0],['running',1]]);
    assert.equal(typeof events.items[0]!.id,'string');
    const last=JSON.parse((await request('GET',`${url}/${scope.jobId}/events?after=${events.nextAfter}`,context.demo!)).body);
    assert.deepEqual(last.items.map((x:{status:string})=>x.status),['succeeded']);assert.equal(last.nextAfter,null);
  }finally{await app.close();}
  await request('POST',`${url}/${jobs[1].id}/cancel`,context.demo!,{payload:{}});
  const cancelled=JSON.parse((await request('GET',`${url}/${jobs[1].id}/events`,context.demo!)).body);
  assert.deepEqual(cancelled.items.map((x:{status:string})=>x.status),['queued','cancelled']);
});

test('job and attempt histories deny foreign cursors, invalid queries, clients, outsiders and revoked assignments',async()=>{
  // Fresh server instance isolates this scenario's rate-limit budget; retain all application limits.
  await context.app!.close();context.app=await createAppInstance();
  const {kase,evidence}=await reportFixture(),url=`/api/cases/${kase.id}/integrity-jobs`;
  const ids=[];for(let i=0;i<2;i++)ids.push(JSON.parse((await request('POST',url,context.demo!,{payload:{evidenceId:evidence.id,idempotencyKey:randomUUID()}})).body).id);
  const events=`${url}/${ids[0]}/events`;
  for(const suffix of ['?limit=0','?limit=51','?limit=1.5','?unknown=yes','?before=invalid'])assertError(await request('GET',url+suffix,context.demo!),422);
  for(const suffix of ['?after=-1','?after=1.5','?after=9999999999999999999','?limit=51','?unknown=yes'])assertError(await request('GET',events+suffix,context.demo!),422);
  const other=await createCase();assertError(await request('GET',`/api/cases/${other.id}/integrity-jobs?before=${ids[0]}`,context.demo!),404);
  assertError(await request('GET',`/api/cases/${other.id}/integrity-jobs/${ids[0]}/events`,context.demo!),404);
  const foreignEvent=JSON.parse((await request('GET',`${url}/${ids[1]}/events`,context.demo!)).body).items[0].id;
  assertError(await request('GET',`${events}?after=${foreignEvent}`,context.demo!),404);
  assertError(await request('GET',`${url}?before=${randomUUID()}`,context.demo!),404);
  const foreignTenant=randomUUID();await context.schemaAdminPool!.query('INSERT INTO tenants (id,name) VALUES ($1,$2)',[foreignTenant,'Fictional processing history agency']);
  const foreign=await createMember(foreignTenant,'reviewer','Fictional history foreign reviewer');
  for(const path of [url,events])assertError(await request('GET',path,await issueTestSession(foreign,foreignTenant)),404);
  const outsider=await createMember(demoTenantId,'investigator','Fictional history outsider'),client=await createMember(demoTenantId,'client','Fictional history client');
  for(const [session,code] of [[await issueTestSession(outsider),404],[await issueTestSession(client),403]] as const)for(const path of [url,events])assertError(await request('GET',path,session),code);
  await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,kase.id,demoUserId]);
  for(const path of [url,events])assertError(await request('GET',path,context.demo!),404);
});


test('attempt pagination preserves numeric sequence order beyond JavaScript safe integers',async()=>{
  // Fresh server instance isolates this scenario's rate-limit budget; retain all application limits.
  await context.app!.close();context.app=await createAppInstance();
  const {kase,evidence}=await reportFixture(),url=`/api/cases/${kase.id}/integrity-jobs`;
  const job=JSON.parse((await request('POST',url,context.demo!,{payload:{evidenceId:evidence.id,idempotencyKey:randomUUID()}})).body);
  // Explicit administrative append-only fixture; no sequence reset or history rewrite.
  for(const id of ['9999999999999999','10000000000000000'])await context.schemaAdminPool!.query(`INSERT INTO integrity_job_events
    (tenant_id,case_id,job_id,id,status,attempt) OVERRIDING SYSTEM VALUE VALUES ($1,$2,$3,$4,'queued',0)`,[demoTenantId,kase.id,job.id,id]);
  const first=JSON.parse((await request('GET',`${url}/${job.id}/events?limit=2`,context.demo!)).body);
  assert.equal(first.items[1].id,'9999999999999999');assert.equal(first.nextAfter,'9999999999999999');
  const second=JSON.parse((await request('GET',`${url}/${job.id}/events?after=${first.nextAfter}`,context.demo!)).body);
  assert.deepEqual(second.items.map((x:{id:string})=>x.id),['10000000000000000']);
});


test('actual HTTP derivative inspection binds processed bytes to the selected job and fails after original corruption',async()=>{
  await context.app!.close();context.app=await createAppInstance();
  const {kase,evidence}=await reportFixture(),base=`/api/cases/${kase.id}/integrity-jobs`;
  const queued=await request('POST',base,context.demo!,{payload:{evidenceId:evidence.id,idempotencyKey:randomUUID(),kind:'utf8_line_index_v1'}});
  assert.equal(queued.statusCode,200,queued.body);const jobId=JSON.parse(queued.body).id;
  assert.equal((await runIntegrityJob(context.pool!,context.storageRoot!,{tenantId:demoTenantId,caseId:kase.id,jobId}))?.status,'succeeded');
  const job=JSON.parse((await request('GET',`${base}/${jobId}`,context.demo!)).body);
  const app=await createAppInstance();
  try {
    const address=await app.listen({host:'127.0.0.1',port:0});
    const response=await fetch(`${address}${base}/${jobId}/derivative`,{headers:{cookie:context.demo!.cookie}});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    const raw=await response.json();const inspected=await inspectTextDerivative(raw,job);
    assert.equal(inspected.evidenceId,evidence.id);assert.equal(inspected.sourceDigest,evidence.digest);
    assert.ok(inspected.lines.some(line=>line.text.includes('NW-104')));
    await assert.rejects(inspectTextDerivative(raw,{...job,caseId:randomUUID()}));
    const file=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[evidence.id])).rows[0].object_path;
    await writeFile(join(context.storageRoot!,file),'Fictional corrupt original');
    const denied=await fetch(`${address}${base}/${jobId}/derivative`,{headers:{cookie:context.demo!.cookie}});
    assert.equal(denied.status,409);assert.equal(denied.headers.get('cache-control'),'no-store');
    const findings=await context.pool!.query('SELECT count(*)::int AS n FROM findings WHERE case_id=$1',[kase.id]);
    assert.equal(findings.rows[0].n,1); // The existing reviewed fixture only; inspection creates no finding.
  }finally{await app.close();}
});


test('queue helper recovers one committed HTTP job after response loss and feeds the real worker and inspector',async()=>{
  await context.app!.close();context.app=await createAppInstance();
  const {kase,evidence}=await reportFixture(),base=`/api/cases/${kase.id}/integrity-jobs`,scope=await jobRequestScope(context.demo!.csrf,kase.id);
  const entries=new Map<string,string>(),storage={getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>{entries.set(k,v);},removeItem:(k:string)=>{entries.delete(k);}};
  const app=await createAppInstance();
  try{
    const address=await app.listen({host:'127.0.0.1',port:0});
    const send=async(payload:unknown)=>{const r=await fetch(address+base,{method:'POST',headers:{cookie:context.demo!.cookie,origin:localOrigin,'content-type':'application/json','x-csrf-token':context.demo!.csrf},body:JSON.stringify(payload)});assert.equal(r.status,200);return r.json();};
    const input={evidenceId:evidence.id,kind:'utf8_line_index_v1' as const};let committed:unknown;
    await assert.rejects(queueRecoverably(storage,scope,kase.id,input,async p=>{committed=await send(p);throw new Error('Fictional receipt discarded');}));
    const recovered=await queueRecoverably({...storage},scope,kase.id,{evidenceId:randomUUID(),kind:'original_sha256_v1'},send);
    assert.deepEqual(recovered,committed);assert.equal(entries.size,0);
    const count=await context.pool!.query('SELECT count(*)::int AS n FROM integrity_jobs WHERE case_id=$1',[kase.id]);assert.equal(count.rows[0].n,1);
    assert.equal((await runIntegrityJob(context.pool!,context.storageRoot!,{tenantId:demoTenantId,caseId:kase.id,jobId:recovered.id}))?.status,'succeeded');
    const job=await (await fetch(`${address}${base}/${recovered.id}`,{headers:{cookie:context.demo!.cookie}})).json() as InspectionJob;
    const derivative=await (await fetch(`${address}${base}/${recovered.id}/derivative`,{headers:{cookie:context.demo!.cookie}})).json();
    assert.equal((await inspectTextDerivative(derivative,job)).sourceDigest,evidence.digest);
  }finally{await app.close();}
});

async function dispatchFixture() {
  await context.app!.close();context.app=await createAppInstance();context.demo=await issueTestSession(demoUserId);
  const kase=await createCase();await approveAuthority(kase.id);
  const evidence=parseBody<Evidence>(await uploadEvidence(kase.id));
  const base=`/api/cases/${kase.id}/integrity-jobs`,scope={tenantId:demoTenantId,caseId:kase.id};
  const enqueue=async(kind='original_sha256_v1')=>{
    const r=await request('POST',base,context.demo!,{payload:{evidenceId:evidence.id,idempotencyKey:randomUUID(),kind}});
    assert.equal(r.statusCode,200,r.body);return JSON.parse(r.body).id as string;
  };
  return {kase,evidence,base,scope,enqueue};
}

test('bounded dispatch skips locked rows and concurrent consumers complete each scoped job once',async()=>{
  const {scope,enqueue,base}=await dispatchFixture();
  const ids=[];for(let n=0;n<6;n++)ids.push(await enqueue(n%2?'utf8_line_index_v1':'original_sha256_v1'));
  const locked=await context.pool!.connect();
  try {
    await locked.query('BEGIN');await locked.query('SELECT id FROM integrity_jobs WHERE id=$1 FOR UPDATE',[ids[0]]);
    const next=await dispatchIntegrityJobs(context.pool!,context.storageRoot!,scope,1);
    assert.equal(next.selected,1);assert.equal(next.stopReason,'limit');assert.equal(next.results[0]!.jobId,ids[1]);
    assert.equal(next.results[0]!.status,'succeeded');
  }finally{await locked.query('ROLLBACK');locked.release();}
  const rounds=await Promise.all([dispatchIntegrityJobs(context.pool!,context.storageRoot!,scope,3),dispatchIntegrityJobs(context.pool!,context.storageRoot!,scope,3)]);
  const receipts=rounds.flatMap(r=>r.results);assert.equal(receipts.length,5);assert.equal(new Set(receipts.map(r=>r.jobId)).size,5);
  receipts.forEach(r=>{assert.equal(r.status,'succeeded');assert.equal(r.attempt,1);});
  assert.equal((await dispatchIntegrityJobs(context.pool!,context.storageRoot!,scope)).stopReason,'empty');
  const history=await context.pool!.query('SELECT job_id,count(*)::int AS n FROM integrity_job_events WHERE case_id=$1 GROUP BY job_id',[scope.caseId]);
  assert.equal(history.rows.length,6);history.rows.forEach(r=>assert.equal(r.n,3));
  const derivatives=await context.pool!.query('SELECT count(*)::int AS n FROM text_derivatives WHERE case_id=$1',[scope.caseId]);assert.equal(derivatives.rows[0].n,3);
  const waiting=await enqueue();
  for(const wrong of [{...scope,tenantId:randomUUID()},{...scope,caseId:randomUUID()}])assert.equal((await dispatchIntegrityJobs(context.pool!,context.storageRoot!,wrong)).selected,0);
  const aborted=new AbortController();aborted.abort();
  assert.deepEqual(await dispatchIntegrityJobs(context.pool!,context.storageRoot!,scope,10,aborted.signal),{selected:0,stopReason:'aborted',results:[]});
  const response=await request('GET',`${base}/${waiting}`,context.demo!);assert.equal(JSON.parse(response.body).status,'queued');
  assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM findings WHERE case_id=$1',[scope.caseId])).rows[0].n,0);
});

function dispatchEnvironment() {
  return {...process.env,INVEOS_DEV_LAB:'1',NODE_ENV:'test',INVEOS_DATABASE_URL:databaseUrl!,INVEOS_STORAGE_ROOT:context.storageRoot!,
    INVEOS_WORKER_SCHEMA:context.schema!,INVEOS_ADMIN_DATABASE_URL:''};
}
const dispatcherPath=fileURLToPath(new URL('../src/dispatch-integrity-jobs.ts',import.meta.url));

test('actual dispatcher CLI uses the restricted lab connection, bounds each pass and rejects unsafe configuration',async()=>{
  const {scope,enqueue,base,evidence}=await dispatchFixture();
  const first=await enqueue('utf8_line_index_v1'),second=await enqueue();
  const args=['--import','tsx',dispatcherPath,scope.tenantId,scope.caseId,'1'];
  const output=await promisify(execFile)(process.execPath,args,{env:dispatchEnvironment(),timeout:15000});
  assert.equal(output.stderr,'');
  assert.deepEqual(JSON.parse(output.stdout),{selected:1,stopReason:'limit',results:[{jobId:first,status:'succeeded',attempt:1,failureCode:null}]});
  const app=await createAppInstance();
  try {
    const address=await app.listen({host:'127.0.0.1',port:0});
    const job=await(await fetch(`${address}${base}/${first}`,{headers:{cookie:context.demo!.cookie}})).json() as InspectionJob;
    const result=await fetch(`${address}${base}/${first}/derivative`,{headers:{cookie:context.demo!.cookie}});assert.equal(result.status,200);
    assert.equal((await inspectTextDerivative(await result.json(),job)).sourceDigest,evidence.digest);
  }finally{await app.close();}
  for(const env of [{INVEOS_DEV_LAB:'0'},{NODE_ENV:'production'},{INVEOS_WORKER_SCHEMA:'bad;schema'},{INVEOS_DATABASE_URL:'postgres://fictional-secret:private@127.0.0.1:1/inveos_test'}]) {
    await assert.rejects(promisify(execFile)(process.execPath,args,{env:{...dispatchEnvironment(),...env},timeout:15000}),error=>{
      const failure=error as Error&{code:number;stderr:string;stdout:string};
      assert.equal(failure.code,1);assert.equal(failure.stdout,'');assert.equal(failure.stderr,'Dispatch failed. Check lab configuration and scoped job history before retrying.\n');return true;
    });
  }
  for(const limit of ['0','26','1.5','1e1'])await assert.rejects(promisify(execFile)(process.execPath,[...args.slice(0,-1),limit],{env:dispatchEnvironment(),timeout:15000}));
  assert.equal(JSON.parse((await request('GET',`${base}/${second}`,context.demo!)).body).status,'queued');
  const again=await promisify(execFile)(process.execPath,args,{env:dispatchEnvironment(),timeout:15000});
  assert.equal(JSON.parse(again.stdout).results[0].jobId,second);
});

test('dispatcher recovers a killed worker only after expiry and cancels stale authority and exhausted jobs',async()=>{
  const {scope,enqueue,base}=await dispatchFixture();const jobId=await enqueue();
  const fixture=fileURLToPath(new URL('./fixtures/claim-and-wait.ts',import.meta.url));
  const child=spawn(process.execPath,['--import','tsx',fixture,scope.tenantId,scope.caseId,jobId],{env:dispatchEnvironment(),stdio:['ignore','pipe','pipe']});
  const closed=new Promise<void>((resolve,reject)=>{child.once('close',()=>resolve());child.once('error',reject);});
  try {
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Claim process did not become ready')),10000);
      child.stdout.once('data',chunk=>{clearTimeout(timer);if(String(chunk)==='claimed\n')resolve();else reject(new Error('Unexpected worker receipt'));});
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',()=>{clearTimeout(timer);reject(new Error('Worker exited before claim'));});
    });
    child.kill('SIGKILL');await closed;
    const old=(await context.pool!.query('SELECT lease_token FROM integrity_jobs WHERE id=$1',[jobId])).rows[0].lease_token;
    assert.equal((await dispatchIntegrityJobs(context.pool!,context.storageRoot!,scope)).selected,0);
    await context.schemaAdminPool!.query("UPDATE integrity_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[jobId]);
    const recovery=await dispatchIntegrityJobs(context.pool!,context.storageRoot!,scope,1);
    assert.equal(recovery.results[0]!.status,'succeeded');assert.equal(recovery.results[0]!.attempt,2);
    assert.equal(await finishIntegrityJob(context.pool!,{...scope,jobId},old,null),null);
    const events=await context.pool!.query('SELECT status,attempt FROM integrity_job_events WHERE job_id=$1 ORDER BY id',[jobId]);
    assert.deepEqual(events.rows,[{status:'queued',attempt:0},{status:'running',attempt:1},{status:'running',attempt:2},{status:'succeeded',attempt:2}]);
  } finally {child.kill('SIGKILL');await closed;}
  const exhausted=await enqueue();
  for(let i=0;i<3;i++){
    assert.ok(await claimIntegrityJob(context.pool!,{...scope,jobId:exhausted}));
    await context.schemaAdminPool!.query("UPDATE integrity_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[exhausted]);
  }
  const exhaustedResult=await dispatchIntegrityJobs(context.pool!,context.storageRoot!,scope,1);
  assert.equal(exhaustedResult.results[0]!.failureCode,'attempts_exhausted');
  const stale=await enqueue();await approveAuthority(scope.caseId);const fresh=await enqueue();
  const final=await dispatchIntegrityJobs(context.pool!,context.storageRoot!,scope,2);
  assert.deepEqual(final.results.map(r=>[r.jobId,r.status,r.failureCode]),[[stale,'cancelled','scope_changed'],[fresh,'succeeded',null]]);
  const revoked=await enqueue();
  await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,scope.caseId,demoUserId]);
  assert.equal((await dispatchIntegrityJobs(context.pool!,context.storageRoot!,scope,1)).results[0]!.failureCode,'scope_changed');
  assertError(await request('GET',`${base}/${revoked}`,context.demo!),404);
});

test('dispatcher fails closed on transactional output failure and resumes expired work without duplicate derivatives',async()=>{
  const {scope,enqueue}=await dispatchFixture();const text=await enqueue('utf8_line_index_v1'),checksum=await enqueue();
  await context.schemaAdminPool!.query(`CREATE FUNCTION fail_dispatch_output_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional dispatch failure'; END $$`);
  await context.schemaAdminPool!.query('CREATE TRIGGER fail_dispatch_output_test BEFORE INSERT ON text_derivatives FOR EACH ROW EXECUTE FUNCTION fail_dispatch_output_test()');
  try {await assert.rejects(dispatchIntegrityJobs(context.pool!,context.storageRoot!,scope),/fictional dispatch failure/);}
  finally {await context.schemaAdminPool!.query('DROP TRIGGER fail_dispatch_output_test ON text_derivatives');await context.schemaAdminPool!.query('DROP FUNCTION fail_dispatch_output_test()');}
  const states=await context.pool!.query('SELECT id,status FROM integrity_jobs WHERE case_id=$1 ORDER BY created_at,id',[scope.caseId]);
  assert.deepEqual(states.rows,[{id:text,status:'running'},{id:checksum,status:'queued'}]);
  assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM text_derivatives WHERE case_id=$1',[scope.caseId])).rows[0].n,0);
  assert.equal((await dispatchIntegrityJobs(context.pool!,context.storageRoot!,scope)).results[0]!.jobId,checksum);
  await context.schemaAdminPool!.query("UPDATE integrity_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[text]);
  const recovered=await dispatchIntegrityJobs(context.pool!,context.storageRoot!,scope);
  assert.equal(recovered.results[0]!.jobId,text);assert.equal(recovered.results[0]!.attempt,2);
  assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM text_derivatives WHERE case_id=$1',[scope.caseId])).rows[0].n,1);
  const ended=await context.pool!.query("SELECT status FROM integrity_job_events WHERE job_id=$1 AND status='succeeded'",[text]);assert.equal(ended.rowCount,1);
});

test('dispatcher CLI finishes its in-flight claim on SIGTERM and leaves the next job queued',async()=>{
  const {scope,enqueue}=await dispatchFixture();const first=await enqueue(),second=await enqueue();
  const blocker=await context.pool!.connect();
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE',[scope.caseId]);
  const applicationName=`fictional_dispatch_${randomUUID()}`,connection=new URL(databaseUrl!);connection.searchParams.set('application_name',applicationName);
  const execution=promisify(execFile)(process.execPath,['--import','tsx',dispatcherPath,scope.tenantId,scope.caseId,'2'],
    {env:{...dispatchEnvironment(),INVEOS_DATABASE_URL:connection.toString()},timeout:15000});
  // Attach a rejection handler immediately; assertion below still sees the original rejection.
  void execution.catch(()=>{});
  try {
    const deadline=Date.now()+10000;let waiting=false;
    while(Date.now()<deadline){
      const activity=await context.adminPool!.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[applicationName]);
      if(activity.rowCount){waiting=true;break;}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.ok(waiting,'CLI must be inside its authority check before sending the real signal');
    assert.ok(execution.child.kill('SIGTERM'));
    // Keep the lock briefly so the Node signal handler runs before this claim completes.
    await new Promise(resolve=>setTimeout(resolve,100));
    await blocker.query('ROLLBACK');
    const output=await execution;assert.equal(output.stderr,'');
    assert.deepEqual(JSON.parse(output.stdout),{selected:1,stopReason:'aborted',results:[{jobId:first,status:'succeeded',attempt:1,failureCode:null}]});
    const row=(await context.pool!.query('SELECT status,attempt FROM integrity_jobs WHERE id=$1',[second])).rows[0];assert.deepEqual(row,{status:'queued',attempt:0});
  }finally{
    await blocker.query('ROLLBACK');blocker.release();execution.child.kill('SIGKILL');await execution.catch(()=>{});
  }
});

test('dispatch authority lock timeout rolls back the claim and recorded source failures do not stop the pass',async()=>{
  const {scope,enqueue,evidence}=await dispatchFixture();const first=await enqueue();
  const blocker=await context.pool!.connect();
  try {
    await blocker.query('BEGIN');await blocker.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE',[scope.caseId]);
    await assert.rejects(dispatchIntegrityJobs(context.pool!,context.storageRoot!,scope),error=>{assert.equal((error as {code:string}).code,'55P03');return true;});
  }finally{await blocker.query('ROLLBACK');blocker.release();}
  const row=(await context.pool!.query('SELECT status,attempt,lease_token FROM integrity_jobs WHERE id=$1',[first])).rows[0];
  assert.deepEqual(row,{status:'queued',attempt:0,lease_token:null});
  assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM integrity_job_events WHERE job_id=$1',[first])).rows[0].n,1);
  const second=await enqueue();
  const source=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[evidence.id])).rows[0];
  await writeFile(join(context.storageRoot!,source.object_path),'Fictional corrupted dispatch original');
  const outcomes=await dispatchIntegrityJobs(context.pool!,context.storageRoot!,scope,2);
  assert.deepEqual(outcomes.results.map(r=>[r.jobId,r.status,r.failureCode]),[[first,'failed','digest_mismatch'],[second,'failed','digest_mismatch']]);
});

test('workspace previews bound original bytes and reject symlinks, directories, FIFOs and oversized replacements over HTTP',async()=>{
  await context.app!.close();context.app=await createAppInstance();context.demo=await issueTestSession(demoUserId);
  const kase=await createCase();await approveAuthority(kase.id);
  const text='Fictional bounded preview\n'+'x'.repeat(262144-Buffer.byteLength('Fictional bounded preview\n'));
  const input=evidenceInput({text,expectedSha256:digest(text)}),evidence=parseBody<Evidence>(await uploadEvidence(kase.id,context.demo!,input));
  const row=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[evidence.id])).rows[0];
  const path=join(context.storageRoot!,row.object_path),copy=join(context.storageRoot!,`fictional-copy-${randomUUID()}.txt`);
  await writeFile(copy,text);
  const app=await createAppInstance();
  try {
    const address=await app.listen({host:'127.0.0.1',port:0});
    const preview=async()=>{
      const response=await fetch(`${address}/api/workspace`,{headers:{cookie:context.demo!.cookie},signal:AbortSignal.timeout(5000)});
      assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
      return (await response.json() as Workspace).evidence.find(e=>e.id===evidence.id)!;
    };
    const original=await preview();assert.equal(original.status,'Verified');assert.equal(original.text,text);
    await writeFile(path,Buffer.alloc(262145,120));let result=await preview();assert.equal(result.status,'Original unavailable');assert.equal(result.text,'');
    await writeFile(path,Buffer.alloc(262144,121));result=await preview();assert.equal(result.status,'Integrity mismatch');assert.equal(result.text,'');
    await rm(path);await symlink(copy,path);result=await preview();assert.equal(result.status,'Original unavailable');assert.equal(result.text,'');
    await rm(path);await mkdir(path);result=await preview();assert.equal(result.status,'Original unavailable');assert.equal(result.text,'');
    await rm(path,{recursive:true});await promisify(execFile)('mkfifo',[path]);result=await preview();assert.equal(result.status,'Original unavailable');assert.equal(result.text,'');
    await rm(path);result=await preview();assert.equal(result.status,'Original unavailable');assert.equal(result.text,'');
    await writeFile(path,text);assert.equal((await preview()).text,text);
  }finally{await app.close();await rm(path,{recursive:true,force:true});await writeFile(path,text);await rm(copy,{force:true});}
});

test('original downloads audit verified bytes before sending text and quarantined binary without cache or inline rendering',async()=>{
  await context.app!.close();context.app=await createAppInstance();context.demo=await issueTestSession(demoUserId);
  const kase=await createCase();await approveAuthority(kase.id);
  const input=evidenceInput(),text=parseBody<Evidence>(await uploadEvidence(kase.id,context.demo!,input));
  const bytes=Buffer.from([0,255,60,115,118,103,62,13,10]),hash=createHash('sha256').update(bytes).digest('hex');
  const response=await request('POST',`/api/cases/${kase.id}/evidence/binary`,context.demo!,{payload:{filename:'fictional-original.svg',contentBase64:bytes.toString('base64'),expectedSha256:hash,sourceTime:'2026-01-01T00:00:00Z',method:'Fictional original download fixture',idempotencyKey:randomUUID()}});
  assert.equal(response.statusCode,200,response.body);const binary=JSON.parse(response.body);
  await approveAuthority(kase.id); // Access history records acquisition authority, not a fabricated new origin.
  const app=await createAppInstance();
  try{
    const address=await app.listen({host:'127.0.0.1',port:0});
    for(const [evidence,expected] of [[text,Buffer.from(input.text)],[binary,bytes]] as const){
      const download=await fetch(`${address}/api/cases/${kase.id}/evidence/${evidence.id}/original`,{headers:{cookie:context.demo!.cookie}});
      assert.equal(download.status,200);assert.equal(download.headers.get('cache-control'),'no-store');assert.equal(download.headers.get('x-content-type-options'),'nosniff');
      assert.match(download.headers.get('content-disposition')!,/^attachment;/);assert.equal(download.headers.get('x-inveos-original-state'),evidence.status);
      assert.deepEqual(Buffer.from(await download.arrayBuffer()),expected);
      if(evidence.id===binary.id)assert.equal(download.headers.get('content-type'),'application/octet-stream');
    }
    const audits=await context.pool!.query("SELECT actor_user_id,entity_id,metadata,summary FROM audit_events WHERE case_id=$1 AND action='evidence.original_read' ORDER BY created_at,id",[kase.id]);
    assert.equal(audits.rowCount,2);
    for(const audit of audits.rows){assert.equal(audit.actor_user_id,demoUserId);assert.equal(audit.summary,'Verified original prepared for download');assert.equal(audit.metadata.authorityVersion,1);assert.deepEqual(Object.keys(audit.metadata).sort(),['authorityVersion','byteLength','originalKind','sha256']);}
    assert.deepEqual(audits.rows.map(r=>r.entity_id),[text.id,binary.id]);
    assert.equal(audits.rows[1].metadata.sha256,hash);assert.equal(audits.rows[1].metadata.byteLength,bytes.length);assert.equal(audits.rows[1].metadata.originalKind,'opaque_binary');
    const workspace=await(await fetch(`${address}/api/workspace`,{headers:{cookie:context.demo!.cookie}})).json() as Workspace;
    assert.equal(workspace.evidence.find(e=>e.id===binary.id)!.status,'Quarantined');assert.equal(workspace.evidence.find(e=>e.id===binary.id)!.text,'');
    assert.equal(workspace.findings.filter(f=>f.caseId===kase.id).length,0);
  }finally{await app.close();}
});

test('original delivery fails closed on audit failure, corruption and revoked or unrelated access',async()=>{
  await context.app!.close();context.app=await createAppInstance();context.demo=await issueTestSession(demoUserId);
  const kase=await createCase();await approveAuthority(kase.id);const evidence=parseBody<Evidence>(await uploadEvidence(kase.id));
  const url=`/api/cases/${kase.id}/evidence/${evidence.id}/original`;
  await context.schemaAdminPool!.query(`CREATE FUNCTION fail_original_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='evidence.original_read' THEN RAISE EXCEPTION 'fictional read audit failure'; END IF; RETURN NEW; END $$`);
  await context.schemaAdminPool!.query('CREATE TRIGGER fail_original_audit_test BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_original_audit_test()');
  try {const response=await request('GET',url,context.demo!);assertError(response,500);assert.equal(response.headers['cache-control'],'no-store');assert.ok(!response.body.includes(sourceText()));}
  finally {await context.schemaAdminPool!.query('DROP TRIGGER fail_original_audit_test ON audit_events');await context.schemaAdminPool!.query('DROP FUNCTION fail_original_audit_test()');}
  assert.equal((await context.pool!.query("SELECT count(*)::int AS n FROM audit_events WHERE case_id=$1 AND action='evidence.original_read'",[kase.id])).rows[0].n,0);
  assert.equal((await request('GET',url,context.demo!)).statusCode,200);
  const other=await createCase();assertError(await request('GET',`/api/cases/${other.id}/evidence/${evidence.id}/original`,context.demo!),404);
  const outsider=await createMember(demoTenantId,'investigator','Fictional original outsider');assertError(await request('GET',url,await issueTestSession(outsider)),404);
  const client=await createMember(demoTenantId,'client','Fictional original client');assertError(await request('GET',url,await issueTestSession(client)),403);
  const tenant=randomUUID();await context.schemaAdminPool!.query('INSERT INTO tenants (id,name) VALUES ($1,$2)',[tenant,'Fictional original foreign agency']);
  const foreign=await createMember(tenant,'reviewer','Fictional foreign reviewer');assertError(await request('GET',url,await issueTestSession(foreign,tenant)),404);
  await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,kase.id,demoUserId]);
  assertError(await request('GET',url,context.demo!),404);
  await context.schemaAdminPool!.query('INSERT INTO case_memberships (tenant_id,case_id,user_id) VALUES ($1,$2,$3)',[demoTenantId,kase.id,demoUserId]);
  const path=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[evidence.id])).rows[0].object_path;
  await writeFile(join(context.storageRoot!,path),'Fictional corruption after successful read');
  const corrupt=await request('GET',url,context.demo!);assertError(corrupt,409);assert.equal(corrupt.headers['cache-control'],'no-store');
  assert.equal((await context.pool!.query("SELECT count(*)::int AS n FROM audit_events WHERE case_id=$1 AND action='evidence.original_read'",[kase.id])).rows[0].n,1);
});

test('binary file intake recovers a committed HTTP receipt after response loss with one immutable quarantined original',async()=>{
 await context.app!.close();context.app=await createAppInstance();context.demo=await issueTestSession(demoUserId);
 const kase=await createCase();await approveAuthority(kase.id);const bytes=new Uint8Array([0,255,13,10,60,62]);
 const input=await prepareBinary({name:'fictional-recovered.bin',size:bytes.length,arrayBuffer:async()=>bytes.buffer},'2026-01-12T09:00:00Z','Fictional file supplied for recovery');
 const scope=await binaryIntakeScope(context.demo.csrf,kase.id),entries=new Map<string,string>(),store={getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>{entries.set(k,v);},removeItem:(k:string)=>{entries.delete(k);}};
 const app=await createAppInstance();try{
  const address=await app.listen({host:'127.0.0.1',port:0});let committed:unknown;
  const send=async(body:unknown)=>{const r=await fetch(`${address}/api/cases/${kase.id}/evidence/binary`,{method:'POST',headers:{cookie:context.demo!.cookie,origin:localOrigin,'content-type':'application/json','x-csrf-token':context.demo!.csrf},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
  await assert.rejects(sendBinaryRecoverably(store,scope,kase.id,input,async body=>{committed=await send(body);throw Error('Fictional response deliberately lost');}));
  await assert.rejects(sendBinaryRecoverably({...store},scope,kase.id,{...input,filename:'different.bin'},send),/same file/);
  const recovered=await sendBinaryRecoverably({...store},scope,kase.id,input,send);assert.deepEqual(recovered,committed);assert.equal(entries.size,0);
  const counts=await context.pool!.query("SELECT (SELECT count(*)::int FROM evidence WHERE case_id=$1) AS originals,(SELECT count(*)::int FROM audit_events WHERE case_id=$1 AND action='evidence.received') AS receipts",[kase.id]);assert.deepEqual(counts.rows[0],{originals:1,receipts:1});
  const original=await fetch(`${address}/api/cases/${kase.id}/evidence/${recovered.id}/original`,{headers:{cookie:context.demo!.cookie}});assert.equal(original.status,200);assert.deepEqual(new Uint8Array(await original.arrayBuffer()),bytes);assert.equal(original.headers.get('x-inveos-original-state'),'Quarantined');
  assertError(await createClaim(kase.id,recovered.id),409);
 }finally{await app.close();}
});

async function uploadReservationFixture(bytes=Buffer.alloc(32769,42)){
 await context.app!.close();context.app=await createAppInstance();context.demo=await issueTestSession(demoUserId);
 const kase=await createCase();await approveAuthority(kase.id);const base=`/api/cases/${kase.id}/uploads`;
 const input={filename:'fictional-chunked.bin',byteLength:bytes.length,expectedSha256:createHash('sha256').update(bytes).digest('hex'),sourceTime:'2026-01-12T09:00:00Z',method:'Fictional resumable fixture',idempotencyKey:randomUUID()};
 const r=await request('POST',base,context.demo!,{payload:input});assert.equal(r.statusCode,200,r.body);return {kase,base,input,bytes,id:JSON.parse(r.body).id as string};
}
test('resumable binary chunks survive restart, replay out of order and atomically become one quarantined original over HTTP',async()=>{
 const {kase,base,input,bytes,id}=await uploadReservationFixture(),url=base+'/'+id;
 assert.equal(JSON.parse((await request('POST',base,context.demo!,{payload:input})).body).id,id);
 const chunk={ordinal:1,contentBase64:bytes.subarray(32768).toString('base64')};
 assert.equal((await request('POST',url+'/chunk',context.demo!,{payload:chunk})).statusCode,200);
 await context.app!.close();context.app=await createAppInstance();
 assert.deepEqual(JSON.parse((await request('GET',url,context.demo!)).body).received,[1]);
 assertError(await request('POST',url+'/complete',context.demo!,{payload:{}}),409);
 assert.equal((await request('POST',url+'/chunk',context.demo!,{payload:chunk})).statusCode,200);
 assertError(await request('POST',url+'/chunk',context.demo!,{payload:{...chunk,contentBase64:'AA=='}}),409);
 assert.equal((await request('POST',url+'/chunk',context.demo!,{payload:{ordinal:0,contentBase64:bytes.subarray(0,32768).toString('base64')}})).statusCode,200);
 const app=await createAppInstance();try{const address=await app.listen({host:'127.0.0.1',port:0});
 const complete=async()=>{const r=await fetch(address+url+'/complete',{method:'POST',headers:{cookie:context.demo!.cookie,origin:localOrigin,'content-type':'application/json','x-csrf-token':context.demo!.csrf},body:'{}'});assert.equal(r.status,200);return r.json() as Promise<Evidence>;};
 const [first,second]=await Promise.all([complete(),complete()]);assert.equal(first.id,second.id);assert.equal(first.status,'Quarantined');
 const downloaded=await fetch(`${address}/api/cases/${kase.id}/evidence/${first.id}/original`,{headers:{cookie:context.demo!.cookie}});assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);
 assert.equal((await complete()).id,first.id);assertError(await createClaim(kase.id,first.id),409);
 }finally{await app.close();}
 const counts=await context.pool!.query("SELECT (SELECT count(*)::int FROM evidence WHERE case_id=$1) AS originals,(SELECT count(*)::int FROM upload_chunks WHERE case_id=$1) AS chunks,(SELECT count(*)::int FROM audit_events WHERE case_id=$1 AND action='upload.completed') AS completed",[kase.id]);assert.deepEqual(counts.rows[0],{originals:1,chunks:0,completed:1});
});
test('upload reservations reject bad ranges, corrupt assembly and stale authority while cancellation removes staging only',async()=>{
 const {kase,base,id}=await uploadReservationFixture(Buffer.from('abc')),url=base+'/'+id;
 for(const payload of [{ordinal:1,contentBase64:'YQ=='},{ordinal:0,contentBase64:'YQ=='},{ordinal:0,contentBase64:'YWJj\n'}])assertError(await request('POST',url+'/chunk',context.demo!,{payload}),422);
 assert.equal((await request('POST',url+'/chunk',context.demo!,{payload:{ordinal:0,contentBase64:'eHl6'}})).statusCode,200);
 assertError(await request('POST',url+'/complete',context.demo!,{payload:{}}),422);
 assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM evidence WHERE case_id=$1',[kase.id])).rows[0].n,0);
 await approveAuthority(kase.id);assertError(await request('POST',url+'/chunk',context.demo!,{payload:{ordinal:0,contentBase64:'eHl6'}}),409);
 assert.equal((await request('POST',url+'/cancel',context.demo!,{payload:{}})).statusCode,200);
 assert.equal(JSON.parse((await request('POST',url+'/cancel',context.demo!,{payload:{}})).body).status,'cancelled');
 assertError(await request('POST',url+'/complete',context.demo!,{payload:{}}),409);
 assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM upload_chunks WHERE case_id=$1',[kase.id])).rows[0].n,0);
 assert.equal((await context.pool!.query("SELECT count(*)::int AS n FROM audit_events WHERE case_id=$1 AND action='upload.cancelled'",[kase.id])).rows[0].n,1);
});
test('upload scope, actor ownership, CSRF, expiry and bounded reservation quota remain enforced',async()=>{
 const {kase,base,input,id}=await uploadReservationFixture(Buffer.from('abc')),url=base+'/'+id;
 assertError(await request('POST',url+'/chunk',context.demo!,{payload:{ordinal:0,contentBase64:'YWJj'},csrfHeader:false}),403);
 const other=await createMember(demoTenantId,'investigator','Fictional upload colleague');await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,kase.id,other]);
 assertError(await request('GET',url,await issueTestSession(other)),404);
 const client=await createMember(demoTenantId,'client','Fictional upload client');assertError(await request('GET',url,await issueTestSession(client)),403);
 const wrong=await createCase();assertError(await request('GET',`/api/cases/${wrong.id}/uploads/${id}`,context.demo!),404);
 const foreignTenant=randomUUID();await context.schemaAdminPool!.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[foreignTenant,'Fictional upload foreign agency']);const foreign=await createMember(foreignTenant,'reviewer','Fictional foreign uploader');assertError(await request('GET',url,await issueTestSession(foreign,foreignTenant)),404);
 await context.schemaAdminPool!.query('ALTER TABLE upload_reservations DISABLE TRIGGER upload_identity');try{await context.schemaAdminPool!.query("UPDATE upload_reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);}finally{await context.schemaAdminPool!.query('ALTER TABLE upload_reservations ENABLE TRIGGER upload_identity');}
 assertError(await request('POST',url+'/chunk',context.demo!,{payload:{ordinal:0,contentBase64:'YWJj'}}),409);
 for(let i=0;i<9;i++)assert.equal((await request('POST',base,context.demo!,{payload:{...input,idempotencyKey:randomUUID()}})).statusCode,200);
 assertError(await request('POST',base,context.demo!,{payload:{...input,idempotencyKey:randomUUID()}}),409);
 await request('POST',url+'/cancel',context.demo!,{payload:{}});assert.equal((await request('POST',base,context.demo!,{payload:{...input,idempotencyKey:randomUUID()}})).statusCode,200);
 await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,kase.id,demoUserId]);assertError(await request('GET',url,context.demo!),404);
});
test('failed upload finalisation audit rolls back evidence and staging cleanup, allowing safe retry',async()=>{
 const {kase,base,id}=await uploadReservationFixture(Buffer.from('abc')),url=base+'/'+id;
 await request('POST',url+'/chunk',context.demo!,{payload:{ordinal:0,contentBase64:'YWJj'}});
 await context.schemaAdminPool!.query(`CREATE FUNCTION fail_upload_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='upload.completed' THEN RAISE EXCEPTION 'fictional upload audit failure'; END IF; RETURN NEW; END $$`);
 await context.schemaAdminPool!.query('CREATE TRIGGER fail_upload_test BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_upload_test()');
 try{assertError(await request('POST',url+'/complete',context.demo!,{payload:{}}),500);}finally{await context.schemaAdminPool!.query('DROP TRIGGER fail_upload_test ON audit_events');await context.schemaAdminPool!.query('DROP FUNCTION fail_upload_test()');}
 const state=JSON.parse((await request('GET',url,context.demo!)).body);assert.equal(state.status,'open');assert.deepEqual(state.received,[0]);
 assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM evidence WHERE case_id=$1',[kase.id])).rows[0].n,0);
 assert.equal((await request('POST',url+'/complete',context.demo!,{payload:{}})).statusCode,200);
});

test('actual chunk client resumes after committed chunk and completion acknowledgement loss without duplicate intake',async()=>{
 await context.app!.close();context.app=await createAppInstance();context.demo=await issueTestSession(demoUserId);
 const kase=await createCase();await approveAuthority(kase.id);const bytes=new Uint8Array(65537).fill(207);
 const input=await prepareBinary({name:'fictional-resumed.bin',size:bytes.length,arrayBuffer:async()=>bytes.buffer},'2026-01-12T09:00:00Z','Fictional resumed transfer');
 const scope=await binaryIntakeScope(context.demo.csrf,kase.id)+':chunks-v1',entries=new Map<string,string>();
 const store={getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>{entries.set(k,v);},removeItem:(k:string)=>{entries.delete(k);}};
 const app=await createAppInstance();try{
  const address=await app.listen({host:'127.0.0.1',port:0});let loseChunk=true,loseComplete=true;const ordinals:number[]=[];let committed:unknown;
  const transport=async(path:string,body?:unknown)=>{
   const r=await fetch(address+path,{method:body===undefined?'GET':'POST',headers:{cookie:context.demo!.cookie,origin:localOrigin,'content-type':'application/json','x-csrf-token':context.demo!.csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.equal(r.status,200);const value=await r.json();
   if(path.endsWith('/chunk')){ordinals.push((body as {ordinal:number}).ordinal);if(loseChunk){loseChunk=false;throw Error('Fictional lost chunk receipt');}}
   if(path.endsWith('/complete')&&loseComplete){loseComplete=false;committed=value;throw Error('Fictional lost original receipt');}return value;
  };
  const run=()=>sendBinaryRecoverably({...store},scope,kase.id,input,body=>uploadBinaryChunks(kase.id,body,transport));
  await assert.rejects(run(),/lost chunk/);assert.deepEqual(ordinals,[0]);
  await context.app!.close();context.app=await createAppInstance(); // Independent HTTP app and durable DB survive client reconstruction.
  await assert.rejects(run(),/lost original/);assert.deepEqual(ordinals,[0,1,2]);
  const receipt=await run();assert.deepEqual(receipt,committed);assert.deepEqual(ordinals,[0,1,2]);assert.equal(entries.size,0);
  const original=await fetch(`${address}/api/cases/${kase.id}/evidence/${receipt.id}/original`,{headers:{cookie:context.demo!.cookie}});assert.equal(original.status,200);assert.deepEqual(new Uint8Array(await original.arrayBuffer()),bytes);
  const counts=await context.pool!.query("SELECT (SELECT count(*)::int FROM evidence WHERE case_id=$1) AS originals,(SELECT count(*)::int FROM upload_reservations WHERE case_id=$1) AS reservations,(SELECT count(*)::int FROM upload_chunks WHERE case_id=$1) AS chunks",[kase.id]);assert.deepEqual(counts.rows[0],{originals:1,reservations:1,chunks:0});
 }finally{await app.close();}
});

async function expireUploadFixture(ids:string[]){
 await context.schemaAdminPool!.query('ALTER TABLE upload_reservations DISABLE TRIGGER upload_identity');
 try{await context.schemaAdminPool!.query("UPDATE upload_reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=ANY($1::uuid[])",[ids]);}
 finally{await context.schemaAdminPool!.query('ALTER TABLE upload_reservations ENABLE TRIGGER upload_identity');}
}
test('bounded reviewer expiry frees staging and quota, preserves identity and serialises concurrent HTTP passes',async()=>{
 const {kase,base,input,id}=await uploadReservationFixture(Buffer.from('abc'));const ids=[id];
 for(let i=0;i<9;i++){const r=await request('POST',base,context.demo!,{payload:{...input,idempotencyKey:randomUUID()}});assert.equal(r.statusCode,200);ids.push(JSON.parse(r.body).id);}
 for(const next of ids.slice(0,3))assert.equal((await request('POST',base+'/'+next+'/chunk',context.demo!,{payload:{ordinal:0,contentBase64:'YWJj'}})).statusCode,200);
 const original=await request('POST',base+'/'+ids[2]+'/complete',context.demo!,{payload:{}});assert.equal(original.statusCode,200);const evidence=JSON.parse(original.body) as Evidence;
 await expireUploadFixture(ids.slice(0,3));
 const before=(await context.pool!.query('SELECT metadata,created_at,expires_at,authority_version,idempotency_key FROM upload_reservations WHERE id=$1',[id])).rows[0];
 const list=await request('GET',base,context.demo!);assert.equal(list.headers['cache-control'],'no-store');const listing=JSON.parse(list.body);assert.equal(listing.canManage,true);assert.equal(listing.items.length,9);assert.equal(listing.items.filter((x:{expired:boolean})=>x.expired).length,2);assert.equal('metadata' in listing.items[0],false);
 const app=await createAppInstance();try{const address=await app.listen({host:'127.0.0.1',port:0});
  const expire=async()=>{const r=await fetch(address+base+'/expire',{method:'POST',headers:{cookie:context.demo!.cookie,origin:localOrigin,'content-type':'application/json','x-csrf-token':context.demo!.csrf},body:'{"limit":1}'});assert.equal(r.status,200);return r.json() as Promise<{caseId:string;expired:string[]}>;};
  const both=await Promise.all([expire(),expire()]);assert.equal(new Set(both.flatMap(r=>r.expired)).size,2);assert.ok(both.every(r=>r.caseId===kase.id&&r.expired.length===1));assert.deepEqual((await expire()).expired,[]);
 }finally{await app.close();}
 const after=(await context.pool!.query('SELECT metadata,created_at,expires_at,authority_version,idempotency_key FROM upload_reservations WHERE id=$1',[id])).rows[0];assert.deepEqual(after,before);
 assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM upload_chunks WHERE case_id=$1',[kase.id])).rows[0].n,0);
 assert.equal((await context.pool!.query("SELECT count(*)::int AS n FROM audit_events WHERE case_id=$1 AND action='upload.expired'",[kase.id])).rows[0].n,2);
 assert.equal(JSON.parse((await request('GET',base+'/'+ids[2],context.demo!)).body).status,'completed');
 const download=await request('GET',`/api/cases/${kase.id}/evidence/${evidence.id}/original`,context.demo!);assert.equal(download.statusCode,200);assert.equal(download.body,'abc');
 assertError(await request('POST',base+'/'+id+'/complete',context.demo!,{payload:{}}),409);
 for(let i=0;i<3;i++)assert.equal((await request('POST',base,context.demo!,{payload:{...input,idempotencyKey:randomUUID()}})).statusCode,200);
 assertError(await request('POST',base,context.demo!,{payload:{...input,idempotencyKey:randomUUID()}}),409);
});
test('reviewer staging administration recovers revoked owners without disclosing their source metadata or accepting client access',async()=>{
 const {kase,base,input,id}=await uploadReservationFixture(Buffer.from('abc'));
 const colleague=await createMember(demoTenantId,'investigator','Fictional stranded uploader');await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,kase.id,colleague]);const session=await issueTestSession(colleague);
 const r=await request('POST',base,session,{payload:{...input,idempotencyKey:randomUUID()}});assert.equal(r.statusCode,200);const otherId=JSON.parse(r.body).id as string;
 await request('POST',base+'/'+otherId+'/chunk',session,{payload:{ordinal:0,contentBase64:'YWJj'}});
 const list=JSON.parse((await request('GET',base,session)).body);assert.equal(list.canManage,false);assert.deepEqual(list.items.map((x:{id:string})=>x.id),[otherId]);assert.equal(list.items[0].owned,true);
 for(const suffix of ['/expire','/'+id+'/reviewer-cancel'])assertError(await request('POST',base+suffix,session,{payload:suffix==='/expire'?{limit:10}:{reason:'Fictional cancellation'}}),403);
 assertError(await request('POST',base+'/'+id+'/cancel',session,{payload:{}}),404);
 await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,kase.id,colleague]);assertError(await request('GET',base,session),404);
 const cancel=()=>request('POST',base+'/'+otherId+'/reviewer-cancel',context.demo!,{payload:{reason:'Fictional uploader assignment ended'}});
 assert.equal(JSON.parse((await cancel()).body).status,'cancelled');assert.equal((await cancel()).statusCode,200);
 assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM upload_chunks WHERE upload_id=$1',[otherId])).rows[0].n,0);
 const events=await context.pool!.query("SELECT actor_user_id,metadata FROM audit_events WHERE entity_id=$1 AND action='upload.reviewer_cancelled'",[otherId]);assert.equal(events.rowCount,1);assert.deepEqual(events.rows[0],{actor_user_id:demoUserId,metadata:{reason:'Fictional uploader assignment ended',removedChunks:1}});
 const outsider=await createMember(demoTenantId,'reviewer','Fictional unrelated reviewer');const outsiderSession=await issueTestSession(outsider);
 const foreignTenant=randomUUID();await context.schemaAdminPool!.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[foreignTenant,'Fictional maintenance agency']);const foreign=await createMember(foreignTenant,'reviewer','Fictional foreign maintainer');
 const client=await createMember(demoTenantId,'client','Fictional maintenance client');
 for(const [denied,status] of [[outsiderSession,404],[await issueTestSession(foreign,foreignTenant),404],[await issueTestSession(client),403]] as const){
  assertError(await request('GET',base,denied),status);
  assertError(await request('POST',base+'/expire',denied,{payload:{limit:10}}),status);
  assertError(await request('POST',base+'/'+id+'/reviewer-cancel',denied,{payload:{reason:'Fictional cancellation'}}),status);
 }
 assertError(await request('POST',base+'/expire',context.demo!,{payload:{limit:10},csrfHeader:false}),403);
 for(const limit of [0,11,1.5])assertError(await request('POST',base+'/expire',context.demo!,{payload:{limit}}),422);
 assertError(await request('POST',base+'/'+id+'/reviewer-cancel',context.demo!,{payload:{reason:'          '}}),422);
 const wrong=await createCase();assertError(await request('POST',`/api/cases/${wrong.id}/uploads/${id}/reviewer-cancel`,context.demo!,{payload:{reason:'Fictional cancellation'}}),404);
});
test('staging maintenance audit failure rolls back all bytes and state, then safely retries after authority changes',async()=>{
 const {kase,base,id}=await uploadReservationFixture(Buffer.from('abc'));
 await request('POST',base+'/'+id+'/chunk',context.demo!,{payload:{ordinal:0,contentBase64:'YWJj'}});await expireUploadFixture([id]);await approveAuthority(kase.id);
 await context.schemaAdminPool!.query(`CREATE FUNCTION fail_maintenance_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('upload.expired','upload.reviewer_cancelled') THEN RAISE EXCEPTION 'fictional maintenance audit failure'; END IF; RETURN NEW; END $$`);
 await context.schemaAdminPool!.query('CREATE TRIGGER fail_maintenance_test BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_maintenance_test()');
 try{
  assertError(await request('POST',base+'/expire',context.demo!,{payload:{limit:10}}),500);
  assertError(await request('POST',base+'/'+id+'/reviewer-cancel',context.demo!,{payload:{reason:'Fictional cancellation'}}),500);
 }finally{await context.schemaAdminPool!.query('DROP TRIGGER fail_maintenance_test ON audit_events');await context.schemaAdminPool!.query('DROP FUNCTION fail_maintenance_test()');}
 const status=JSON.parse((await request('GET',base+'/'+id,context.demo!)).body);assert.equal(status.status,'open');assert.deepEqual(status.received,[0]);
 assert.deepEqual(JSON.parse((await request('POST',base+'/expire',context.demo!,{payload:{limit:10}})).body).expired,[id]);
 assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM evidence WHERE case_id=$1',[kase.id])).rows[0].n,0);
});
test('reviewer cancellation races with finalisation without losing originals or leaving staged bytes',async()=>{
 const {kase,base,id}=await uploadReservationFixture(Buffer.from('abc'));await request('POST',base+'/'+id+'/chunk',context.demo!,{payload:{ordinal:0,contentBase64:'YWJj'}});
 const [complete,cancel]=await Promise.all([request('POST',base+'/'+id+'/complete',context.demo!,{payload:{}}),request('POST',base+'/'+id+'/reviewer-cancel',context.demo!,{payload:{reason:'Fictional race cancellation'}})]);
 const state=JSON.parse((await request('GET',base+'/'+id,context.demo!)).body);
 if(state.status==='completed'){assert.equal(complete.statusCode,200);assertError(cancel,409);assertError(await request('POST',base+'/'+id+'/reviewer-cancel',context.demo!,{payload:{reason:'Fictional repeat cancellation'}}),409);}
 else{assert.equal(state.status,'cancelled');assert.equal(cancel.statusCode,200);assertError(complete,409);}
 const counts=await context.pool!.query('SELECT (SELECT count(*)::int FROM evidence WHERE case_id=$1) AS originals,(SELECT count(*)::int FROM upload_chunks WHERE case_id=$1) AS chunks',[kase.id]);assert.deepEqual(counts.rows[0],{originals:state.status==='completed'?1:0,chunks:0});
});

test('cancelled upload lookup reconciles the actual client retry without permitting another owner or a live request to clear it',async()=>{
 const {clearCancelledBinary,pendingBinary}=await import('../../web/src/binaryIntake.js');
 const {kase,base,input,id}=await uploadReservationFixture(Buffer.from('abc')),scope='fictional:chunks-v1',entries=new Map<string,string>(),store={getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>{entries.set(k,v);},removeItem:(k:string)=>{entries.delete(k);}};
 store.setItem(scope,JSON.stringify({key:input.idempotencyKey,fingerprint:'a'.repeat(64)}));
 const lookup=async(key:string)=>{const response=await request('GET',base+'/by-key/'+key,context.demo!);assert.equal(response.statusCode,200);return JSON.parse(response.body);};
 await assert.rejects(clearCancelledBinary(store,scope,kase.id,lookup),/not confirmed/);assert.ok(pendingBinary(store,scope));
 const other=await createMember(demoTenantId,'reviewer','Fictional lookup reviewer');await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,kase.id,other]);assertError(await request('GET',base+'/by-key/'+input.idempotencyKey,await issueTestSession(other)),404);
 assertError(await request('GET',base+'/by-key/'+randomUUID(),context.demo!),404);
 assert.equal((await request('POST',base+'/'+id+'/cancel',context.demo!,{payload:{}})).statusCode,200);
 await clearCancelledBinary(store,scope,kase.id,lookup);assert.equal(pendingBinary(store,scope),null);
 const replacement=await request('POST',base,context.demo!,{payload:{...input,idempotencyKey:randomUUID()}});assert.equal(replacement.statusCode,200);assert.notEqual(JSON.parse(replacement.body).id,id);
});

test('upload history retains terminal receipts and paginates exact database order across inserts and status changes over HTTP',async()=>{
 const {kase,base,input,id}=await uploadReservationFixture(Buffer.from('abc'));const ids=[id];
 for(let i=0;i<5;i++){const r=await request('POST',base,context.demo!,{payload:{...input,idempotencyKey:randomUUID()}});assert.equal(r.statusCode,200);ids.push(JSON.parse(r.body).id);}
 await request('POST',base+'/'+id+'/chunk',context.demo!,{payload:{ordinal:0,contentBase64:'YWJj'}});
 const original=JSON.parse((await request('POST',base+'/'+id+'/complete',context.demo!,{payload:{}})).body) as Evidence;
 await request('POST',base+'/'+ids[1]+'/cancel',context.demo!,{payload:{}});
 // Precision/tie fixture: application identity remains immutable; only test administrator bypasses its trigger.
 await context.schemaAdminPool!.query('ALTER TABLE upload_reservations DISABLE TRIGGER upload_identity');
 try{for(let i=0;i<ids.length;i++)await context.schemaAdminPool!.query("UPDATE upload_reservations SET created_at='2026-01-12T09:00:00Z'::timestamptz+$2*interval '1 microsecond' WHERE id=$1",[ids[i],Math.floor(i/2)]);}
 finally{await context.schemaAdminPool!.query('ALTER TABLE upload_reservations ENABLE TRIGGER upload_identity');}
 const expected=(await context.pool!.query('SELECT id FROM upload_reservations WHERE case_id=$1 ORDER BY created_at DESC,id DESC',[kase.id])).rows.map(r=>r.id);
 await context.app!.close();context.app=await createAppInstance();context.demo=await issueTestSession(demoUserId);
 const app=await createAppInstance();try{const address=await app.listen({host:'127.0.0.1',port:0});
  const page=async(before?:string)=>{const r=await fetch(address+base+'/history?limit=2'+(before?'&before='+before:''),{headers:{cookie:context.demo!.cookie}});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');return r.json() as Promise<{caseId:string;items:Array<{id:string;status:string;evidenceId:string|null}>;nextCursor:string|null}>;};
  const first=await page();assert.equal(first.caseId,kase.id);assert.deepEqual(first.items.map(r=>r.id),expected.slice(0,2));assert.ok(first.nextCursor);
  await request('POST',base+'/'+first.nextCursor+'/cancel',context.demo!,{payload:{}});
  const added=await request('POST',base,context.demo!,{payload:{...input,idempotencyKey:randomUUID()}});assert.equal(added.statusCode,200);
  const second=await page(first.nextCursor!),third=await page(second.nextCursor!);const all=[...first.items,...second.items,...third.items];assert.deepEqual(all.map(r=>r.id),expected);assert.equal(third.nextCursor,null);
  assert.equal(all.find(r=>r.id===id)!.evidenceId,original.id);assert.equal(all.find(r=>r.id===id)!.status,'completed');assert.equal(all.find(r=>r.id===ids[1])!.status,'cancelled');
  for(const item of all)for(const forbidden of ['metadata','filename','contentBase64','requestKey','idempotencyKey','created_by'])assert.equal(forbidden in item,false);
  assert.equal((await page()).items[0]!.id,JSON.parse(added.body).id);
 }finally{await app.close();}
});
test('upload history and cursors enforce owner, reviewer, case, tenant, role and revocation boundaries',async()=>{
 const {kase,base,input,id}=await uploadReservationFixture(Buffer.from('abc'));
 const user=await createMember(demoTenantId,'investigator','Fictional history investigator');await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,kase.id,user]);const session=await issueTestSession(user);
 const own=await request('POST',base,session,{payload:{...input,idempotencyKey:randomUUID()}});assert.equal(own.statusCode,200);const ownId=JSON.parse(own.body).id;
 const listing=JSON.parse((await request('GET',base+'/history',session)).body);assert.deepEqual(listing.items.map((x:{id:string})=>x.id),[ownId]);assert.equal(listing.items[0].owned,true);
 assertError(await request('GET',base+'/history?before='+id,session),404);
 const reviewer=JSON.parse((await request('GET',base+'/history',context.demo!)).body);assert.equal(reviewer.items.length,2);assert.equal(reviewer.items.find((x:{id:string})=>x.id===ownId).owned,false);
 const wrong=await createCase();assertError(await request('GET',`/api/cases/${wrong.id}/uploads/history?before=${id}`,context.demo!),404);
 const foreignTenant=randomUUID();await context.schemaAdminPool!.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[foreignTenant,'Fictional receipt agency']);const foreign=await createMember(foreignTenant,'reviewer','Fictional foreign reviewer');assertError(await request('GET',base+'/history',await issueTestSession(foreign,foreignTenant)),404);
 const client=await createMember(demoTenantId,'client','Fictional history client');assertError(await request('GET',base+'/history',await issueTestSession(client)),403);
 for(const query of ['limit=0','limit=51','limit=1.5','before=invalid','extra=1'])assertError(await request('GET',base+'/history?'+query,context.demo!),422);
 assertError(await request('GET',base+'/history?before='+randomUUID(),context.demo!),404);
 await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,kase.id,user]);assertError(await request('GET',base+'/history',session),404);
 assertError(await request('GET',base+'/history'),401);
});

async function revisionReviewFixture(){
 await context.app!.close();context.app=await createAppInstance();const fixture=await reportFixture();
 const frozen=await request('POST',fixture.url,context.demo!,{payload:{idempotencyKey:randomUUID()}});assert.equal(frozen.statusCode,200);const revision=JSON.parse(frozen.body);
 const reviewer=await createMember(demoTenantId,'reviewer','Fictional independent report reviewer');await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,fixture.kase.id,reviewer]);
 return {...fixture,revision,reviewer,session:await issueTestSession(reviewer),reviewUrl:fixture.url+'/'+revision.id+'/reviews',input:{sha256:revision.sha256,decision:'accept_internal',reason:'Inspected this exact fictional internal draft.'}};
}
test('independent frozen report review is atomic, idempotent and immutable without changing draft bytes or client access',async()=>{
 const f=await revisionReviewFixture();const app=await createAppInstance();try{const address=await app.listen({host:'127.0.0.1',port:0});
 const send=async()=>{const r=await fetch(address+f.reviewUrl,{method:'POST',headers:{cookie:f.session.cookie,origin:localOrigin,'content-type':'application/json','x-csrf-token':f.session.csrf},body:JSON.stringify(f.input)});assert.equal(r.status,200);return r.json() as Promise<{status:string;authorityVersion:number}>;};
 const [a,b]=await Promise.all([send(),send()]);assert.deepEqual(a,b);assert.equal(a.status,'internal_review_not_release');assert.equal(a.authorityVersion,1);
 }finally{await app.close();}
 await context.app!.close();context.app=await createAppInstance();
 const history=await request('GET',f.reviewUrl,context.demo!);assert.equal(history.headers['cache-control'],'no-store');assert.equal(JSON.parse(history.body).items.length,1);
 const download=await request('GET',f.url+'/'+f.revision.id,context.demo!);assert.equal(digest(download.body),f.revision.sha256);assert.equal(JSON.parse(download.body).status,'draft_not_released');
 assertError(await request('POST',f.reviewUrl,f.session,{payload:{...f.input,decision:'request_changes'}}),409);
 await assert.rejects(context.pool!.query("UPDATE report_revision_reviews SET decision='request_changes' WHERE revision_id=$1",[f.revision.id]));
 await assert.rejects(context.schemaAdminPool!.query('DELETE FROM report_revision_reviews WHERE revision_id=$1',[f.revision.id]),/append|immutable/i);
 assert.equal((await context.pool!.query("SELECT count(*)::int AS n FROM audit_events WHERE entity_id=$1 AND action='report_revision.reviewed'",[f.revision.id])).rows[0].n,1);
});
test('frozen report reviews reject self approval, wrong digest, forbidden roles, scope and revoked membership',async()=>{
 const f=await revisionReviewFixture();assertError(await request('POST',f.reviewUrl,context.demo!,{payload:f.input}),403);
 assertError(await request('POST',f.reviewUrl,f.session,{payload:{...f.input,sha256:'0'.repeat(64)}}),409);
 assertError(await request('POST',f.reviewUrl,f.session,{payload:{...f.input,reason:'          '}}),422);
 assertError(await request('POST',f.reviewUrl,f.session,{payload:f.input,csrfHeader:false}),403);
 const investigator=await createMember(demoTenantId,'investigator','Fictional report author colleague');await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,f.kase.id,investigator]);assertError(await request('POST',f.reviewUrl,await issueTestSession(investigator),{payload:f.input}),403);
 const client=await createMember(demoTenantId,'client','Fictional report recipient');const clientSession=await issueTestSession(client);assertError(await request('GET',f.reviewUrl,clientSession),403);assertError(await request('POST',f.reviewUrl,clientSession,{payload:f.input}),403);
 const other=await createCase();assertError(await request('GET',`/api/cases/${other.id}/report-revisions/${f.revision.id}/reviews`,context.demo!),404);
 await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,f.kase.id,f.reviewer]);assertError(await request('POST',f.reviewUrl,f.session,{payload:f.input}),404);
});
test('report review audit failure rolls back and allows retry; changed authority is recorded without changing the snapshot',async()=>{
 const f=await revisionReviewFixture();await approveAuthority(f.kase.id);
 await context.schemaAdminPool!.query(`CREATE FUNCTION fail_report_review_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='report_revision.reviewed' THEN RAISE EXCEPTION 'fictional review audit failure'; END IF; RETURN NEW; END $$`);
 await context.schemaAdminPool!.query('CREATE TRIGGER fail_report_review_test BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_report_review_test()');
 try{assertError(await request('POST',f.reviewUrl,f.session,{payload:f.input}),500);}finally{await context.schemaAdminPool!.query('DROP TRIGGER fail_report_review_test ON audit_events');await context.schemaAdminPool!.query('DROP FUNCTION fail_report_review_test()');}
 assert.equal(JSON.parse((await request('GET',f.reviewUrl,f.session)).body).items.length,0);
 const result=await request('POST',f.reviewUrl,f.session,{payload:{...f.input,decision:'request_changes'}});assert.equal(result.statusCode,200);assert.equal(JSON.parse(result.body).authorityVersion,2);
 assert.equal(digest((await request('GET',f.url+'/'+f.revision.id,context.demo!)).body),f.revision.sha256);
 const another=await createMember(demoTenantId,'reviewer','Fictional dissenting reviewer');await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,f.kase.id,another]);
 assert.equal((await request('POST',f.reviewUrl,await issueTestSession(another),{payload:f.input})).statusCode,200);
 const decisions=JSON.parse((await request('GET',f.reviewUrl,f.session)).body).items.map((r:{decision:string})=>r.decision);assert.deepEqual(decisions,['request_changes','accept_internal']);
 await context.schemaAdminPool!.query('ALTER TABLE report_revisions DISABLE TRIGGER report_revisions_append_only');
 try{await context.schemaAdminPool!.query("UPDATE report_revisions SET report_bytes=convert_to('fictional corrupt snapshot','UTF8') WHERE id=$1",[f.revision.id]);}finally{await context.schemaAdminPool!.query('ALTER TABLE report_revisions ENABLE TRIGGER report_revisions_append_only');}
 assertError(await request('GET',f.reviewUrl,f.session),409);assertError(await request('POST',f.reviewUrl,f.session,{payload:{...f.input,decision:'request_changes'}}),409);
});

test('frozen source verification checks the selected historical finding set over HTTP and excludes unrelated later material',async()=>{
 const f=await revisionReviewFixture();const base=f.url+'/'+f.revision.id;
 await createWork(f.kase.id,workInput({kind:'question',title:'Fictional later context is not frozen'}));
 const later=JSON.parse((await uploadEvidence(f.kase.id)).body) as Evidence;
 const claim=JSON.parse((await createClaim(f.kase.id,later.id)).body);
 assert.equal((await request('POST',`/api/cases/${f.kase.id}/claims/${claim.id}/review`,context.demo!,{payload:{accepted:true,reason:'Reviewed fictional later source.'}})).statusCode,200);
 const laterPath=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[later.id])).rows[0].object_path;
 await writeFile(join(context.storageRoot!,laterPath),'Fictional corrupt unrelated later source');
 const app=await createAppInstance();try{const address=await app.listen({host:'127.0.0.1',port:0});
 const response=await fetch(address+base+'/verify-sources',{method:'POST',headers:{cookie:context.demo!.cookie,origin:localOrigin,'content-type':'application/json','x-csrf-token':context.demo!.csrf},body:JSON.stringify({sha256:f.revision.sha256})});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const receipt=await response.json() as {findingCount:number;status:string;sha256:string};assert.equal(receipt.findingCount,1);assert.equal(receipt.status,'snapshot_sources_verified_not_released');assert.equal(receipt.sha256,f.revision.sha256);
 }finally{await app.close();}
 assert.equal(digest((await request('GET',base,context.demo!)).body),f.revision.sha256);
 const audits=await context.pool!.query("SELECT metadata FROM audit_events WHERE entity_id=$1 AND action='report_revision.sources_verified'",[f.revision.id]);assert.equal(audits.rowCount,1);assert.equal(audits.rows[0].metadata.findingCount,1);
});
test('source verification fails closed on corrupted originals and denied scope without creating a successful verification event',async()=>{
 const f=await revisionReviewFixture(),url=f.url+'/'+f.revision.id+'/verify-sources',payload={sha256:f.revision.sha256};
 assertError(await request('POST',url,context.demo!,{payload:{sha256:'0'.repeat(64)}}),409);
 assertError(await request('POST',url,context.demo!,{payload,csrfHeader:false}),403);
 const client=await createMember(demoTenantId,'client','Fictional verification client');assertError(await request('POST',url,await issueTestSession(client),{payload}),403);
 const foreignTenant=randomUUID();await context.schemaAdminPool!.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[foreignTenant,'Fictional verification agency']);const foreign=await createMember(foreignTenant,'reviewer','Fictional foreign verifier');assertError(await request('POST',url,await issueTestSession(foreign,foreignTenant),{payload}),404);
 const wrong=await createCase();assertError(await request('POST',`/api/cases/${wrong.id}/report-revisions/${f.revision.id}/verify-sources`,context.demo!,{payload}),404);
 await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,f.kase.id,f.reviewer]);assertError(await request('POST',url,f.session,{payload}),404);
 const path=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[f.evidence.id])).rows[0].object_path;
 await writeFile(join(context.storageRoot!,path),'Fictional corrupted cited original');assertError(await request('POST',url,context.demo!,{payload}),409);
 assert.equal((await context.pool!.query("SELECT count(*)::int AS n FROM audit_events WHERE entity_id=$1 AND action='report_revision.sources_verified'",[f.revision.id])).rows[0].n,0);
 assert.equal(digest((await request('GET',f.url+'/'+f.revision.id,context.demo!)).body),f.revision.sha256);
});
test('source verification audit failure rolls back its receipt and changed reviewed source spans fail revalidation',async()=>{
 const f=await revisionReviewFixture(),url=f.url+'/'+f.revision.id+'/verify-sources',payload={sha256:f.revision.sha256};
 await context.schemaAdminPool!.query(`CREATE FUNCTION fail_source_check_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='report_revision.sources_verified' THEN RAISE EXCEPTION 'fictional verification audit failure'; END IF; RETURN NEW; END $$`);
 await context.schemaAdminPool!.query('CREATE TRIGGER fail_source_check_test BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_source_check_test()');
 try{assertError(await request('POST',url,context.demo!,{payload}),500);}finally{await context.schemaAdminPool!.query('DROP TRIGGER fail_source_check_test ON audit_events');await context.schemaAdminPool!.query('DROP FUNCTION fail_source_check_test()');}
 assert.equal((await request('POST',url,context.demo!,{payload})).statusCode,200);
 await corruptClaim('UPDATE claims SET source_start_byte=source_start_byte+1 WHERE tenant_id=$1 AND case_id=$2',[demoTenantId,f.kase.id]);
 assertError(await request('POST',url,context.demo!,{payload}),409);
 assert.equal((await context.pool!.query("SELECT count(*)::int AS n FROM audit_events WHERE entity_id=$1 AND action='report_revision.sources_verified'",[f.revision.id])).rows[0].n,1);
});

async function disclosureFixture(){
 const f=await revisionReviewFixture();const client=await createMember(demoTenantId,'client','Fictional approved recipient');
 const input={sha256:f.revision.sha256,recipientId:client,idempotencyKey:randomUUID(),expiresAt:new Date(Date.now()+3600000).toISOString(),reason:'Fictional full snapshot disclosure approved; scope, privilege and all embedded originals reviewed.',confirmFullDisclosure:true};
 return {...f,client,clientSession:await issueTestSession(client),disclosureUrl:f.url+'/'+f.revision.id+'/disclosures',disclosureInput:input};
}
test('approved disclosure gives exactly one client the frozen bytes over HTTP and durable revocation removes future access',async()=>{
 const f=await disclosureFixture();assertError(await request('POST',f.disclosureUrl,context.demo!,{payload:f.disclosureInput}),409);
 await request('POST',f.reviewUrl,f.session,{payload:f.input});
 const results=await Promise.all([request('POST',f.disclosureUrl,context.demo!,{payload:f.disclosureInput}),request('POST',f.disclosureUrl,context.demo!,{payload:f.disclosureInput})]);results.forEach(r=>assert.equal(r.statusCode,200,r.body));assert.deepEqual(JSON.parse(results[0]!.body),JSON.parse(results[1]!.body));const grant=JSON.parse(results[0]!.body);
 const app=await createAppInstance();try{const address=await app.listen({host:'127.0.0.1',port:0});const response=await fetch(address+'/api/portal/disclosures/'+grant.id,{headers:{cookie:f.clientSession.cookie}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(digest(await response.text()),f.revision.sha256);}finally{await app.close();}
 assertError(await request('GET',f.url+'/'+f.revision.id,f.clientSession),403);
 assertError(await request('GET',`/api/cases/${f.kase.id}/evidence/${f.evidence.id}/original`,f.clientSession),403);
 const other=await createMember(demoTenantId,'client','Fictional other recipient');assertError(await request('GET','/api/portal/disclosures/'+grant.id,await issueTestSession(other)),404);
 assertError(await request('POST',f.disclosureUrl,context.demo!,{payload:{...f.disclosureInput,recipientId:other}}),409);
 const revoke=`/api/cases/${f.kase.id}/disclosures/${grant.id}/revoke`;for(let i=0;i<2;i++)assert.equal((await request('POST',revoke,context.demo!,{payload:{reason:'Fictional delivery withdrawn'}})).statusCode,200);
 await context.app!.close();context.app=await createAppInstance();assertError(await request('GET','/api/portal/disclosures/'+grant.id,f.clientSession),404);
 assert.equal((await context.pool!.query("SELECT count(*)::int AS n FROM audit_events WHERE entity_id=$1 AND action='report.disclosed'",[grant.id])).rows[0].n,1);
 assert.equal((await context.pool!.query("SELECT count(*)::int AS n FROM audit_events WHERE entity_id=$1 AND action='report.disclosure_revoked'",[grant.id])).rows[0].n,1);
});
test('disclosures fail closed for missing attestations, expiry, conflicting reviews, stale authority and corrupt source',async()=>{
 const f=await disclosureFixture();await request('POST',f.reviewUrl,f.session,{payload:f.input});
 assertError(await request('POST',f.disclosureUrl,context.demo!,{payload:{...f.disclosureInput,confirmFullDisclosure:false}}),422);
 assertError(await request('POST',f.disclosureUrl,context.demo!,{payload:f.disclosureInput,csrfHeader:false}),403);
 for(const expiresAt of [new Date(Date.now()-1000).toISOString(),new Date(Date.now()+8*86400000).toISOString(),'not a timestamp'])assertError(await request('POST',f.disclosureUrl,context.demo!,{payload:{...f.disclosureInput,expiresAt}}),422);
 assertError(await request('POST',f.disclosureUrl,context.demo!,{payload:{...f.disclosureInput,recipientId:demoUserId}}),422);
 const grant=JSON.parse((await request('POST',f.disclosureUrl,context.demo!,{payload:f.disclosureInput})).body);
 await approveAuthority(f.kase.id);assertError(await request('GET','/api/portal/disclosures/'+grant.id,f.clientSession),404);
 assertError(await request('POST',f.disclosureUrl,context.demo!,{payload:{...f.disclosureInput,idempotencyKey:randomUUID()}}),409);
 const another=await createMember(demoTenantId,'reviewer','Fictional current reviewer');await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,f.kase.id,another]);await request('POST',f.reviewUrl,await issueTestSession(another),{payload:f.input});
 const path=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[f.evidence.id])).rows[0].object_path;await writeFile(join(context.storageRoot!,path),'Fictional corruption');assertError(await request('POST',f.disclosureUrl,context.demo!,{payload:{...f.disclosureInput,idempotencyKey:randomUUID()}}),409);
});
test('disclosure audit rollback denies creation and download; expiry and change requests deny previously granted access',async()=>{
 const f=await disclosureFixture();await request('POST',f.reviewUrl,f.session,{payload:f.input});
 await context.schemaAdminPool!.query(`CREATE FUNCTION fail_disclosure_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('report.disclosed','report.disclosure_downloaded') THEN RAISE EXCEPTION 'fictional disclosure audit failure'; END IF; RETURN NEW; END $$`);await context.schemaAdminPool!.query('CREATE TRIGGER fail_disclosure_test BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_disclosure_test()');
 try{assertError(await request('POST',f.disclosureUrl,context.demo!,{payload:f.disclosureInput}),500);}finally{await context.schemaAdminPool!.query('DROP TRIGGER fail_disclosure_test ON audit_events');}
 assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM report_disclosures WHERE case_id=$1',[f.kase.id])).rows[0].n,0);
 const grant=JSON.parse((await request('POST',f.disclosureUrl,context.demo!,{payload:f.disclosureInput})).body);const url='/api/portal/disclosures/'+grant.id;
 await context.schemaAdminPool!.query('CREATE TRIGGER fail_disclosure_test BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_disclosure_test()');try{assertError(await request('GET',url,f.clientSession),500);}finally{await context.schemaAdminPool!.query('DROP TRIGGER fail_disclosure_test ON audit_events');await context.schemaAdminPool!.query('DROP FUNCTION fail_disclosure_test()');}
 assert.equal((await request('GET',url,f.clientSession)).statusCode,200);
 await context.schemaAdminPool!.query('ALTER TABLE report_disclosures DISABLE TRIGGER disclosure_append_only');try{await context.schemaAdminPool!.query("UPDATE report_disclosures SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[grant.id]);}finally{await context.schemaAdminPool!.query('ALTER TABLE report_disclosures ENABLE TRIGGER disclosure_append_only');}assertError(await request('GET',url,f.clientSession),404);
 const next=JSON.parse((await request('POST',f.disclosureUrl,context.demo!,{payload:{...f.disclosureInput,idempotencyKey:randomUUID()}})).body);
 const dissent=await createMember(demoTenantId,'reviewer','Fictional disclosure dissent');await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,f.kase.id,dissent]);await request('POST',f.reviewUrl,await issueTestSession(dissent),{payload:{...f.input,decision:'request_changes'}});
 assertError(await request('GET','/api/portal/disclosures/'+next.id,f.clientSession),404);assertError(await request('POST',f.disclosureUrl,context.demo!,{payload:{...f.disclosureInput,idempotencyKey:randomUUID()}}),409);
});

test('portal disclosure denies cross-tenant identifiers, issuer revocation and snapshot tampering without exposing internal records',async()=>{
 const f=await disclosureFixture();await request('POST',f.reviewUrl,f.session,{payload:f.input});
 const created=await request('POST',f.disclosureUrl,context.demo!,{payload:f.disclosureInput});assert.equal(created.statusCode,200);const grant=JSON.parse(created.body),url='/api/portal/disclosures/'+grant.id;
 const tenant=randomUUID();await context.schemaAdminPool!.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenant,'Fictional isolated portal agency']);const other=await createMember(tenant,'client','Fictional foreign recipient');assertError(await request('GET',url,await issueTestSession(other,tenant)),404);
 assertError(await request('GET',url,context.demo!),403);assertError(await request('GET',url),401);assertError(await request('GET','/api/portal/disclosures/'+randomUUID(),f.clientSession),404);
 assertError(await request('POST',f.disclosureUrl,f.clientSession,{payload:f.disclosureInput}),403);
 const wrong=await createCase();assertError(await request('POST',`/api/cases/${wrong.id}/disclosures/${grant.id}/revoke`,context.demo!,{payload:{reason:'Fictional wrong case revoke'}}),404);
 await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,f.kase.id,demoUserId]);assertError(await request('GET',url,f.clientSession),404);
 await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,f.kase.id,demoUserId]);assert.equal((await request('GET',url,f.clientSession)).statusCode,200);
 await context.schemaAdminPool!.query('ALTER TABLE report_revisions DISABLE TRIGGER report_revisions_append_only');try{await context.schemaAdminPool!.query("UPDATE report_revisions SET report_bytes=convert_to('fictional altered snapshot','UTF8') WHERE id=$1",[f.revision.id]);}finally{await context.schemaAdminPool!.query('ALTER TABLE report_revisions ENABLE TRIGGER report_revisions_append_only');}
 assertError(await request('GET',url,f.clientSession),409);
 await assert.rejects(context.pool!.query('DELETE FROM report_disclosures WHERE id=$1',[grant.id]));
});

test('recipient discovery paginates exact database timestamps, survives revoked anchors and returns only minimal metadata over HTTP',async()=>{
 const f=await disclosureFixture();await request('POST',f.reviewUrl,f.session,{payload:f.input});
 const ids:string[]=[];for(let i=0;i<4;i++){const r=await request('POST',f.disclosureUrl,context.demo!,{payload:{...f.disclosureInput,idempotencyKey:randomUUID()}});assert.equal(r.statusCode,200,r.body);ids.push(JSON.parse(r.body).id);}
 await context.schemaAdminPool!.query('ALTER TABLE report_disclosures DISABLE TRIGGER disclosure_append_only');try{for(let i=0;i<ids.length;i++)await context.schemaAdminPool!.query("UPDATE report_disclosures SET created_at='2026-01-01T00:00:00Z'::timestamptz + $2::integer * interval '1 microsecond' WHERE id=$1",[ids[i],i<2?0:i]);}finally{await context.schemaAdminPool!.query('ALTER TABLE report_disclosures ENABLE TRIGGER disclosure_append_only');}
 const expected=(await context.pool!.query('SELECT id FROM report_disclosures WHERE recipient_id=$1 ORDER BY created_at DESC,id DESC',[f.client])).rows.map(r=>r.id);
 const app=await createAppInstance();let first;try{const address=await app.listen({host:'127.0.0.1',port:0});const r=await fetch(address+'/api/portal/disclosures?limit=2',{headers:{cookie:f.clientSession.cookie}});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');first=await r.json() as {items:{id:string}[];nextBefore:string};}finally{await app.close();}
 assert.deepEqual(first.items.map(r=>r.id),expected.slice(0,2));assert.deepEqual(Object.keys(first.items[0]!).sort(),['createdAt','deliverable','expiresAt','id','reportSha256','revisionId','sha256']);assert.equal(first.nextBefore,expected[1]);
 await request('POST',`/api/cases/${f.kase.id}/disclosures/${first.nextBefore}/revoke`,context.demo!,{payload:{reason:'Fictional cursor grant withdrawn'}});
 await request('POST',f.disclosureUrl,context.demo!,{payload:{...f.disclosureInput,idempotencyKey:randomUUID()}});
 await context.app!.close();context.app=await createAppInstance();const second=JSON.parse((await request('GET','/api/portal/disclosures?limit=2&before='+first.nextBefore,f.clientSession)).body);assert.deepEqual(second.items.map((r:{id:string})=>r.id),expected.slice(2));assert.equal(second.nextBefore,null);
});

test('recipient discovery rejects foreign anchors and query variations without internal access',async()=>{
 const f=await disclosureFixture();await request('POST',f.reviewUrl,f.session,{payload:f.input});const grant=JSON.parse((await request('POST',f.disclosureUrl,context.demo!,{payload:f.disclosureInput})).body);
 const other=await createMember(demoTenantId,'client','Fictional empty inbox');const otherSession=await issueTestSession(other);
 assert.deepEqual(JSON.parse((await request('GET','/api/portal/disclosures',otherSession)).body),{items:[],nextBefore:null});assertError(await request('GET','/api/portal/disclosures?before='+grant.id,otherSession),404);
 const tenant=randomUUID();await context.schemaAdminPool!.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenant,'Fictional discovery tenant']);const foreign=await createMember(tenant,'client','Fictional remote inbox');const foreignSession=await issueTestSession(foreign,tenant);assert.deepEqual(JSON.parse((await request('GET','/api/portal/disclosures',foreignSession)).body),{items:[],nextBefore:null});assertError(await request('GET','/api/portal/disclosures?before='+grant.id,foreignSession),404);
 assertError(await request('GET','/api/portal/disclosures'),401);assertError(await request('GET','/api/portal/disclosures',context.demo!),403);
 for(const q of ['limit=0','limit=51','before=bad','caseId='+f.kase.id,'recipientId='+other])assertError(await request('GET','/api/portal/disclosures?'+q,f.clientSession),422);
 assertError(await request('GET','/api/portal/disclosures?before='+randomUUID(),f.clientSession),404);
});

test('discovery removes revoked, expired, stale-authority and issuer-revoked grants using download eligibility',async()=>{
 const f=await disclosureFixture();await request('POST',f.reviewUrl,f.session,{payload:f.input});const ids:string[]=[];for(let i=0;i<3;i++)ids.push(JSON.parse((await request('POST',f.disclosureUrl,context.demo!,{payload:{...f.disclosureInput,idempotencyKey:randomUUID()}})).body).id);
 const visible=async()=>JSON.parse((await request('GET','/api/portal/disclosures',f.clientSession)).body).items.map((r:{id:string})=>r.id);
 assert.equal((await visible()).length,3);await request('POST',`/api/cases/${f.kase.id}/disclosures/${ids[0]}/revoke`,context.demo!,{payload:{reason:'Fictional grant withdrawn'}});
 await context.schemaAdminPool!.query('ALTER TABLE report_disclosures DISABLE TRIGGER disclosure_append_only');try{await context.schemaAdminPool!.query("UPDATE report_disclosures SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[ids[1]]);}finally{await context.schemaAdminPool!.query('ALTER TABLE report_disclosures ENABLE TRIGGER disclosure_append_only');}assert.deepEqual(await visible(),[ids[2]]);
 await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,f.kase.id,demoUserId]);assert.deepEqual(await visible(),[]);await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,f.kase.id,demoUserId]);assert.deepEqual(await visible(),[ids[2]]);
 await approveAuthority(f.kase.id);assert.deepEqual(await visible(),[]);
});

test('recipient acknowledgement is explicit, fingerprint-bound, atomic and retryable over HTTP after restart',async()=>{
 const f=await disclosureFixture();await request('POST',f.reviewUrl,f.session,{payload:f.input});const grant=JSON.parse((await request('POST',f.disclosureUrl,context.demo!,{payload:f.disclosureInput})).body);const url='/api/portal/disclosures/'+grant.id;
 await request('GET',url,f.clientSession);assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM report_disclosure_acknowledgements WHERE disclosure_id=$1',[grant.id])).rows[0].n,0);
 const payload={sha256:grant.sha256,confirmReceipt:true};const app=await createAppInstance();let receipt;try{const address=await app.listen({host:'127.0.0.1',port:0});const results=await Promise.all([1,2].map(()=>fetch(address+url+'/acknowledge',{method:'POST',headers:{cookie:f.clientSession.cookie,origin:localOrigin,'content-type':'application/json','x-csrf-token':f.clientSession.csrf},body:JSON.stringify(payload)})));for(const r of results)assert.equal(r.status,200);receipt=await results[0]!.json();assert.deepEqual(await results[1]!.json(),receipt);}finally{await app.close();}
 await context.app!.close();context.app=await createAppInstance();assert.deepEqual(JSON.parse((await request('POST',url+'/acknowledge',f.clientSession,{payload})).body),receipt);
 assert.equal((await context.pool!.query("SELECT count(*)::int AS n FROM audit_events WHERE entity_id=$1 AND action='report.disclosure_acknowledged'",[grant.id])).rows[0].n,1);
 await assert.rejects(context.pool!.query('DELETE FROM report_disclosure_acknowledgements WHERE disclosure_id=$1',[grant.id]));
 assertError(await request('POST',url+'/acknowledge',f.clientSession,{payload:{...payload,sha256:'0'.repeat(64)}}),409);
 await request('POST',`/api/cases/${f.kase.id}/disclosures/${grant.id}/revoke`,context.demo!,{payload:{reason:'Fictional receipt does not extend access'}});assertError(await request('POST',url+'/acknowledge',f.clientSession,{payload}),404);assertError(await request('GET',url,f.clientSession),404);
});

test('recipient acknowledgement denies scope, role, CSRF, origin, missing attestation and audit failure',async()=>{
 const f=await disclosureFixture();await request('POST',f.reviewUrl,f.session,{payload:f.input});const grant=JSON.parse((await request('POST',f.disclosureUrl,context.demo!,{payload:f.disclosureInput})).body);const url='/api/portal/disclosures/'+grant.id+'/acknowledge',payload={sha256:grant.sha256,confirmReceipt:true};
 assertError(await request('POST',url,f.clientSession,{payload,csrfHeader:false}),403);assertError(await request('POST',url,f.clientSession,{payload,origin:'https://untrusted.invalid'}),403);assertError(await request('POST',url,context.demo!,{payload}),403);assertError(await request('POST',url,f.clientSession,{payload:{...payload,confirmReceipt:false}}),422);
 const other=await createMember(demoTenantId,'client','Fictional other receipt');assertError(await request('POST',url,await issueTestSession(other),{payload}),404);
 await context.schemaAdminPool!.query(`CREATE FUNCTION fail_ack_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='report.disclosure_acknowledged' THEN RAISE EXCEPTION 'fictional audit failure'; END IF; RETURN NEW; END $$`);await context.schemaAdminPool!.query('CREATE TRIGGER fail_ack_test BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_ack_test()');try{assertError(await request('POST',url,f.clientSession,{payload}),500);}finally{await context.schemaAdminPool!.query('DROP TRIGGER fail_ack_test ON audit_events');await context.schemaAdminPool!.query('DROP FUNCTION fail_ack_test()');}
 assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM report_disclosure_acknowledgements WHERE disclosure_id=$1',[grant.id])).rows[0].n,0);assert.equal((await request('POST',url,f.clientSession,{payload})).statusCode,200);
 await approveAuthority(f.kase.id);assertError(await request('POST',url,f.clientSession,{payload}),404);
});

test('clients can end their own session with CSRF but cannot mutate internal case records',async()=>{
 const f=await disclosureFixture();assertError(await request('POST','/api/session/end',f.clientSession,{payload:{},csrfHeader:false}),403);
 assertError(await request('POST','/api/cases',f.clientSession,{payload:{title:'Fictional denied case',client:'Fictional client',scope:'Fictional denied mutation',jurisdiction:'UK'}}),403);
 const ended=await request('POST','/api/session/end',f.clientSession,{payload:{}});assert.equal(ended.statusCode,200,ended.body);assert.match(String(ended.headers['set-cookie']),/Max-Age=0|Expires=Thu, 01 Jan 1970/);
 assertError(await request('GET','/api/portal/disclosures',f.clientSession),401);assert.equal((await request('GET','/api/workspace',context.demo!)).statusCode,200);
});

test('acknowledgements fail closed for foreign tenants, expired grants and corrupted snapshots',async()=>{
 const f=await disclosureFixture();await request('POST',f.reviewUrl,f.session,{payload:f.input});const grant=JSON.parse((await request('POST',f.disclosureUrl,context.demo!,{payload:f.disclosureInput})).body);const url='/api/portal/disclosures/'+grant.id+'/acknowledge',payload={sha256:grant.sha256,confirmReceipt:true};
 const tenant=randomUUID();await context.schemaAdminPool!.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenant,'Fictional receipt tenant']);const other=await createMember(tenant,'client','Fictional isolated recipient');assertError(await request('POST',url,await issueTestSession(other,tenant),{payload}),404);
 await context.schemaAdminPool!.query('ALTER TABLE report_revisions DISABLE TRIGGER report_revisions_append_only');const original=(await context.pool!.query('SELECT report_bytes FROM report_revisions WHERE id=$1',[f.revision.id])).rows[0].report_bytes;
 try{await context.schemaAdminPool!.query("UPDATE report_revisions SET report_bytes=convert_to('fictional corruption','UTF8') WHERE id=$1",[f.revision.id]);assertError(await request('POST',url,f.clientSession,{payload}),409);await context.schemaAdminPool!.query('UPDATE report_revisions SET report_bytes=$2 WHERE id=$1',[f.revision.id,original]);}finally{await context.schemaAdminPool!.query('ALTER TABLE report_revisions ENABLE TRIGGER report_revisions_append_only');}
 await context.schemaAdminPool!.query('ALTER TABLE report_disclosures DISABLE TRIGGER disclosure_append_only');try{await context.schemaAdminPool!.query("UPDATE report_disclosures SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[grant.id]);}finally{await context.schemaAdminPool!.query('ALTER TABLE report_disclosures ENABLE TRIGGER disclosure_append_only');}assertError(await request('POST',url,f.clientSession,{payload}),404);
 assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM report_disclosure_acknowledgements WHERE disclosure_id=$1',[grant.id])).rows[0].n,0);
});

test('reviewer disclosure history preserves grants, acknowledgement and revocation over HTTP after restart',async()=>{
 const f=await disclosureFixture();await request('POST',f.reviewUrl,f.session,{payload:f.input});const grant=JSON.parse((await request('POST',f.disclosureUrl,context.demo!,{payload:f.disclosureInput})).body);const url=`/api/cases/${f.kase.id}/disclosures`;
 let page=JSON.parse((await request('GET',url,context.demo!)).body);assert.equal(page.items[0].accessPolicyEligible,true);assert.equal(page.items[0].acknowledgedAt,null);assert.equal(page.items[0].reason,f.disclosureInput.reason);assert.equal(page.items[0].recipientId,f.client);assert.equal(page.items[0].report_bytes,undefined);assert.equal(page.items[0].idempotency_key,undefined);
 await request('POST',`/api/portal/disclosures/${grant.id}/acknowledge`,f.clientSession,{payload:{sha256:grant.sha256,confirmReceipt:true}});const reason='Fictional reviewer withdrawal after receipt';await request('POST',url+'/'+grant.id+'/revoke',context.demo!,{payload:{reason}});
 await context.app!.close();context.app=await createAppInstance();const app=await createAppInstance();try{const address=await app.listen({host:'127.0.0.1',port:0});const r=await fetch(address+url,{headers:{cookie:f.session.cookie}});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');page=await r.json();}finally{await app.close();}
 const row=page.items[0];assert.equal(row.id,grant.id);assert.equal(row.accessPolicyEligible,false);assert.ok(row.acknowledgedAt);assert.equal(row.revocation.reason,reason);assert.equal(row.revocation.revokedBy,demoUserId);assert.equal(row.sha256,grant.sha256);assert.equal(page.nextBefore,null);
});

test('disclosure oversight keysets retain database precision through ties, newer inserts and revoked rows',async()=>{
 const f=await disclosureFixture();await request('POST',f.reviewUrl,f.session,{payload:f.input});const ids:string[]=[];for(let i=0;i<4;i++)ids.push(JSON.parse((await request('POST',f.disclosureUrl,context.demo!,{payload:{...f.disclosureInput,idempotencyKey:randomUUID()}})).body).id);
 await context.schemaAdminPool!.query('ALTER TABLE report_disclosures DISABLE TRIGGER disclosure_append_only');try{for(let i=0;i<ids.length;i++)await context.schemaAdminPool!.query("UPDATE report_disclosures SET created_at='2026-01-01T00:00:00Z'::timestamptz + $2::integer * interval '1 microsecond' WHERE id=$1",[ids[i],i<2?0:i]);}finally{await context.schemaAdminPool!.query('ALTER TABLE report_disclosures ENABLE TRIGGER disclosure_append_only');}
 const url=`/api/cases/${f.kase.id}/disclosures`,expected=(await context.pool!.query('SELECT id FROM report_disclosures WHERE case_id=$1 ORDER BY created_at DESC,id DESC',[f.kase.id])).rows.map(r=>r.id);const first=JSON.parse((await request('GET',url+'?limit=2',context.demo!)).body);assert.deepEqual(first.items.map((r:{id:string})=>r.id),expected.slice(0,2));assert.equal(first.nextBefore,expected[1]);
 await request('POST',url+'/'+first.nextBefore+'/revoke',context.demo!,{payload:{reason:'Fictional anchor withdrawal'}});await request('POST',f.disclosureUrl,context.demo!,{payload:{...f.disclosureInput,idempotencyKey:randomUUID()}});
 const second=JSON.parse((await request('GET',url+'?limit=2&before='+first.nextBefore,context.demo!)).body);assert.deepEqual(second.items.map((r:{id:string})=>r.id),expected.slice(2));assert.equal(second.nextBefore,null);
});

test('disclosure oversight denies unrelated roles, case and tenant cursors and reflects revoked issuer or changed authority',async()=>{
 const f=await disclosureFixture();await request('POST',f.reviewUrl,f.session,{payload:f.input});const grant=JSON.parse((await request('POST',f.disclosureUrl,context.demo!,{payload:f.disclosureInput})).body);const url=`/api/cases/${f.kase.id}/disclosures`;
 assertError(await request('GET',url,f.clientSession),403);assertError(await request('GET',url),401);
 const investigator=await createMember(demoTenantId,'investigator','Fictional internal observer');await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,f.kase.id,investigator]);assertError(await request('GET',url,await issueTestSession(investigator)),403);
 const outsider=await createMember(demoTenantId,'reviewer','Fictional unrelated reviewer');assertError(await request('GET',url,await issueTestSession(outsider)),404);
 const tenant=randomUUID();await context.schemaAdminPool!.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenant,'Fictional oversight tenant']);const foreign=await createMember(tenant,'reviewer','Fictional foreign reviewer');assertError(await request('GET',url,await issueTestSession(foreign,tenant)),404);
 const other=await createCase();assertError(await request('GET',`/api/cases/${other.id}/disclosures?before=${grant.id}`,context.demo!),404);
 for(const query of ['limit=0','limit=51','before=invalid','recipientId='+f.client])assertError(await request('GET',url+'?'+query,context.demo!),422);
 await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,f.kase.id,demoUserId]);assertError(await request('GET',url,context.demo!),404);assert.equal(JSON.parse((await request('GET',url,f.session)).body).items[0].accessPolicyEligible,false);
 await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,f.kase.id,demoUserId]);await approveAuthority(f.kase.id);assert.equal(JSON.parse((await request('GET',url,context.demo!)).body).items[0].accessPolicyEligible,false);
});

test('real sandboxed browser verifies portal downloads, acknowledgement, revoked access and sign-out', {skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:90000},async t=>{
 const f=await disclosureFixture();await request('POST',f.reviewUrl,f.session,{payload:f.input});const grantResponse=await request('POST',f.disclosureUrl,context.demo!,{payload:f.disclosureInput});assert.equal(grantResponse.statusCode,200,grantResponse.body);const grant=JSON.parse(grantResponse.body);
 await withBrowserApp(async(b,origin)=>{
  t.diagnostic('Browser runtime: '+JSON.stringify(await b.send('Browser.getVersion')));
  await b.send('Network.enable');for(const pair of f.clientSession.cookie.split('; ')){const split=pair.indexOf('=');await b.send('Network.setCookie',{name:pair.slice(0,split),value:pair.slice(split+1),url:origin,path:'/',sameSite:'Strict',httpOnly:pair.startsWith('inveos_session=')});}
  const downloads=join(b.root,'downloads');await mkdir(downloads);await b.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  await b.send('Page.navigate',{url:origin+'/portal'});
  const text=()=>b.evaluate<string>("document.body?.innerText||''");
  const click=async(label:string)=>{await b.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)});if(!button||button.disabled)throw new Error('Button unavailable');button.click();})()`);};
  await eventually(async()=> (await text()).includes('Refresh disclosures'),'portal render');await click('Refresh disclosures');await eventually(async()=> (await text()).includes(grant.id),'recipient grant discovery');
  assert.equal(await b.evaluate("fetch('/api/workspace').then(r=>r.status)"),403);
  await click('Verify and download snapshot');await eventually(async()=> (await readdir(downloads)).includes('disclosure-'+grant.id+'.json'),'actual browser download');assert.equal(createHash('sha256').update(await readFile(join(downloads,'disclosure-'+grant.id+'.json'))).digest('hex'),grant.sha256);
  await eventually(async()=> (await text()).includes('Acknowledge receipt'),'receipt controls');await b.evaluate("document.querySelector('input[type=checkbox]').click()");await click('Acknowledge receipt');await eventually(async()=> (await text()).includes('Receipt acknowledged at'),'acknowledgement confirmation');
  assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM report_disclosure_acknowledgements WHERE disclosure_id=$1',[grant.id])).rows[0].n,1);
  await request('POST',`/api/cases/${f.kase.id}/disclosures/${grant.id}/revoke`,context.demo!,{payload:{reason:'Fictional browser withdrawal check'}});await click('Verify and download snapshot');await eventually(async()=> (await text()).includes('Download denied or unavailable'),'stale grant denied');
  await click('Refresh disclosures');await eventually(async()=> (await text()).includes('No currently available disclosures'),'withdrawn grant disappears');
  const otherSession=await issueTestSession(f.client);await click('End other sessions');await eventually(async()=> (await text()).includes('1 other sessions ended. This session remains active.'),'browser session revocation receipt');assertError(await request('GET','/api/portal/disclosures',otherSession),401);assert.equal(await b.evaluate("fetch('/api/portal/disclosures').then(r=>r.status)"),200);
  await click('Sign out');await eventually(async()=> (await text()).includes('Session ended.'),'client sign-out');assert.equal(await b.evaluate("fetch('/api/portal/disclosures').then(r=>r.status)"),401);
 });
});

type BrowserProxyProbe={epoch?:string;request?:(path:string,method:string)=>void;response?:(path:string,status:number)=>'hold'|'drop'|undefined};
async function withBrowserApp(run:(b:Awaited<ReturnType<typeof launchBrowser>>,origin:string)=>Promise<void>,probe:BrowserProxyProbe={}){
 const dist=fileURLToPath(new URL('../../web/dist/',import.meta.url));let apiAddress='';
 const server=createServer((req,res)=>{void(async()=>{
  const pathname=new URL(req.url!,'http://localhost').pathname;
  if(pathname.startsWith('/api/')){
   probe.request?.(pathname,req.method!);
   const upstream=proxyRequest(apiAddress+req.url,{method:req.method,headers:req.headers},response=>{
    const fault=probe.response?.(pathname,response.statusCode!);
    // Consume an actual committed API response without delivering it to Chrome.
    if(fault){response.resume();if(fault==='drop')res.destroy();return;}
    res.writeHead(response.statusCode!,response.headers);response.pipe(res);
   });upstream.on('error',()=>{res.statusCode=502;res.end();});req.pipe(upstream);return;
  }
  if(pathname==='/portal'||pathname==='/'){res.setHeader('content-type','text/html');res.end(await readFile(join(dist,'index.html')));return;}
  if(/^\/assets\/[A-Za-z0-9_.-]+\.(js|css)$/.test(pathname)){res.setHeader('content-type',pathname.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(join(dist,pathname.slice(1))));return;}
  res.statusCode=404;res.end();
 })().catch(()=>{res.statusCode=500;res.end();});});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address() as {port:number};const origin='http://127.0.0.1:'+address.port;
 const app=await createApp({pool:context.pool!,storageRoot:context.storageRoot!,allowedOrigins:[...allowedOrigins,origin],demoTenantId,demoUserId,sessionTtlSeconds:3600,sessionEpoch:probe.epoch});
 let browser:Awaited<ReturnType<typeof launchBrowser>>|undefined;
 try{
  apiAddress=await app.listen({host:'127.0.0.1',port:0});browser=await launchBrowser();const b=browser;
  await b.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await run(b,origin);
 }finally{try{await browser?.close();}finally{try{await app.close();}finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}}}
}

test('real browser creates a case, enforces authority and restores versioned scope', {skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:90000},async t=>{
 await withBrowserApp(async(b,origin)=>{
  t.diagnostic('Investigator browser runtime: '+JSON.stringify(await b.send('Browser.getVersion')));
  const text=()=>b.evaluate<string>("document.body?.innerText||''");
  const click=async(label:string)=>{await b.evaluate(`(()=>{const buttons=[...document.querySelectorAll('button')].filter(b=>b.textContent===${JSON.stringify(label)});const button=buttons.find(b=>b.getClientRects().length);if(!button||button.disabled)throw new Error('Button unavailable: '+${JSON.stringify(label)});button.click();})()`);};
  const fill=async(name:string,value:string)=>{await b.evaluate(`(()=>{const field=document.querySelector('dialog [name="'+${JSON.stringify(name)}+'"]');if(!field)throw new Error('Missing field');field.value=${JSON.stringify(value)};field.dispatchEvent(new Event('input',{bubbles:true}));})()`);};
  await b.send('Page.navigate',{url:origin+'/'});
  await eventually(async()=> (await text()).includes('Open persistent lab'),'prototype render');await click('Open persistent lab');
  await b.evaluate("document.querySelector('input[type=checkbox]').click()");await click('Enter synthetic lab');
  await eventually(async()=> (await text()).includes('PERSISTENT SYNTHETIC LAB'),'actual demo session');await click('New case');
  const title='Fictional browser scope '+randomUUID();
  await fill('title',title);await fill('client','Fictional Browser Commission');await fill('scope','Supplied fictional records only for browser acceptance.');await click('Create case');
  await eventually(async()=> (await text()).includes('Scope approval required'),'case created');
  const row=(await context.pool!.query('SELECT id,authority_version FROM cases WHERE tenant_id=$1 AND title=$2',[demoTenantId,title])).rows[0];assert.ok(row);assert.equal(row.authority_version,null);
  await click('Evidence');await click('Register evidence');assert.equal(await b.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Register original')).disabled"),true);await click('Cancel');await click('Brief');await click('Review authority');
  await fill('purpose','Fictional browser authority acceptance');await fill('basis','Synthetic exercise with no personal data');await b.evaluate("document.querySelector('input[type=checkbox]').click()");await click('Approve synthetic scope');
  await eventually(async()=> (await text()).includes('Supplied records authorised'),'authority approved');
  const records=()=>context.pool!.query('SELECT version,scope FROM authority_records WHERE tenant_id=$1 AND case_id=$2 ORDER BY version',[demoTenantId,row.id]);assert.equal((await records()).rows.length,1);
  await click('Review scope again');await fill('purpose','Fictional second browser authority decision');await fill('basis','Synthetic revised assessment with no personal data');await fill('scope','Only supplied fictional text, excluding external collection.');await b.evaluate("document.querySelector('input[type=checkbox]').click()");await click('Approve synthetic scope');
  await eventually(async()=> (await records()).rows.length===2,'second authority persisted');
  const previousDocument=await b.evaluate<number>('performance.timeOrigin');await b.send('Page.reload');await eventually(async()=>await b.evaluate<number>('performance.timeOrigin')!==previousDocument,'new document loaded');await eventually(async()=> (await text()).includes('PERSISTENT SYNTHETIC LAB')&&(await text()).includes('Only supplied fictional text, excluding external collection.'),'scope restored after reload');
  assert.equal(await b.evaluate("new URLSearchParams(location.hash.slice(1)).get('case')"),row.id);
  assert.deepEqual((await records()).rows.map(r=>r.version),[1,2]);assert.equal((await records()).rows[0].scope,'Supplied fictional records only for browser acceptance.');
  await click('Evidence');await click('Register evidence');
  const source='Fictional browser record: supplied amount is £125. No real persons.\n';const sourcePath=join(b.root,'fictional-browser.txt');await writeFile(sourcePath,source);
  const dom=await b.send<{root:{nodeId:number}}>('DOM.getDocument');const input=await b.send<{nodeId:number}>('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'dialog input[name=file]'});await b.send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[sourcePath]});await fill('sourceTime','2026-10-01T10:00');assert.equal(await b.evaluate("document.querySelector('dialog form').checkValidity()"),true);await click('Register original');
  await eventually(async()=>{const error=await b.evaluate<string>("document.querySelector('.form-error')?.textContent||''");if(error)throw new Error('Intake form: '+error);return (await text()).includes('fictional-browser.txt')&&(await text()).includes(source.trim());},'original preview');
  const original=(await context.pool!.query('SELECT digest,source_time FROM evidence WHERE tenant_id=$1 AND case_id=$2',[demoTenantId,row.id])).rows;assert.equal(original.length,1);assert.equal(original[0].digest,digest(source));
  await click('Propose claim');await fill('statement','The fictional supplied record states an amount of £125.');await fill('quote','supplied amount is £125.');
  await b.evaluate("document.querySelector('dialog form .primary').click()");await eventually(async()=> (await text()).includes('A claim is not a conclusion.'),'claim review');
  await click('Accept as finding');await eventually(async()=> (await text()).includes('Enter a review reason'),'reason required');assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM findings WHERE case_id=$1',[row.id])).rows[0].n,0);
  await b.evaluate("(()=>{const field=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Fictional source assertion only; not proof of payment.');field.dispatchEvent(new Event('input',{bubbles:true}));})()");await click('Accept as finding');await eventually(async()=> (await text()).includes('Decision recorded'),'finding accepted');
  await click('Report');const downloads=join(b.root,'downloads');await mkdir(downloads);await b.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});await click('Export JSON draft');
  await eventually(async()=> (await readdir(downloads)).some(name=>name.endsWith('-draft.json')),'downloaded investigator report');const reportFile=join(downloads,(await readdir(downloads)).find(name=>name.endsWith('-draft.json'))!);const bytes=await readFile(reportFile);const exported=JSON.parse(bytes.toString());assert.equal(exported.findings.length,1);assert.equal(exported.findings[0].source.quote,'supplied amount is £125.');
  assert.equal(await b.evaluate("document.querySelector('[aria-label=\"Exported draft fingerprint\"]').value"),createHash('sha256').update(bytes).digest('hex'));
  const verifier=fileURLToPath(new URL('../../../tools/verify_report.py',import.meta.url));await promisify(execFile)('python3',[verifier,reportFile,'--expected-sha256',createHash('sha256').update(bytes).digest('hex'),'--expected-case-id',row.id],{timeout:10000});
  await writeFile(reportFile,Buffer.concat([bytes,Buffer.from('tampered')]));await assert.rejects(promisify(execFile)('python3',[verifier,reportFile,'--expected-sha256',createHash('sha256').update(bytes).digest('hex')],{timeout:10000}));
  await click('Workspace details');await click('End lab session & return to prototype');await eventually(async()=> (await text()).includes('INTERACTIVE PROTOTYPE'),'investigator sign-out');assert.equal(await b.evaluate("fetch('/api/workspace').then(r=>r.status)"),401);
 });
});

async function binaryBrowserControls(b:Awaited<ReturnType<typeof launchBrowser>>,origin:string,caseId:string){
 const text=()=>b.evaluate<string>("document.body?.innerText||''");
 const click=async(label:string)=>{await b.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}&&b.getClientRects().length);if(!button||button.disabled)throw new Error('Button unavailable: '+${JSON.stringify(label)});button.click();})()`);};
 await b.send('Network.enable');
 for(const pair of context.demo!.cookie.split('; ')){const split=pair.indexOf('=');await b.send('Network.setCookie',{name:pair.slice(0,split),value:pair.slice(split+1),url:origin,path:'/',sameSite:'Strict',httpOnly:pair.startsWith('inveos_session=')});}
 await b.send('Page.navigate',{url:origin+'/#case='+caseId+'&view=Evidence'});
 await eventually(async()=> (await text()).includes('Register a binary original'),'binary intake render');
 const fill=async(path:string)=>{
  const dom=await b.send<{root:{nodeId:number}}>('DOM.getDocument');const input=await b.send<{nodeId:number}>('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'form[aria-label="Binary original intake"] input[name=file]'});
  await b.send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[path]});
  await b.evaluate(`(()=>{const form=document.querySelector('form[aria-label="Binary original intake"]');for(const [name,value] of Object.entries({sourceTime:'2026-10-01T09:00:00+01:00',method:'Fictional supplied bytes for browser recovery'})){const field=form.elements.namedItem(name);field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));}if(!form.checkValidity())throw new Error('Invalid binary fixture form');})()`);
 };
 const reload=async()=>{const previous=await b.evaluate<number>('performance.timeOrigin');await b.send('Page.reload');await eventually(async()=>await b.evaluate<number>('performance.timeOrigin')!==previous,'fresh recovery document');await eventually(async()=> (await text()).includes('Unconfirmed intake:'),'retry recovered from tab storage');assert.equal(await b.evaluate("document.querySelector('form[aria-label=\"Binary original intake\"] input[name=file]').files.length"),0);};
 const pending=()=>b.evaluate<Array<[string,string]>>("Object.entries(sessionStorage).filter(([key])=>key.includes('binary-intake'))");
 return {text,click,fill,reload,pending};
}

test('real browser pauses committed chunks, reloads and recovers a lost completion without duplicate originals', {skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:90000},async t=>{
 const kase=await createCase();await approveAuthority(kase.id);
 let held=false,dropped=false,allowCompletion=false;const requests:string[]=[];
 const probe:BrowserProxyProbe={request:(path,method)=>{if(method==='POST'&&path.includes('/uploads'))requests.push(path);},response:(path,status)=>{
  if(status===200&&path.endsWith('/chunk')&&!held){held=true;return 'hold';}
  if(status===200&&path.endsWith('/complete')&&!allowCompletion){dropped=true;return 'drop';}
 }};
 await withBrowserApp(async(b,origin)=>{
  t.diagnostic('Binary recovery browser runtime: '+JSON.stringify(await b.send('Browser.getVersion')));
  const ui=await binaryBrowserControls(b,origin,kase.id),bytes=Buffer.alloc(65537);for(let i=0;i<bytes.length;i++)bytes[i]=i%256;
  const path=join(b.root,'fictional-recovery.bin');await writeFile(path,bytes);await ui.fill(path);await ui.click('Register in quarantine');
  await eventually(async()=>held,'first chunk committed but acknowledgement held');
  assert.deepEqual((await context.pool!.query('SELECT ordinal FROM upload_chunks WHERE case_id=$1 ORDER BY ordinal',[kase.id])).rows,[{ordinal:0}]);
  await ui.click('Pause transfer');await eventually(async()=> (await ui.text()).includes('Transfer paused.'),'explicit paused state');
  const pending=await ui.pending();assert.equal(pending.length,1);assert.deepEqual(Object.keys(JSON.parse(pending[0]![1])).sort(),['fingerprint','key']);assert.ok(pending[0]![0].endsWith(':chunks-v1'));assert.ok(!JSON.stringify(pending).includes('fictional-recovery'));
  await ui.reload();assert.deepEqual(await ui.pending(),pending);
  await ui.fill(path);await writeFile(path,Buffer.alloc(bytes.length,254));await ui.fill(path);const before=requests.length;await ui.click('Recover original receipt');
  await eventually(async()=> (await ui.text()).includes('An unconfirmed intake exists.'),'changed file denied');assert.equal(requests.length,before);assert.deepEqual(await ui.pending(),pending);
  await writeFile(path,bytes);await ui.fill(path);await ui.click('Recover original receipt');
  await eventually(async()=>dropped,'completed original response deliberately lost');await eventually(async()=>await b.evaluate("!document.querySelector('form[aria-label=\"Binary original intake\"] fieldset').disabled"),'failed completion unlocks retry');
  assert.equal(requests.filter(p=>p.endsWith('/chunk')).length,3,'only two missing chunks transmitted on recovery');
  const rows=(await context.pool!.query('SELECT id,status,evidence_id FROM upload_reservations WHERE case_id=$1',[kase.id])).rows;assert.equal(rows.length,1);assert.equal(rows[0].status,'completed');assert.ok(rows[0].evidence_id);assert.deepEqual(await ui.pending(),pending);
  await ui.reload();allowCompletion=true;await ui.fill(path);await ui.click('Recover original receipt');await eventually(async()=> (await ui.text()).includes('confirmed in quarantine.'),'receipt confirmed after response loss');
  assert.deepEqual(await ui.pending(),[]);assert.equal(requests.filter(p=>p.endsWith('/chunk')).length,3,'completed recovery sends no chunk again');
  assert.deepEqual((await context.pool!.query("SELECT (SELECT count(*)::int FROM evidence WHERE case_id=$1) AS originals,(SELECT count(*)::int FROM audit_events WHERE case_id=$1 AND action='evidence.received') AS receipts",[kase.id])).rows[0],{originals:1,receipts:1});
  await eventually(async()=> (await ui.text()).includes('Binary original quarantined'),'quarantine preview shown');assert.equal(await b.evaluate("[...document.querySelectorAll('.evidence-inspector button')].find(b=>b.textContent.startsWith('Propose claim')).disabled"),true);assert.equal(await b.evaluate("document.querySelector('.evidence-inspector').textContent.includes('TEXT REPRESENTATION')"),false);
  const downloads=join(b.root,'downloads');await mkdir(downloads);await b.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});await ui.click('Verify and download original');
  const downloaded='original-'+rows[0].evidence_id+'.bin';await eventually(async()=> (await readdir(downloads)).includes(downloaded),'actual verified original download');assert.deepEqual(await readFile(join(downloads,downloaded)),bytes);
  assert.equal((await context.pool!.query("SELECT count(*)::int AS n FROM audit_events WHERE case_id=$1 AND action='evidence.original_read'",[kase.id])).rows[0].n,1);
  await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,kase.id,demoUserId]);
  try{await ui.click('Verify and download original');await eventually(async()=> (await ui.text()).includes('Original download denied or unavailable.'),'withdrawn membership denies stale UI download');assert.deepEqual(await readdir(downloads),[downloaded]);}finally{await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,kase.id,demoUserId]);}
  const original=(await context.pool!.query('SELECT digest,source_time,original_kind,status FROM evidence WHERE case_id=$1',[kase.id])).rows[0];assert.equal(original.digest,createHash('sha256').update(bytes).digest('hex'));assert.equal(original.source_time,'2026-10-01T09:00:00+01:00');assert.equal(original.original_kind,'opaque_binary');assert.equal(original.status,'Quarantined');
  await ui.click('Refresh upload history');await eventually(async()=> (await ui.text()).includes('Original receipt: '+rows[0].evidence_id),'persisted completion history');
 },probe);
});

test('real browser cancels paused staging and clears only its confirmed retry before replacement', {skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:90000},async()=>{
 const kase=await createCase();await approveAuthority(kase.id);let held=false;
 await withBrowserApp(async(b,origin)=>{
  const ui=await binaryBrowserControls(b,origin,kase.id),path=join(b.root,'fictional-cancel.bin');await writeFile(path,Buffer.alloc(32769,255));await ui.fill(path);await ui.click('Register in quarantine');
  await eventually(async()=>held,'staging committed before pause');await ui.click('Pause transfer');await eventually(async()=> (await ui.text()).includes('Transfer paused.'),'pause settled');
  const pending=await ui.pending();await ui.click('Confirm cancellation and clear this retry');await eventually(async()=> (await ui.text()).includes('Cancellation is not confirmed.'),'open reservation cannot be abandoned');assert.deepEqual(await ui.pending(),pending);
  await ui.click('Refresh pending uploads');await eventually(async()=> (await ui.text()).includes('Cancel this pending upload'),'pending reservation visible');await ui.click('Cancel this pending upload');await eventually(async()=> (await ui.text()).includes('Staging removed; history retained.'),'server cancellation receipt');assert.deepEqual(await ui.pending(),pending);
  const cancelled=(await context.pool!.query('SELECT id,status,evidence_id FROM upload_reservations WHERE case_id=$1',[kase.id])).rows[0];assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.evidence_id,null);assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM upload_chunks WHERE case_id=$1',[kase.id])).rows[0].n,0);
  await ui.click('Confirm cancellation and clear this retry');await eventually(async()=> (await ui.text()).includes('Cancelled reservation confirmed.'),'terminal cancellation clears retry');assert.deepEqual(await ui.pending(),[]);
  await ui.fill(path);await ui.click('Register in quarantine');await eventually(async()=> (await ui.text()).includes('confirmed in quarantine.'),'replacement original confirmed');assert.deepEqual(await ui.pending(),[]);
  const rows=(await context.pool!.query('SELECT status,id FROM upload_reservations WHERE case_id=$1 ORDER BY created_at',[kase.id])).rows;assert.deepEqual(rows.map(r=>r.status),['cancelled','completed']);assert.notEqual(rows[0].id,rows[1].id);assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM evidence WHERE case_id=$1',[kase.id])).rows[0].n,1);
 },{response:(path,status)=>{if(status===200&&path.endsWith('/chunk')&&!held){held=true;return 'hold';}}});
});

test('quiesced PostgreSQL and original-store backup restores exact reports, authority and access guards', {timeout:90000},async t=>{
 // Separate random schema and filesystem roots: never reset another test or an application database.
 const previous={...context},schema='api_test_restore_'+randomUUID().replaceAll('-','');
 assert.match(schema,/^api_test_restore_[a-f0-9]{32}$/);
 const root=await mkdtemp(join(process.cwd(),'.local-data','restore-')),objects=join(root,'objects'),backup=join(root,'backup');
 const db=new URL(adminDatabaseUrl!);
 const command=async(name:string,args:string[])=>promisify(execFile)(name,args,{timeout:20000,maxBuffer:1024*1024,env:{...process.env,PGHOST:db.hostname,PGPORT:db.port||'5432',PGUSER:decodeURIComponent(db.username),PGPASSWORD:decodeURIComponent(db.password),PGDATABASE:db.pathname.slice(1)}});
 const checksum=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
 try{
  await mkdir(objects);await mkdir(backup,{mode:0o700});await runMigrations(previous.adminPool!,schema);
  context.schema=schema;context.storageRoot=objects;context.schemaAdminPool=createPool(adminDatabaseUrl!,schema,2);context.pool=createPool(databaseUrl!,schema,4);context.app=await createAppInstance();context.demo=await startDemoSession();
  const f=await reportFixture(),key=randomUUID();const frozen=await request('POST',f.url,context.demo!,{payload:{idempotencyKey:key}});assert.equal(frozen.statusCode,200,frozen.body);const revision=JSON.parse(frozen.body);
  const originalUrl=`/api/cases/${f.kase.id}/evidence/${f.evidence.id}/original`,reportUrl=f.url+'/'+revision.id;
  const original=await request('GET',originalUrl,context.demo!),report=await request('GET',reportUrl,context.demo!);assert.equal(original.statusCode,200);assert.equal(report.statusCode,200);
  const client=await createMember(demoTenantId,'client','Fictional restore access check'),clientSession=await issueTestSession(client);
  const authorityBefore=(await context.pool!.query('SELECT * FROM authority_records ORDER BY id')).rows;
  const auditBefore=(await context.pool!.query('SELECT * FROM audit_events ORDER BY id')).rows;
  const migrationsBefore=(await context.schemaAdminPool!.query('SELECT * FROM schema_migrations ORDER BY filename')).rows;
  const evidenceRow=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[f.evidence.id])).rows[0];
  await context.app!.close();await context.pool!.end();await context.schemaAdminPool!.end();
  // No writers remain for this isolated schema/store. This is not a live atomic backup protocol.
  const archive=join(backup,'database.dump');await command('pg_dump',['--schema='+schema,'--format=custom','--no-owner','--file='+archive]);await cp(objects,join(backup,'objects'),{recursive:true});
  const backupHash=checksum(await readFile(archive));assert.ok((await stat(archive)).size>0);
  await previous.adminPool!.query(`DROP SCHEMA "${schema}" CASCADE`);await rm(objects,{recursive:true});await mkdir(objects);
  assert.equal((await previous.adminPool!.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[schema])).rows.length,0);
  assert.equal(checksum(await readFile(archive)),backupHash);
  await command('pg_restore',['--exit-on-error','--single-transaction','--no-owner','--dbname='+db.pathname.slice(1),archive]);
  context.schemaAdminPool=createPool(adminDatabaseUrl!,schema,2);context.pool=createPool(databaseUrl!,schema,4);context.app=await createAppInstance();
  assert.deepEqual((await context.schemaAdminPool!.query('SELECT * FROM schema_migrations ORDER BY filename')).rows,migrationsBefore);
  assert.deepEqual((await context.pool!.query('SELECT * FROM authority_records ORDER BY id')).rows,authorityBefore);
  assert.deepEqual((await context.pool!.query('SELECT * FROM audit_events ORDER BY id')).rows,auditBefore);
  assertError(await request('GET',originalUrl,context.demo!),409);
  await cp(join(backup,'objects'),objects,{recursive:true});
  const restored=await request('GET',originalUrl,context.demo!);assert.equal(restored.statusCode,200,restored.body);assert.deepEqual(restored.rawPayload,original.rawPayload);
  const restoredReport=await request('GET',reportUrl,context.demo!);assert.equal(restoredReport.statusCode,200,restoredReport.body);assert.deepEqual(restoredReport.rawPayload,report.rawPayload);assert.equal(checksum(restoredReport.rawPayload),revision.sha256);
  const offline=join(root,'restored-report.json');await writeFile(offline,restoredReport.rawPayload);await promisify(execFile)('python3',[fileURLToPath(new URL('../../../tools/verify_report.py',import.meta.url)),offline,'--expected-sha256',revision.sha256,'--expected-case-id',f.kase.id],{timeout:10000});
  assertError(await request('GET',originalUrl,clientSession),403);assertError(await request('GET',reportUrl,clientSession),403);
  await assert.rejects(context.pool!.query("UPDATE evidence SET digest=$1 WHERE id=$2",['0'.repeat(64),f.evidence.id]));
  await assert.rejects(context.schemaAdminPool!.query('DELETE FROM authority_records WHERE case_id=$1',[f.kase.id]));
  const retry=await request('POST',f.url,context.demo!,{payload:{idempotencyKey:key}});assert.equal(retry.statusCode,200);assert.equal(JSON.parse(retry.body).id,revision.id);
  await writeFile(join(objects,evidenceRow.object_path),'Fictional restore corruption');assertError(await request('GET',originalUrl,context.demo!),409);
  await cp(join(backup,'objects',evidenceRow.object_path),join(objects,evidenceRow.object_path));assert.equal((await request('GET',originalUrl,context.demo!)).statusCode,200);
  await runMigrations(previous.adminPool!,schema);assert.deepEqual((await context.schemaAdminPool!.query('SELECT * FROM schema_migrations ORDER BY filename')).rows,migrationsBefore);
  const restoredSession=context.demo!;await context.app!.close();context.app=await createAppInstance(randomUUID());
  assertError(await request('GET',originalUrl,restoredSession),401);assertError(await request('GET',reportUrl,restoredSession),401);assertError(await request('POST','/api/session/end-others',restoredSession,{payload:{}}),401);
  context.demo=await startDemoSession();assert.equal((await request('GET',originalUrl,context.demo!)).statusCode,200);assert.equal((await request('GET',reportUrl,context.demo!)).statusCode,200);
  t.diagnostic('Restore passed: quiesced schema + objects, missing/corrupt object denial, exact snapshot, offline verification, permissions, immutable authority and idempotency. Dump SHA-256 '+backupHash);
 }finally{
  try{if(context.app!==previous.app)await context.app?.close();if(context.pool!==previous.pool)await context.pool?.end().catch(()=>{});if(context.schemaAdminPool!==previous.schemaAdminPool)await context.schemaAdminPool?.end().catch(()=>{});}finally{Object.assign(context,previous);await previous.adminPool!.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await rm(root,{recursive:true,force:true});}
 }
});

test('ending other sessions is scoped, bounded, audited, repeatable and survives restart',async()=>{
 const user=await createMember(demoTenantId,'investigator','Fictional session owner'),current=await issueTestSession(user),other=await issueTestSession(user);
 const unrelated=await issueTestSession(demoUserId),tenant=randomUUID();await context.schemaAdminPool!.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenant,'Fictional second session workspace']);await context.schemaAdminPool!.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'investigator')",[tenant,user]);const foreign=await issueTestSession(user,tenant);
 const response=await request('POST','/api/session/end-others',current,{payload:{}});assert.equal(response.statusCode,200,response.body);assert.deepEqual(JSON.parse(response.body),{revokedCount:1,moreRemaining:false});assert.equal(response.headers['cache-control'],'no-store');
 assertError(await request('GET','/api/workspace',other),401);for(const session of [current,unrelated,foreign])assert.equal((await request('GET','/api/workspace',session)).statusCode,200);
 await context.app!.close();context.app=await createAppInstance();assertError(await request('GET','/api/workspace',other),401);assert.deepEqual(JSON.parse((await request('POST','/api/session/end-others',current,{payload:{}})).body),{revokedCount:0,moreRemaining:false});
 const rows=(await context.pool!.query("SELECT metadata FROM audit_events WHERE actor_user_id=$1 AND action='session.others_ended'",[user])).rows;assert.equal(rows.length,1);assert.equal(rows[0].metadata.revokedCount,1);
 for(let i=0;i<101;i++)await issueTestSession(user);
 assert.deepEqual(JSON.parse((await request('POST','/api/session/end-others',current,{payload:{}})).body),{revokedCount:100,moreRemaining:true});assert.deepEqual(JSON.parse((await request('POST','/api/session/end-others',current,{payload:{}})).body),{revokedCount:1,moreRemaining:false});
});

test('other-session revocation requires CSRF and rolls back with its audit; clients cannot select another owner',async()=>{
 const user=await createMember(demoTenantId,'client','Fictional session client'),current=await issueTestSession(user),other=await issueTestSession(user);
 const url='/api/session/end-others';assertError(await request('POST',url,undefined,{payload:{}}),401);assertError(await request('POST',url,current,{payload:{},csrfHeader:false}),403);assertError(await request('POST',url,current,{payload:{},origin:'https://untrusted.invalid'}),403);assertError(await request('POST',url,current,{payload:{userId:demoUserId}}),422);
 await context.schemaAdminPool!.query("CREATE FUNCTION fail_session_revoke_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='session.others_ended' THEN RAISE EXCEPTION 'Fictional audit failure'; END IF; RETURN NEW; END $$");await context.schemaAdminPool!.query('CREATE TRIGGER fail_session_revoke_test BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_session_revoke_test()');
 try{assertError(await request('POST',url,current,{payload:{}}),500);assert.equal((await request('GET','/api/portal/disclosures',other)).statusCode,200);}finally{await context.schemaAdminPool!.query('DROP TRIGGER fail_session_revoke_test ON audit_events');await context.schemaAdminPool!.query('DROP FUNCTION fail_session_revoke_test()');}
 const replies=await Promise.all([request('POST',url,current,{payload:{}}),request('POST',url,current,{payload:{}})]);assert.deepEqual(replies.map(r=>JSON.parse(r.body).revokedCount).sort(),[0,1]);assertError(await request('GET','/api/portal/disclosures',other),401);assert.equal((await request('GET','/api/portal/disclosures',current)).statusCode,200);assertError(await request('GET','/api/workspace',current),403);
});

test('competing session owners leave exactly one caller active and exclude expired sessions',async()=>{
 const user=await createMember(demoTenantId,'investigator','Fictional competing session owner');
 const expired=await issueTestSession(user);await context.schemaAdminPool!.query('UPDATE sessions SET expires_at=now()-interval \'1 minute\' WHERE user_id=$1',[user]);
 const first=await issueTestSession(user),second=await issueTestSession(user);
 const responses=await Promise.all([first,second].map(s=>request('POST','/api/session/end-others',s,{payload:{}})));
 assert.deepEqual(responses.map(r=>r.statusCode).sort(),[200,401]);assert.deepEqual(JSON.parse(responses.find(r=>r.statusCode===200)!.body),{revokedCount:1,moreRemaining:false});
 const access=await Promise.all([first,second].map(s=>request('GET','/api/workspace',s)));assert.deepEqual(access.map(r=>r.statusCode).sort(),[200,401]);assertError(await request('GET','/api/workspace',expired),401);
 const rows=(await context.pool!.query('SELECT revoked_at FROM sessions WHERE user_id=$1 AND expires_at<now()',[user])).rows;assert.equal(rows.length,1);assert.equal(rows[0].revoked_at,null);
 assert.equal((await context.pool!.query("SELECT count(*)::int AS n FROM audit_events WHERE actor_user_id=$1 AND action='session.others_ended'",[user])).rows[0].n,1);
});

test('external session generations reject old cookies across restart without changing evidence or audit history',async()=>{
 const before=context.demo!,epoch=randomUUID();const beforeCount=(await context.pool!.query('SELECT count(*)::int AS n FROM audit_events')).rows[0].n;
 await context.app!.close();context.app=await createAppInstance(epoch);
 assertError(await request('GET','/api/workspace',before),401);assertError(await request('POST','/api/session/end',before,{payload:{}}),401);
 context.demo=await startDemoSession();const active=context.demo!;await assert.rejects(context.pool!.query('UPDATE sessions SET epoch=$1 WHERE epoch=$2',[randomUUID(),epoch]),/immutable/);assert.equal((await request('GET','/api/workspace',active)).statusCode,200);
 assert.deepEqual(JSON.parse((await request('POST','/api/session/end-others',active,{payload:{}})).body),{revokedCount:0,moreRemaining:false});
 assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM audit_events')).rows[0].n,beforeCount+1);
 await context.app!.close();context.app=await createAppInstance(epoch);assert.equal((await request('GET','/api/workspace',active)).statusCode,200);assertError(await request('GET','/api/workspace',before),401);
 await context.app!.close();context.app=await createAppInstance(randomUUID());assertError(await request('GET','/api/workspace',active),401);
 await context.app!.close();context.app=await createAppInstance();context.demo=await issueTestSession(demoUserId);
});

test('browser rejects a retired session generation and requires explicit lab re-entry', {skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:90000},async()=>{
 const old=await issueTestSession(demoUserId),epoch=randomUUID();
 await withBrowserApp(async(b,origin)=>{
  await b.send('Network.enable');for(const pair of old.cookie.split('; ')){const split=pair.indexOf('=');await b.send('Network.setCookie',{name:pair.slice(0,split),value:pair.slice(split+1),url:origin,path:'/',sameSite:'Strict',httpOnly:pair.startsWith('inveos_session=')});}
  const text=()=>b.evaluate<string>("document.body?.innerText||''");const click=async(label:string)=>{await b.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}&&b.getClientRects().length);if(!button||button.disabled)throw new Error('Unavailable button');button.click();})()`);};
  await b.send('Page.navigate',{url:origin+'/'});await eventually(async()=> (await text()).includes('Open persistent lab'),'retired session cannot restore workspace');assert.equal(await b.evaluate("fetch('/api/workspace').then(r=>r.status)"),401);
  await click('Open persistent lab');await b.evaluate("document.querySelector('input[type=checkbox]').click()");await click('Enter synthetic lab');await eventually(async()=> (await text()).includes('PERSISTENT SYNTHETIC LAB'),'explicit new-generation session');assert.equal(await b.evaluate("fetch('/api/workspace').then(r=>r.status)"),200);
  assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM sessions WHERE epoch=$1',[epoch])).rows[0].n,1);
 },{epoch});
});


async function renewalFixture() {
  context.demo=await issueTestSession(demoUserId);
  const kase=await createCase();await approveAuthority(kase.id);
  const evidence=parseBody<Evidence>(await uploadEvidence(kase.id));
  const url=`/api/cases/${kase.id}/integrity-jobs`;
  const response=await request('POST',url,context.demo!,{payload:{evidenceId:evidence.id,idempotencyKey:randomUUID()}});
  assert.equal(response.statusCode,200,response.body);
  const scope={tenantId:demoTenantId,caseId:kase.id,jobId:JSON.parse(response.body).id};
  const lease=await claimIntegrityJob(context.pool!,scope);assert.ok(lease);
  return {scope,lease,url};
}

test('worker renewal preserves attempt, deadline and token across restart without exposing credentials',async()=>{
  const {scope,lease,url}=await renewalFixture();
  const before=(await context.pool!.query('SELECT lease_deadline,lease_token FROM integrity_jobs WHERE id=$1',[scope.jobId])).rows[0];
  await context.schemaAdminPool!.query("UPDATE integrity_jobs SET lease_until=clock_timestamp()+interval '2 seconds' WHERE id=$1",[scope.jobId]);
  await context.app!.close();context.app=await createAppInstance();
  const renewed=await renewIntegrityJob(context.pool!,scope,lease.token);assert.ok(renewed);
  assert.equal(renewed.attempt,1);assert.deepEqual(renewed.deadline,before.lease_deadline);
  const remaining=(await context.pool!.query('SELECT EXTRACT(EPOCH FROM lease_until-clock_timestamp())::float AS seconds,lease_token FROM integrity_jobs WHERE id=$1',[scope.jobId])).rows[0];
  assert.ok(remaining.seconds>50 && remaining.seconds<=60);assert.equal(remaining.lease_token,before.lease_token);
  const events=(await context.pool!.query('SELECT status FROM integrity_job_events WHERE job_id=$1 ORDER BY id',[scope.jobId])).rows;
  assert.deepEqual(events.map(r=>r.status),['queued','running']);
  const body=(await request('GET',`${url}/${scope.jobId}`,context.demo!)).body;
  assert.ok(!body.includes(lease.token));assert.ok(!body.includes('lease_deadline'));
  assert.equal((await finishIntegrityJob(context.pool!,scope,lease.token,null))?.status,'succeeded');
  assert.equal(await renewIntegrityJob(context.pool!,scope,lease.token),null);
});

test('renewal denies wrong scope, stale tokens, expiry, cancellation and superseded workers',async()=>{
  const {scope,lease,url}=await renewalFixture();
  for(const wrong of [{...scope,tenantId:randomUUID()},{...scope,caseId:randomUUID()},{...scope,jobId:randomUUID()}]) {
    assert.equal(await renewIntegrityJob(context.pool!,wrong,lease.token),null);
  }
  assert.equal(await renewIntegrityJob(context.pool!,scope,randomUUID()),null);
  await context.schemaAdminPool!.query("UPDATE integrity_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[scope.jobId]);
  assert.equal(await renewIntegrityJob(context.pool!,scope,lease.token),null);
  const next=await claimIntegrityJob(context.pool!,scope);assert.ok(next);
  assert.equal(await renewIntegrityJob(context.pool!,scope,lease.token),null);
  const current=await renewIntegrityJob(context.pool!,scope,next.token);assert.equal(current?.attempt,2);
  await request('POST',`${url}/${scope.jobId}/cancel`,context.demo!,{payload:{}});
  assert.equal(await renewIntegrityJob(context.pool!,scope,next.token),null);
});

test('renewal rechecks authority and requester membership',async()=>{
  for(const revoke of ['authority','membership']) {
    const {scope,lease}=await renewalFixture();
    if(revoke==='authority')await approveAuthority(scope.caseId);
    else await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,scope.caseId,demoUserId]);
    assert.equal(await renewIntegrityJob(context.pool!,scope,lease.token),null);
    const row=(await context.pool!.query('SELECT status,failure_code FROM integrity_jobs WHERE id=$1',[scope.jobId])).rows[0];
    assert.deepEqual(row,{status:'cancelled',failure_code:'scope_changed'});
    assert.equal(await finishIntegrityJob(context.pool!,scope,lease.token,null),null);
  }
});

test('renewals cap at immutable attempt deadline and concurrent renewals cannot accumulate time',async()=>{
  const {scope,lease}=await renewalFixture();
  await assert.rejects(context.pool!.query("UPDATE integrity_jobs SET lease_deadline=lease_deadline+interval '1 second' WHERE id=$1",[scope.jobId]),/cannot be extended/);
  await assert.rejects(context.pool!.query('UPDATE integrity_jobs SET lease_deadline=NULL WHERE id=$1',[scope.jobId]),/cannot be extended/);
  await context.schemaAdminPool!.query("UPDATE integrity_jobs SET lease_until=clock_timestamp()+interval '10 seconds',lease_deadline=clock_timestamp()+interval '20 seconds' WHERE id=$1",[scope.jobId]);
  const renewals=await Promise.all([renewIntegrityJob(context.pool!,scope,lease.token),renewIntegrityJob(context.pool!,scope,lease.token)]);
  for(const result of renewals){assert.ok(result);assert.deepEqual(result.leaseUntil,result.deadline);assert.equal(result.attempt,1);}
  await context.schemaAdminPool!.query("UPDATE integrity_jobs SET lease_until=clock_timestamp()-interval '2 seconds',lease_deadline=clock_timestamp()-interval '1 second' WHERE id=$1",[scope.jobId]);
  assert.equal(await renewIntegrityJob(context.pool!,scope,lease.token),null);
  assert.equal(await finishIntegrityJob(context.pool!,scope,lease.token,null),null);
});

test('renewal lock timeout leaves lease unchanged and can be retried after contention',async()=>{
  const {scope,lease}=await renewalFixture();
  const before=(await context.pool!.query('SELECT lease_until,lease_deadline,attempt FROM integrity_jobs WHERE id=$1',[scope.jobId])).rows[0];
  const blocker=await context.pool!.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM integrity_jobs WHERE id=$1 FOR UPDATE',[scope.jobId]);
    await assert.rejects(renewIntegrityJob(context.pool!,scope,lease.token),(error:unknown)=>
      error instanceof Error && 'code' in error && error.code==='55P03');
    const after=(await blocker.query('SELECT lease_until,lease_deadline,attempt FROM integrity_jobs WHERE id=$1',[scope.jobId])).rows[0];
    assert.deepEqual(after,before);
  } finally {await blocker.query('ROLLBACK');blocker.release();}
  assert.ok(await renewIntegrityJob(context.pool!,scope,lease.token));
});


test('actual leased subprocess stops on database cancellation and changed authority without completing job',async()=>{
  for(const change of ['cancel','authority']) {
    const {scope,lease,url}=await renewalFixture();
    const marker=join(context.storageRoot!,`fictional-worker-${randomUUID()}.txt`);
    const script=`const fs=require('node:fs');let n=0;setInterval(()=>fs.writeFileSync(${JSON.stringify(marker)},String(++n)),10)`;
    const stopped=assert.rejects(runLeasedWorker(context.pool!,scope,lease.token,{
      command:process.execPath,args:['-e',script],cwd:context.storageRoot!,heartbeatMs:30,timeoutMs:5000,
    }),/lease_lost/);
    for(let i=0;i<100;i++) {
      if(await stat(marker).then(()=>true,()=>false))break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.ok(await stat(marker));
    if(change==='cancel')assert.equal((await request('POST',`${url}/${scope.jobId}/cancel`,context.demo!,{payload:{}})).statusCode,200);
    else await approveAuthority(scope.caseId);
    await stopped;
    const count=await readFile(marker,'utf8');await new Promise(resolve=>setTimeout(resolve,80));
    assert.equal(await readFile(marker,'utf8'),count);
    const row=(await context.pool!.query('SELECT status FROM integrity_jobs WHERE id=$1',[scope.jobId])).rows[0];
    assert.equal(row.status,'cancelled');
    assert.equal(await finishIntegrityJob(context.pool!,scope,lease.token,null),null);
  }
});

// Durable document tests replay a stored actual native result. No parser runs in the API process.
async function documentFixture() {
  const {documentKind,documentProfileDigest}=await import('../src/document-derivative.js');
  context.demo=await issueTestSession(demoUserId);
  const kase=await createCase();await approveAuthority(kase.id);
  const fixture=spawnSync('python3',['-c','import sys;from tools.synthetic_pdf import digital_pdf;sys.stdout.buffer.write(digital_pdf())'],{cwd:fileURLToPath(new URL('../../../',import.meta.url))});
  assert.equal(fixture.status,0,fixture.stderr.toString());const bytes=fixture.stdout;
  const uploaded=await request('POST',`/api/cases/${kase.id}/evidence/binary`,context.demo!,{payload:{filename:'fictional-native.pdf',contentBase64:bytes.toString('base64'),expectedSha256:createHash('sha256').update(bytes).digest('hex'),sourceTime:'2026-01-01T00:00:00Z',method:'Fictional native PDF attachment fixture',idempotencyKey:randomUUID()}});
  assert.equal(uploaded.statusCode,200,uploaded.body);const evidence=JSON.parse(uploaded.body);
  const app=await createApp({pool:context.pool!,storageRoot:context.storageRoot!,allowedOrigins,demoTenantId,demoUserId,sessionTtlSeconds:3600,documentLab:true});await app.ready();
  const url=`/api/cases/${kase.id}/integrity-jobs`;
  const payload={evidenceId:evidence.id,idempotencyKey:randomUUID(),kind:documentKind};
  const enqueue=()=>app.inject({method:'POST',url,headers:{cookie:context.demo!.cookie,origin:localOrigin,'x-csrf-token':context.demo!.csrf},payload});
  const queued=await enqueue();assert.equal(queued.statusCode,200,queued.body);const job=JSON.parse(queued.body);
  const scope={tenantId:demoTenantId,caseId:kase.id,jobId:job.id};
  const receipt=JSON.parse(await readFile(new URL('../../../research/runtime_artifacts/native-boundary-receipt.json',import.meta.url),'utf8'));
  const result={context:{...scope,evidenceId:evidence.id,sourceDigest:evidence.digest,authorityVersion:job.authorityVersion},profileDigest:documentProfileDigest,successful:true,raw:Buffer.from(JSON.stringify(receipt.runs[0].nativeDocument))};
  return {app,enqueue,scope,job,result,url:`${url}/${job.id}/document-derivative`,payload,bytes};
}

test('document jobs are opt-in, idempotent, excluded from text dispatch and atomically attach verified durable lineage',async()=>{
  const f=await documentFixture();try{
    assertError(await request('POST',`/api/cases/${f.scope.caseId}/integrity-jobs`,context.demo!,{payload:f.payload}),409);
    assert.equal(JSON.parse((await f.enqueue()).body).id,f.job.id);
    assert.equal((await dispatchIntegrityJobs(context.pool!,context.storageRoot!,f.scope)).selected,0);
    assert.equal(await runIntegrityJob(context.pool!,context.storageRoot!,f.scope),null);
    const lease=await claimIntegrityJob(context.pool!,f.scope);assert.ok(lease);
    await assert.rejects(finishIntegrityJob(context.pool!,f.scope,lease.token,null),/requires immutable derivative/);
    assert.equal((await finishDocumentJob(context.pool!,context.storageRoot!,f.scope,lease.token,f.result))?.status,'succeeded');
    assert.equal(await finishDocumentJob(context.pool!,context.storageRoot!,f.scope,lease.token,f.result),null);
    const response=await request('GET',f.url,context.demo!);assert.equal(response.statusCode,200,response.body);
    const body=JSON.parse(response.body);assert.equal(body.derivative.references[1].page,2);assert.equal(body.derivative.references[1].startByte,34);
    assert.equal(body.status,'unreviewed_derivative');assert.equal(body.sourceTime,'2026-01-01T00:00:00Z');assert.equal(body.derivative.coverage.completeExtractionVerified,false);
    assert.equal(response.headers['cache-control'],'no-store');assert.equal(body.attempt,1);
    const restarted=await createAppInstance();try{const r=await restarted.inject({method:'GET',url:f.url,headers:{cookie:context.demo!.cookie}});assert.deepEqual(JSON.parse(r.body),body);}finally{await restarted.close();}
    const e=(await context.pool!.query('SELECT status,object_path FROM evidence WHERE id=$1',[f.result.context.evidenceId])).rows[0];assert.equal(e.status,'Quarantined');assert.deepEqual(await readFile(resolve(context.storageRoot!,e.object_path)),f.bytes);
    assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM claims WHERE case_id=$1',[f.scope.caseId])).rows[0].n,0);
    assert.equal((await context.pool!.query("SELECT count(*)::int AS n FROM audit_events WHERE case_id=$1 AND action='document_derivative.read'",[f.scope.caseId])).rows[0].n,2);
    for(const sql of ['UPDATE document_derivatives SET output_digest=output_digest WHERE job_id=$1','DELETE FROM document_derivatives WHERE job_id=$1'])await assert.rejects(context.schemaAdminPool!.query(sql,[f.job.id]),/append.only|immutable/i);
  }finally{await f.app.close();}
});

test('document attachment rejects changed context, runtime profile, partial parser results and changed originals',async()=>{
  for(const mutation of ['context','profile','partial','original'] as const){
    const f=await documentFixture();try{
      const lease=await claimIntegrityJob(context.pool!,f.scope);assert.ok(lease);
      if(mutation==='context')f.result.context.evidenceId=randomUUID();
      if(mutation==='profile')f.result.profileDigest='f'.repeat(64);
      if(mutation==='partial')f.result.successful=false;
      if(mutation==='original'){const e=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[f.result.context.evidenceId])).rows[0];await writeFile(resolve(context.storageRoot!,e.object_path),'Fictional corrupted original');}
      const result=await finishDocumentJob(context.pool!,context.storageRoot!,f.scope,lease.token,f.result);
      assert.equal(result?.status,'failed');assert.equal(result?.failureCode,mutation==='original'?'original_unavailable':'document_result_invalid');
      assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM document_derivatives WHERE job_id=$1',[f.job.id])).rows[0].n,0);
    }finally{await f.app.close();}
  }
});

test('document completion fences expired/superseded tokens and serialises competing attachments',async()=>{
  const f=await documentFixture();try{
    const first=await claimIntegrityJob(context.pool!,f.scope);assert.ok(first);
    await context.schemaAdminPool!.query("UPDATE integrity_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[f.job.id]);
    assert.equal(await finishDocumentJob(context.pool!,context.storageRoot!,f.scope,first.token,f.result),null);
    const second=await claimIntegrityJob(context.pool!,f.scope);assert.ok(second);
    assert.equal(await finishDocumentJob(context.pool!,context.storageRoot!,f.scope,first.token,f.result),null);
    for(const field of ['tenantId','caseId','jobId'] as const)assert.equal(await finishDocumentJob(context.pool!,context.storageRoot!,{...f.scope,[field]:randomUUID()},second.token,f.result),null);
    const results=await Promise.all([1,2].map(()=>finishDocumentJob(context.pool!,context.storageRoot!,f.scope,second.token,f.result)));
    assert.equal(results.filter(r=>r?.status==='succeeded').length,1);assert.equal(results.filter(r=>r===null).length,1);
    assert.equal((await context.pool!.query('SELECT attempt FROM document_derivatives WHERE job_id=$1',[f.job.id])).rows[0].attempt,2);
  }finally{await f.app.close();}
});

test('cancelled jobs, revised authority and revoked requester cannot attach document results',async()=>{
  for(const mode of ['cancel','authority','membership'] as const){
    const f=await documentFixture();try{
      const lease=await claimIntegrityJob(context.pool!,f.scope);assert.ok(lease);
      if(mode==='cancel')assert.equal((await request('POST',`/api/cases/${f.scope.caseId}/integrity-jobs/${f.job.id}/cancel`,context.demo!,{payload:{}})).statusCode,200);
      if(mode==='authority')await approveAuthority(f.scope.caseId);
      if(mode==='membership')await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE case_id=$1 AND user_id=$2',[f.scope.caseId,demoUserId]);
      const result=await finishDocumentJob(context.pool!,context.storageRoot!,f.scope,lease.token,f.result);assert.ok(result===null||result.status==='cancelled');
      assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM document_derivatives WHERE job_id=$1',[f.job.id])).rows[0].n,0);
    }finally{await f.app.close();}
  }
});

test('document storage failure rolls back success and its event before retry',async()=>{
  const f=await documentFixture();try{
    const lease=await claimIntegrityJob(context.pool!,f.scope);assert.ok(lease);
    await context.schemaAdminPool!.query("CREATE FUNCTION deny_document_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional document storage failure'; END $$");
    await context.schemaAdminPool!.query('CREATE TRIGGER deny_document_test BEFORE INSERT ON document_derivatives FOR EACH ROW EXECUTE FUNCTION deny_document_test()');
    try{await assert.rejects(finishDocumentJob(context.pool!,context.storageRoot!,f.scope,lease.token,f.result),/fictional document storage failure/);}
    finally{await context.schemaAdminPool!.query('DROP TRIGGER deny_document_test ON document_derivatives');await context.schemaAdminPool!.query('DROP FUNCTION deny_document_test()');}
    assert.deepEqual((await context.pool!.query('SELECT status FROM integrity_job_events WHERE job_id=$1 ORDER BY id',[f.job.id])).rows.map(r=>r.status),['queued','running']);
    assert.equal((await finishDocumentJob(context.pool!,context.storageRoot!,f.scope,lease.token,f.result))?.status,'succeeded');
  }finally{await f.app.close();}
});

test('document retrieval denies foreign and withdrawn scope and detects original, raw and normalised output corruption',async()=>{
  const f=await documentFixture();try{
    const lease=await claimIntegrityJob(context.pool!,f.scope);assert.ok(lease);await finishDocumentJob(context.pool!,context.storageRoot!,f.scope,lease.token,f.result);
    const outsider=await createMember(demoTenantId,'investigator','Fictional document outsider');assertError(await request('GET',f.url,await issueTestSession(outsider)),404);
    const client=await createMember(demoTenantId,'client','Fictional document client');assertError(await request('GET',f.url,await issueTestSession(client)),403);
    const tenant=randomUUID();await context.schemaAdminPool!.query('INSERT INTO tenants (id,name) VALUES ($1,$2)',[tenant,'Fictional document foreign tenant']);
    const foreign=await createMember(tenant,'reviewer','Fictional foreign document reviewer');assertError(await request('GET',f.url,await issueTestSession(foreign,tenant)),404);
    const other=await createCase();assertError(await request('GET',f.url.replace(f.scope.caseId,other.id),context.demo!),404);
    await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE case_id=$1 AND user_id=$2',[f.scope.caseId,demoUserId]);assertError(await request('GET',f.url,context.demo!),404);
    await context.schemaAdminPool!.query('INSERT INTO case_memberships (tenant_id,case_id,user_id) VALUES ($1,$2,$3)',[demoTenantId,f.scope.caseId,demoUserId]);
    const e=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[f.result.context.evidenceId])).rows[0];const path=resolve(context.storageRoot!,e.object_path);
    await writeFile(path,'Fictional changed original');assertError(await request('GET',f.url,context.demo!),409);await writeFile(path,f.bytes);
    const stored=(await context.pool!.query('SELECT * FROM document_derivatives WHERE job_id=$1',[f.job.id])).rows[0];
    await context.schemaAdminPool!.query('ALTER TABLE document_derivatives DISABLE TRIGGER document_derivatives_append_only');
    try{
      await context.schemaAdminPool!.query('UPDATE document_derivatives SET raw_bytes=$2 WHERE job_id=$1',[f.job.id,Buffer.from('{}')]);assertError(await request('GET',f.url,context.demo!),409);
      const forged=JSON.parse(stored.output_bytes.toString());forged.references[1].page=1;const raw=JSON.stringify(forged);
      await context.schemaAdminPool!.query('UPDATE document_derivatives SET raw_bytes=$2,output_bytes=$3,output_digest=$4 WHERE job_id=$1',[f.job.id,stored.raw_bytes,Buffer.from(raw),digest(raw)]);assertError(await request('GET',f.url,context.demo!),409);
    }finally{await context.schemaAdminPool!.query('ALTER TABLE document_derivatives ENABLE TRIGGER document_derivatives_append_only');}
  }finally{await f.app.close();}
});

test('document queue enforces CSRF, internal membership, supported originals and immutable retry input',async()=>{
  const f=await documentFixture();try{
    const url=`/api/cases/${f.scope.caseId}/integrity-jobs`;
    const post=(payload:object,session=context.demo!,csrf=true)=>f.app.inject({method:'POST',url,headers:{cookie:session.cookie,origin:localOrigin,...(csrf?{'x-csrf-token':session.csrf}:{})},payload});
    assertError(await post(f.payload,context.demo!,false),403);
    assertError(await post({...f.payload,profileDigest:'f'.repeat(64)}),422);
    const client=await createMember(demoTenantId,'client','Fictional document queue client');assertError(await post(f.payload,await issueTestSession(client)),403);
    const outsider=await createMember(demoTenantId,'investigator','Fictional document queue outsider');assertError(await post(f.payload,await issueTestSession(outsider)),404);
    const text=JSON.parse((await uploadEvidence(f.scope.caseId)).body);
    assertError(await post({...f.payload,evidenceId:text.id}),409);
    assertError(await post({...f.payload,evidenceId:text.id,idempotencyKey:randomUUID()}),409);
    const large=Buffer.alloc(65537);const uploaded=await request('POST',`/api/cases/${f.scope.caseId}/evidence/binary`,context.demo!,{payload:{filename:'fictional-large.pdf',contentBase64:large.toString('base64'),expectedSha256:createHash('sha256').update(large).digest('hex'),sourceTime:'2026-01-01T00:00:00Z',method:'Fictional oversized document queue fixture',idempotencyKey:randomUUID()}});
    assert.equal(uploaded.statusCode,200,uploaded.body);assertError(await post({...f.payload,evidenceId:JSON.parse(uploaded.body).id,idempotencyKey:randomUUID()}),409);
  }finally{await f.app.close();}
});

test('real browser inspects durable unreviewed page references and removes stale display after original corruption',{skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:90000},async()=>{
  const f=await documentFixture();try{
    const lease=await claimIntegrityJob(context.pool!,f.scope);assert.ok(lease);assert.equal((await finishDocumentJob(context.pool!,context.storageRoot!,f.scope,lease.token,f.result))?.status,'succeeded');
    await withBrowserApp(async(b,origin)=>{
      const ui=await binaryBrowserControls(b,origin,f.scope.caseId),label='Inspect unreviewed pages '+f.job.id.slice(0,8);
      await eventually(async()=>(await ui.text()).includes(label),'document job listing');await ui.click(label);
      await eventually(async()=>(await ui.text()).includes('Unreviewed document passages'),'document inspection');
      const text=await ui.text();assert.ok(text.includes('Page 2 · #/texts/1 · extracted UTF-8 bytes [34, 67)'));assert.ok(text.includes('Completeness still needs human review.'));assert.ok(text.includes('origin BOTTOMLEFT'));
      assert.equal(await b.evaluate("document.querySelectorAll('section[aria-label=\"Verified unreviewed document derivative\"] li').length"),2);
      await b.evaluate("(()=>{const s=document.querySelector('section[aria-label=\"Extracted region map\"] select');s.value='2';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
      await ui.click('Highlight page 2 passage 1');
      await eventually(async()=>(await ui.text()).includes('Selected #/texts/1'),'second-page region selection');
      assert.equal(await b.evaluate("document.querySelector('svg[aria-label=\"Extraction outline for page 2\"] rect').getAttribute('fill')"),'#b45309');
      assert.ok((await ui.text()).includes('It is not an original PDF image'));
      const previous=await b.evaluate<number>('performance.timeOrigin');await b.send('Page.reload');await eventually(async()=>await b.evaluate<number>('performance.timeOrigin')!==previous,'document inspection reload');
      await eventually(async()=>(await ui.text()).includes(label),'durable document restored');await ui.click(label);await eventually(async()=>(await ui.text()).includes('Unreviewed document passages'),'document reinspection');
      const e=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[f.result.context.evidenceId])).rows[0];await writeFile(resolve(context.storageRoot!,e.object_path),'Fictional corrupt original');
      await ui.click(label);await eventually(async()=>(await ui.text()).includes('document derivative integrity verification failed'),'corrupt document denied');
      assert.equal(await b.evaluate("document.querySelector('section[aria-label=\"Verified unreviewed document derivative\"]')===null"),true);
    });
  }finally{await f.app.close();}
});


test('renewal waits for the case before locking the job, avoiding cancellation lock inversion',async()=>{
  const {scope,lease}=await renewalFixture();
  const blocker=await context.pool!.connect();let renewal:ReturnType<typeof renewIntegrityJob>|undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[scope.tenantId,scope.caseId]);
    renewal=renewIntegrityJob(context.pool!,scope,lease.token);
    // Observe the real database wait rather than relying on process scheduling.
    await eventually(async()=>Number((await context.pool!.query(
      "SELECT count(*) AS n FROM pg_stat_activity WHERE usename=current_user AND datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM cases%'"
    )).rows[0].n)>0,'renewal case lock wait',1500);
    // Cancellation already owns the case and must be able to acquire its job.
    await blocker.query('SELECT id FROM integrity_jobs WHERE id=$1 FOR UPDATE NOWAIT',[scope.jobId]);
  } finally {
    await blocker.query('ROLLBACK');blocker.release();
    if(renewal)assert.ok(await renewal);
  }
});


async function rasterFixture(){
  // Each fixture owns a fresh HTTP rate-limit window; durable database state is retained.
  await context.app!.close();context.app=await createAppInstance();
  const f=await documentFixture();
  const payload={...f.payload,idempotencyKey:randomUUID(),kind:'pdf_raster_lab_v1'};
  const queued=await f.app.inject({method:'POST',url:`/api/cases/${f.scope.caseId}/integrity-jobs`,headers:{cookie:context.demo!.cookie,origin:localOrigin,'x-csrf-token':context.demo!.csrf},payload});
  assert.equal(queued.statusCode,200,queued.body);const job=JSON.parse(queued.body),scope={...f.scope,jobId:job.id};
  const fixture=JSON.parse(await readFile(new URL('../../../research/runtime_artifacts/render-page-fixture.json',import.meta.url),'utf8'));
  const png=Buffer.from(fixture.pngBase64,'base64');assert.equal(createHash('sha256').update(png).digest('hex'),fixture.sha256);
  const {rasterProfileDigest}=await import('../src/raster-derivative.js');
  const result={context:{...f.result.context,jobId:job.id},profileDigest:rasterProfileDigest,originalSha256:f.result.context.sourceDigest,
    pages:[1,2].map(page=>({page,width:612,height:792,pngSha256:fixture.sha256,pngBytes:png.length,pngBase64:fixture.pngBase64}))};
  return {...f,extraction:{job:f.job,scope:f.scope,result:f.result},job,scope,payload,result,png,url:`/api/cases/${scope.caseId}/integrity-jobs/${job.id}/raster-derivative`,pageUrl:`/api/cases/${scope.caseId}/integrity-jobs/${job.id}/raster-pages/2`};
}
test('raster jobs persist atomically, preserve quarantine and reverify PNG delivery after restart',async()=>{
  const f=await rasterFixture();try{
    assertError(await request('POST',`/api/cases/${f.scope.caseId}/integrity-jobs`,context.demo!,{payload:f.payload}),409);
    assert.equal((await dispatchIntegrityJobs(context.pool!,context.storageRoot!,f.scope)).selected,0);
    assert.equal(await runIntegrityJob(context.pool!,context.storageRoot!,f.scope),null);
    const lease=await claimIntegrityJob(context.pool!,f.scope);assert.ok(lease);
    await assert.rejects(finishIntegrityJob(context.pool!,f.scope,lease.token,null),/requires immutable derivative/);
    assert.equal((await finishRasterJob(context.pool!,context.storageRoot!,f.scope,lease.token,f.result))?.status,'succeeded');
    assert.equal(await finishRasterJob(context.pool!,context.storageRoot!,f.scope,lease.token,f.result),null);
    const manifest=await request('GET',f.url,context.demo!);assert.equal(manifest.statusCode,200,manifest.body);
    assert.equal(manifest.json().manifest.pages[1].page,2);assert.equal(manifest.json().manifest.reviewState,'unreviewed');
    const image=await request('GET',f.pageUrl,context.demo!);assert.equal(image.statusCode,200,image.body);assert.deepEqual(image.rawPayload,f.png);
    assert.equal(image.headers['content-type'],'image/png');assert.equal(image.headers['cache-control'],'no-store');assert.equal(image.headers['x-content-type-options'],'nosniff');
    const app=await createAppInstance();try{const r=await app.inject({method:'GET',url:f.pageUrl,headers:{cookie:context.demo!.cookie}});assert.deepEqual(r.rawPayload,f.png);}finally{await app.close();}
    const e=(await context.pool!.query('SELECT status FROM evidence WHERE id=$1',[f.result.context.evidenceId])).rows[0];assert.equal(e.status,'Quarantined');
    for(const sql of ['UPDATE raster_derivatives SET output_digest=output_digest WHERE job_id=$1','DELETE FROM raster_derivatives WHERE job_id=$1'])await assert.rejects(context.schemaAdminPool!.query(sql,[f.job.id]),/append.only|immutable/i);
  }finally{await f.app.close();}
});
test('raster attachment rejects stale workers, changed authority and invalid PNG without storing output',async()=>{
  for(const mode of ['cancel','authority','png','context'] as const){
    const f=await rasterFixture();try{
      const lease=await claimIntegrityJob(context.pool!,f.scope);assert.ok(lease);
      if(mode==='cancel')assert.equal((await request('POST',f.url.replace('/raster-derivative','/cancel'),context.demo!,{payload:{}})).statusCode,200);
      if(mode==='authority')await approveAuthority(f.scope.caseId);
      if(mode==='png')f.result.pages[0]!.pngBase64='invalid';
      if(mode==='context')f.result.context.caseId=randomUUID();
      const result=await finishRasterJob(context.pool!,context.storageRoot!,f.scope,lease.token,f.result);assert.notEqual(result?.status,'succeeded');
      assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM raster_derivatives WHERE job_id=$1',[f.job.id])).rows[0].n,0);
    }finally{await f.app.close();}
  }
});
test('raster delivery denies wrong cases and fails closed after original corruption',async()=>{
  const f=await rasterFixture();try{
    const lease=await claimIntegrityJob(context.pool!,f.scope);assert.ok(lease);
    await finishRasterJob(context.pool!,context.storageRoot!,f.scope,lease.token,f.result);
    const other=await createCase();
    assertError(await request('GET',f.pageUrl.replace(f.scope.caseId,other.id),context.demo!),404);
    assertError(await request('GET',f.pageUrl.replace(/2$/,'3'),context.demo!),422);
    const e=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[f.result.context.evidenceId])).rows[0];
    await writeFile(resolve(context.storageRoot!,e.object_path),'Fictional altered original');
    assertError(await request('GET',f.pageUrl,context.demo!),409);assertError(await request('GET',f.url,context.demo!),409);
  }finally{await f.app.close();}
});
test('real browser decodes verified raster page bytes and cannot reload them after corruption',{skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:90000},async()=>{
  const f=await rasterFixture();try{
    const lease=await claimIntegrityJob(context.pool!,f.scope);assert.ok(lease);await finishRasterJob(context.pool!,context.storageRoot!,f.scope,lease.token,f.result);
    await withBrowserApp(async(b,origin)=>{
      const ui=await binaryBrowserControls(b,origin,f.scope.caseId),label='Inspect page images '+f.job.id.slice(0,8);
      await eventually(async()=>(await ui.text()).includes(label),'raster job listing');await ui.click(label);
      await eventually(async()=>await b.evaluate(`Boolean(document.querySelector('img[alt="Unreviewed rendered page 1"]')?.naturalWidth)`),'verified page one');
      await b.evaluate(`(()=>{const s=document.querySelector('section[aria-label="Verified unreviewed raster pages"] select');s.value="2";s.dispatchEvent(new Event("change",{bubbles:true}));})()`);
      await eventually(async()=>await b.evaluate(`Boolean(document.querySelector('img[alt="Unreviewed rendered page 2"]')?.naturalWidth)`),'verified page two');
      assert.ok((await ui.text()).includes('Forms and annotations are omitted'));
      const previous=await b.evaluate<number>('performance.timeOrigin');await b.send('Page.reload');await eventually(async()=>await b.evaluate<number>('performance.timeOrigin')!==previous,'raster reload');
      await eventually(async()=>(await ui.text()).includes(label),'raster history restored');await ui.click(label);
      await eventually(async()=>await b.evaluate(`Boolean(document.querySelector('img[alt="Unreviewed rendered page 1"]')?.naturalWidth)`),'raster reinspection');
      const e=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[f.result.context.evidenceId])).rows[0];
      await writeFile(resolve(context.storageRoot!,e.object_path),'Fictional changed original');
      await ui.click('Reload verified page');await eventually(async()=>(await ui.text()).includes('Page unavailable or integrity verification failed'),'corrupt raster denied');
      assert.equal(await b.evaluate(`document.querySelectorAll('section[aria-label="Verified unreviewed raster pages"] img').length`),0);
    });
  }finally{await f.app.close();}
});

test('raster storage failure rolls back success and permits retry',async()=>{
  const f=await rasterFixture();try{
    const lease=await claimIntegrityJob(context.pool!,f.scope);assert.ok(lease);
    await context.schemaAdminPool!.query("CREATE FUNCTION deny_raster_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional raster failure'; END $$");
    await context.schemaAdminPool!.query('CREATE TRIGGER deny_raster_test BEFORE INSERT ON raster_derivatives FOR EACH ROW EXECUTE FUNCTION deny_raster_test()');
    try{await assert.rejects(finishRasterJob(context.pool!,context.storageRoot!,f.scope,lease.token,f.result),/fictional raster failure/);}
    finally{await context.schemaAdminPool!.query('DROP TRIGGER deny_raster_test ON raster_derivatives');await context.schemaAdminPool!.query('DROP FUNCTION deny_raster_test()');}
    assert.deepEqual((await context.pool!.query('SELECT status FROM integrity_job_events WHERE job_id=$1 ORDER BY id',[f.job.id])).rows.map(r=>r.status),['queued','running']);
    assert.equal((await finishRasterJob(context.pool!,context.storageRoot!,f.scope,lease.token,f.result))?.status,'succeeded');
  }finally{await f.app.close();}
});
test('raster reads deny clients, foreign tenants and revoked members and detect stored tampering',async()=>{
  const f=await rasterFixture();try{
    const lease=await claimIntegrityJob(context.pool!,f.scope);assert.ok(lease);await finishRasterJob(context.pool!,context.storageRoot!,f.scope,lease.token,f.result);
    const outsider=await createMember(demoTenantId,'investigator','Fictional raster outsider');assertError(await request('GET',f.pageUrl,await issueTestSession(outsider)),404);
    const client=await createMember(demoTenantId,'client','Fictional raster client');assertError(await request('GET',f.pageUrl,await issueTestSession(client)),403);
    const tenant=randomUUID();await context.schemaAdminPool!.query('INSERT INTO tenants (id,name) VALUES ($1,$2)',[tenant,'Fictional raster foreign tenant']);
    const foreign=await createMember(tenant,'reviewer','Fictional foreign raster reviewer');assertError(await request('GET',f.pageUrl,await issueTestSession(foreign,tenant)),404);
    await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE case_id=$1 AND user_id=$2',[f.scope.caseId,demoUserId]);assertError(await request('GET',f.pageUrl,context.demo!),404);
    await context.schemaAdminPool!.query('INSERT INTO case_memberships (tenant_id,case_id,user_id) VALUES ($1,$2,$3)',[demoTenantId,f.scope.caseId,demoUserId]);
    const stored=(await context.pool!.query('SELECT * FROM raster_derivatives WHERE job_id=$1',[f.job.id])).rows[0];
    await context.schemaAdminPool!.query('ALTER TABLE raster_derivatives DISABLE TRIGGER raster_derivatives_append_only');
    try{
      await context.schemaAdminPool!.query('UPDATE raster_derivatives SET raw_bytes=$2 WHERE job_id=$1',[f.job.id,Buffer.from('{}')]);assertError(await request('GET',f.pageUrl,context.demo!),409);
      await context.schemaAdminPool!.query('UPDATE raster_derivatives SET raw_bytes=$2,output_bytes=$3 WHERE job_id=$1',[f.job.id,stored.raw_bytes,Buffer.from('{}')]);assertError(await request('GET',f.url,context.demo!),409);
    }finally{await context.schemaAdminPool!.query('ALTER TABLE raster_derivatives ENABLE TRIGGER raster_derivatives_append_only');}
  }finally{await f.app.close();}
});


test('real browser compares verified extraction regions with raster page two and clears corrupt comparison',{skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:90000},async()=>{
  const f=await rasterFixture();try{
    const extractionLease=await claimIntegrityJob(context.pool!,f.extraction.scope);assert.ok(extractionLease);
    await finishDocumentJob(context.pool!,context.storageRoot!,f.extraction.scope,extractionLease.token,f.extraction.result);
    const lease=await claimIntegrityJob(context.pool!,f.scope);assert.ok(lease);await finishRasterJob(context.pool!,context.storageRoot!,f.scope,lease.token,f.result);
    await withBrowserApp(async(b,origin)=>{
      const ui=await binaryBrowserControls(b,origin,f.scope.caseId),label='Compare image '+f.job.id.slice(0,8)+' with passages '+f.extraction.job.id.slice(0,8);
      await eventually(async()=>(await ui.text()).includes(label),'matching derivative comparison');await ui.click(label);
      await eventually(async()=>await b.evaluate(`Boolean(document.querySelector('img[alt="Unreviewed rendered page 1"]')?.naturalWidth)`),'comparison page one');
      await b.evaluate(`(()=>{const s=document.querySelector('section[aria-label="Verified unreviewed raster pages"] select');s.value='2';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await eventually(async()=>await b.evaluate(`Boolean(document.querySelector('img[alt="Unreviewed rendered page 2"]')?.naturalWidth)`),'comparison page two');await ui.click('Compare page 2 passage 1');
      assert.equal(await b.evaluate(`document.querySelector('svg[aria-label="Passage overlay for page 2"] rect').getAttribute('fill')`),'#b45309');
      assert.ok((await ui.text()).includes('Selected #/texts/1 · extracted UTF-8 bytes [34, 67)'));
      const sizes=await b.evaluate<number[]>(`(()=>{const i=document.querySelector('img[alt="Unreviewed rendered page 2"]').getBoundingClientRect(),s=document.querySelector('svg[aria-label="Passage overlay for page 2"]').getBoundingClientRect();return [i.width,i.height,s.width,s.height];})()`);assert.equal(sizes[0],sizes[2]);assert.equal(sizes[1],sizes[3]);
      const e=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[f.result.context.evidenceId])).rows[0];await writeFile(resolve(context.storageRoot!,e.object_path),'Fictional changed comparison source');
      await ui.click(label);await eventually(async()=>(await ui.text()).includes('integrity verification failed'),'comparison refuses changed source');
      assert.equal(await b.evaluate(`document.querySelector('section[aria-label="Verified unreviewed raster pages"]')===null`),true);
    });
  }finally{await f.app.close();}
});

async function citationFixture(){
 await context.app!.close();context.app=await createAppInstance();const f=await documentFixture();
 const lease=await claimIntegrityJob(context.pool!,f.scope);assert.ok(lease);await finishDocumentJob(context.pool!,context.storageRoot!,f.scope,lease.token,f.result);
 const receipt=(await request('GET',f.url,context.demo!)).json();
 return {...f,citationUrl:f.url.replace('/document-derivative','/document-citations/'+randomUUID()),selection:{derivativeDigest:receipt.derivativeDigest,itemRef:'#/texts/1',startByte:34,endByte:67,quote:'FICTIONAL INVEOS repeated passage'}};
}
test('document citation candidates persist exact occurrence with concurrent retry and remain outside findings',async()=>{
 const f=await citationFixture();try{
  const results=await Promise.all([1,2].map(()=>request('POST',f.citationUrl,context.demo!,{payload:f.selection})));for(const r of results)assert.equal(r.statusCode,200,r.body);assert.deepEqual(results[0]!.json(),results[1]!.json());
  const saved=results[0]!.json();assert.equal(saved.citation.page,2);assert.equal(saved.citation.status,'unreviewed_candidate');assert.equal(saved.citation.offsetBasis,'extracted_utf8_not_original_pdf');
  await context.app!.close();context.app=await createAppInstance();assert.deepEqual((await request('GET',f.citationUrl,context.demo!)).json(),saved);
  assertError(await request('POST',f.citationUrl,context.demo!,{payload:{...f.selection,startByte:35,quote:f.selection.quote.slice(1)}}),409);
  const count=await context.pool!.query('SELECT count(*)::int AS n FROM findings WHERE case_id=$1',[f.scope.caseId]);assert.equal(count.rows[0].n,0);
  for(const sql of ['UPDATE document_citation_candidates SET citation_digest=citation_digest WHERE job_id=$1','DELETE FROM document_citation_candidates WHERE job_id=$1'])await assert.rejects(context.schemaAdminPool!.query(sql,[f.job.id]),/immutable|append.only/i);
 }finally{await f.app.close();}
});
test('document citation candidates enforce CSRF, case membership, client denial and current authority',async()=>{
 const f=await citationFixture();try{
  assertError(await request('POST',f.citationUrl,context.demo!,{payload:f.selection,csrfHeader:false}),403);
  const client=await createMember(demoTenantId,'client','Fictional citation client');assertError(await request('POST',f.citationUrl,await issueTestSession(client),{payload:f.selection}),403);
  const outsider=await createMember(demoTenantId,'investigator','Fictional citation outsider');assertError(await request('POST',f.citationUrl,await issueTestSession(outsider),{payload:f.selection}),404);
  assert.equal((await request('POST',f.citationUrl,context.demo!,{payload:f.selection})).statusCode,200);
  await approveAuthority(f.scope.caseId);assertError(await request('POST',f.citationUrl,context.demo!,{payload:f.selection}),409);
  assert.equal((await request('GET',f.citationUrl,context.demo!)).statusCode,200); // Historical candidate, never current approval.
  await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE case_id=$1 AND user_id=$2',[f.scope.caseId,demoUserId]);assertError(await request('GET',f.citationUrl,context.demo!),404);
 }finally{await f.app.close();}
});
test('document citation candidates reject altered selection and original on save and read',async()=>{
 const f=await citationFixture();try{
  for(const patch of [{itemRef:'#/texts/0'},{quote:'invented'},{derivativeDigest:'f'.repeat(64)}])assertError(await request('POST',f.citationUrl,context.demo!,{payload:{...f.selection,...patch}}),409);
  assert.equal((await request('POST',f.citationUrl,context.demo!,{payload:f.selection})).statusCode,200);
  const source=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[f.result.context.evidenceId])).rows[0];await writeFile(resolve(context.storageRoot!,source.object_path),'Fictional corrupt cited original');
  assertError(await request('GET',f.citationUrl,context.demo!),409);assertError(await request('POST',f.citationUrl,context.demo!,{payload:f.selection}),409);
 }finally{await f.app.close();}
});

test('citation audit failure rolls back candidate and stored tampering fails closed',async()=>{
 const f=await citationFixture();try{
  await context.schemaAdminPool!.query("CREATE FUNCTION deny_citation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='document_citation.saved' THEN RAISE EXCEPTION 'fictional citation audit failure'; END IF; RETURN NEW; END $$");
  await context.schemaAdminPool!.query('CREATE TRIGGER deny_citation_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_citation_audit()');
  try{assertError(await request('POST',f.citationUrl,context.demo!,{payload:f.selection}),500);assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM document_citation_candidates WHERE job_id=$1',[f.job.id])).rows[0].n,0);}
  finally{await context.schemaAdminPool!.query('DROP TRIGGER deny_citation_audit ON audit_events');await context.schemaAdminPool!.query('DROP FUNCTION deny_citation_audit()');}
  assert.equal((await request('POST',f.citationUrl,context.demo!,{payload:f.selection})).statusCode,200);
  await context.schemaAdminPool!.query('ALTER TABLE document_citation_candidates DISABLE TRIGGER document_citation_candidates_append_only');
  try{await context.schemaAdminPool!.query('UPDATE document_citation_candidates SET selection=$2 WHERE job_id=$1',[f.job.id,{...f.selection,quote:'invented'}]);assertError(await request('GET',f.citationUrl,context.demo!),409);assertError(await request('POST',f.citationUrl,context.demo!,{payload:f.selection}),409);}
  finally{await context.schemaAdminPool!.query('ALTER TABLE document_citation_candidates ENABLE TRIGGER document_citation_candidates_append_only');}
 }finally{await f.app.close();}
});

test('document candidate listing is bounded, scoped, verified and recoverable after restart',async()=>{
 const f=await citationFixture();try{
  const base=f.citationUrl.slice(0,f.citationUrl.lastIndexOf('/'));
  assert.deepEqual((await request('GET',base,context.demo!)).json(),{items:[],nextAfter:null});
  const saved=(await request('POST',f.citationUrl,context.demo!,{payload:f.selection})).json();
  // Populate an additional page using already-validated immutable bytes, without HTTP rate-limit noise.
  await context.schemaAdminPool!.query(`INSERT INTO document_citation_candidates(tenant_id,case_id,job_id,id,created_by,selection,citation_bytes,citation_digest) SELECT tenant_id,case_id,job_id,gen_random_uuid(),created_by,selection,citation_bytes,citation_digest FROM document_citation_candidates CROSS JOIN generate_series(1,50) WHERE id=$1`,[saved.id]);
  await context.app!.close();context.app=await createAppInstance();
  const first=await request('GET',base,context.demo!);assert.equal(first.statusCode,200,first.body);assert.equal(first.headers['cache-control'],'no-store');const page=first.json();assert.equal(page.items.length,50);assert.equal(page.nextAfter,page.items.at(-1).id);
  const tail=(await request('GET',base+'?after='+page.nextAfter,context.demo!)).json();assert.equal(tail.items.length,1);assert.equal(tail.nextAfter,null);assert.equal(new Set([...page.items,...tail.items].map(r=>r.id)).size,51);
  assertError(await request('GET',base+'?after=invalid',context.demo!),422);
  const outsider=await createMember(demoTenantId,'investigator','Fictional citation outsider');assertError(await request('GET',base,await issueTestSession(outsider)),404);
  const client=await createMember(demoTenantId,'client','Fictional citation client');assertError(await request('GET',base,await issueTestSession(client)),403);
  const evidence=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[f.job.evidenceId])).rows[0];await writeFile(resolve(context.storageRoot!,evidence.object_path),'Fictional changed list source');assertError(await request('GET',base,context.demo!),409);
 }finally{await f.app.close();}
});

test('real browser saves page-two candidate, recovers lost response after reload and clears corrupted list',{skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:90000},async()=>{
 const f=await citationFixture();try{
  await withBrowserApp(async(b,origin)=>{
   const ui=await binaryBrowserControls(b,origin,f.scope.caseId),label='Inspect unreviewed pages '+f.job.id.slice(0,8);
   await eventually(async()=>(await ui.text()).includes(label),'document inspection');await ui.click(label);
   await eventually(async()=>(await ui.text()).includes('No saved candidates for this extraction.'),'empty candidate list');
   await b.evaluate(`(()=>{const s=document.querySelector('section[aria-label="Document citation candidates"] select');s.value='#/texts/1';s.dispatchEvent(new Event('change',{bubbles:true}));const original=window.fetch;window.fetch=async(...args)=>{const r=await original(...args);if(String(args[0]).includes('/document-citations/')&&args[1]?.method==='POST'&&r.ok){window.fetch=original;throw new Error('Fictional lost citation response');}return r;};})()`);
   await ui.click('Save passage candidate');await eventually(async()=>(await ui.text()).includes('Recover pending citation'),'pending candidate after committed response loss');
   const stored=(await context.pool!.query('SELECT id,selection FROM document_citation_candidates WHERE job_id=$1',[f.job.id])).rows;assert.equal(stored.length,1);assert.equal(stored[0].selection.itemRef,'#/texts/1');
   await b.send('Page.reload');await eventually(async()=>(await ui.text()).includes(label),'reloaded job history');await ui.click(label);
   await eventually(async()=>(await ui.text()).includes('Recover pending citation'),'reload retry identity');await ui.click('Recover pending citation');
   await eventually(async()=>(await ui.text()).includes('saved as unreviewed. No finding was approved.'),'recovered verified receipt');
   assert.ok((await ui.text()).includes('Unreviewed candidate · page 2'));assert.ok((await ui.text()).includes(stored[0].id));
   assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM document_citation_candidates WHERE job_id=$1',[f.job.id])).rows[0].n,1);
   assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM findings WHERE case_id=$1',[f.scope.caseId])).rows[0].n,0);
   const evidence=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[f.job.evidenceId])).rows[0];await writeFile(resolve(context.storageRoot!,evidence.object_path),'Fictional corrupt citation source');
   await ui.click('Refresh citation candidates');await eventually(async()=>(await ui.text()).includes('integrity verification failed'),'corrupt list rejected');
   assert.equal(await b.evaluate(`document.querySelector('section[aria-label="Document citation candidates"] ol').children.length`),0);
  });
 }finally{await f.app.close();}
});

async function citationReviewFixture(){
 const f=await citationFixture(),author=await createMember(demoTenantId,'investigator','Fictional document citation author');
 await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,f.scope.caseId,author]);const authorSession=await issueTestSession(author);
 const response=await request('POST',f.citationUrl,authorSession,{payload:f.selection});assert.equal(response.statusCode,200,response.body);const candidate=response.json();
 return {...f,author,authorSession,candidate,reviewUrl:f.citationUrl+'/reviews',reviewInput:{id:randomUUID(),previousReviewId:null as string|null,citationDigest:candidate.citationDigest,decision:'accepted',reason:'Fictional exact page-two passage compared with supplied original; source truth not assessed.',originalCompared:true}};
}
test('citation correspondence reviews retain independent decisions, replacements, retries and immutable history',async()=>{
 const f=await citationReviewFixture();try{
  const results=await Promise.all([1,2].map(()=>request('POST',f.reviewUrl,context.demo!,{payload:f.reviewInput})));for(const r of results)assert.equal(r.statusCode,200,r.body);assert.deepEqual(results[0]!.json(),results[1]!.json());
  const first=results[0]!.json();assert.equal(first.reviews[0].scope,'extraction_correspondence_not_finding');
  const replacement={...f.reviewInput,id:randomUUID(),previousReviewId:f.reviewInput.id,decision:'rejected',reason:'Fictional later comparison found correspondence uncertain.',originalCompared:false};
  const rejected=await request('POST',f.reviewUrl,context.demo!,{payload:replacement});assert.equal(rejected.statusCode,200,rejected.body);const h=rejected.json();assert.equal(h.reviews.length,2);assert.equal(h.reviews[1].previousReviewDigest,h.reviews[0].digest);assert.equal(h.currentReviewId,replacement.id);
  assertError(await request('POST',f.reviewUrl,context.demo!,{payload:{...f.reviewInput,id:randomUUID()}}),409);
  assertError(await request('POST',f.reviewUrl,context.demo!,{payload:{...f.reviewInput,reason:'changed'}}),409);
  assert.deepEqual((await request('POST',f.reviewUrl,context.demo!,{payload:f.reviewInput})).json(),h);
  await context.app!.close();context.app=await createAppInstance();assert.deepEqual((await request('GET',f.reviewUrl,context.demo!)).json(),h);
  const race=await Promise.all(['accepted','rejected'].map(decision=>request('POST',f.reviewUrl,context.demo!,{payload:{...f.reviewInput,id:randomUUID(),previousReviewId:replacement.id,decision}})));assert.deepEqual(race.map(r=>r.statusCode).sort(),[200,409]);assert.equal((await request('GET',f.reviewUrl,context.demo!)).json().reviews.length,3);
  for(const sql of ['UPDATE document_citation_reviews SET review_digest=review_digest WHERE citation_id=$1','DELETE FROM document_citation_reviews WHERE citation_id=$1'])await assert.rejects(context.schemaAdminPool!.query(sql,[f.candidate.id]),/immutable|append.only/i);
  assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM findings WHERE case_id=$1',[f.scope.caseId])).rows[0].n,0);
 }finally{await f.app.close();}
});
test('citation review denies self-review, missing comparison, roles, scope and stale authority',async()=>{
 const f=await citationReviewFixture();try{
  assertError(await request('POST',f.reviewUrl,context.demo!,{payload:f.reviewInput,csrfHeader:false}),403);
  assertError(await request('POST',f.reviewUrl,f.authorSession,{payload:f.reviewInput}),403);
  for(const patch of [{originalCompared:false},{reason:' '},{citationDigest:'0'.repeat(64)}])assertError(await request('POST',f.reviewUrl,context.demo!,{payload:{...f.reviewInput,...patch}}),422);
  const ownUrl=f.citationUrl.slice(0,f.citationUrl.lastIndexOf('/'))+'/'+randomUUID();const own=(await request('POST',ownUrl,context.demo!,{payload:f.selection})).json();assertError(await request('POST',ownUrl+'/reviews',context.demo!,{payload:{...f.reviewInput,citationDigest:own.citationDigest}}),403);
  const outsider=await createMember(demoTenantId,'reviewer','Fictional unrelated reviewer');assertError(await request('GET',f.reviewUrl,await issueTestSession(outsider)),404);assertError(await request('POST',f.reviewUrl,await issueTestSession(outsider),{payload:f.reviewInput}),404);
  const client=await createMember(demoTenantId,'client','Fictional denied citation recipient');assertError(await request('GET',f.reviewUrl,await issueTestSession(client)),403);
  assert.equal((await request('POST',f.reviewUrl,context.demo!,{payload:f.reviewInput})).statusCode,200);
  await approveAuthority(f.scope.caseId);assertError(await request('POST',f.reviewUrl,context.demo!,{payload:{...f.reviewInput,id:randomUUID(),previousReviewId:f.reviewInput.id}}),409);
  assert.equal((await request('POST',f.reviewUrl,context.demo!,{payload:f.reviewInput})).statusCode,200); // historical retry only
  await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE case_id=$1 AND user_id=$2',[f.scope.caseId,demoUserId]);assertError(await request('GET',f.reviewUrl,context.demo!),404);
 }finally{await f.app.close();}
});
test('citation review audit rollback and tampered review or original fail closed',async()=>{
 const f=await citationReviewFixture();try{
  await context.schemaAdminPool!.query("CREATE FUNCTION deny_document_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='document_citation.reviewed' THEN RAISE EXCEPTION 'fictional review audit failure'; END IF; RETURN NEW; END $$");
  await context.schemaAdminPool!.query('CREATE TRIGGER deny_document_review_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_document_review_audit()');
  try{assertError(await request('POST',f.reviewUrl,context.demo!,{payload:f.reviewInput}),500);assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM document_citation_reviews WHERE citation_id=$1',[f.candidate.id])).rows[0].n,0);}
  finally{await context.schemaAdminPool!.query('DROP TRIGGER deny_document_review_audit ON audit_events');await context.schemaAdminPool!.query('DROP FUNCTION deny_document_review_audit()');}
  assert.equal((await request('POST',f.reviewUrl,context.demo!,{payload:f.reviewInput})).statusCode,200);
  const old=(await context.pool!.query('SELECT review_bytes FROM document_citation_reviews WHERE citation_id=$1',[f.candidate.id])).rows[0].review_bytes;
  await context.schemaAdminPool!.query('ALTER TABLE document_citation_reviews DISABLE TRIGGER document_citation_reviews_append_only');
  try{await context.schemaAdminPool!.query('UPDATE document_citation_reviews SET review_bytes=$2 WHERE citation_id=$1',[f.candidate.id,Buffer.from('{}')]);assertError(await request('GET',f.reviewUrl,context.demo!),409);assertError(await request('POST',f.reviewUrl,context.demo!,{payload:f.reviewInput}),409);await context.schemaAdminPool!.query('UPDATE document_citation_reviews SET review_bytes=$2 WHERE citation_id=$1',[f.candidate.id,old]);}
  finally{await context.schemaAdminPool!.query('ALTER TABLE document_citation_reviews ENABLE TRIGGER document_citation_reviews_append_only');}
  const evidence=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[f.job.evidenceId])).rows[0];await writeFile(resolve(context.storageRoot!,evidence.object_path),'Fictional corrupted reviewed source');assertError(await request('GET',f.reviewUrl,context.demo!),409);assertError(await request('POST',f.reviewUrl,context.demo!,{payload:f.reviewInput}),409);
 }finally{await f.app.close();}
});
test('real browser independently accepts citation correspondence, recovers a lost response and retains rejection history',{skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:90000},async()=>{
 const f=await citationReviewFixture();try{await withBrowserApp(async(b,origin)=>{
  const ui=await binaryBrowserControls(b,origin,f.scope.caseId),inspect='Inspect unreviewed pages '+f.job.id.slice(0,8),review='Review candidate '+f.candidate.id.slice(0,8);
  await eventually(async()=>(await ui.text()).includes(inspect),'review document');await ui.click(inspect);await eventually(async()=>(await ui.text()).includes(review),'candidate review button');await ui.click(review);
  await eventually(async()=>(await ui.text()).includes('No human correspondence decision recorded.'),'empty review history');
  await b.evaluate(`(()=>{const p=document.querySelector('section[aria-label="Citation correspondence review"]'),s=p.querySelector('select'),t=p.querySelector('textarea');s.value='accepted';s.dispatchEvent(new Event('change',{bubbles:true}));Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Fictional page two compared; no source truth conclusion.');t.dispatchEvent(new Event('input',{bubbles:true}));p.querySelector('input[type=checkbox]').click();const original=window.fetch;window.fetch=async(...args)=>{const r=await original(...args);if(String(args[0]).endsWith('/reviews')&&args[1]?.method==='POST'&&r.ok){window.fetch=original;throw new Error('Fictional lost review response');}return r;};})()`);
  await ui.click('Record correspondence decision');await eventually(async()=>await b.evaluate<boolean>(`Boolean([...document.querySelectorAll('button')].find(b=>b.textContent==='Recover pending review'&&!b.disabled))`)&&(await ui.text()).includes('Fictional lost review response'),'unconfirmed review settled');await ui.click('Recover pending review');await eventually(async()=>(await ui.text()).includes('Current correspondence decision: accepted · revision 1'),'accepted review recovered');
  assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM document_citation_reviews WHERE citation_id=$1',[f.candidate.id])).rows[0].n,1);
  await b.evaluate(`(()=>{const p=document.querySelector('section[aria-label="Citation correspondence review"]'),s=p.querySelector('select'),t=p.querySelector('textarea');s.value='rejected';s.dispatchEvent(new Event('change',{bubbles:true}));Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Fictional corrected comparison: correspondence uncertain.');t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await ui.click('Record replacement decision');await eventually(async()=>(await ui.text()).includes('Current correspondence decision: rejected · revision 2'),'replacement rejection');
  await b.send('Page.reload');await eventually(async()=>(await ui.text()).includes(inspect),'reloaded review case');await ui.click(inspect);await eventually(async()=>(await ui.text()).includes(review),'reloaded candidate');await ui.click(review);await eventually(async()=>(await ui.text()).includes('Current correspondence decision: rejected · revision 2'),'persisted review chain');
  assert.ok((await ui.text()).includes('Revision 1: accepted'));assert.ok((await ui.text()).includes('Revision 2: rejected'));
  assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM findings WHERE case_id=$1',[f.scope.caseId])).rows[0].n,0);
 });}finally{await f.app.close();}
});

async function documentClaimFixture(){
 const f=await citationReviewFixture(),reviewResponse=await request('POST',f.reviewUrl,context.demo!,{payload:f.reviewInput});assert.equal(reviewResponse.statusCode,200,reviewResponse.body);const history=reviewResponse.json(),review=history.reviews[0];
 return {...f,history,claimUrl:f.citationUrl+'/claims',claimInput:{id:randomUUID(),citationDigest:f.candidate.citationDigest,correspondenceReviewId:review.id,correspondenceReviewDigest:review.digest,text:'Fictional records may indicate a separately reviewable pattern; this interpretation is not source truth.'}};
}
async function documentReportFixture(){
 const f=await documentClaimFixture();
 const proposed=await request('POST',f.claimUrl,f.authorSession,{payload:f.claimInput});assert.equal(proposed.statusCode,200,proposed.body);const claim=proposed.json().claims[0];
 const decision={id:randomUUID(),claimDigest:claim.digest,accepted:true,reason:'Fictional independent interpretation for the report lineage check.'};
 const accepted=await request('POST',`${f.claimUrl}/${claim.id}/decision`,context.demo!,{payload:decision});assert.equal(accepted.statusCode,200,accepted.body);
 return {...f,claim,decision,reportUrl:`/api/cases/${f.scope.caseId}/report`,revisionsUrl:`/api/cases/${f.scope.caseId}/report-revisions`};
}
test('actual document report packages verify offline, preserve mixed originals and deny stale or unaudited exports',async()=>{
 const f=await documentReportFixture();try{
  const frozen=await request('POST',f.revisionsUrl,context.demo!,{payload:{idempotencyKey:randomUUID()}});assert.equal(frozen.statusCode,200,frozen.body);const receipt=frozen.json(),url=`${f.revisionsUrl}/${receipt.id}/document-package`;
  const exported=await request('GET',url,context.demo!);assert.equal(exported.statusCode,200,exported.body);assert.equal(exported.headers['cache-control'],'no-store');const packageDigest=digest(exported.body);assert.equal(exported.headers['x-inveos-package-sha256'],packageDigest);
  const path=join(context.storageRoot!,'fictional-api-document-package.json'),verifier=fileURLToPath(new URL('../../../tools/verify_document_package.py',import.meta.url));await writeFile(path,exported.body);
  const checked=await promisify(execFile)('python3',[verifier,path,'--expected-report-sha256',receipt.sha256,'--expected-package-sha256',packageDigest],{timeout:10000});assert.equal(JSON.parse(checked.stdout).documentFindingsChecked,1);assert.equal(JSON.parse(checked.stdout).trustedPackageDigestMatched,true);
  await context.app!.close();context.app=await createAppInstance();assert.equal((await request('GET',url,context.demo!)).body,exported.body);
  const clientId=await createMember(demoTenantId,'client','Fictional package recipient');assertError(await request('GET',url,await issueTestSession(clientId)),403);
  const outsider=await createMember(demoTenantId,'reviewer','Fictional package outsider');assertError(await request('GET',url,await issueTestSession(outsider)),404);
  const original=parseBody<Evidence>(await uploadEvidence(f.scope.caseId)),claim=(await createClaim(f.scope.caseId,original.id)).json();assert.equal((await request('POST',`/api/cases/${f.scope.caseId}/claims/${claim.id}/review`,context.demo!,{payload:{accepted:true,reason:'Fictional original-byte observation for mixed export.'}})).statusCode,200);
  const mixed=(await request('POST',f.revisionsUrl,context.demo!,{payload:{idempotencyKey:randomUUID()}})).json(),mixedPackage=await request('GET',`${f.revisionsUrl}/${mixed.id}/document-package`,context.demo!);assert.equal(mixedPackage.statusCode,200,mixedPackage.body);await writeFile(path,mixedPackage.body);
  const mixedCheck=await promisify(execFile)('python3',[verifier,path,'--expected-report-sha256',mixed.sha256],{timeout:10000});assert.equal(JSON.parse(mixedCheck.stdout).originalFindingsChecked,1);assert.equal(JSON.parse(mixedCheck.stdout).documentFindingsChecked,1);
  await context.schemaAdminPool!.query("CREATE FUNCTION deny_document_export_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='report.document_package_exported' THEN RAISE EXCEPTION 'fictional export audit failure'; END IF; RETURN NEW; END $$");await context.schemaAdminPool!.query('CREATE TRIGGER deny_document_export_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_document_export_audit()');
  try{assertError(await request('GET',url,context.demo!),500);}finally{await context.schemaAdminPool!.query('DROP TRIGGER deny_document_export_audit ON audit_events');await context.schemaAdminPool!.query('DROP FUNCTION deny_document_export_audit()');}
  const replacement={...f.reviewInput,id:randomUUID(),previousReviewId:f.reviewInput.id,decision:'rejected',reason:'Fictional correspondence withdrawn before export.',originalCompared:false};assert.equal((await request('POST',f.reviewUrl,context.demo!,{payload:replacement})).statusCode,200);assertError(await request('GET',url,context.demo!),409);
  // Downloaded bytes remain independently checkable; offline checks cannot assert current server policy.
  assert.equal((await promisify(execFile)('python3',[verifier,path],{timeout:10000})).stderr,'');
 }finally{await f.app.close();}
});
async function pdfReleaseFixture(){
 const f=await documentReportFixture();
 const frozen=await request('POST',f.revisionsUrl,f.authorSession,{payload:{idempotencyKey:randomUUID()}});assert.equal(frozen.statusCode,200,frozen.body);const revision=frozen.json();
 const created=await request('POST',`${f.revisionsUrl}/${revision.id}/renditions`,context.demo!,{payload:{idempotencyKey:randomUUID(),redactedFindingIds:[f.decision.id],reason:'Fictional scope excludes this entire finding.'}});assert.equal(created.statusCode,200,created.body);const rendition=created.json(),base=`${f.revisionsUrl}/${revision.id}/renditions/${rendition.id}`;
 const reviewerId=await createMember(demoTenantId,'reviewer','Fictional independent PDF reviewer');await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,f.scope.caseId,reviewerId]);const reviewer=await issueTestSession(reviewerId);
 const recipientId=await createMember(demoTenantId,'client','Fictional PDF recipient'),recipient=await issueTestSession(recipientId);
 const review={pdfSha256:rendition.pdfSha256,redactionSha256:rendition.redactionSha256,decision:'accept_for_disclosure',reason:'Fictional exact PDF, retained content and redactions inspected.',confirmInspected:true};
 const release={pdfSha256:rendition.pdfSha256,recipientId,idempotencyKey:randomUUID(),expiresAt:new Date(Date.now()+3600000).toISOString(),reason:'Fictional explicit reviewed PDF disclosure.',confirmReviewedDisclosure:true};
 return {...f,revision,rendition,base,reviewerId,reviewer,recipientId,recipient,review,release};
}
test('PDF review is independent, fingerprint-bound, append-only and retry-safe',async()=>{
 const f=await pdfReleaseFixture();try{
  assertError(await request('POST',f.base+'/reviews',context.demo!,{payload:f.review}),403);
  assertError(await request('POST',f.base+'/reviews',f.authorSession,{payload:f.review}),403);
  assertError(await request('GET',f.base+'/reviews',f.recipient),403);
  assertError(await request('POST',f.base+'/reviews',f.reviewer,{payload:f.review,csrfHeader:false}),403);
  assertError(await request('POST',f.base+'/reviews',f.reviewer,{payload:{...f.review,pdfSha256:'0'.repeat(64)}}),409);
  assertError(await request('POST',f.base+'/reviews',f.reviewer,{payload:{...f.review,confirmInspected:false}}),422);
  const results=await Promise.all([request('POST',f.base+'/reviews',f.reviewer,{payload:f.review}),request('POST',f.base+'/reviews',f.reviewer,{payload:f.review})]);for(const r of results)assert.equal(r.statusCode,200,r.body);assert.deepEqual(results[0]!.json(),results[1]!.json());
  assertError(await request('POST',f.base+'/reviews',f.reviewer,{payload:{...f.review,decision:'request_changes'}}),409);
  await assert.rejects(context.schemaAdminPool!.query('DELETE FROM report_rendition_reviews WHERE rendition_id=$1',[f.rendition.id]),/append.only|immutable/i);
  await context.app!.close();context.app=await createAppInstance();assert.deepEqual((await request('GET',f.base+'/reviews',context.demo!)).json().items,[results[0]!.json()]);
  const outsider=await issueTestSession(await createMember(demoTenantId,'reviewer','Fictional PDF outsider'));assertError(await request('GET',f.base+'/reviews',outsider),404);
 }finally{await f.app.close();}
});
test('reviewed PDF releases preserve exact redacted bytes through portal receipt, history and revocation',async()=>{
 const f=await pdfReleaseFixture();try{
  assertError(await request('POST',f.base+'/disclosures',context.demo!,{payload:f.release}),409);
  assert.equal((await request('POST',f.base+'/reviews',f.reviewer,{payload:f.review})).statusCode,200);
  const results=await Promise.all([request('POST',f.base+'/disclosures',context.demo!,{payload:f.release}),request('POST',f.base+'/disclosures',context.demo!,{payload:f.release})]);for(const r of results)assert.equal(r.statusCode,200,r.body);assert.deepEqual(results[0]!.json(),results[1]!.json());const grant=results[0]!.json();assert.equal(grant.deliverable,'report_pdf');assert.equal(grant.sha256,f.rendition.pdfSha256);assert.equal(grant.reportSha256,f.revision.sha256);
  assertError(await request('POST',f.base+'/disclosures',context.demo!,{payload:{...f.release,reason:'Changed fictional release reason.'}}),409);
  const listed=(await request('GET','/api/portal/disclosures',f.recipient)).json();assert.equal(listed.items[0].deliverable,'report_pdf');assert.equal(listed.items[0].sha256,f.rendition.pdfSha256);
  const portal='/api/portal/disclosures/'+grant.id,download=await request('GET',portal,f.recipient);assert.equal(download.statusCode,200,download.body);assert.equal(download.headers['content-type'],'application/pdf');assert.equal(download.headers['x-inveos-report-sha256'],f.revision.sha256);assert.deepEqual(download.rawPayload,(await request('GET',f.base,context.demo!)).rawPayload);
  await context.app!.close();context.app=await createAppInstance();assert.deepEqual((await request('GET',portal,f.recipient)).rawPayload,download.rawPayload);
  await context.schemaAdminPool!.query('ALTER TABLE report_renditions DISABLE TRIGGER report_renditions_append_only');try{await context.schemaAdminPool!.query("UPDATE report_renditions SET pdf_bytes=convert_to('Fictional altered PDF','UTF8') WHERE id=$1",[f.rendition.id]);assertError(await request('GET',portal,f.recipient),409);await context.schemaAdminPool!.query('UPDATE report_renditions SET pdf_bytes=$2 WHERE id=$1',[f.rendition.id,download.rawPayload]);}finally{await context.schemaAdminPool!.query('ALTER TABLE report_renditions ENABLE TRIGGER report_renditions_append_only');}
  await context.schemaAdminPool!.query('ALTER TABLE report_disclosures DISABLE TRIGGER disclosure_append_only');try{await context.schemaAdminPool!.query("UPDATE report_disclosures SET expires_at=now()-interval '1 second' WHERE id=$1",[grant.id]);assertError(await request('GET',portal,f.recipient),404);assert.equal((await request('GET','/api/portal/disclosures',f.recipient)).json().items.length,0);await context.schemaAdminPool!.query('UPDATE report_disclosures SET expires_at=$2 WHERE id=$1',[grant.id,new Date(f.release.expiresAt)]);}finally{await context.schemaAdminPool!.query('ALTER TABLE report_disclosures ENABLE TRIGGER disclosure_append_only');}
  const otherTenant=randomUUID();await context.schemaAdminPool!.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[otherTenant,'Fictional isolated PDF agency']);const foreign=await issueTestSession(await createMember(otherTenant,'client','Fictional foreign PDF recipient'),otherTenant);assertError(await request('GET',portal,foreign),404);
  const path=join(context.storageRoot!,'fictional-released-pdf.pdf');await writeFile(path,download.rawPayload);await promisify(execFile)('python3',[fileURLToPath(new URL('../../../tools/verify_report_pdf.py',import.meta.url)),path,'--expected-pdf-sha256',f.rendition.pdfSha256,'--expected-report-sha256',f.revision.sha256],{timeout:10000});
  assertError(await request('POST',portal+'/acknowledge',f.recipient,{payload:{sha256:f.revision.sha256,confirmReceipt:true}}),409);
  const ack={sha256:f.rendition.pdfSha256,confirmReceipt:true};assert.equal((await request('POST',portal+'/acknowledge',f.recipient,{payload:ack})).statusCode,200);assert.equal((await request('POST',portal+'/acknowledge',f.recipient,{payload:ack})).statusCode,200);
  const history=(await request('GET',`/api/cases/${f.scope.caseId}/disclosures`,context.demo!)).json().items[0];assert.equal(history.deliverable,'report_pdf');assert.ok(history.acknowledgedAt);assert.equal(history.accessPolicyEligible,true);
  await assert.rejects(context.schemaAdminPool!.query('DELETE FROM report_disclosure_renditions WHERE disclosure_id=$1',[grant.id]),/append.only|immutable/i);
  const stranger=await issueTestSession(await createMember(demoTenantId,'client','Fictional different PDF recipient'));assertError(await request('GET',portal,stranger),404);assertError(await request('GET',f.base,f.recipient),403);
  // Reusing a PDF key against the JSON/package endpoint must never recover a different deliverable.
  assertError(await request('POST',`${f.revisionsUrl}/${f.revision.id}/disclosures`,context.demo!,{payload:{sha256:f.revision.sha256,recipientId:f.recipientId,idempotencyKey:f.release.idempotencyKey,expiresAt:f.release.expiresAt,reason:f.release.reason,confirmFullDisclosure:true}}),409);
  const changed={...f.reviewInput,id:randomUUID(),previousReviewId:f.reviewInput.id,decision:'rejected',reason:'Fictional later source correspondence correction.',originalCompared:false};assert.equal((await request('POST',f.reviewUrl,context.demo!,{payload:changed})).statusCode,200);assertError(await request('POST',f.base+'/disclosures',context.demo!,{payload:{...f.release,idempotencyKey:randomUUID()}}),409);
  assert.deepEqual((await request('GET',portal,f.recipient)).rawPayload,download.rawPayload);
  assert.equal((await request('POST',`/api/cases/${f.scope.caseId}/disclosures/${grant.id}/revoke`,context.demo!,{payload:{reason:'Fictional revoke after corrected source review.'}})).statusCode,200);assertError(await request('GET',portal,f.recipient),404);assertError(await request('POST',portal+'/acknowledge',f.recipient,{payload:ack}),404);assert.equal((await request('GET','/api/portal/disclosures',f.recipient)).json().items.length,0);
 }finally{await f.app.close();}
});
test('PDF review and release roll back with audit failures and reject revoked acceptance or change requests',async()=>{
 const f=await pdfReleaseFixture();try{
  await context.schemaAdminPool!.query("CREATE FUNCTION deny_pdf_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('report.rendition_reviewed','report.disclosed') THEN RAISE EXCEPTION 'fictional PDF audit failure'; END IF; RETURN NEW; END $$");await context.schemaAdminPool!.query('CREATE TRIGGER deny_pdf_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_pdf_audit()');
  try{assertError(await request('POST',f.base+'/reviews',f.reviewer,{payload:f.review}),500);assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM report_rendition_reviews WHERE rendition_id=$1',[f.rendition.id])).rows[0].n,0);}finally{await context.schemaAdminPool!.query('DROP TRIGGER deny_pdf_audit ON audit_events');}
  assert.equal((await request('POST',f.base+'/reviews',f.reviewer,{payload:f.review})).statusCode,200);
  await context.schemaAdminPool!.query('CREATE TRIGGER deny_pdf_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_pdf_audit()');
  try{assertError(await request('POST',f.base+'/disclosures',context.demo!,{payload:f.release}),500);assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM report_disclosures WHERE case_id=$1',[f.scope.caseId])).rows[0].n,0);}finally{await context.schemaAdminPool!.query('DROP TRIGGER deny_pdf_audit ON audit_events');await context.schemaAdminPool!.query('DROP FUNCTION deny_pdf_audit()');}
  const result=await request('POST',f.base+'/disclosures',context.demo!,{payload:f.release});assert.equal(result.statusCode,200,result.body);const portal='/api/portal/disclosures/'+result.json().id;
  await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,f.scope.caseId,f.reviewerId]);assertError(await request('GET',portal,f.recipient),404);assertError(await request('POST',f.base+'/disclosures',context.demo!,{payload:{...f.release,idempotencyKey:randomUUID()}}),409);
  await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,f.scope.caseId,f.reviewerId]);assert.equal((await request('GET',portal,f.recipient)).statusCode,200);
  const third=await createMember(demoTenantId,'reviewer','Fictional PDF change requester');await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,f.scope.caseId,third]);assert.equal((await request('POST',f.base+'/reviews',await issueTestSession(third),{payload:{...f.review,decision:'request_changes',reason:'Fictional retained context needs further redaction.'}})).statusCode,200);assertError(await request('GET',portal,f.recipient),404);assertError(await request('POST',f.base+'/disclosures',context.demo!,{payload:{...f.release,idempotencyKey:randomUUID()}}),409);
 }finally{await f.app.close();}
});
test('canonical PDF renditions are immutable, redaction-safe, reproducible and independently verified',async()=>{
 const f=await documentReportFixture();try{
  const frozen=await request('POST',f.revisionsUrl,context.demo!,{payload:{idempotencyKey:randomUUID()}});assert.equal(frozen.statusCode,200,frozen.body);const revision=frozen.json(),base=`${f.revisionsUrl}/${revision.id}/renditions`,key=randomUUID(),input={idempotencyKey:key,redactedFindingIds:[f.decision.id],reason:'Withheld for fictional client-scope review.'};
  const created=await Promise.all([request('POST',base,context.demo!,{payload:input}),request('POST',base,context.demo!,{payload:input})]);for(const response of created)assert.equal(response.statusCode,200,response.body);assert.deepEqual(created[0]!.json(),created[1]!.json());const receipt=created[0]!.json();assert.equal(receipt.redactedFindingCount,1);assert.equal(receipt.sourceReportSha256,revision.sha256);assert.equal(receipt.status,'internal_rendition_not_released');
  const downloaded=await request('GET',`${base}/${receipt.id}`,context.demo!);assert.equal(downloaded.statusCode,200,downloaded.body);assert.equal(downloaded.headers['content-type'],'application/pdf');assert.equal(downloaded.headers['x-inveos-pdf-sha256'],receipt.pdfSha256);assert.equal(downloaded.headers['x-inveos-report-sha256'],revision.sha256);assert.equal(createHash('sha256').update(downloaded.rawPayload).digest('hex'),receipt.pdfSha256);
  const secret=f.claimInput.text,raw=downloaded.rawPayload,secretHex=Buffer.from(secret).toString('hex').toUpperCase();assert.equal(raw.includes(Buffer.from(secret)),false);assert.equal(raw.includes(Buffer.from(secretHex)),false);
  const path=join(context.storageRoot!,'fictional-redacted-report.pdf'),verifier=fileURLToPath(new URL('../../../tools/verify_report_pdf.py',import.meta.url));await writeFile(path,raw);const checked=await promisify(execFile)('python3',[verifier,path,'--expected-pdf-sha256',receipt.pdfSha256,'--expected-report-sha256',revision.sha256]);assert.equal(JSON.parse(checked.stdout).semanticStreamsMatched,true);
  const listed=await request('GET',base,context.demo!);assert.deepEqual(listed.json().items,[receipt]);
  assertError(await request('POST',base,context.demo!,{payload:{...input,reason:'A different fictional redaction reason.'}}),409);assertError(await request('POST',base,context.demo!,{payload:{idempotencyKey:randomUUID(),redactedFindingIds:[randomUUID()],reason:input.reason}}),422);
  const investigator=await issueTestSession(await createMember(demoTenantId,'investigator','Fictional rendition investigator'));assertError(await request('POST',base,investigator,{payload:{...input,idempotencyKey:randomUUID()}}),403);const client=await issueTestSession(await createMember(demoTenantId,'client','Fictional rendition client'));assertError(await request('GET',`${base}/${receipt.id}`,client),403);
  await context.app!.close();context.app=await createAppInstance();assert.deepEqual((await request('GET',`${base}/${receipt.id}`,context.demo!)).rawPayload,raw);
  await assert.rejects(context.schemaAdminPool!.query('DELETE FROM report_renditions WHERE id=$1',[receipt.id]),/append.only|immutable/i);
  await context.schemaAdminPool!.query('ALTER TABLE report_renditions DISABLE TRIGGER report_renditions_append_only');try{await context.schemaAdminPool!.query("UPDATE report_renditions SET pdf_bytes=convert_to('fictional changed pdf','UTF8') WHERE id=$1",[receipt.id]);assertError(await request('GET',`${base}/${receipt.id}`,context.demo!),409);await context.schemaAdminPool!.query('UPDATE report_renditions SET pdf_bytes=$2 WHERE id=$1',[receipt.id,raw]);}finally{await context.schemaAdminPool!.query('ALTER TABLE report_renditions ENABLE TRIGGER report_renditions_append_only');}
  const replacement={...f.reviewInput,id:randomUUID(),previousReviewId:f.reviewInput.id,decision:'rejected',reason:'Fictional later correction blocks new rendition.',originalCompared:false};assert.equal((await request('POST',f.reviewUrl,context.demo!,{payload:replacement})).statusCode,200);assertError(await request('POST',base,context.demo!,{payload:{...input,idempotencyKey:randomUUID()}}),409);assert.deepEqual((await request('GET',`${base}/${receipt.id}`,context.demo!)).rawPayload,raw);
 }finally{await f.app.close();}
});
test('document reports freeze exact lineage and release only the independently verified immutable package',async()=>{
 const f=await documentReportFixture();try{
  const draft=await request('GET',f.reportUrl,context.demo!);assert.equal(draft.statusCode,200,draft.body);const report=draft.json(),entry=report.documentFindings[0];assert.deepEqual(report.findings,[]);
  assert.equal(entry.kind,'derived_document');assert.equal(entry.id,f.decision.id);assert.equal(entry.reference.page,2);assert.equal(entry.reference.offsetBasis,'extracted_utf8_not_original_pdf');assert.equal(entry.reference.citationDigest,f.candidate.citationDigest);assert.equal(entry.extraction.derivativeDigest,f.selection.derivativeDigest);assert.equal(entry.correspondence.id,f.reviewInput.id);assert.equal(entry.interpretation.claimDigest,f.claim.digest);assert.equal(entry.text,f.claimInput.text);assert.ok(entry.source.filename);assert.ok(entry.extraction.profile.includes('NativePdfPipeline'));
  const payload={idempotencyKey:randomUUID()},responses=await Promise.all([1,2].map(()=>request('POST',f.revisionsUrl,f.authorSession,{payload})));for(const r of responses)assert.equal(r.statusCode,200,r.body);assert.deepEqual(responses[0]!.json(),responses[1]!.json());const receipt=responses[0]!.json(),url=f.revisionsUrl+'/'+receipt.id;
  const download=await request('GET',url,context.demo!);assert.deepEqual(download.json(),report);assert.equal(createHash('sha256').update(download.body).digest('hex'),receipt.sha256);
  await context.app!.close();context.app=await createAppInstance();assert.equal((await request('GET',url,context.demo!)).body,download.body);
  const verified=await request('POST',url+'/verify-sources',context.demo!,{payload:{sha256:receipt.sha256}});assert.equal(verified.statusCode,200,verified.body);assert.equal(verified.json().findingCount,1);
  const internal=await request('POST',url+'/reviews',context.demo!,{payload:{sha256:receipt.sha256,decision:'accept_internal',reason:'Fictional internal report acceptance; no release.'}});assert.equal(internal.statusCode,200,internal.body);
  const recipientId=await createMember(demoTenantId,'client','Fictional report lineage recipient');
  const releaseBase={sha256:receipt.sha256,recipientId,idempotencyKey:randomUUID(),expiresAt:new Date(Date.now()+3600000).toISOString(),reason:'Fictional reviewed document package release.',confirmFullDisclosure:true};
  const missing=await request('POST',url+'/disclosures',context.demo!,{payload:releaseBase});assertError(missing,409);assert.match(missing.body,/Verify and confirm/);
  const packageResponse=await request('GET',url+'/document-package',context.demo!),packageSha256=digest(packageResponse.body);assert.equal(packageResponse.statusCode,200,packageResponse.body);
  assertError(await request('POST',url+'/disclosures',context.demo!,{payload:{...releaseBase,documentPackageSha256:'0'.repeat(64),confirmDocumentPackageVerified:true}}),409);
  const releaseInput={...releaseBase,documentPackageSha256:packageSha256,confirmDocumentPackageVerified:true};const released=await request('POST',url+'/disclosures',context.demo!,{payload:releaseInput});assert.equal(released.statusCode,200,released.body);const retried=await request('POST',url+'/disclosures',context.demo!,{payload:releaseInput});assert.deepEqual(retried.json(),released.json());const grant=released.json();assert.equal(grant.sha256,packageSha256);assert.equal(grant.reportSha256,receipt.sha256);assert.equal(grant.deliverable,'document_package');
  assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM report_disclosures WHERE case_id=$1',[f.scope.caseId])).rows[0].n,1);assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM report_disclosure_packages WHERE disclosure_id=$1',[grant.id])).rows[0].n,1);await assert.rejects(context.schemaAdminPool!.query('DELETE FROM report_disclosure_packages WHERE disclosure_id=$1',[grant.id]),/append.only|immutable/i);
  const client=await issueTestSession(recipientId),portal=(await request('GET','/api/portal/disclosures',client)).json();assert.equal(portal.items[0].sha256,packageSha256);assert.equal(portal.items[0].reportSha256,receipt.sha256);assert.equal(portal.items[0].deliverable,'document_package');
  const delivered=await request('GET','/api/portal/disclosures/'+grant.id,client);assert.equal(delivered.statusCode,200,delivered.body);assert.equal(delivered.headers['x-inveos-package-sha256'],packageSha256);assert.equal(delivered.headers['x-inveos-report-sha256'],undefined);assert.deepEqual(delivered.rawPayload,packageResponse.rawPayload);
  const packageFile=join(context.storageRoot!,'fictional-released-document-package.json'),packageVerifier=fileURLToPath(new URL('../../../tools/verify_document_package.py',import.meta.url));await writeFile(packageFile,delivered.rawPayload);await promisify(execFile)('python3',[packageVerifier,packageFile,'--expected-report-sha256',receipt.sha256,'--expected-package-sha256',packageSha256],{timeout:10000});
  const acknowledged=await request('POST','/api/portal/disclosures/'+grant.id+'/acknowledge',client,{payload:{sha256:packageSha256,confirmReceipt:true}});assert.equal(acknowledged.statusCode,200,acknowledged.body);assert.equal(acknowledged.json().sha256,packageSha256);
  await context.schemaAdminPool!.query('ALTER TABLE report_disclosure_packages DISABLE TRIGGER disclosure_package_append_only');try{await context.schemaAdminPool!.query("UPDATE report_disclosure_packages SET package_bytes=convert_to('fictional changed release','UTF8') WHERE disclosure_id=$1",[grant.id]);assertError(await request('GET','/api/portal/disclosures/'+grant.id,client),409);await context.schemaAdminPool!.query('UPDATE report_disclosure_packages SET package_bytes=$2 WHERE disclosure_id=$1',[grant.id,packageResponse.rawPayload]);}finally{await context.schemaAdminPool!.query('ALTER TABLE report_disclosure_packages ENABLE TRIGGER disclosure_package_append_only');}
  assertError(await request('GET',url,client),403);const outsider=await createMember(demoTenantId,'reviewer','Fictional report outsider');assertError(await request('GET',url,await issueTestSession(outsider)),404);
  const replacement={...f.reviewInput,id:randomUUID(),previousReviewId:f.reviewInput.id,decision:'rejected',reason:'Fictional later correction blocks new releases.',originalCompared:false};assert.equal((await request('POST',f.reviewUrl,context.demo!,{payload:replacement})).statusCode,200);assertError(await request('GET',url+'/document-package',context.demo!),409);assertError(await request('POST',url+'/disclosures',context.demo!,{payload:{...releaseInput,idempotencyKey:randomUUID()}}),409);
  // A later correspondence correction blocks new grants but does not rewrite an already released package; revoke explicitly when required.
  assert.deepEqual((await request('GET','/api/portal/disclosures/'+grant.id,client)).rawPayload,packageResponse.rawPayload);
  // The legacy offline verifier must not silently verify just the original-byte array.
  const reportFile=join(context.storageRoot!,'fictional-document-report.json');await writeFile(reportFile,download.body);
  const verifier=spawnSync('python3',[fileURLToPath(new URL('../../../tools/verify_report.py',import.meta.url)),reportFile],{encoding:'utf8'});assert.equal(verifier.status,1);assert.match(verifier.stderr,/derivative package verifier/);
 }finally{await f.app.close();}
});
test('report document lineage rejects stale correspondence and authority while preserving historical frozen bytes',async()=>{
 const f=await documentReportFixture();try{
  const payload={idempotencyKey:randomUUID()},frozen=await request('POST',f.revisionsUrl,context.demo!,{payload});assert.equal(frozen.statusCode,200,frozen.body);const receipt=frozen.json(),url=f.revisionsUrl+'/'+receipt.id,bytes=(await request('GET',url,context.demo!)).body;
  const replacement={...f.reviewInput,id:randomUUID(),previousReviewId:f.reviewInput.id,decision:'rejected',reason:'Fictional corrected comparison invalidates new report use.',originalCompared:false};assert.equal((await request('POST',f.reviewUrl,context.demo!,{payload:replacement})).statusCode,200);
  assertError(await request('GET',f.reportUrl,context.demo!),409);assertError(await request('POST',f.revisionsUrl,context.demo!,{payload:{idempotencyKey:randomUUID()}}),409);assertError(await request('POST',url+'/verify-sources',context.demo!,{payload:{sha256:receipt.sha256}}),409);
  assert.equal((await request('GET',url,context.demo!)).body,bytes);assert.deepEqual((await request('POST',f.revisionsUrl,context.demo!,{payload})).json(),receipt);
 }finally{await f.app.close();}
 const g=await documentReportFixture();try{await approveAuthority(g.scope.caseId);assertError(await request('POST',g.revisionsUrl,context.demo!,{payload:{idempotencyKey:randomUUID()}}),409);}finally{await g.app.close();}
});
test('document report freeze rolls back with audit and rejects changed source bytes',async()=>{
 const f=await documentReportFixture();try{
  const payload={idempotencyKey:randomUUID()};
  await context.schemaAdminPool!.query("CREATE FUNCTION deny_document_report_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='report.frozen' THEN RAISE EXCEPTION 'fictional report audit failure'; END IF; RETURN NEW; END $$");await context.schemaAdminPool!.query('CREATE TRIGGER deny_document_report_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_document_report_audit()');
  try{assertError(await request('POST',f.revisionsUrl,context.demo!,{payload}),500);assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM report_revisions WHERE case_id=$1',[f.scope.caseId])).rows[0].n,0);}
  finally{await context.schemaAdminPool!.query('DROP TRIGGER deny_document_report_audit ON audit_events');await context.schemaAdminPool!.query('DROP FUNCTION deny_document_report_audit()');}
  assert.equal((await request('POST',f.revisionsUrl,context.demo!,{payload})).statusCode,200);
  const evidence=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[f.job.evidenceId])).rows[0];await writeFile(resolve(context.storageRoot!,evidence.object_path),'Fictional changed report original');assertError(await request('GET',f.reportUrl,context.demo!),409);assertError(await request('POST',f.revisionsUrl,context.demo!,{payload:{idempotencyKey:randomUUID()}}),409);
 }finally{await f.app.close();}
});
test('real browser prints document-only findings with page provenance and clears a stale verified preview',{skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:90000},async()=>{
 const f=await documentReportFixture();try{await withBrowserApp(async(b,origin)=>{
  const ui=await binaryBrowserControls(b,origin,f.scope.caseId);await ui.click('Reports');await b.evaluate('window.print=()=>{window.__fictionalPrintCalled=true;}');await ui.click('Print complete draft');
  await eventually(async()=>(await ui.text()).includes('Reviewed document interpretations')&&await b.evaluate<boolean>('window.__fictionalPrintCalled===true'),'document-backed report preview and print callback');assert.ok((await ui.text()).includes(f.claimInput.text));assert.ok((await ui.text()).includes('page 2'));assert.ok((await ui.text()).includes('not original PDF byte offsets'));
  const evidence=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[f.job.evidenceId])).rows[0];await writeFile(resolve(context.storageRoot!,evidence.object_path),'Fictional corrupt print source');await ui.click('Print complete draft');await eventually(async()=>(await ui.text()).includes('integrity verification failed'),'fresh print corruption failure');assert.equal(await b.evaluate(`Boolean(document.querySelector('section[aria-label="Document-backed report findings"]'))`),false);
 });}finally{await f.app.close();}
});
test('real browser independently reviews and releases a redacted PDF, recovers delivery and acknowledges exact bytes',{skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:90000},async()=>{
 const f=await pdfReleaseFixture();try{await withBrowserApp(async(b,origin)=>{
  const ui=await binaryBrowserControls(b,origin,f.scope.caseId),downloads=join(b.root,'reviewed-pdf-downloads');await mkdir(downloads);await b.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  const session=async(value:TestSession)=>{for(const pair of value.cookie.split('; ')){const split=pair.indexOf('=');await b.send('Network.setCookie',{name:pair.slice(0,split),value:pair.slice(split+1),url:origin,path:'/',sameSite:'Strict',httpOnly:pair.startsWith('inveos_session=')});}};
  await session(f.reviewer);await b.send('Page.reload');await eventually(async()=>(await ui.text()).includes('Register a binary original'),'independent reviewer workspace');await ui.click('Reports');
  const load='Load saved PDFs '+f.revision.id.slice(0,8);await eventually(async()=>await b.evaluate<boolean>(`[...document.querySelectorAll('button')].some(button=>button.textContent===${JSON.stringify(load)})`),'PDF list control');
  await b.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent===${JSON.stringify(load)});button.closest('details').open=true;})()`);await ui.click(load);await eventually(async()=>(await ui.text()).includes('Saved PDF renditions loaded.'),'PDF receipts');await ui.click('Download saved PDF '+f.rendition.id.slice(0,8));await eventually(async()=>(await ui.text()).includes('Saved PDF verified and downloaded.'),'verified independent download');
  await b.evaluate(`(()=>{const form=[...document.querySelectorAll('form')].find(form=>form.textContent.includes('PDF review decision'));form.closest('details').open=true;form.elements.namedItem('decision').value='accept_for_disclosure';form.elements.namedItem('reason').value='Fictional browser inspection of exact PDF and redactions.';form.querySelector('input[type=checkbox]').click();if(!form.checkValidity())throw new Error('Invalid PDF review form');})()`);await ui.click('Record PDF review');await eventually(async()=>(await ui.text()).includes('Independent PDF review recorded.'),'PDF review receipt');
  await b.evaluate(`(()=>{const form=[...document.querySelectorAll('form')].find(form=>form.textContent.includes('PDF recipient UUID'));form.closest('details').open=true;for(const [name,value] of Object.entries({recipientId:${JSON.stringify(f.recipientId)},expiresAt:${JSON.stringify(f.release.expiresAt)},reason:'Fictional browser release of independently reviewed redacted PDF.'})){form.elements.namedItem(name).value=value;}form.querySelector('input[type=checkbox]').click();if(!form.checkValidity())throw new Error('Invalid PDF release form');const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).endsWith('/disclosures')&&args[1]?.method==='POST'&&response.ok){window.fetch=original;window.__fictionalPdfReleaseLost=true;throw new Error('Fictional committed PDF release response lost');}return response;};})()`);await ui.click('Approve PDF disclosure');await eventually(async()=>await b.evaluate<boolean>('window.__fictionalPdfReleaseLost===true'),'committed PDF release loss');
  await b.send('Page.reload');await eventually(async()=>await b.evaluate<boolean>(`[...document.querySelectorAll('button')].some(button=>button.textContent===${JSON.stringify(load)})`),'reviewer reload');await b.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent===${JSON.stringify(load)});button.closest('details').open=true;})()`);await ui.click(load);await eventually(async()=>await b.evaluate<boolean>(`[...document.querySelectorAll('button')].some(button=>button.textContent==='Recover pending PDF release')`),'PDF release recovery control');await b.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent==='Recover pending PDF release');button.closest('details').open=true;})()`);await ui.click('Recover pending PDF release');await eventually(async()=>(await ui.text()).includes('Restricted PDF release confirmed.'),'PDF release recovery');
  const grants=(await context.pool!.query('SELECT id FROM report_disclosures WHERE case_id=$1',[f.scope.caseId])).rows;assert.equal(grants.length,1);const grant=grants[0];
  await session(f.recipient);await b.send('Page.navigate',{url:origin+'/portal'});await eventually(async()=>(await ui.text()).includes('Refresh disclosures'),'PDF recipient portal');await ui.click('Refresh disclosures');await eventually(async()=>(await ui.text()).includes(grant.id)&&(await ui.text()).includes('reviewed PDF'),'PDF recipient discovery');await ui.click('Verify and download snapshot');const name='disclosure-'+grant.id+'.pdf';await eventually(async()=>{try{return createHash('sha256').update(await readFile(join(downloads,name))).digest('hex')===f.rendition.pdfSha256;}catch{return false;}},'exact client PDF download');
  const path=join(downloads,name);await promisify(execFile)('python3',[fileURLToPath(new URL('../../../tools/verify_report_pdf.py',import.meta.url)),path,'--expected-pdf-sha256',f.rendition.pdfSha256,'--expected-report-sha256',f.revision.sha256],{timeout:10000});
  await eventually(async()=>(await ui.text()).includes('I confirm receipt of this exact deliverable.'),'PDF receipt controls');await b.evaluate(`[...document.querySelectorAll('input[type=checkbox]')].find(input=>input.closest('label').textContent.includes('I confirm receipt')).click()`);await ui.click('Acknowledge receipt');await eventually(async()=>(await ui.text()).includes('Receipt acknowledged at'),'PDF recipient acknowledgement');
  const ack=(await context.pool!.query('SELECT digest FROM report_disclosure_acknowledgements WHERE disclosure_id=$1',[grant.id])).rows[0];assert.equal(ack.digest.trim(),f.rendition.pdfSha256);
 });}finally{await f.app.close();}
});
test('real browser recovers, verifies and renders a canonical internal PDF',{skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:90000},async()=>{
 const f=await documentReportFixture();try{
  const frozen=await request('POST',f.revisionsUrl,f.authorSession,{payload:{idempotencyKey:randomUUID()}});assert.equal(frozen.statusCode,200,frozen.body);const revision=frozen.json();
  await withBrowserApp(async(b,origin)=>{const ui=await binaryBrowserControls(b,origin,f.scope.caseId),downloads=join(b.root,'report-pdf-downloads');await mkdir(downloads);await b.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});await ui.click('Reports');const label='Create unredacted PDF '+revision.id.slice(0,8);await eventually(async()=>(await ui.text()).includes(label),'saved revision PDF control');
    await b.evaluate(`(()=>{const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).endsWith('/renditions')&&args[1]?.method==='POST'&&response.ok){window.fetch=original;window.__fictionalRenditionLost=true;throw new Error('Fictional committed rendition response lost');}return response;};})()`);await ui.click(label);await eventually(async()=>await b.evaluate<boolean>('window.__fictionalRenditionLost===true')&&await b.evaluate<boolean>(`[...document.querySelectorAll('button')].some(button=>button.textContent==='Recover pending PDF rendition')`),'lost PDF receipt');assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM report_renditions WHERE revision_id=$1',[revision.id])).rows[0].n,1);
    await b.send('Page.reload');await eventually(async()=>await b.evaluate<boolean>(`[...document.querySelectorAll('button')].some(button=>button.textContent==='Recover pending PDF rendition')`),'pending PDF after reload');await b.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent==='Recover pending PDF rendition');if(!button)throw new Error('recovery button absent');button.closest('details').open=true;})()`);await ui.click('Recover pending PDF rendition');await eventually(async()=>(await ui.text()).includes('Unredacted PDF bytes verified and downloaded.'),'verified PDF recovery');
    let name='';await eventually(async()=>{name=(await readdir(downloads)).find(value=>value.endsWith('.pdf'))??'';return Boolean(name);},'PDF file download');const path=join(downloads,name),bytes=await readFile(path),row=(await context.pool!.query('SELECT pdf_digest,source_report_digest FROM report_renditions WHERE revision_id=$1',[revision.id])).rows[0];assert.equal(createHash('sha256').update(bytes).digest('hex'),row.pdf_digest.trim());const verifier=fileURLToPath(new URL('../../../tools/verify_report_pdf.py',import.meta.url));await promisify(execFile)('python3',[verifier,path,'--expected-pdf-sha256',row.pdf_digest.trim(),'--expected-report-sha256',row.source_report_digest.trim()],{timeout:10000});
    await b.send('Page.reload');const historyLabel='Load saved PDFs '+revision.id.slice(0,8);
    await eventually(async()=>await b.evaluate<boolean>(`[...document.querySelectorAll('button')].some(button=>button.textContent===${JSON.stringify(historyLabel)})`),'saved PDF history control');
    await b.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent===${JSON.stringify(historyLabel)});button.closest('details').open=true;})()`);
    await ui.click(historyLabel);await eventually(async()=>(await ui.text()).includes('Saved PDF renditions loaded.'),'saved rendition list');
    const saved=(await context.pool!.query('SELECT id FROM report_renditions WHERE revision_id=$1',[revision.id])).rows[0];
    await ui.click('Download saved PDF '+saved.id.slice(0,8));await eventually(async()=>(await ui.text()).includes('Saved PDF verified and downloaded. No new rendition was created.'),'historical PDF verified');
    assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM report_renditions WHERE revision_id=$1',[revision.id])).rows[0].n,1);
    const html=`<style>html,body,embed{margin:0;width:100%;height:100%}</style><embed type="application/pdf" src="data:application/pdf;base64,${bytes.toString('base64')}">`;await b.send('Page.navigate',{url:'data:text/html;base64,'+Buffer.from(html).toString('base64')});await eventually(async()=>await b.evaluate<boolean>(`document.querySelector('embed')?.getBoundingClientRect().height>500`),'PDF embed surface');await b.evaluate('new Promise(resolve=>setTimeout(resolve,500))');const screenshot=await b.send<{data:string}>('Page.captureScreenshot',{format:'png'});assert.ok(Buffer.from(screenshot.data,'base64').length>5000);
  });
 }finally{await f.app.close();}
});
test('real browser verifies, recovers and releases an immutable document package to the client portal',{skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:90000},async()=>{
 const f=await documentReportFixture();try{
  const frozen=await request('POST',f.revisionsUrl,f.authorSession,{payload:{idempotencyKey:randomUUID()}});assert.equal(frozen.statusCode,200,frozen.body);const revision=frozen.json(),url=f.revisionsUrl+'/'+revision.id;
  const reviewed=await request('POST',url+'/reviews',context.demo!,{payload:{sha256:revision.sha256,decision:'accept_internal',reason:'Fictional browser release review of the exact frozen report.'}});assert.equal(reviewed.statusCode,200,reviewed.body);
  const recipientId=await createMember(demoTenantId,'client','Fictional browser document recipient'),clientSession=await issueTestSession(recipientId);let releaseRequested=false,releaseStatus=0;
  await withBrowserApp(async(b,origin)=>{
   const ui=await binaryBrowserControls(b,origin,f.scope.caseId),downloads=join(b.root,'document-release-downloads');await mkdir(downloads);await b.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});await ui.click('Reports');
   const packageLabel='Verify and download document package '+revision.id.slice(0,8);await eventually(async()=>(await ui.text()).includes(packageLabel),'saved document revision');await ui.click(packageLabel);
   const packageName='document-report-'+revision.id+'.json',packageField='Verified package SHA-256 '+revision.id;await eventually(async()=>/^[a-f0-9]{64}$/.test(await b.evaluate<string>(`document.querySelector('[aria-label="${packageField}"]')?.value||''`)),'verified package fingerprint');const packageSha256=await b.evaluate<string>(`document.querySelector('[aria-label="${packageField}"]').value`);await eventually(async()=>{try{return createHash('sha256').update(await readFile(join(downloads,packageName))).digest('hex')===packageSha256;}catch{return false;}},'complete verified browser package');const packageBytes=await readFile(join(downloads,packageName));
   const verifier=fileURLToPath(new URL('../../../tools/verify_document_package.py',import.meta.url));await promisify(execFile)('python3',[verifier,join(downloads,packageName),'--expected-report-sha256',revision.sha256,'--expected-package-sha256',packageSha256],{timeout:10000});
   await b.send('Page.reload');await eventually(async()=>await b.evaluate<string>(`document.querySelector('[aria-label="${packageField}"]')?.value||''`)===packageSha256,'verified package receipt after reload');
   const expiresAt=new Date(Date.now()+3600000).toISOString();await b.evaluate(`(()=>{const rows=[...document.querySelectorAll('li')],row=rows.find(x=>x.textContent.includes(${JSON.stringify(revision.id)}));if(!row)throw new Error('revision row absent');const forms=[...row.querySelectorAll('form')],form=forms.find(x=>x.textContent.includes('Client recipient UUID'));if(!form)throw new Error('release form absent');form.closest('details').open=true;for(const [name,value] of Object.entries({recipientId:${JSON.stringify(recipientId)},expiresAt:${JSON.stringify(expiresAt)},reason:'Fictional browser verified package release.'})){const field=form.elements.namedItem(name);Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));}form.querySelector('input[type=checkbox]').click();if(!form.checkValidity())throw new Error('release form invalid');})()`);
   await b.evaluate(`(()=>{const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).endsWith('/disclosures')&&args[1]?.method==='POST'&&response.ok){window.fetch=original;window.__fictionalDocumentReleaseLost=true;throw new Error('Fictional committed document release response lost');}return response;};})()`);const releaseStarted=Date.now();await ui.click('Create restricted release');await eventually(async()=>{const lost=await b.evaluate<boolean>('window.__fictionalDocumentReleaseLost===true');if(lost)return await b.evaluate<boolean>(`[...document.querySelectorAll('button')].some(button=>button.textContent==='Recover pending release')`);const error=await b.evaluate<string>("document.querySelector('.form-error')?.textContent||''");if(error)throw new Error('Document release before response loss failed: '+error);if(Date.now()-releaseStarted>2000)throw new Error(`Document release loss hook missed request=${releaseRequested} status=${releaseStatus}`);return false;},'lost release response');await b.send('Page.reload');await eventually(async()=>await b.evaluate<boolean>(`[...document.querySelectorAll('button')].some(button=>button.textContent==='Recover pending release')`)&&await b.evaluate<string>(`document.querySelector('[aria-label="${packageField}"]')?.value||''`)===packageSha256,'pending release after reload');await b.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent==='Recover pending release');const details=button?.closest('details');if(!details)throw new Error('recovery controls absent');details.open=true;})()`);await ui.click('Recover pending release');await eventually(async()=>(await ui.text()).includes('Restricted document package release created.'),'release recovery receipt');
   const grant=(await context.pool!.query('SELECT d.id,p.package_digest FROM report_disclosures d JOIN report_disclosure_packages p ON p.tenant_id=d.tenant_id AND p.disclosure_id=d.id WHERE d.case_id=$1',[f.scope.caseId])).rows[0];assert.equal(grant.package_digest.trim(),packageSha256);
   await b.send('Network.enable');for(const pair of clientSession.cookie.split('; ')){const split=pair.indexOf('=');await b.send('Network.setCookie',{name:pair.slice(0,split),value:pair.slice(split+1),url:origin,path:'/',sameSite:'Strict',httpOnly:pair.startsWith('inveos_session=')});}
   await b.send('Page.navigate',{url:origin+'/portal'});await eventually(async()=>(await ui.text()).includes('Refresh disclosures'),'client portal');await ui.click('Refresh disclosures');await eventually(async()=>(await ui.text()).includes(grant.id)&&(await ui.text()).includes('document provenance package'),'document grant');await ui.click('Verify and download snapshot');
   const clientName='disclosure-'+grant.id+'.json';await eventually(async()=>(await readdir(downloads)).includes(clientName),'client package download');assert.deepEqual(await readFile(join(downloads,clientName)),packageBytes);
  },{request:(path,method)=>{if(method==='POST'&&path.endsWith('/disclosures'))releaseRequested=true;},response:(path,status)=>{if(path.endsWith('/disclosures'))releaseStatus=status;return undefined;}});
 }finally{await f.app.close();}
});
test('document-derived claims persist independent accepted findings with idempotent retries and immutable records',async()=>{
 const f=await documentClaimFixture();try{
  const proposed=await Promise.all([1,2].map(()=>request('POST',f.claimUrl,f.authorSession,{payload:f.claimInput})));for(const r of proposed)assert.equal(r.statusCode,200,r.body);assert.deepEqual(proposed[0]!.json(),proposed[1]!.json());const claim=proposed[0]!.json().claims[0];assert.equal(claim.status,'proposed_interpretation');assert.equal(claim.decision,null);assert.equal(claim.finding,null);
  const decision={id:randomUUID(),claimDigest:claim.digest,accepted:true,reason:'Fictional interpretation independently assessed against the accepted correspondence.'},decisionUrl=`${f.claimUrl}/${claim.id}/decision`;
  const decided=await Promise.all([1,2].map(()=>request('POST',decisionUrl,context.demo!,{payload:decision})));for(const r of decided)assert.equal(r.statusCode,200,r.body);assert.deepEqual(decided[0]!.json(),decided[1]!.json());assert.equal(decided[0]!.json().finding.text,f.claimInput.text);
  const saved=(await request('GET',f.claimUrl,context.demo!)).json();assert.equal(saved.claims[0].decision.accepted,true);assert.equal(saved.claims[0].finding.id,decision.id);
  assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM document_findings WHERE case_id=$1',[f.scope.caseId])).rows[0].n,1);assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM findings WHERE case_id=$1',[f.scope.caseId])).rows[0].n,0);
  await context.app!.close();context.app=await createAppInstance();assert.deepEqual((await request('GET',f.claimUrl,context.demo!)).json(),saved);
  for(const [sql,id] of [['UPDATE document_claims SET text=text WHERE id=$1',claim.id],['DELETE FROM document_claims WHERE id=$1',claim.id],['UPDATE document_claim_decisions SET reason=reason WHERE id=$1',decision.id],['DELETE FROM document_claim_decisions WHERE id=$1',decision.id],['UPDATE document_findings SET text=text WHERE id=$1',decision.id],['DELETE FROM document_findings WHERE id=$1',decision.id]] as const)await assert.rejects(context.schemaAdminPool!.query(sql,[id]),/immutable|append.only/i);
 }finally{await f.app.close();}
});
test('document-derived claims require current accepted correspondence, scope, authority and an independent reviewer',async()=>{
 const f=await citationReviewFixture();try{
  const claimUrl=f.citationUrl+'/claims',blank={id:randomUUID(),citationDigest:f.candidate.citationDigest,correspondenceReviewId:f.reviewInput.id,correspondenceReviewDigest:'0'.repeat(64),text:'Fictional pending interpretation.'};assertError(await request('POST',claimUrl,f.authorSession,{payload:blank}),409);
  const accepted=(await request('POST',f.reviewUrl,context.demo!,{payload:f.reviewInput})).json().reviews[0],input={...blank,correspondenceReviewDigest:accepted.digest};const proposed=await request('POST',claimUrl,context.demo!,{payload:input});assert.equal(proposed.statusCode,200,proposed.body);const claim=proposed.json().claims[0],decision={id:randomUUID(),claimDigest:claim.digest,accepted:true,reason:'Fictional self decision denied.'};
  assertError(await request('POST',`${claimUrl}/${claim.id}/decision`,context.demo!,{payload:decision}),403);
  const investigator=await createMember(demoTenantId,'investigator','Fictional denied claim reviewer');await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,f.scope.caseId,investigator]);assertError(await request('POST',`${claimUrl}/${claim.id}/decision`,await issueTestSession(investigator),{payload:decision}),403);
  const client=await createMember(demoTenantId,'client','Fictional document finding recipient');assertError(await request('GET',claimUrl,await issueTestSession(client)),403);
  const outsider=await createMember(demoTenantId,'reviewer','Fictional unrelated document finding reviewer');assertError(await request('GET',claimUrl,await issueTestSession(outsider)),404);
  const replacement={...f.reviewInput,id:randomUUID(),previousReviewId:accepted.id,decision:'rejected',reason:'Fictional replacement correspondence rejection.',originalCompared:false};assert.equal((await request('POST',f.reviewUrl,context.demo!,{payload:replacement})).statusCode,200);
  const reviewer=await createMember(demoTenantId,'reviewer','Fictional independent document finding reviewer');await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,f.scope.caseId,reviewer]);assertError(await request('POST',`${claimUrl}/${claim.id}/decision`,await issueTestSession(reviewer),{payload:decision}),409);
  await approveAuthority(f.scope.caseId);assertError(await request('POST',claimUrl,f.authorSession,{payload:{...input,id:randomUUID()}}),409);
 }finally{await f.app.close();}
});
test('document finding audit rollback and stored claim or original tampering fail closed',async()=>{
 const f=await documentClaimFixture();try{
  const proposed=await request('POST',f.claimUrl,f.authorSession,{payload:f.claimInput});assert.equal(proposed.statusCode,200,proposed.body);const claim=proposed.json().claims[0],decision={id:randomUUID(),claimDigest:claim.digest,accepted:true,reason:'Fictional independently accepted interpretation.'},url=`${f.claimUrl}/${claim.id}/decision`;
  await context.schemaAdminPool!.query("CREATE FUNCTION deny_document_finding_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='document_claim.accepted' THEN RAISE EXCEPTION 'fictional document finding audit failure'; END IF; RETURN NEW; END $$");await context.schemaAdminPool!.query('CREATE TRIGGER deny_document_finding_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_document_finding_audit()');
  try{assertError(await request('POST',url,context.demo!,{payload:decision}),500);assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM document_claim_decisions WHERE claim_id=$1',[claim.id])).rows[0].n,0);assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM document_findings WHERE claim_id=$1',[claim.id])).rows[0].n,0);}
  finally{await context.schemaAdminPool!.query('DROP TRIGGER deny_document_finding_audit ON audit_events');await context.schemaAdminPool!.query('DROP FUNCTION deny_document_finding_audit()');}
  assert.equal((await request('POST',url,context.demo!,{payload:decision})).statusCode,200);assertError(await request('POST',url,context.demo!,{payload:{...decision,reason:'Conflicting fictional reason'}}),409);
  const old=(await context.pool!.query('SELECT claim_bytes FROM document_claims WHERE id=$1',[claim.id])).rows[0].claim_bytes;await context.schemaAdminPool!.query('ALTER TABLE document_claims DISABLE TRIGGER document_claims_append_only');
  try{await context.schemaAdminPool!.query('UPDATE document_claims SET claim_bytes=$2 WHERE id=$1',[claim.id,Buffer.from('{}')]);assertError(await request('GET',f.claimUrl,context.demo!),409);await context.schemaAdminPool!.query('UPDATE document_claims SET claim_bytes=$2 WHERE id=$1',[claim.id,old]);}
  finally{await context.schemaAdminPool!.query('ALTER TABLE document_claims ENABLE TRIGGER document_claims_append_only');}
  const evidence=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[f.job.evidenceId])).rows[0];await writeFile(resolve(context.storageRoot!,evidence.object_path),'Fictional corrupted document finding source');assertError(await request('GET',f.claimUrl,context.demo!),409);
 }finally{await f.app.close();}
});
test('real browser independently accepts a document-derived finding and recovers a committed lost response',{skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:90000},async()=>{
 const f=await documentClaimFixture();try{const proposed=await request('POST',f.claimUrl,f.authorSession,{payload:f.claimInput});assert.equal(proposed.statusCode,200,proposed.body);const claim=proposed.json().claims[0];await withBrowserApp(async(b,origin)=>{
  const ui=await binaryBrowserControls(b,origin,f.scope.caseId),inspect='Inspect unreviewed pages '+f.job.id.slice(0,8),review='Review candidate '+f.candidate.id.slice(0,8),choose='Review interpretation '+claim.id.slice(0,8);
  await eventually(async()=>(await ui.text()).includes(inspect),'document finding inspection');await ui.click(inspect);await eventually(async()=>(await ui.text()).includes(review),'document finding candidate');await ui.click(review);await eventually(async()=>await b.evaluate<boolean>(`Boolean([...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(choose)}&&!b.disabled))`),'verified proposed interpretation');await ui.click(choose);await eventually(async()=>await b.evaluate<boolean>(`Boolean(document.querySelector('form[aria-label="Document claim decision"]'))`),'document finding decision form');
  await b.evaluate(`(()=>{const p=document.querySelector('form[aria-label="Document claim decision"]'),t=p.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Fictional interpretation independently accepted in browser.');t.dispatchEvent(new Event('input',{bubbles:true}));p.querySelector('input[type=checkbox]').click();const original=window.fetch;window.fetch=async(...args)=>{const r=await original(...args);if(String(args[0]).endsWith('/decision')&&args[1]?.method==='POST'&&r.ok){window.fetch=original;throw new Error('Fictional lost claim decision response');}return r;};})()`);
  await ui.click('Record claim decision');await eventually(async()=>await b.evaluate<boolean>(`Boolean([...document.querySelectorAll('button')].find(b=>b.textContent==='Recover pending claim decision'&&!b.disabled))`)&&(await ui.text()).includes('Fictional lost claim decision response'),'unconfirmed finding decision');await ui.click('Recover pending claim decision');await eventually(async()=>(await ui.text()).includes('Accepted document finding'),'recovered accepted finding');
  await b.send('Page.reload');await eventually(async()=>(await ui.text()).includes(inspect),'reloaded document finding case');await ui.click(inspect);await eventually(async()=>(await ui.text()).includes(review),'reloaded document finding candidate');await ui.click(review);await eventually(async()=>(await ui.text()).includes('Accepted document finding'),'persisted accepted document finding');
  assert.ok((await ui.text()).includes(f.claimInput.text));assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM document_findings WHERE claim_id=$1',[claim.id])).rows[0].n,1);
 });}finally{await f.app.close();}
});

// Uses fabricated parser boundary fixtures; actual OCR reasoning is exercised by ocr-worker.integration.ts.
async function documentReasoningFixture(){
 const f=await documentReportFixture(),question=parseBody<WorkItem>(await createWork(f.scope.caseId));
 const hypothesis=parseBody<WorkItem>(await createWork(f.scope.caseId,workInput({kind:'hypothesis',parentId:question.id,title:'Fictional ownership changed between records'})));
 const base=`/api/cases/${f.scope.caseId}/work`,link={id:randomUUID(),findingId:f.decision.id,relation:'supports',reason:'Fictional reviewed statement supports this working explanation, without proving it.'};
 return {...f,question,hypothesis,base,link,url:`${base}/${hypothesis.id}/document-links`};
}
test('document reasoning links preserve typed identity, assessment source history and independent frozen package joins',async()=>{
 const f=await documentReasoningFixture();try{
  const responses=await Promise.all([1,2].map(()=>request('POST',f.url,context.demo!,{payload:f.link})));for(const r of responses)assert.equal(r.statusCode,200,r.body);assert.deepEqual(responses[0]!.json(),responses[1]!.json());assert.equal(responses[0]!.json().kind,'document_finding');assert.equal(responses[0]!.json().claimId,undefined);
  assertError(await request('POST',f.url,context.demo!,{payload:{...f.link,reason:'Changed retry'}}),409);
  const candidates=await request('GET',f.base+'/document-findings',context.demo!);assert.equal(candidates.statusCode,200);assert.equal(candidates.json().items[0].id,f.decision.id);
  const inspected=await request('GET',f.base+'/document-findings/'+f.decision.id,context.demo!);assert.equal(inspected.statusCode,200,inspected.body);assert.equal(inspected.json().reference.citationDigest,f.candidate.citationDigest);
  const assessed=await reviseWork(f.hypothesis,workEdit(f.hypothesis,{status:'Supported'}));assert.equal(assessed.statusCode,200,assessed.body);
  const history=(await request('GET',`${f.base}/${f.hypothesis.id}/history`,context.demo!)).json();assert.deepEqual(history[1].sources,[]);assert.equal(history[0].sources[0].findingId,f.decision.id);
  assert.equal((await reviseWork(f.question,workEdit(f.question,{status:'Resolved',reason:'Fictional supplied records differ; explanation remains uncertain and further collection is outside scope.'}))).statusCode,200);
  const frozen=await request('POST',f.revisionsUrl,context.demo!,{payload:{idempotencyKey:randomUUID()}});assert.equal(frozen.statusCode,200,frozen.body);const url=f.revisionsUrl+'/'+frozen.json().id;
  const report=(await request('GET',url,context.demo!)).json();assert.equal(report.investigation.documentLinks[0].findingId,f.decision.id);
  const packaged=await request('GET',url+'/document-package',context.demo!);assert.equal(packaged.statusCode,200,packaged.body);const file=join(context.storageRoot!,'fictional-reasoning-package.json');await writeFile(file,packaged.rawPayload);
  const verified=await promisify(execFile)('python3',[fileURLToPath(new URL('../../../tools/verify_document_package.py',import.meta.url)),file]);assert.equal(JSON.parse(verified.stdout).documentWorkLinksChecked,1);
  await context.app!.close();context.app=await createAppInstance();const workspace=parseBody<Workspace>(await request('GET','/api/workspace',context.demo!));assert.equal(workspace.workLinks.filter(l=>l.id===f.link.id).length,1);
  const withdrawn=await request('POST',f.url+'/'+f.link.id+'/withdraw',context.demo!,{payload:{reason:'Fictional withdrawal before a delayed duplicate save.'}});assert.equal(withdrawn.statusCode,200,withdrawn.body);
  const retried=await request('POST',f.url,context.demo!,{payload:f.link});assert.equal(retried.statusCode,200,retried.body);
  const afterWithdrawal=parseBody<Workspace>(await request('GET','/api/workspace',context.demo!));assert.deepEqual(retried.json(),afterWithdrawal.workLinks.find(l=>l.id===f.link.id));assert.deepEqual(retried.json().withdrawal,withdrawn.json());
  await assert.rejects(context.schemaAdminPool!.query('DELETE FROM case_work_links WHERE id=$1',[f.link.id]),/append.only/i);
 }finally{await f.app.close();}
});
test('document reasoning rejects foreign scope, stale correspondence, revoked reviewers and changed authority',async()=>{
 const f=await documentReasoningFixture();try{
  const outsider=await issueTestSession(await createMember(demoTenantId,'reviewer','Fictional reasoning outsider')),client=await issueTestSession(await createMember(demoTenantId,'client','Fictional reasoning client'));
  for(const path of [f.base+'/document-findings',f.base+'/document-findings/'+f.decision.id]){assertError(await request('GET',path,outsider),404);assertError(await request('GET',path,client),403);}
  assertError(await request('POST',f.url,outsider,{payload:f.link}),404);assertError(await request('POST',f.url,client,{payload:f.link}),403);
  const other=await createCase(),q=parseBody<WorkItem>(await createWork(other.id));assertError(await request('POST',`/api/cases/${other.id}/work/${q.id}/document-links`,context.demo!,{payload:f.link}),404);
  const linked=await request('POST',f.url,context.demo!,{payload:f.link});assert.equal(linked.statusCode,200,linked.body);
  await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,f.scope.caseId,demoUserId]);
  assertError(await request('GET',f.base+'/document-findings/'+f.decision.id,f.authorSession),409);
  await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,f.scope.caseId,demoUserId]);
  const replacement={...f.reviewInput,id:randomUUID(),previousReviewId:f.reviewInput.id,decision:'rejected',reason:'Fictional corrected comparison.',originalCompared:false};assert.equal((await request('POST',f.reviewUrl,context.demo!,{payload:replacement})).statusCode,200);
  assertError(await request('POST',f.url,context.demo!,{payload:f.link}),409);assertError(await reviseWork(f.hypothesis,workEdit(f.hypothesis,{status:'Supported'})),409);assertError(await reviseWork(f.question,workEdit(f.question,{status:'Resolved'})),409);
  const withdraw=f.url+'/'+f.link.id+'/withdraw',payload={reason:'Fictional correction: withdraw superseded source and retain history.'};assert.equal((await request('POST',withdraw,context.demo!,{payload})).statusCode,200);assert.equal((await request('POST',withdraw,context.demo!,{payload})).statusCode,200);
  assertError(await reviseWork(f.hypothesis,workEdit(f.hypothesis,{status:'Supported'})),422);
  assert.equal((await reviseWork(f.question,workEdit(f.question,{status:'Resolved',reason:'Scope closed with no current support; no ownership or wrongdoing conclusion.'}))).statusCode,200);
  const workspace=(await request('GET','/api/workspace',context.demo!)).json();assert.equal(workspace.workLinks.find((l:{id:string})=>l.id===f.link.id).withdrawal.reason,payload.reason);
  await assert.rejects(context.schemaAdminPool!.query('DELETE FROM case_work_link_withdrawals WHERE link_id=$1',[f.link.id]),/append.only/i);
 }finally{await f.app.close();}
 const g=await documentReasoningFixture();try{await approveAuthority(g.scope.caseId);assertError(await request('POST',g.url,context.demo!,{payload:g.link}),409);}finally{await g.app.close();}
});
test('document source links and withdrawals roll back on audit failure; context alone cannot support a hypothesis',async()=>{
 const f=await documentReasoningFixture();try{
  await context.schemaAdminPool!.query("CREATE FUNCTION deny_reasoning_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('work.document_source_linked','work.document_source_withdrawn') THEN RAISE EXCEPTION 'fictional audit failure'; END IF; RETURN NEW; END $$");await context.schemaAdminPool!.query('CREATE TRIGGER deny_reasoning_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_reasoning_audit()');
  try{assertError(await request('POST',f.url,context.demo!,{payload:f.link}),500);assert.equal((await context.pool!.query('SELECT count(*)::int n FROM case_work_links WHERE id=$1',[f.link.id])).rows[0].n,0);}finally{await context.schemaAdminPool!.query('DROP TRIGGER deny_reasoning_audit ON audit_events');}
  assert.equal((await request('POST',f.url,context.demo!,{payload:{...f.link,relation:'context'}})).statusCode,200);assertError(await reviseWork(f.hypothesis,workEdit(f.hypothesis,{status:'Supported'})),422);
  await context.schemaAdminPool!.query('CREATE TRIGGER deny_reasoning_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_reasoning_audit()');
  try{assertError(await request('POST',f.url+'/'+f.link.id+'/withdraw',context.demo!,{payload:{reason:'Fictional withdrawal'}}),500);assert.equal((await context.pool!.query('SELECT count(*)::int n FROM case_work_link_withdrawals WHERE link_id=$1',[f.link.id])).rows[0].n,0);}finally{await context.schemaAdminPool!.query('DROP TRIGGER deny_reasoning_audit ON audit_events');await context.schemaAdminPool!.query('DROP FUNCTION deny_reasoning_audit()');}
  const evidence=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[f.job.evidenceId])).rows[0];await writeFile(resolve(context.storageRoot!,evidence.object_path),'Fictional altered source');assertError(await request('GET',f.base+'/document-findings/'+f.decision.id,context.demo!),409);
 }finally{await f.app.close();}
});
test('real browser links and reinspects document reasoning, reloads decisions and withdraws without deleting history',{skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:90000},async()=>{
 const f=await documentReasoningFixture();try{await withBrowserApp(async(b,origin)=>{
  const ui=await binaryBrowserControls(b,origin,f.scope.caseId);await ui.click('Brief');await eventually(async()=>(await ui.text()).includes(f.hypothesis.title),'reasoning hypothesis displayed');
  const selector='#work-'+f.hypothesis.id;
  const openMaterial=async()=>{await b.evaluate(`document.querySelector(${JSON.stringify(selector)}+' details.work-detail').open=true`);};await openMaterial();
  const click=async(label:string)=>{await b.evaluate(`(()=>{const root=document.querySelector(${JSON.stringify(selector)}),button=[...root.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)});if(!button||button.disabled)throw new Error('Reasoning button unavailable');button.click();})()`);};
  await click('Choose a reviewed document finding');await eventually(async()=>await b.evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(selector)}+' form[aria-label="Link reviewed document finding"] option[value="${f.decision.id}"]'))`),'document finding candidates');
  await b.evaluate(`(()=>{const select=document.querySelector(${JSON.stringify(selector)}+' form[aria-label="Link reviewed document finding"] select');select.value=${JSON.stringify(f.decision.id)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);await click('Inspect selected document finding');await eventually(async()=>(await ui.text()).includes('Exact extraction location'),'verified in-context document passage');assert.ok((await ui.text()).includes(f.candidate.citation.quote));
  await b.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)}+' textarea[name="reason"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Fictional browser source relevance retains uncertainty.');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await click('Save document source link');await eventually(async()=>(await ui.text()).includes('Reviewed document source linked.'),'persisted document reasoning link');
  const link=(await context.pool!.query('SELECT * FROM case_work_links WHERE case_id=$1 AND item_id=$2',[f.scope.caseId,f.hypothesis.id])).rows[0];assert.ok(link);assert.equal((await reviseWork(f.hypothesis,workEdit(f.hypothesis,{status:'Supported'}))).statusCode,200);
  const previous=await b.evaluate<number>('performance.timeOrigin');await b.send('Page.reload');await eventually(async()=>await b.evaluate<number>('performance.timeOrigin')!==previous&&(await ui.text()).includes(f.hypothesis.title),'fresh reasoning reload');await openMaterial();await click('Inspect document finding '+f.decision.id.slice(0,8));await eventually(async()=>(await ui.text()).includes('Exact extraction location'),'reloaded in-context finding');
  await click('History');await eventually(async()=>(await ui.text()).includes('Version 2'),'assessment history');assert.ok(await b.evaluate<boolean>(`document.querySelector(${JSON.stringify(selector)}+' [aria-label="Sources at this revision"]').textContent.includes(${JSON.stringify(f.decision.id)})`));
  await click('Withdraw source link '+link.id.slice(0,8));await b.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)}+' form[aria-label="Withdraw document source link"] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Fictional withdraw from active reasoning after reassessment.');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await click('Record source withdrawal');await eventually(async()=>(await ui.text()).includes('Withdrawn · Supporting material'),'visible withdrawal with preserved original link');
  assertError(await reviseWork({...f.hypothesis,version:2},workEdit({...f.hypothesis,version:2},{status:'Supported'})),422);
 });}finally{await f.app.close();}
});

async function chronologyFixture(){
 const f=await reportFixture(),report=JSON.parse((await request('GET',`/api/cases/${f.kase.id}/report`,context.demo!)).body) as ReportDraft;
 const input={id:randomUUID(),title:'Fictional disputed packing date',account:'The fictional source alleges a packing event; corroboration remains open.',status:'disputed',source:{kind:'text_finding',findingId:report.findings[0]!.id},time:{precision:'month',start:'2026-01',end:null,timezone:'',note:'The alleged account only establishes a calendar month, not an instant.'}};
 return {...f,input,base:`/api/cases/${f.kase.id}/chronology`};
}

test('chronology preserves uncertain competing accounts, immutable corrections and independently verified frozen exports',async()=>{
 const f=await chronologyFixture(),post=await request('POST',f.base,context.demo!,{payload:f.input});assert.equal(post.statusCode,200,post.body);const event=JSON.parse(post.body);
 assert.equal(event.interpretation,'recorded_account_not_finding');assert.deepEqual(event.time,f.input.time);
 const unknown={...f.input,id:randomUUID(),title:'Fictional competing undated account',time:{...f.input.time,precision:'unknown',start:null}};
 assert.equal((await request('POST',f.base,context.demo!,{payload:unknown})).statusCode,200);
 const list=JSON.parse((await request('GET',f.base,context.demo!)).body);assert.equal(list.order,'recorded_order_not_event_sequence');assert.deepEqual(list.items.map((e:{time:{precision:string}})=>e.time.precision),['month','unknown']);
 const source=JSON.parse((await request('GET',f.base+'/'+event.id+'/source',context.demo!)).body);assert.equal(source.source.sourceTime,f.evidence.sourceTime);assert.equal(source.source.receivedTime,f.evidence.receivedTime);assert.equal(source.source.quote.includes('2026-01-12'),true);
 const receipt=JSON.parse((await request('POST',f.url,context.demo!,{payload:{idempotencyKey:randomUUID()}})).body),frozen=await request('GET',f.url+'/'+receipt.id,context.demo!);assert.equal(frozen.statusCode,200,frozen.body);
 const {id:omit,...fields}=f.input;assert.ok(omit);
 const edit={...fields,expectedVersion:1,status:'withdrawn',reason:'Fictional correction retains the original account.'};
 const revised=await request('POST',f.base+'/'+event.id+'/revise',context.demo!,{payload:edit});assert.equal(revised.statusCode,200,revised.body);assert.equal(JSON.parse(revised.body).version,2);
 assertError(await request('POST',f.base+'/'+event.id+'/revise',context.demo!,{payload:edit}),409);
 assert.equal(JSON.parse((await request('POST',f.base,context.demo!,{payload:f.input})).body).status,'withdrawn');
 const history=JSON.parse((await request('GET',f.base+'/'+event.id+'/history',context.demo!)).body);assert.deepEqual(history.map((r:{event:{version:number}})=>r.event.version),[2,1]);assert.equal(history[1].event.status,'disputed');
 await assert.rejects(context.schemaAdminPool!.query('UPDATE chronology_revisions SET reason=$1 WHERE event_id=$2',['Changed',event.id]),/append.only|immutable/i);
 await context.app!.close();context.app=await createAppInstance();assert.equal((await request('GET',f.url+'/'+receipt.id,context.demo!)).body,frozen.body);
 const file=join(context.storageRoot!,'fictional-chronology.json');await writeFile(file,frozen.body);
 const verifier=fileURLToPath(new URL('../../../tools/verify_report.py',import.meta.url));
 const result=await promisify(execFile)('python3',[verifier,file,'--expected-sha256',receipt.sha256]);assert.equal(JSON.parse(result.stdout).chronologyEventsChecked,2);
 const changed=JSON.parse(frozen.body);changed.investigation.chronology[0].source.findingId=randomUUID();await writeFile(file,JSON.stringify(changed));await assert.rejects(promisify(execFile)('python3',[verifier,file]));
 const audit=await context.pool!.query("SELECT count(*)::int n FROM audit_events WHERE case_id=$1 AND action LIKE 'chronology.%'",[f.kase.id]);assert.equal(audit.rows[0].n,3);
});

test('chronology denies missing CSRF, other cases, client roles, revoked access, stale authority and corrupted sources',async()=>{
 const f=await chronologyFixture();assertError(await request('POST',f.base,context.demo!,{payload:f.input,csrfHeader:false}),403);
 const outsider=await createMember(demoTenantId,'investigator','Fictional chronology outsider'),session=await issueTestSession(outsider);
 assertError(await request('GET',f.base,session),404);assertError(await request('POST',f.base,session,{payload:f.input}),404);
 const tenant=randomUUID();await context.schemaAdminPool!.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenant,'Fictional chronology foreign agency']);const foreignId=await createMember(tenant,'reviewer','Fictional chronology foreign reviewer'),foreign=await issueTestSession(foreignId,tenant);
 for(const suffix of ['', '/sources','/'+f.input.id+'/history','/'+f.input.id+'/source'])assertError(await request('GET',f.base+suffix,foreign),404);
 assertError(await request('POST',f.base,foreign,{payload:f.input}),404);
 const other=await createCase();await approveAuthority(other.id);const bad=await request('POST',`/api/cases/${other.id}/chronology`,context.demo!,{payload:f.input});assert.ok([404,422].includes(bad.statusCode),bad.body);
 const client=await createMember(demoTenantId,'client','Fictional chronology client');await context.schemaAdminPool!.query('INSERT INTO case_memberships VALUES($1,$2,$3)',[demoTenantId,f.kase.id,client]);const cs=await issueTestSession(client);assertError(await request('GET',f.base,cs),403);assertError(await request('POST',f.base,cs,{payload:f.input}),403);
 const saved=await request('POST',f.base,context.demo!,{payload:f.input});assert.equal(saved.statusCode,200,saved.body);
 const original=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[f.evidence.id])).rows[0];await writeFile(resolve(context.storageRoot!,original.object_path),'Fictional damaged source');
 assertError(await request('GET',f.base+'/'+f.input.id+'/source',context.demo!),409);assertError(await request('POST',f.base,context.demo!,{payload:{...f.input,id:randomUUID()}}),409);
 const {id,...fields}=f.input;assert.equal((await request('POST',f.base+'/'+id+'/revise',context.demo!,{payload:{...fields,status:'withdrawn',expectedVersion:1,reason:'Source unavailable; retain the historical record.'}})).statusCode,200);
 await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,f.kase.id,demoUserId]);
 for(const suffix of ['', '/'+id+'/history','/'+id+'/source','/sources'])assertError(await request('GET',f.base+suffix,context.demo!),404);
 const fresh=await chronologyFixture();await approveAuthority(fresh.kase.id);assertError(await request('POST',fresh.base,context.demo!,{payload:fresh.input}),409);
});

test('chronology document sources freeze into independently checked derivative packages and reject withdrawn correspondence',async()=>{
 const f=await documentReportFixture();try{
  const base=`/api/cases/${f.scope.caseId}/chronology`,input={id:randomUUID(),title:'Fictional document account',account:'A fictional derived passage alleges an event; not an established fact.',status:'alleged',source:{kind:'document_finding',findingId:f.decision.id},time:{precision:'range',start:'2026-10-25T01:30:00+01:00',end:'2026-10-25T01:00:00Z',timezone:'Original offsets retained',note:'Overlapping clocks across the stated offset transition.'}};
  const save=await request('POST',base,context.demo!,{payload:input});assert.equal(save.statusCode,200,save.body);
  const frozen=await request('POST',f.revisionsUrl,context.demo!,{payload:{idempotencyKey:randomUUID()}});assert.equal(frozen.statusCode,200,frozen.body);const receipt=frozen.json();
  const exported=await request('GET',`${f.revisionsUrl}/${receipt.id}/document-package`,context.demo!);assert.equal(exported.statusCode,200,exported.body);
  const path=join(context.storageRoot!,'fictional-chronology-document-package.json'),verifier=fileURLToPath(new URL('../../../tools/verify_document_package.py',import.meta.url));await writeFile(path,exported.body);
  const checked=await promisify(execFile)('python3',[verifier,path,'--expected-report-sha256',receipt.sha256]);assert.equal(JSON.parse(checked.stdout).chronologyEventsChecked,1);
  const replacement={...f.reviewInput,id:randomUUID(),previousReviewId:f.reviewInput.id,decision:'rejected',reason:'Fictional chronology source comparison withdrawn.',originalCompared:false};assert.equal((await request('POST',f.reviewUrl,context.demo!,{payload:replacement})).statusCode,200);
  assertError(await request('GET',base+'/'+input.id+'/source',context.demo!),409);
  assertError(await request('POST',base,context.demo!,{payload:{...input,id:randomUUID()}}),409);
  assert.equal(JSON.parse((await promisify(execFile)('python3',[verifier,path])).stdout).chronologyEventsChecked,1);
 }finally{await f.app.close();}
});

test('chronology validates precision through the actual API and rolls back mutations if audit storage fails',async()=>{
 const f=await chronologyFixture();
 const valid=[['unknown',null,null],['day','2024-02-29',null],['day','2026-10-25',null],['month','2026-01',null],['instant','2026-10-25T01:30:00+01:00',null],['instant','2026-10-25T01:30:00+00:00',null],['range','2026-10-25T01:30:00+01:00','2026-10-25T01:00:00Z']];
 const invalid=[['unknown','2026-01',null],['day','2026-02-29',null],['day','2026-04-31',null],['day','2026-01-01T00:00:00Z',null],['month','2026-1',null],['month','2026-13',null],['instant','2026-01-01T12:00:00',null],['instant','2026-01-01T24:00:00Z',null],['instant','2026-01-01T12:00:00-00:00',null],['instant','2026-01-01T12:00:00+14:01',null],['range','2026-10-25T01:30:00Z','2026-10-25T01:45:00+01:00'],['range','2026-01-01',null]];
 for(const [allowed,cases] of [[true,valid],[false,invalid]] as const)for(const [precision,start,end] of cases){const response=await request('POST',f.base,context.demo!,{payload:{...f.input,id:randomUUID(),time:{...f.input.time,precision,start,end}}});assert.equal(response.statusCode,allowed?200:422,response.body);}
 await context.schemaAdminPool!.query("CREATE FUNCTION deny_chronology_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'chronology.%' THEN RAISE EXCEPTION 'fictional audit failure'; END IF; RETURN NEW; END $$");await context.schemaAdminPool!.query('CREATE TRIGGER deny_chronology_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_chronology_audit()');
 try{assertError(await request('POST',f.base,context.demo!,{payload:f.input}),500);assert.equal((await context.pool!.query('SELECT count(*)::int n FROM chronology_events WHERE id=$1',[f.input.id])).rows[0].n,0);}finally{await context.schemaAdminPool!.query('DROP TRIGGER deny_chronology_audit ON audit_events');await context.schemaAdminPool!.query('DROP FUNCTION deny_chronology_audit()');}
});

test('real browser records uncertain chronology, corrects it, reloads history and inspects the source',{skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:90000},async()=>{
 const f=await chronologyFixture();await withBrowserApp(async(b,origin)=>{
  const ui=await binaryBrowserControls(b,origin,f.kase.id);await ui.click('Timeline');await eventually(async()=>(await ui.text()).includes('Record an alleged event'),'chronology screen');await ui.click('Record an alleged event');
  await eventually(async()=>await b.evaluate<boolean>('Boolean(document.querySelector(\'form[aria-label="Chronology account"]\'))'),'chronology form');
  const fill=async(values:Record<string,string>)=>{await b.evaluate(`(()=>{const form=document.querySelector('form[aria-label="Chronology account"]');for(const [name,value] of Object.entries(${JSON.stringify(values)})){const input=form.elements.namedItem(name);input.value=value;input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));}})()`);};
  const title='Fictional uncertain browser event';await fill({title,account:'Fictional account pending corroboration.',status:'disputed',precision:'month',start:'2026-01',end:'',timezone:'',note:'Only the calendar month was stated.',source:'text_finding:'+f.input.source.findingId});await ui.click('Save alleged event');
  await eventually(async()=>(await ui.text()).includes('Correct '+title),'saved chronology');assert.ok((await ui.text()).includes('month · 2026-01'));
  await ui.click('Correct '+title);await eventually(async()=>await b.evaluate<boolean>('Boolean(document.querySelector(\'textarea[name="reason"]\'))'),'correction form');await fill({precision:'unknown',start:'',note:'Fictional correction: even the month is disputed.',reason:'Fictional contrary account requires an unknown date.'});await ui.click('Save account correction');await eventually(async()=>(await ui.text()).includes('disputed · v2'),'saved correction');
  const previous=await b.evaluate<number>('performance.timeOrigin');await b.send('Page.reload');await eventually(async()=>await b.evaluate<number>('performance.timeOrigin')!==previous&&(await ui.text()).includes('Correct '+title),'persisted chronology reload');
  await ui.click('History: '+title);await eventually(async()=>(await ui.text()).includes('Version 1: Account recorded'),'history retained');await ui.click('Inspect source: '+title);await eventually(async()=>(await ui.text()).includes('Source-recorded time:'),'verified source times');
  assert.ok((await ui.text()).includes(f.evidence.sourceTime));assert.ok((await ui.text()).includes('unknown · Unknown'));
  await b.evaluate('document.querySelector(\'[aria-label="Chronology correction history"] details:last-child\').open=true');
  const artifact=fileURLToPath(new URL('../../../output/evals/chronology-desktop.png',import.meta.url));await mkdir(resolve(artifact,'..'),{recursive:true});const screenshot=await b.send<{data:string}>('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(artifact,Buffer.from(screenshot.data,'base64'));
  await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.ok(await b.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth+1'));
 });
});

const allCaseRecords={query:'',kind:'all',status:''};
test('case search separates stored claims, findings and alleged accounts and treats wildcard characters literally',async()=>{
 const f=await chronologyFixture(),base=`/api/cases/${f.kase.id}`;
 assert.equal((await request('POST',f.base,context.demo!,{payload:f.input})).statusCode,200);
 assert.equal((await createWork(f.kase.id,workInput({kind:'note',title:'Fictional 100%_ exact phrase',body:'Fictional multilingual passage: café Δοκιμή.'}))).statusCode,200);
 const search=async(payload:object)=>{const r=await request('POST',base+'/search',context.demo!,{payload});assert.equal(r.statusCode,200,r.body);assert.equal(r.headers['cache-control'],'no-store');return r.json();};
 const all=await search(allCaseRecords);assert.equal(all.interpretation,'stored_records_reverify_sources');assert.deepEqual(all.facets.map((v:{kind:string})=>v.kind),['chronology','claim','original','text_finding','work']);
 assert.equal((await search({...allCaseRecords,query:'100%_'})).items.length,1);assert.equal((await search({...allCaseRecords,query:'café'})).items.length,1);assert.equal((await search({...allCaseRecords,query:"' OR 1=1 --"})).items.length,0);
 const filtered=await search({...allCaseRecords,kind:'chronology',status:'disputed'});assert.equal(filtered.items.length,1);assert.equal(filtered.items[0].id,f.input.id);assert.equal(filtered.items[0].evidenceId,null);assert.equal(filtered.items[0].page,'Timeline');
 assertError(await request('POST',base+'/search',context.demo!,{payload:{...allCaseRecords,query:'x'.repeat(201)}}),422);assertError(await request('POST',base+'/search',context.demo!,{payload:{...allCaseRecords,query:'\u0000'}}),422);
 const other=await createCase();assert.equal((await request('POST',`/api/cases/${other.id}/search`,context.demo!,{payload:allCaseRecords})).json().items.length,0);
 const d=await documentReportFixture();try{const result=await request('POST',`/api/cases/${d.scope.caseId}/search`,context.demo!,{payload:{...allCaseRecords,kind:'document_finding'}});assert.equal(result.statusCode,200,result.body);assert.equal(result.json().items.length,1);assert.equal(result.json().items[0].evidenceId,d.job.evidenceId);const claims=await request('POST',`/api/cases/${d.scope.caseId}/search`,context.demo!,{payload:{...allCaseRecords,kind:'document_claim'}});assert.equal(claims.json().items[0].status,'Accepted interpretation');}finally{await d.app.close();}
});
test('private saved views retain revisions and replay withdrawals without disclosure to other assigned users',async()=>{
 const kase=await createCase(),base=`/api/cases/${kase.id}/saved-views`,input={id:randomUUID(),name:'Fictional review filters',filter:allCaseRecords,withdrawn:false};
 const post=(url:string,payload:object,session=context.demo!)=>request('POST',url,session,{payload});
 assert.equal((await post(base,input)).statusCode,200);const changed={name:'Fictional disputed accounts',filter:{...allCaseRecords,kind:'chronology',status:'disputed'},withdrawn:false,expectedVersion:1};
 const raced=await Promise.all([post(base+'/'+input.id+'/revise',changed),post(base+'/'+input.id+'/revise',changed)]);assert.deepEqual(raced.map(r=>r.statusCode).sort(),[200,409]);
 const withdrawn=await post(base+'/'+input.id+'/revise',{...changed,expectedVersion:2,withdrawn:true});assert.equal(withdrawn.statusCode,200,withdrawn.body);assert.equal((await post(base,input)).json().withdrawn,true);assert.equal((await post(base,input)).json().version,3);
 assertError(await post(base,{...input,name:'Different request identity'}),409);
 const colleague=await createMember(demoTenantId,'investigator','Fictional assigned colleague');await context.schemaAdminPool!.query('INSERT INTO case_memberships(tenant_id,case_id,user_id) VALUES($1,$2,$3)',[demoTenantId,kase.id,colleague]);const session=await issueTestSession(colleague);
 assert.deepEqual((await request('GET',base,session)).json(),[]);assertError(await request('GET',base+'/'+input.id+'/history',session),404);assertError(await post(base+'/'+input.id+'/revise',{...changed,expectedVersion:3},session),404);
 const history=await request('GET',base+'/'+input.id+'/history',context.demo!);assert.equal(history.json().length,3);assert.equal(history.json()[2].snapshot.name,input.name);
 await assert.rejects(context.pool!.query('UPDATE saved_case_views SET owner_id=$1 WHERE id=$2',[colleague,input.id]),/permission denied/);await assert.rejects(context.schemaAdminPool!.query('DELETE FROM saved_case_view_revisions WHERE view_id=$1',[input.id]),/append.only/i);
 await context.app!.close();context.app=await createAppInstance();assert.equal((await request('GET',base,context.demo!)).json()[0].version,3);
 const audit=(await context.pool!.query("SELECT summary,metadata FROM audit_events WHERE action='search_view.saved' AND entity_id=$1",[input.id])).rows;assert.equal(audit.length,3);assert.equal(JSON.stringify(audit).includes(changed.name),false);
});
test('search and saved views deny clients, cross-case/tenant access, revoked membership and missing CSRF',async()=>{
 const kase=await createCase(),base=`/api/cases/${kase.id}`,input={id:randomUUID(),name:'Fictional scoped filter',filter:allCaseRecords,withdrawn:false};await request('POST',base+'/saved-views',context.demo!,{payload:input});
 assertError(await request('POST',base+'/search',undefined,{payload:allCaseRecords}),401);assertError(await request('POST',base+'/search',context.demo!,{payload:allCaseRecords,csrfHeader:false}),403);assertError(await request('POST',base+'/search',context.demo!,{payload:allCaseRecords,origin:'https://untrusted.invalid'}),403);
 const tenant=randomUUID();await context.schemaAdminPool!.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenant,'Fictional separate search tenant']);
 for(const [role,tid,status] of [['client',demoTenantId,403],['reviewer',demoTenantId,404],['reviewer',tenant,404]] as const){const id=await createMember(tid,role,'Fictional forbidden search user'),session=await issueTestSession(id,tid);for(const [method,path,payload] of [['POST','/search',allCaseRecords],['POST','/saved-views',input],['GET','/saved-views',undefined],['GET','/saved-views/'+input.id+'/history',undefined]] as const)assertError(await request(method,base+path,session,{payload}),status);}
 await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,kase.id,demoUserId]);
 assertError(await request('POST',base+'/search',context.demo!,{payload:allCaseRecords}),404);assertError(await request('GET',base+'/saved-views',context.demo!),404);assertError(await request('GET',base+'/saved-views/'+input.id+'/history',context.demo!),404);
});
test('saved-view audit failure rolls back and bounded pagination traverses unchanged fictional records',async t=>{
 const kase=await createCase(),base=`/api/cases/${kase.id}`,input={id:randomUUID(),name:'Fictional rollback view',filter:allCaseRecords,withdrawn:false};
 await context.schemaAdminPool!.query("CREATE FUNCTION deny_search_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='search_view.saved' THEN RAISE EXCEPTION 'fictional audit failure'; END IF; RETURN NEW; END $$");await context.schemaAdminPool!.query('CREATE TRIGGER deny_search_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_search_audit()');
 try{assertError(await request('POST',base+'/saved-views',context.demo!,{payload:input}),500);assert.equal((await context.pool!.query('SELECT count(*)::int n FROM saved_case_views WHERE id=$1',[input.id])).rows[0].n,0);}finally{await context.schemaAdminPool!.query('DROP TRIGGER deny_search_audit ON audit_events');await context.schemaAdminPool!.query('DROP FUNCTION deny_search_audit()');}
 const ids=Array.from({length:5000},()=>randomUUID());await context.schemaAdminPool!.query(`INSERT INTO case_work_items(tenant_id,case_id,id,kind,title,body,status,request_hash,created_by) SELECT $1,$2,id,'note','Fictional searchable record','Fictional corpus entry','Recorded',$4,$3 FROM unnest($5::uuid[]) id`,[demoTenantId,kase.id,demoUserId,'a'.repeat(64),ids]);
 const begin=performance.now(),first=await request('POST',base+'/search',context.demo!,{payload:allCaseRecords});assert.equal(first.statusCode,200,first.body);assert.equal(first.json().items.length,50);assert.equal(first.json().facets[0].count,5000);t.diagnostic('Actual PostgreSQL search of 5,000 short fictional notes, first page milliseconds: '+Math.round(performance.now()-begin)+'; not representative large-document acceptance.');
 const sorted=ids.sort(),second=await request('POST',base+'/search',context.demo!,{payload:{...allCaseRecords,after:first.json().next}});assert.equal(second.statusCode,200,second.body);assert.deepEqual(first.json().items.map((r:{id:string})=>r.id),sorted.slice(0,50));assert.deepEqual(second.json().items.map((r:{id:string})=>r.id),sorted.slice(50,100));
 const last=await request('POST',base+'/search',context.demo!,{payload:{...allCaseRecords,after:{kind:'work',id:sorted[4989]}}});assert.equal(last.json().items.length,10);assert.equal(last.json().next,null);await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,kase.id,demoUserId]);
});
test('real browser searches case records, saves and revises a private filter, reloads history and clears revoked results',{skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:90000},async()=>{
 const f=await chronologyFixture();await request('POST',f.base,context.demo!,{payload:f.input});await withBrowserApp(async(b,origin)=>{
  const ui=await binaryBrowserControls(b,origin,f.kase.id);await ui.click('Brief');await eventually(async()=>(await ui.text()).includes('Search case records'),'case search mounted');
  const fill=async(name:string,value:string)=>{await b.evaluate(`(()=>{const input=document.querySelector('[name='+${JSON.stringify(name)}+']');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);};
  await fill('caseQuery','fictional');await ui.click('Search case records');await eventually(async()=>await b.evaluate<boolean>('!!document.querySelector(\'[aria-label="Case search results"] article\')'),'search results');
  await fill('viewName','Fictional source checks');await ui.click('Save private view');await eventually(async()=>(await ui.text()).includes('Fictional source checks · v1'),'saved private view');
  await fill('caseQuery','packing');await ui.click('Save filter revision');await eventually(async()=>(await ui.text()).includes('Fictional source checks · v2'),'revised private view');
  const previous=await b.evaluate<number>('performance.timeOrigin');await b.send('Page.reload');await eventually(async()=>await b.evaluate<number>('performance.timeOrigin')!==previous&&(await ui.text()).includes('Fictional source checks · v2'),'saved view reload');
  await b.evaluate(`(()=>{const select=document.querySelector('[aria-label="Private case views"] select');select.value=select.options[1].value;select.dispatchEvent(new Event('change',{bubbles:true}));})()`);await eventually(async()=>await b.evaluate('document.querySelector("[name=caseQuery]").value')==='packing','saved filter loaded');
  await ui.click('Search case records');await eventually(async()=>await b.evaluate<boolean>('!!document.querySelector(\'[aria-label="Case search results"] article\')'),'restored filter results');await ui.click('Withdraw saved view');await eventually(async()=>(await ui.text()).includes('v3 · withdrawn'),'withdrawal persisted');await ui.click('View filter history');await eventually(async()=>(await ui.text()).includes('Version 1 · Fictional source checks'),'saved filter history');
  await b.evaluate('document.querySelector(\'form[aria-label="Case record search"]\').scrollIntoView()');const artifact=fileURLToPath(new URL('../../../output/evals/case-search-desktop.png',import.meta.url));await mkdir(resolve(artifact,'..'),{recursive:true});const screenshot=await b.send<{data:string}>('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(artifact,Buffer.from(screenshot.data,'base64'));
  await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.ok(await b.evaluate<boolean>('document.documentElement.scrollWidth<=window.innerWidth+1'));
  await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,f.kase.id,demoUserId]);await ui.click('Search case records');await eventually(async()=>await b.evaluate<boolean>('!!document.querySelector(".form-error")&&!document.querySelector(\'[aria-label="Case search results"]\')'),'revoked results cleared');
 });
});

async function graphFixture(){
 const f=await chronologyFixture(),base=`/api/cases/${f.kase.id}/graph`,author=await createMember(demoTenantId,'investigator','Fictional graph author');await context.schemaAdminPool!.query('INSERT INTO case_memberships(tenant_id,case_id,user_id) VALUES($1,$2,$3)',[demoTenantId,f.kase.id,author]);const authorSession=await issueTestSession(author);
 const save=async(path:string,payload:object,session=authorSession)=>{const r=await request('POST',base+path,session,{payload});assert.equal(r.statusCode,200,r.body);return r.json();};
 const entityInput={id:randomUUID(),kind:'organisation',label:'Fictional Alder Supply',detail:'Identity is a working record; no automatic match is asserted.'},from=await save('/entities',entityInput),to=await save('/entities',{...entityInput,id:randomUUID(),label:'Fictional Northstar Paperworks'});
 const input={id:randomUUID(),from:{id:from.id,version:1},to:{id:to.id,version:1},relationship:'May have supplied goods to',account:'The fictional packing record supports this interpretation only; receipt and identity remain uncertain.',sources:[f.input.source]},proposal=await save('/relationships',input);
 return {...f,base,author,authorSession,save,from,to,entityInput,graphInput:input,proposal};
}
test('graph proposals pin exact entities and sources, require independent review and retain corrections and withdrawal',async()=>{
 const f=await graphFixture(),url=f.base+'/relationships/'+f.proposal.id;
 const graph=()=>request('GET',f.base,context.demo!);let state=(await graph()).json();assert.equal(state.sourceVerification,'not_checked_on_listing');assert.equal(state.relationships[0].state,'candidate');assert.equal(state.relationships[0].canReview,true);
 const decision={id:randomUUID(),expectedVersion:1,digest:f.proposal.digest,accepted:true,reason:'Fictional source inspected; this is an interpretation, not proof of delivery.'};
 assertError(await request('POST',url+'/review',context.demo!,{payload:{...decision,digest:'a'.repeat(64)}}),409);
 await context.schemaAdminPool!.query("UPDATE memberships SET role='reviewer' WHERE tenant_id=$1 AND user_id=$2",[demoTenantId,f.author]);assertError(await request('POST',url+'/review',f.authorSession,{payload:decision}),403);
 assert.equal((await request('POST',url+'/review',context.demo!,{payload:decision})).statusCode,200);assert.equal((await request('POST',url+'/review',context.demo!,{payload:decision})).statusCode,200);assertError(await request('POST',url+'/review',context.demo!,{payload:{...decision,reason:'Different decision text'}}),409);
 state=(await graph()).json();assert.equal(state.relationships[0].state,'confirmed');assert.equal((await request('GET',url+'/sources',context.demo!)).json()[0].id,f.input.source.findingId);
 const corrected=await f.save('/entities/'+f.from.id+'/revise',{expectedVersion:1,label:'Fictional Alder entity, identification disputed',detail:'A correction preserves the earlier label.',withdrawn:false,reason:'Fictional ambiguous name reassessment'});assert.equal(corrected.version,2);
 state=(await graph()).json();assert.equal(state.relationships[0].state,'needs_review');assert.equal(state.relationships[0].proposal.from.label,f.from.label);assert.equal((await f.save('/entities',f.entityInput)).version,2);
 assertError(await request('POST',f.base+'/relationships',f.authorSession,{payload:{...f.graphInput,id:randomUUID()}}),409);
 const revision=await f.save('/relationships/'+f.proposal.id+'/revise',{...f.graphInput,id:undefined,from:{id:f.from.id,version:2},expectedVersion:1,reason:'Fictional revised endpoint interpretation'});assert.equal(revision.version,2);assert.equal((await graph()).json().relationships[0].state,'candidate');
 const original=(await context.pool!.query('SELECT object_path FROM evidence WHERE tenant_id=$1 AND case_id=$2 AND id=$3',[demoTenantId,f.kase.id,f.evidence.id])).rows[0],path=resolve(context.storageRoot!,original.object_path),bytes=await readFile(path);await writeFile(path,'Fictional altered original');
 try{
  const next={...decision,id:randomUUID(),expectedVersion:2,digest:revision.digest};assertError(await request('POST',url+'/review',context.demo!,{payload:next}),409);assertError(await request('GET',url+'/sources',context.demo!),409);
  assert.equal((await request('POST',url+'/review',context.demo!,{payload:{...next,accepted:false,reason:'Fictional unavailable source prevents reliance.'}})).statusCode,200);
  await f.save('/relationships/'+f.proposal.id+'/withdraw',{expectedVersion:2,reason:'Fictional withdrawal after reassessment'});assert.equal((await graph()).json().relationships[0].state,'withdrawn');assert.equal((await f.save('/relationships',f.graphInput)).withdrawn,true);
  const history=(await request('GET',url+'/history',context.demo!)).json();assert.equal(history.length,3);assert.equal(history[2].review.accepted,true);assert.equal(history[1].review.accepted,false);assert.equal(history[2].proposal.from.label,f.from.label);
 }finally{await writeFile(path,bytes);}
 await assert.rejects(context.schemaAdminPool!.query('UPDATE graph_relationship_reviews SET accepted=false WHERE relationship_id=$1',[f.proposal.id]),/append.only/i);
 await assert.rejects(context.pool!.query('UPDATE graph_entities SET created_by=$1 WHERE id=$2',[demoUserId,f.from.id]),/permission denied/);
 await context.app!.close();context.app=await createAppInstance();assert.equal((await graph()).json().relationships[0].state,'withdrawn');
 const searched=await request('POST',`/api/cases/${f.kase.id}/search`,context.demo!,{payload:{query:'',kind:'relationship',status:''}});assert.equal(searched.json().items[0].status,'Withdrawn relationship');
});
test('graph scope, current authority, typed source binding and ambiguous entity identities fail closed',async()=>{
 const f=await graphFixture(),other=await graphFixture(),url=f.base+'/relationships/'+f.proposal.id;
 const duplicate=await f.save('/entities',{...f.entityInput,id:randomUUID()});assert.notEqual(duplicate.id,f.from.id);assert.equal(duplicate.label,f.from.label);
 assertError(await request('POST',f.base+'/relationships',f.authorSession,{payload:{...f.graphInput,id:randomUUID(),to:f.graphInput.from}}),422);
 assertError(await request('POST',f.base+'/relationships',f.authorSession,{payload:{...f.graphInput,id:randomUUID(),to:{id:other.to.id,version:1}}}),422);
 assertError(await request('POST',f.base+'/relationships',f.authorSession,{payload:{...f.graphInput,id:randomUUID(),sources:[other.input.source]}}),404);
 assertError(await request('POST',f.base+'/relationships',f.authorSession,{payload:{...f.graphInput,id:randomUUID(),sources:[f.input.source,f.input.source]}}),422);
 assertError(await request('GET',f.base+'?focus='+other.to.id,context.demo!),404);assert.equal((await request('GET',f.base+'?focus='+duplicate.id,context.demo!)).json().relationships.length,0);
 assertError(await request('POST',f.base+'/entities',f.authorSession,{payload:{...f.entityInput,id:randomUUID()},csrfHeader:false}),403);
 const tenant=randomUUID();await context.schemaAdminPool!.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[tenant,'Fictional separate graph tenant']);
 for(const [role,tid,status] of [['client',demoTenantId,403],['reviewer',demoTenantId,404],['reviewer',tenant,404]] as const){const actor=await createMember(tid,role,'Fictional forbidden graph actor'),session=await issueTestSession(actor,tid);for(const path of [f.base,url+'/history',url+'/sources',f.base+'/entities/'+f.from.id+'/history'])assertError(await request('GET',path,session),status);assertError(await request('POST',f.base+'/entities',session,{payload:{...f.entityInput,id:randomUUID()}}),status);}
 await approveAuthority(f.kase.id);assert.equal((await request('GET',f.base,context.demo!)).json().relationships[0].state,'needs_review');assertError(await request('POST',url+'/review',context.demo!,{payload:{id:randomUUID(),expectedVersion:1,digest:f.proposal.digest,accepted:true,reason:'Fictional stale authority denial'}}),409);assertError(await request('GET',url+'/sources',context.demo!),409);
 await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,f.kase.id,f.author]);assertError(await request('GET',f.base,f.authorSession),404);assertError(await request('POST',url+'/withdraw',f.authorSession,{payload:{expectedVersion:1,reason:'Fictional revoked author denial'}}),404);
});
test('graph audit failure rolls back proposals and decisions, and concurrent reviews retain one immutable decision',async()=>{
 const f=await graphFixture(),url=f.base+'/relationships/'+f.proposal.id,decision={id:randomUUID(),expectedVersion:1,digest:f.proposal.digest,accepted:true,reason:'Fictional independent review after reading the source.'};
 await context.schemaAdminPool!.query("CREATE FUNCTION deny_graph_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'graph.%' THEN RAISE EXCEPTION 'fictional graph audit failure'; END IF; RETURN NEW; END $$");await context.schemaAdminPool!.query('CREATE TRIGGER deny_graph_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_graph_audit()');
 const id=randomUUID();try{assertError(await request('POST',f.base+'/relationships',f.authorSession,{payload:{...f.graphInput,id}}),500);assert.equal((await context.pool!.query('SELECT count(*)::int n FROM graph_relationships WHERE id=$1',[id])).rows[0].n,0);assertError(await request('POST',url+'/review',context.demo!,{payload:decision}),500);assert.equal((await context.pool!.query('SELECT count(*)::int n FROM graph_relationship_reviews WHERE relationship_id=$1',[f.proposal.id])).rows[0].n,0);}finally{await context.schemaAdminPool!.query('DROP TRIGGER deny_graph_audit ON audit_events');await context.schemaAdminPool!.query('DROP FUNCTION deny_graph_audit()');}
 const results=await Promise.all([request('POST',url+'/review',context.demo!,{payload:decision}),request('POST',url+'/review',context.demo!,{payload:{...decision,id:randomUUID(),accepted:false}})]);assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);
 const entityChange={expectedVersion:1,label:'Fictional corrected label',detail:'Fictional proposed correction with uncertainty retained.',withdrawn:false,reason:'Fictional concurrent correction'};
 const entities=await Promise.all([request('POST',f.base+'/entities/'+f.from.id+'/revise',f.authorSession,{payload:entityChange}),request('POST',f.base+'/entities/'+f.from.id+'/revise',f.authorSession,{payload:entityChange})]);assert.deepEqual(entities.map(r=>r.statusCode).sort(),[200,409]);
});

test('graph document sources retain precise citations and reject changed correspondence or provenance',async()=>{
 const f=await documentReportFixture(),base=`/api/cases/${f.scope.caseId}/graph`;
 try{
  const save=async(path:string,payload:object)=>{const r=await request('POST',base+path,f.authorSession,{payload});assert.equal(r.statusCode,200,r.body);return r.json();};
  const from=await save('/entities',{id:randomUUID(),kind:'document',label:'Fictional supplier declaration',detail:'A document identity, separate from its assertions.'}),to=await save('/entities',{id:randomUUID(),kind:'organisation',label:'Fictional named supplier',detail:'Name matching remains uncertain.'});
  const proposal=await save('/relationships',{id:randomUUID(),from:{id:from.id,version:1},to:{id:to.id,version:1},relationship:'Names a possible supplier',account:'Fictional interpretation of the cited page only.',sources:[{kind:'document_finding',findingId:f.decision.id}]}),url=base+'/relationships/'+proposal.id;
  const inspected=await request('GET',url+'/sources',context.demo!);assert.equal(inspected.statusCode,200,inspected.body);const finding=inspected.json()[0];assert.equal(finding.id,f.decision.id);assert.equal(finding.reference.page,f.candidate.citation.page);assert.equal(finding.reference.quote,f.candidate.citation.quote);assert.equal(finding.source.id,f.job.evidenceId);assert.match(proposal.sources[0].sha256,/^[a-f0-9]{64}$/);
  const review={id:randomUUID(),expectedVersion:1,digest:proposal.digest,accepted:true,reason:'Fictional independent page interpretation.'};assert.equal((await request('POST',url+'/review',context.demo!,{payload:review})).statusCode,200);
  await context.schemaAdminPool!.query('ALTER TABLE graph_relationship_sources DISABLE TRIGGER graph_source_immutable');try{await context.schemaAdminPool!.query("UPDATE graph_relationship_sources SET source_hash=$1 WHERE relationship_id=$2",['a'.repeat(64),proposal.id]);assertError(await request('GET',base,context.demo!),409);assertError(await request('GET',url+'/history',context.demo!),409);}finally{await context.schemaAdminPool!.query('UPDATE graph_relationship_sources SET source_hash=$1 WHERE relationship_id=$2',[proposal.sources[0].sha256,proposal.id]);await context.schemaAdminPool!.query('ALTER TABLE graph_relationship_sources ENABLE TRIGGER graph_source_immutable');}
  await context.schemaAdminPool!.query('ALTER TABLE graph_relationship_revisions DISABLE TRIGGER graph_relationship_history_immutable');try{await context.schemaAdminPool!.query('UPDATE graph_relationship_revisions SET actor_id=$1 WHERE relationship_id=$2',[demoUserId,proposal.id]);assertError(await request('GET',base,context.demo!),409);}finally{await context.schemaAdminPool!.query('UPDATE graph_relationship_revisions SET actor_id=$1 WHERE relationship_id=$2',[f.author,proposal.id]);await context.schemaAdminPool!.query('ALTER TABLE graph_relationship_revisions ENABLE TRIGGER graph_relationship_history_immutable');}
  const replacement=await request('POST',f.reviewUrl,context.demo!,{payload:{...f.reviewInput,id:randomUUID(),previousReviewId:f.reviewInput.id,decision:'rejected',reason:'Fictional later comparison disputes correspondence.',originalCompared:false}});assert.equal(replacement.statusCode,200,replacement.body);assertError(await request('GET',url+'/sources',context.demo!),409);
  // A recorded graph decision stays historical; merely listing it does not reverify source bytes/reviews.
  assert.equal((await request('GET',base,context.demo!)).json().sourceVerification,'not_checked_on_listing');
 }finally{await f.app.close();}
});

test('graph rejects oversized and malformed input and applies a hard entity query limit',async()=>{
 const f=await graphFixture();for(const patch of [{label:' '},{detail:'\u0000'},{label:'x'.repeat(201)},{kind:'inferred_person'}])assertError(await request('POST',f.base+'/entities',f.authorSession,{payload:{...f.entityInput,id:randomUUID(),...patch}}),422);
 for(const patch of [{account:'x'.repeat(4001)},{sources:[]},{sources:Array(6).fill(f.input.source)},{from:{id:f.from.id,version:0}}])assertError(await request('POST',f.base+'/relationships',f.authorSession,{payload:{...f.graphInput,id:randomUUID(),...patch}}),422);
 const ids=Array.from({length:198},()=>randomUUID());await context.schemaAdminPool!.query(`INSERT INTO graph_entities(tenant_id,case_id,id,request_hash,created_by) SELECT $1,$2,id,$4,$3 FROM unnest($5::uuid[]) id`,[demoTenantId,f.kase.id,f.author,'a'.repeat(64),ids]);
 await context.schemaAdminPool!.query(`INSERT INTO graph_entity_revisions(tenant_id,case_id,entity_id,version,snapshot,actor_id,reason) SELECT tenant_id,case_id,id,1,jsonb_build_object('id',id,'caseId',case_id,'version',1,'createdBy',created_by,'kind','organisation','label','Fictional bounded entity','detail','Fictional limit fixture','withdrawn',false,'recordedAt','2026-10-01T00:00:00.000Z'),created_by,'Fictional query limit fixture' FROM graph_entities WHERE tenant_id=$1 AND case_id=$2 AND id=ANY($3::uuid[])`,[demoTenantId,f.kase.id,ids]);
 assert.equal((await request('GET',f.base,context.demo!)).json().entities.length,200);assertError(await request('POST',f.base+'/entities',f.authorSession,{payload:{...f.entityInput,id:randomUUID()}}),422);
});

test('real browser creates graph records, independently reviews sources, preserves stale interpretations and clears revoked data',{skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:90000},async()=>{
 const f=await graphFixture();await withBrowserApp(async(b,origin)=>{
  const ui=await binaryBrowserControls(b,origin,f.kase.id);await ui.click('Intelligence');await eventually(async()=>(await ui.text()).includes('May have supplied goods to'),'persistent graph mounted');
  const fill=async(form:string,values:Record<string,string>)=>b.evaluate(`(()=>{const f=document.querySelector('form[aria-label='+${JSON.stringify(JSON.stringify(form))}+']');for(const [name,value] of Object.entries(${JSON.stringify(values)})){const field=f.elements.namedItem(name);field.value=value;field.dispatchEvent(new Event(field.tagName==='SELECT'?'change':'input',{bubbles:true}));}})()`);
  await ui.click('Record entity');await fill('Graph entity editor',{label:'Fictional independent depot',detail:'The fictional depot identity remains uncertain.'});await ui.click('Save entity');await eventually(async()=>(await ui.text()).includes('3 entities'),'entity created');
  await ui.click('Propose relationship');await eventually(async()=>await b.evaluate<boolean>('!!document.querySelector(\'form[aria-label="Relationship proposal editor"]\')'),'proposal editor');
  const entity=(await request('GET',f.base,context.demo!)).json().entities.find((e:{label:string})=>e.label==='Fictional independent depot');
  await fill('Relationship proposal editor',{from:f.from.id,to:entity.id,relationship:'Possible depot connection',account:'Fictional working interpretation with no automatic identity match.'});await b.evaluate('document.querySelector(\'form[aria-label="Relationship proposal editor"] input[name=source]\').click()');assert.ok(await b.evaluate<boolean>('document.querySelector(\'input[name=source]\').getBoundingClientRect().width<=24'));
  await ui.click('Save relationship proposal');await eventually(async()=>(await ui.text()).includes('Possible depot connection')&&!await b.evaluate<boolean>('!!document.querySelector(\'form[aria-label="Relationship proposal editor"]\')'),'proposal persisted');assert.equal(await b.evaluate('!!document.querySelector(\'form[aria-label="Relationship review"]\')'),false);
  const selectOriginal=()=>b.evaluate('Array.from(document.querySelectorAll(".graph-record-choice")).find(e=>e.textContent.includes("May have supplied goods to")).click()');await selectOriginal();await ui.click('Inspect relationship sources');await eventually(async()=>await b.evaluate<boolean>('!!document.querySelector(\'[aria-label="Relationship sources"] blockquote\')'),'verified source quote');assert.ok((await ui.text()).includes('Source-recorded:'));
  await fill('Relationship review',{reason:'Fictional independent assessment after inspecting the original reference.'});await ui.click('Accept relationship interpretation');await eventually(async()=>(await ui.text()).includes('Reviewer accepted'),'independent decision persisted');
  const previous=await b.evaluate<number>('performance.timeOrigin');await b.send('Page.reload');await eventually(async()=>await b.evaluate<number>('performance.timeOrigin')!==previous&&(await ui.text()).includes('Reviewer accepted'),'saved graph reload');
  await b.evaluate('document.querySelector(".case-graph-panel details.work-detail").open=true');await ui.click('Correct entity: '+f.from.label);await fill('Graph entity editor',{label:'Fictional Alder identity disputed',detail:'Fictional later source makes this name ambiguous.',reason:'Fictional identity correction'});await ui.click('Save entity correction');await eventually(async()=>(await ui.text()).includes('Needs fresh review'),'old decision stale after entity correction');await selectOriginal();await ui.click('Relationship history');await eventually(async()=>(await ui.text()).includes('Proposal version 1'),'exact proposal history');await b.evaluate('document.querySelector(\'[aria-label="Relationship history"] details\').open=true');assert.ok((await ui.text()).includes(f.from.label+' (v1)'));
  await b.evaluate('document.querySelector(".case-graph-panel").scrollIntoView()');const artifact=fileURLToPath(new URL('../../../output/evals/case-graph-desktop.png',import.meta.url));await mkdir(resolve(artifact,'..'),{recursive:true});const shot=await b.send<{data:string}>('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(artifact,Buffer.from(shot.data,'base64'));
  await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.ok(await b.evaluate<boolean>('document.documentElement.scrollWidth<=window.innerWidth+1'));
  await ui.click('Record entity');await fill('Graph entity editor',{label:'Fictional unsubmitted entity',detail:'Must clear after access denial.'});await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,f.kase.id,demoUserId]);await ui.click('Refresh graph');await eventually(async()=>await b.evaluate<boolean>('!!document.querySelector(".case-graph-panel .form-error")&&!document.querySelector(".saved-graph")&&!document.querySelector(\'form[aria-label="Graph entity editor"]\')&&!document.querySelector(\'[aria-label="Relationship history"]\')'),'revoked graph and drafts cleared');
 });
});
test('work discussions preserve corrections, private mention reads and current membership boundaries',async()=>{
 context.demo=await issueTestSession(demoUserId);const kase=await createCase(),work=(await createWork(kase.id)).json(),base=`/api/cases/${kase.id}`,url=base+'/work/'+work.id+'/comments';
 const colleagueId=await createMember(demoTenantId,'investigator','Fictional discussion colleague');await context.schemaAdminPool!.query('INSERT INTO case_memberships(tenant_id,case_id,user_id) VALUES($1,$2,$3)',[demoTenantId,kase.id,colleagueId]);const colleague=await issueTestSession(colleagueId);
 const input={id:randomUUID(),body:'Fictional possible clerical mismatch; please inspect the supplied record.',mentions:[colleagueId],reason:'Request a separate fictional check.'};const created=await request('POST',url,context.demo!,{payload:input});assert.equal(created.statusCode,200,created.body);assert.equal(created.json().version,1);assert.deepEqual((await request('POST',url,context.demo!,{payload:input})).json(),created.json());assertError(await request('POST',url,context.demo!,{payload:{...input,body:'Different content'}}),409);
 assert.equal((await context.pool!.query('SELECT count(*)::int n FROM findings WHERE case_id=$1',[kase.id])).rows[0].n,0);assert.equal((await context.pool!.query('SELECT version FROM case_work_items WHERE case_id=$1 AND id=$2',[kase.id,work.id])).rows[0].version,1);
 assertError(await request('POST',url,colleague,{payload:input}),403);assert.equal((await request('GET',url,colleague)).json()[0].canEdit,false);
 const revise=url+'/'+input.id+'/revise',read=url+'/'+input.id+'/read',inbox=base+'/work-mentions';const edit={body:'Fictional correction: there may be a date transcription mismatch.',mentions:[colleagueId],reason:'Clarify the uncertainty, without deciding source truth.',expectedVersion:1,withdrawn:false};assertError(await request('POST',revise,colleague,{payload:edit}),403);assertError(await request('POST',revise,context.demo!,{payload:edit,csrfHeader:false}),403);
 const mentions=(await request('GET',inbox,colleague)).json();assert.equal(mentions.items[0].commentId,input.id);assert.deepEqual((await request('GET',inbox,context.demo!)).json().items,[]);assertError(await request('POST',read,context.demo!,{payload:{version:1}}),404);
 assert.equal((await request('POST',read,colleague,{payload:{version:1}})).statusCode,200);assert.equal((await request('POST',read,colleague,{payload:{version:1}})).statusCode,200);assert.deepEqual((await request('GET',inbox,colleague)).json().items,[]);assert.equal((await context.pool!.query("SELECT count(*)::int n FROM audit_events WHERE entity_id=$1 AND action='work_mention.read'",[input.id])).rows[0].n,1);
 const restarted=await createAppInstance();try{const r=await restarted.inject({method:'GET',url,headers:{cookie:colleague.cookie}});assert.equal(r.statusCode,200,r.body);assert.equal(r.json()[0].body,input.body);const m=await restarted.inject({method:'GET',url:inbox,headers:{cookie:colleague.cookie}});assert.deepEqual(m.json().items,[]);}finally{await restarted.close();}
 const correction=await request('POST',revise,context.demo!,{payload:edit});assert.equal(correction.statusCode,200,correction.body);assert.equal((await request('GET',inbox,colleague)).json().items[0].version,2);assertError(await request('POST',read,colleague,{payload:{version:1}}),409);
 const races=await Promise.all([1,2].map(()=>request('POST',revise,context.demo!,{payload:{...edit,expectedVersion:2}})));assert.deepEqual(races.map(r=>r.statusCode).sort(),[200,409]);
 const withdrawn=await request('POST',revise,context.demo!,{payload:{body:'',mentions:[],reason:'Withdraw the working comment; preserve all prior versions.',withdrawn:true,expectedVersion:3}});assert.equal(withdrawn.statusCode,200,withdrawn.body);assert.equal(withdrawn.json().body,'');assert.deepEqual((await request('GET',inbox,colleague)).json().items,[]);const history=(await request('GET',url+'/'+input.id+'/history',colleague)).json();assert.deepEqual(history.map((x:{version:number})=>x.version),[4,3,2,1]);assert.equal(history[3].body,input.body);assert.equal((await request('POST',url,context.demo!,{payload:input})).json().withdrawn,true);assertError(await request('POST',revise,context.demo!,{payload:{...edit,expectedVersion:4}}),409);
 await assert.rejects(context.schemaAdminPool!.query('UPDATE work_comment_revisions SET body=$1 WHERE comment_id=$2',['replacement',input.id]),/append.only|immutable/i);await assert.rejects(context.pool!.query('UPDATE work_comments SET author_id=$1 WHERE id=$2',[colleagueId,input.id]),/permission denied/);
 const otherCase=await createCase();assertError(await request('GET',url.replace(kase.id,otherCase.id),context.demo!),404);
 const clientId=await createMember(demoTenantId,'client','Fictional excluded recipient'),client=await issueTestSession(clientId);assertError(await request('GET',url,client),403);assertError(await request('GET',inbox,client),403);assertError(await request('POST',url,client,{payload:{...input,id:randomUUID()}}),403);assertError(await request('POST',url,context.demo!,{payload:{...input,id:randomUUID(),mentions:[clientId]}}),422);
 const otherTenant=randomUUID();await context.schemaAdminPool!.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[otherTenant,'Fictional discussion other tenant']);const outsiderId=await createMember(otherTenant,'reviewer','Fictional excluded investigator'),outsider=await issueTestSession(outsiderId,otherTenant);assertError(await request('GET',url,outsider),404);assertError(await request('GET',inbox,outsider),404);assertError(await request('POST',url,context.demo!,{payload:{...input,id:randomUUID(),mentions:[outsiderId]}}),422);
 await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,kase.id,colleagueId]);for(const path of [url,inbox,url+'/'+input.id+'/history'])assertError(await request('GET',path,colleague),404);assertError(await request('POST',read,colleague,{payload:{version:4}}),404);assertError(await request('POST',url,context.demo!,{payload:{...input,id:randomUUID()}}),422);
});

test('discussion writes and mention acknowledgement roll back when audit fails',async()=>{
 context.demo=await issueTestSession(demoUserId);const kase=await createCase(),work=(await createWork(kase.id)).json(),url=`/api/cases/${kase.id}/work/${work.id}/comments`,input={id:randomUUID(),body:'Fictional work comment for atomic audit checks.',mentions:[demoUserId],reason:'Fictional atomicity check.'};
 await context.schemaAdminPool!.query(`CREATE FUNCTION fail_work_discussion_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'work_comment.%' OR NEW.action='work_mention.read' THEN RAISE EXCEPTION 'fictional discussion audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_work_discussion_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_work_discussion_audit()`);
 try{assertError(await request('POST',url,context.demo!,{payload:input}),500);assert.equal((await context.pool!.query('SELECT count(*)::int n FROM work_comments WHERE id=$1',[input.id])).rows[0].n,0);}finally{await context.schemaAdminPool!.query('DROP TRIGGER fail_work_discussion_audit ON audit_events');}
 assert.equal((await request('POST',url,context.demo!,{payload:input})).statusCode,200);
 await context.schemaAdminPool!.query('CREATE TRIGGER fail_work_discussion_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_work_discussion_audit()');
 try{assertError(await request('POST',url+'/'+input.id+'/revise',context.demo!,{payload:{...input,id:undefined,expectedVersion:1,withdrawn:false,body:'Fictional changed version.'}}),500);assert.equal((await request('GET',url,context.demo!)).json()[0].version,1);assertError(await request('POST',url+'/'+input.id+'/read',context.demo!,{payload:{version:1}}),500);assert.equal((await context.pool!.query('SELECT count(*)::int n FROM work_mention_reads WHERE comment_id=$1',[input.id])).rows[0].n,0);}finally{await context.schemaAdminPool!.query('DROP TRIGGER fail_work_discussion_audit ON audit_events; DROP FUNCTION fail_work_discussion_audit()');}
});

test('discussion input bounds reject malformed text and duplicate or oversized mention sets',async()=>{
 context.demo=await issueTestSession(demoUserId);const kase=await createCase(),work=(await createWork(kase.id)).json(),url=`/api/cases/${kase.id}/work/${work.id}/comments`,input={id:randomUUID(),body:'Fictional bounded discussion.',mentions:[],reason:'Fictional validation.'};
 for(const change of [{body:' '.repeat(8)},{body:'bad\u0000text'},{reason:' '}])assertError(await request('POST',url,context.demo!,{payload:{...input,...change}}),422);
 for(const change of [{body:'x'.repeat(4001)},{reason:'x'.repeat(1001)},{mentions:[demoUserId,demoUserId]},{mentions:Array.from({length:9},()=>randomUUID())}])assertError(await request('POST',url,context.demo!,{payload:{...input,...change}}),422);
 assert.equal((await context.pool!.query('SELECT count(*)::int n FROM work_comments WHERE id=$1',[input.id])).rows[0].n,0);
});

test('real browser retains work discussion corrections and per-version mentions after reload',{skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:60000},async()=>{
 context.demo=await issueTestSession(demoUserId);const kase=await createCase(),title='Fictional discussion browser question';assert.equal((await createWork(kase.id,workInput({title}))).statusCode,200);const name=(await context.pool!.query('SELECT display_name FROM users WHERE id=$1',[demoUserId])).rows[0].display_name;
 await withBrowserApp(async(b,origin)=>{
  await b.send('Network.setCookie',{name:'inveos_session',value:context.demo!.cookie.match(/inveos_session=([^;]+)/)![1]!,url:origin,httpOnly:true,sameSite:'Strict'});await b.send('Network.setCookie',{name:'inveos_csrf',value:context.demo!.csrf,url:origin,sameSite:'Strict'});await b.send('Page.navigate',{url:origin+'/#case='+kase.id+'&view=Brief'});await eventually(async()=>await b.evaluate(`document.body.innerText.includes(${JSON.stringify(title)})`),'discussion case loaded');
  const click=async(text:string)=>b.evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(text)}).click()`),fill=async(label:string,value:string)=>b.evaluate(`(()=>{const e=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const open=async()=>{await b.evaluate(`[...document.querySelectorAll('summary')].find(e=>e.textContent==='Team discussion').parentElement.open=true`);await click('Load discussion');await eventually(async()=>await b.evaluate(`document.body.innerText.includes('No comments recorded')`),'empty discussion');};await open();
  await fill('Work comment text','Fictional amber account needs an independent comparison.');await fill('Work comment reason','Ask for a fictional working check.');await b.evaluate(`[...document.querySelectorAll('[aria-label="Internal work discussion"] label')].find(e=>e.textContent===${JSON.stringify(name)}).querySelector('input').click()`);await click('Add comment');await eventually(async()=>await b.evaluate(`!![...document.querySelectorAll('button')].find(e=>e.textContent==='Correct comment')`),'saved comment');
  await click('Correct comment');await fill('Work comment text','Fictional corrected amber account remains uncertain.');await fill('Work comment reason','Clarify uncertainty without changing evidence.');await click('Save comment correction');await eventually(async()=>await b.evaluate(`document.body.innerText.includes('version 2')`),'saved correction');
  const previous=await b.evaluate<number>('performance.timeOrigin');await b.send('Page.reload');await eventually(async()=>await b.evaluate<number>('performance.timeOrigin')!==previous,'new discussion document');await eventually(async()=>await b.evaluate(`document.body.innerText.includes(${JSON.stringify(title)})`),'case restored');await b.evaluate(`[...document.querySelectorAll('summary')].find(e=>e.textContent==='Team discussion').parentElement.open=true`);await click('Load discussion');await eventually(async()=>await b.evaluate(`document.body.innerText.includes('Fictional corrected amber account remains uncertain.')`),'persisted correction');await click('Comment history');await eventually(async()=>await b.evaluate(`document.body.innerText.includes('Fictional amber account needs an independent comparison.')`),'original preserved');
  await click('Load mentions');await eventually(async()=>await b.evaluate(`!![...document.querySelectorAll('button')].find(e=>e.textContent==='Mark mention read')`),'current mention');await click('Mark mention read');await eventually(async()=>await b.evaluate(`document.body.innerText.includes('No unread mentions in this case.')`),'read receipt');
  await b.evaluate(`document.querySelector('[aria-label="View notifications"]').click()`);await eventually(async()=>await b.evaluate(`!!document.querySelector('dialog [aria-label="My case mentions"]')`),'notification inbox entry');await b.evaluate(`[...document.querySelectorAll('dialog button')].find(e=>e.textContent==='Load mentions').click()`);await eventually(async()=>await b.evaluate(`document.querySelector('dialog').innerText.includes('No unread mentions in this case.')`),'same persisted mention receipt');await b.evaluate(`document.querySelector('dialog [aria-label="Close dialog"]').click()`);
  await b.evaluate(`document.querySelector('[aria-label="Internal work discussion"]').scrollIntoView({block:'start'})`);
  assert.ok(await b.evaluate<boolean>(`document.querySelector('.work-mention-option input').getBoundingClientRect().width<=24 && document.querySelector('.work-mention-option span').getBoundingClientRect().width>100`));
  const artifact=fileURLToPath(new URL('../../../output/evals/work-discussion-desktop.png',import.meta.url));await mkdir(resolve(artifact,'..'),{recursive:true});const screenshot=await b.send<{data:string}>('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(artifact,Buffer.from(screenshot.data,'base64'));await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.ok(await b.evaluate<boolean>('document.documentElement.scrollWidth<=window.innerWidth+1'));
  await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,kase.id,demoUserId]);await click('Refresh discussion');await eventually(async()=>await b.evaluate(`document.querySelector('[aria-label="Internal work discussion"] [role="alert"]')?.textContent.toLowerCase().includes('not found')`),'revoked discussion denial');assert.equal(await b.evaluate(`document.querySelector('[aria-label="Internal work discussion"]').innerText.includes('Fictional corrected amber account remains uncertain.')`),false);assert.equal(await b.evaluate(`!!document.querySelector('[aria-label="Comment correction history"]')`),false);

 });
});

test('downgraded client cannot acknowledge an internal mention retained from their investigator role',async()=>{
 context.demo=await issueTestSession(demoUserId);const kase=await createCase(),work=(await createWork(kase.id)).json(),actor=await createMember(demoTenantId,'investigator','Fictional downgraded colleague');
 await context.schemaAdminPool!.query('INSERT INTO case_memberships(tenant_id,case_id,user_id) VALUES($1,$2,$3)',[demoTenantId,kase.id,actor]);const session=await issueTestSession(actor),base=`/api/cases/${kase.id}/work/${work.id}/comments`,id=randomUUID();
 const saved=await request('POST',base,context.demo!,{payload:{id,body:'Fictional internal discussion for an investigator.',mentions:[actor],reason:'Fictional role-change acceptance'}});assert.equal(saved.statusCode,200,saved.body);
 await context.schemaAdminPool!.query("UPDATE memberships SET role='client' WHERE tenant_id=$1 AND user_id=$2",[demoTenantId,actor]);
 assertError(await request('GET',`/api/cases/${kase.id}/work-mentions`,session),403);
 assertError(await request('POST',base+'/'+id+'/read',session,{payload:{version:1}}),403);
 assert.equal((await context.pool!.query('SELECT count(*)::int n FROM work_mention_reads WHERE comment_id=$1 AND user_id=$2',[id,actor])).rows[0].n,0);
});

async function manualSourceFixture(){
 // Isolate the real rate-limit store from earlier API/browser fixture traffic.
 await context.app!.close();context.app=await createAppInstance();
 const kase=await createCase();await approveAuthority(kase.id);const evidence=parseBody<Evidence>(await uploadEvidence(kase.id));
 const author=await createMember(demoTenantId,'investigator','Fictional supplied-source author');await context.schemaAdminPool!.query('INSERT INTO case_memberships(tenant_id,case_id,user_id) VALUES($1,$2,$3)',[demoTenantId,kase.id,author]);const session=await issueTestSession(author),base=`/api/cases/${kase.id}/manual-sources`;
 const fields={url:'https://records.example.test/supplied-page?record=fictional',publisher:'Fictional Northstar register',retrievedAt:'2026-01-13T09:32:11+01:00',method:'Fictional supplied snapshot; server did not fetch this URL.',trustGrade:'unassessed',termsReference:'Fictional terms supplied by the commissioner, not independently qualified.',purpose:'Review the supplied fictional supplier record.',lawfulBasis:'Fictional fixture authority only.',scope:'This supplied page only; no live collection.',retentionDays:90,minimisation:'Retain only the fictional page relevant to the instructed review.',annotation:'Publisher identity and retrieval time are supplied assertions.'},input={...fields,id:randomUUID(),evidenceId:evidence.id};
 const response=await request('POST',base,session,{payload:input});assert.equal(response.statusCode,200,response.body);return {kase,evidence,author,session,base,fields,input,record:response.json()};
}
test('manual source register preserves original and reported times, independent metadata review, corrections and withdrawal',async()=>{
 const f=await manualSourceFixture(),url=f.base+'/'+f.record.id,list=async()=>{const r=await request('GET',f.base,context.demo!);assert.equal(r.statusCode,200,r.body);return r;};
 assert.equal(f.record.original.sourceTime,f.evidence.sourceTime);assert.equal(f.record.original.receivedTime,f.evidence.receivedTime);assert.equal(f.record.retrievedAt,f.input.retrievedAt);assert.notEqual(f.record.recordedAt,f.record.retrievedAt);assert.equal((await list()).json().items[0].state,'pending');
 const decision={id:randomUUID(),expectedVersion:1,digest:f.record.digest,accepted:true,reason:'Fictional metadata and source limitations inspected; not legal or truth certification.'};
 await context.schemaAdminPool!.query("UPDATE memberships SET role='reviewer' WHERE tenant_id=$1 AND user_id=$2",[demoTenantId,f.author]);assertError(await request('POST',url+'/review',f.session,{payload:decision}),403);
 assert.equal((await request('POST',url+'/review',context.demo!,{payload:decision})).statusCode,200);assert.equal((await request('POST',url+'/review',context.demo!,{payload:decision})).statusCode,200);assert.equal((await list()).json().items[0].state,'record_accepted');
 const edit={...f.fields,publisher:'Fictional corrected publisher attribution',annotation:'Fictional later assessment disputes attribution.',expectedVersion:1,reason:'Correct the supplied attribution without rewriting the original.'};const revised=await request('POST',url+'/revise',f.session,{payload:edit});assert.equal(revised.statusCode,200,revised.body);assert.equal((await list()).json().items[0].state,'pending');assert.equal((await request('GET',url+'/original',context.demo!)).json().sha256,f.evidence.digest);
 const withdrawal=await request('POST',url+'/withdraw',f.session,{payload:{expectedVersion:2,reason:'Withdraw disputed metadata while retaining every earlier assertion.'}});assert.equal(withdrawal.statusCode,200,withdrawal.body);assert.equal((await request('POST',f.base,f.session,{payload:f.input})).json().withdrawn,true);const history=(await request('GET',url+'/history',context.demo!)).json();assert.deepEqual(history.map((e:{record:{version:number}})=>e.record.version),[3,2,1]);assert.equal(history[2].review.accepted,true);assert.equal(history[2].record.publisher,f.fields.publisher);
 await assert.rejects(context.schemaAdminPool!.query('UPDATE manual_source_reviews SET accepted=false WHERE source_id=$1',[f.record.id]),/append.only/i);await assert.rejects(context.pool!.query('UPDATE manual_sources SET evidence_id=$1 WHERE id=$2',[randomUUID(),f.record.id]),/permission denied/);
 await context.app!.close();context.app=await createAppInstance();assert.equal((await list()).json().items[0].state,'withdrawn');const search=await request('POST',`/api/cases/${f.kase.id}/search`,context.demo!,{payload:{query:'corrected publisher',kind:'source_context',status:''}});assert.equal(search.statusCode,200,search.body);assert.equal(search.json().items[0].status,'Withdrawn source context');
});
test('manual source HTTP validation and access matrix denies unrelated actors, unsafe URLs and invented date precision',async()=>{
 const f=await manualSourceFixture(),other=await manualSourceFixture(),url=f.base+'/'+f.record.id,app=await createAppInstance(),address=await app.listen({host:'127.0.0.1',port:0});
 const call=async(method:string,path:string,session:TestSession,payload?:object)=>{const response=await fetch(address+path,{method,headers:{cookie:session.cookie,origin:allowedOrigins[0]!,...(payload?{'content-type':'application/json','x-csrf-token':session.csrf}:{})},...(payload?{body:JSON.stringify(payload)}:{})});await response.text();return response.status;};
 try{
  const invalid=[{url:'javascript:alert(1)'},{url:'file:///tmp/source'},{url:'https://user:secret@example.test/'},{url:'https://example.test/ has-space'},{url:'https://example.test\\path'},{url:'data:text/plain,test'},{url:'//example.test/'},{retrievedAt:'2026-02-30T00:00:00Z'},{retrievedAt:'2026-01-01'},{retrievedAt:'2026-01-01T00:00:00-00:00'},{retrievedAt:'2026-01-01T00:00:00+14:30'},{publisher:' '},{publisher:'x'.repeat(301)},{annotation:'\u0000'},{trustGrade:'true'},{retentionDays:366},{retentionDays:0},{termsReference:''}];
  for(const patch of invalid)assert.equal(await call('POST',f.base,f.session,{...f.input,id:randomUUID(),...patch}),422,JSON.stringify(patch));
  assert.equal(await call('POST',f.base,f.session,{...f.input,id:randomUUID(),evidenceId:other.evidence.id}),404);
  const client=await issueTestSession(await createMember(demoTenantId,'client','Fictional denied source recipient')),outsider=await issueTestSession(await createMember(demoTenantId,'investigator','Fictional unrelated source investigator'));
  for(const [session,status] of [[client,403],[outsider,404]] as const){for(const path of [f.base,f.base+'/originals',url+'/history',url+'/original'])assert.equal(await call('GET',path,session),status);assert.equal(await call('POST',url+'/withdraw',session,{expectedVersion:1,reason:'Fictional denied withdrawal'}),status);}
  assert.equal(await call('GET',f.base,context.demo!),200);assert.equal(await call('GET',url+'/original',context.demo!),200);
  await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,f.kase.id,f.author]);assert.equal(await call('GET',f.base,f.session),404);assert.equal(await call('POST',url+'/revise',f.session,{...f.fields,expectedVersion:1,reason:'Fictional revoked edit'}),404);
 }finally{await app.close();}
});
test('manual source integrity, current authority, audit rollback and conflicting corrections fail closed',async()=>{
 const f=await manualSourceFixture(),url=f.base+'/'+f.record.id,decision={id:randomUUID(),expectedVersion:1,digest:f.record.digest,accepted:true,reason:'Fictional independent source metadata check.'};
 const original=(await context.pool!.query('SELECT object_path FROM evidence WHERE id=$1',[f.evidence.id])).rows[0],path=resolve(context.storageRoot!,original.object_path),bytes=await readFile(path);await writeFile(path,'Fictional corrupted supplied capture');try{assertError(await request('GET',url+'/original',context.demo!),409);assertError(await request('POST',url+'/review',context.demo!,{payload:decision}),409);assertError(await request('POST',url+'/revise',f.session,{payload:{...f.fields,expectedVersion:1,reason:'Fictional edit with corrupt original'}}),409);}finally{await writeFile(path,bytes);}
 await context.schemaAdminPool!.query("CREATE FUNCTION deny_manual_source_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'manual_source.%' THEN RAISE EXCEPTION 'fictional source audit failure'; END IF; RETURN NEW; END $$");await context.schemaAdminPool!.query('CREATE TRIGGER deny_manual_source_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_manual_source_audit()');
 const id=randomUUID();try{assertError(await request('POST',f.base,f.session,{payload:{...f.input,id}}),500);assert.equal((await context.pool!.query('SELECT count(*)::int n FROM manual_sources WHERE id=$1',[id])).rows[0].n,0);assertError(await request('POST',url+'/review',context.demo!,{payload:decision}),500);assert.equal((await context.pool!.query('SELECT count(*)::int n FROM manual_source_reviews WHERE source_id=$1',[f.record.id])).rows[0].n,0);}finally{await context.schemaAdminPool!.query('DROP TRIGGER deny_manual_source_audit ON audit_events');await context.schemaAdminPool!.query('DROP FUNCTION deny_manual_source_audit()');}
 const edit={...f.fields,expectedVersion:1,reason:'Fictional concurrent correction'},results=await Promise.all([request('POST',url+'/revise',f.session,{payload:edit}),request('POST',url+'/revise',f.session,{payload:edit})]);assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);const current=(await request('GET',f.base,context.demo!)).json().items[0].record;
 await approveAuthority(f.kase.id);assert.equal((await request('GET',f.base,context.demo!)).json().items[0].state,'authority_changed');assertError(await request('POST',url+'/review',context.demo!,{payload:{...decision,expectedVersion:2,digest:current.digest}}),409);assert.equal((await request('POST',url+'/withdraw',f.session,{payload:{expectedVersion:2,reason:'Withdraw after authority supersession.'}})).statusCode,200);
});

test('real browser records supplied capture context, reviews metadata, reloads corrections and clears revoked source data',{skip:process.env.INVEOS_TEST_BROWSER!=='1',timeout:90000},async()=>{
 const f=await manualSourceFixture();await withBrowserApp(async(b,origin)=>{
  const ui=await binaryBrowserControls(b,origin,f.kase.id);await ui.click('Research');await eventually(async()=>(await ui.text()).includes('Manual source register'),'saved source register');
  const fill=async(form:string,values:Record<string,string|number>)=>b.evaluate(`(()=>{const f=document.querySelector('form[aria-label='+${JSON.stringify(JSON.stringify(form))}+']');for(const [name,value] of Object.entries(${JSON.stringify(values)})){const field=f.elements.namedItem(name);field.value=String(value);field.dispatchEvent(new Event(field.tagName==='SELECT'?'change':'input',{bubbles:true}));}})()`);
  const select=(publisher:string)=>b.evaluate(`Array.from(document.querySelectorAll('.source-record-choice')).find(e=>e.textContent.includes(${JSON.stringify(publisher)})).click()`);
  await select(f.fields.publisher);await ui.click('Verify linked original');await eventually(async()=>(await ui.text()).includes('Original bytes match the recorded digest.'),'source bytes verified');await fill('Source metadata review',{reason:'Fictional metadata reviewed with supplied attribution and uncertain retrieval retained.'});await ui.click('Accept source record');await eventually(async()=>(await ui.text()).includes('Metadata record accepted'),'independent metadata decision');
  await ui.click('Record supplied capture');await eventually(async()=>await b.evaluate<boolean>('!!document.querySelector(\'form[aria-label="Manual source editor"]\')'),'capture form');await fill('Manual source editor',{...f.fields,evidenceId:f.evidence.id,publisher:'Fictional second supplied context'});
  await b.evaluate(`(()=>{const original=window.fetch;window.fetch=async(...args)=>{const r=await original(...args);if(String(args[0]).endsWith('/manual-sources')&&args[1]?.method==='POST'&&r.ok){window.fetch=original;throw new Error('Fictional lost source receipt');}return r;};})()`);await ui.click('Save source context');await eventually(async()=>(await ui.text()).includes('Fictional lost source receipt')&&!await b.evaluate<boolean>('document.querySelector(\'form[aria-label="Manual source editor"] fieldset\').disabled'),'lost receipt retains source editor');await ui.click('Save source context');await eventually(async()=>(await ui.text()).includes('2 records')&&!await b.evaluate<boolean>('!!document.querySelector(\'form[aria-label="Manual source editor"]\')'),'creation replay recovers one record');assert.equal((await context.pool!.query('SELECT count(*)::int n FROM manual_sources WHERE case_id=$1',[f.kase.id])).rows[0].n,2);
  await select(f.fields.publisher);await ui.click('Correct source context');await fill('Manual source editor',{publisher:'Fictional corrected source attribution',annotation:'Fictional later correction preserves the first account.',reason:'Fictional correction of supplied publisher attribution.'});await ui.click('Save source correction');await eventually(async()=>(await ui.text()).includes('Fictional corrected source attribution')&&!await b.evaluate<boolean>('!!document.querySelector(\'form[aria-label="Manual source editor"]\')'),'source correction saved');
  const previous=await b.evaluate<number>('performance.timeOrigin');await b.send('Page.reload');await eventually(async()=>await b.evaluate<number>('performance.timeOrigin')!==previous&&(await ui.text()).includes('Fictional corrected source attribution'),'source correction survives reload');await select('Fictional corrected source attribution');await ui.click('Source context history');await eventually(async()=>(await ui.text()).includes('Source version 1'),'source history');await b.evaluate('Array.from(document.querySelectorAll(\'[aria-label="Source context history"] details\')).forEach(d=>d.open=true)');assert.ok((await ui.text()).includes(f.fields.publisher));assert.ok((await ui.text()).includes(f.fields.retrievedAt));assert.ok((await ui.text()).includes('Metadata accepted by'));
  await b.evaluate('document.querySelector(\'[aria-label="Selected source record"]\').scrollIntoView()');assert.ok(await b.evaluate<boolean>('(()=>{const row=document.querySelector(".manual-source-panel .metadata>div");return Math.abs(row.querySelector("dt").getBoundingClientRect().top-row.querySelector("dd").getBoundingClientRect().top)<=4;})()'));const artifact=fileURLToPath(new URL('../../../output/evals/manual-source-desktop.png',import.meta.url));await mkdir(resolve(artifact,'..'),{recursive:true});const shot=await b.send<{data:string}>('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(artifact,Buffer.from(shot.data,'base64'));
  await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.ok(await b.evaluate<boolean>('document.documentElement.scrollWidth<=window.innerWidth+1'));
  await context.schemaAdminPool!.query('DELETE FROM case_memberships WHERE tenant_id=$1 AND case_id=$2 AND user_id=$3',[demoTenantId,f.kase.id,demoUserId]);await ui.click('Refresh source register');await eventually(async()=>await b.evaluate<boolean>('!!document.querySelector(".manual-source-panel .form-error")&&!document.querySelector(\'[aria-label="Selected source record"]\')&&!document.querySelector(\'[aria-label="Source context history"]\')'),'revoked source data cleared');
 });
});
