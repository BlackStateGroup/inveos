import {createServer,request as proxyRequest} from 'node:http';
import {launchBrowser,eventually} from './support/browser.js';
import {uploadBinaryChunks} from '../../web/src/chunkUpload.js';
import {prepareBinary,binaryIntakeScope,sendBinaryRecoverably} from '../../web/src/binaryIntake.js';
import { fileURLToPath } from 'node:url';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { claimIntegrityJob, dispatchIntegrityJobs, finishIntegrityJob, runIntegrityJob } from '../src/integrity-jobs.js';
import { createApp } from '../src/app.js';
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

async function createAppInstance(): Promise<FastifyInstance> {
  const app = await createApp({
    pool: context.pool!,
    storageRoot: context.storageRoot!,
    allowedOrigins,
    demoTenantId,
    demoUserId,
    sessionTtlSeconds: 3600,
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
    assert.deepEqual(result.rows.map(r => r.filename), ['001_foundation.sql', '002_casework.sql', '003_binary_originals.sql', '004_integrity_jobs.sql', '005_text_derivatives.sql', '006_claim_source_identity.sql', '007_report_revisions.sql', '008_report_revision_listing.sql', '009_job_history_indexes.sql', '010_dispatch_candidates.sql', '011_upload_reservations.sql', '012_upload_maintenance.sql', '013_upload_history.sql', '014_report_review.sql', '015_report_disclosures.sql', '016_disclosure_recipient_index.sql', '017_disclosure_acknowledgements.sql', '018_disclosure_case_history.sql']);
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
 assert.deepEqual(first.items.map(r=>r.id),expected.slice(0,2));assert.deepEqual(Object.keys(first.items[0]!).sort(),['createdAt','expiresAt','id','revisionId','sha256']);assert.equal(first.nextBefore,expected[1]);
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
 const dist=fileURLToPath(new URL('../../web/dist/',import.meta.url));let apiAddress='';
 const server=createServer((req,res)=>{void(async()=>{
  const pathname=new URL(req.url!,'http://localhost').pathname;
  if(pathname.startsWith('/api/')){const upstream=proxyRequest(apiAddress+req.url,{method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode!,response.headers);response.pipe(res);});upstream.on('error',()=>{res.statusCode=502;res.end();});req.pipe(upstream);return;}
  if(pathname==='/portal'){res.setHeader('content-type','text/html');res.end(await readFile(join(dist,'index.html')));return;}
  if(/^\/assets\/[A-Za-z0-9_.-]+\.(js|css)$/.test(pathname)){res.setHeader('content-type',pathname.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(join(dist,pathname.slice(1))));return;}
  res.statusCode=404;res.end();
 })().catch(()=>{res.statusCode=500;res.end();});});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address() as {port:number};const origin='http://127.0.0.1:'+address.port;
 const app=await createApp({pool:context.pool!,storageRoot:context.storageRoot!,allowedOrigins:[...allowedOrigins,origin],demoTenantId,demoUserId,sessionTtlSeconds:3600});
 let browser:Awaited<ReturnType<typeof launchBrowser>>|undefined;
 try{
  apiAddress=await app.listen({host:'127.0.0.1',port:0});browser=await launchBrowser();const b=browser;
  t.diagnostic('Browser runtime: '+JSON.stringify(await b.send('Browser.getVersion')));
  await b.send('Network.enable');for(const pair of f.clientSession.cookie.split('; ')){const split=pair.indexOf('=');await b.send('Network.setCookie',{name:pair.slice(0,split),value:pair.slice(split+1),url:origin,path:'/',sameSite:'Strict',httpOnly:pair.startsWith('inveos_session=')});}
  const downloads=join(b.root,'downloads');await mkdir(downloads);await b.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  await b.send('Page.navigate',{url:origin+'/portal'});
  const text=()=>b.evaluate<string>('document.body.innerText');
  const click=async(label:string)=>{await b.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)});if(!button||button.disabled)throw new Error('Button unavailable');button.click();})()`);};
  await eventually(async()=> (await text()).includes('Refresh disclosures'),'portal render');await click('Refresh disclosures');await eventually(async()=> (await text()).includes(grant.id),'recipient grant discovery');
  assert.equal(await b.evaluate("fetch('/api/workspace').then(r=>r.status)"),403);
  await click('Verify and download snapshot');await eventually(async()=> (await readdir(downloads)).includes('disclosure-'+grant.id+'.json'),'actual browser download');assert.equal(createHash('sha256').update(await readFile(join(downloads,'disclosure-'+grant.id+'.json'))).digest('hex'),grant.sha256);
  await eventually(async()=> (await text()).includes('Acknowledge receipt'),'receipt controls');await b.evaluate("document.querySelector('input[type=checkbox]').click()");await click('Acknowledge receipt');await eventually(async()=> (await text()).includes('Receipt acknowledged at'),'acknowledgement confirmation');
  assert.equal((await context.pool!.query('SELECT count(*)::int AS n FROM report_disclosure_acknowledgements WHERE disclosure_id=$1',[grant.id])).rows[0].n,1);
  await request('POST',`/api/cases/${f.kase.id}/disclosures/${grant.id}/revoke`,context.demo!,{payload:{reason:'Fictional browser withdrawal check'}});await click('Verify and download snapshot');await eventually(async()=> (await text()).includes('Download denied or unavailable'),'stale grant denied');
  await click('Refresh disclosures');await eventually(async()=> (await text()).includes('No currently available disclosures'),'withdrawn grant disappears');
  await click('Sign out');await eventually(async()=> (await text()).includes('Session ended.'),'client sign-out');assert.equal(await b.evaluate("fetch('/api/portal/disclosures').then(r=>r.status)"),401);
 }finally{await browser?.close();await app.close();server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
