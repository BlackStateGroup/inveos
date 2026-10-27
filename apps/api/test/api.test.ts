import { fileURLToPath } from 'node:url';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { claimIntegrityJob, finishIntegrityJob, runIntegrityJob } from '../src/integrity-jobs.js';
import { createApp } from '../src/app.js';
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
  await context.schemaAdminPool!.query(
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
    assert.deepEqual(result.rows.map(r => r.filename), ['001_foundation.sql', '002_casework.sql', '003_binary_originals.sql', '004_integrity_jobs.sql']);
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
  await context.schemaAdminPool!.query('UPDATE claims SET source_start_byte=$4, source_end_byte=$5 WHERE tenant_id=$1 AND case_id=$2 AND id=$3', [demoTenantId, kase.id, claim.id, midpoint, midpoint + 1]);
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
