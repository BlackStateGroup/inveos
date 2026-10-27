import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { createPool, runMigrations } from '../src/db.js';
import type { Case, Evidence, ReportDraft, Workspace } from '@inveos/contracts';

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

async function issueTestSession(userId: string): Promise<TestSession> {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(32).toString('base64url');
  await context.schemaAdminPool!.query(
    `INSERT INTO sessions (token_hash, id, csrf_hash, tenant_id, user_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + interval '1 hour')`,
    [digest(token), randomUUID(), digest(csrf), demoTenantId, userId],
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
  }

  const clientId = await createMember(demoTenantId, 'client', 'Synthetic internal API client');
  const clientSession = await issueTestSession(clientId);
  assertError(await request('GET', '/api/workspace', clientSession), 403);
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
