# Immutable text derivatives in the synthetic lab

27 October 2026. This extends the durable jobs in [28](28_DURABLE_INTEGRITY_JOBS.md) with an actual first-party UTF-8 line processor. It is an incremental WP-05 lineage slice, **not a PDF/OCR parser, page/region citation implementation or complete product**. PR #2's Docling/Tika/OCRmyPDF decision and runtime approval gates still apply.

## Behaviour and provenance

Enqueue `kind: "utf8_line_index_v1"` using the existing authenticated, CSRF-protected `POST /api/cases/:caseId/integrity-jobs` with `evidenceId` and a fresh UUID `idempotencyKey`. Omitted kind retains the original SHA-256 check. Reusing a key for a different evidence ID or kind returns 409. Unknown kinds or provenance fields return 422. Binary originals return 409; their existing quarantine remains in force.

The existing trusted consumer now dispatches either permitted kind. It reads at most 256 KiB from the scoped original, verifies length/SHA-256, decodes strict UTF-8 without stripping BOM, and produces deterministic JSON containing the exact text and ordered line byte ranges. CRLF, CR and LF delimiters remain in the text. Each line records one-based `line`, zero-based inclusive `startByte`, exclusive `endByte` before its delimiter, and exclusive `nextByte` after its delimiter. Empty lines are explicit; a terminal delimiter does not invent an extra line. There are at most 4,096 lines and 1 MiB of serialised output. Over-limit/invalid text fails with `text_limits`, with no derivative. No page number, bounding box, language, entity or factual assertion is inferred.

Migration 005 stores output bytes in an append-only PostgreSQL `bytea` row, separately from original evidence. It records:

- Exact tenant/case/evidence identity, original digest, processing authority version, job and successful attempt.
- Processor identifier/version, SHA-256 of the first-party processor source module actually read by the worker, configuration bytes/digest and Node runtime version.
- Exact output bytes/digest and server processing time. Source and receipt times remain separate original evidence fields.

The source-module digest is **not** an image digest, resolved runtime SBOM or proof that the runtime is approved. The existing application lockfile remains the dependency inventory for this first-party consumer. No new dependency, external service, model or third-party source is incorporated. Changed algorithm/configuration semantics must have a new processor/job version; do not silently reinterpret persisted v1 results.

Job success, success event and derivative insert commit in one transaction. A deferred database constraint blocks successful text jobs without their result, and a composite foreign key binds the result to the job's exact lineage. Results require the successful matching attempt and cannot be updated/deleted by application credentials. Any result-insertion failure rolls success back; the existing scoped lease-expiry/retry path recovers it. Stale/cancelled/authority-invalid attempts cannot attach a result. A new idempotency key creates a separately attributed run; equal output digests do not collapse run/acquisition identities.

`GET /api/cases/:caseId/integrity-jobs/:jobId/derivative` requires current internal case membership. It returns 404 until a result exists, denies clients, and re-reads/re-hashes the original, verifies configuration/output hashes and independently reconstructs expected lines before returning an `unreviewed_derivative` response. Corruption, including fabricated offsets with a matching replacement output digest, returns 409. Each successful read adds a case audit event. Output contains no object path or lease token. Historical results retain their processing authority version; reading does not reauthorise dispatch under an obsolete version. There is no public result-write or worker-completion endpoint.

## Reproduce

Use a disposable synthetic database and the existing [local application setup](23_LOCAL_APPLICATION.md). Run ordered migrations with the administrative migration credentials, then API and worker with the restricted application credentials. Supply an ordinary fictional UTF-8 original through the existing intake flow and approve current case authority. Enqueue:

```json
{"evidenceId":"<existing evidence UUID>","idempotencyKey":"<fresh UUID>","kind":"utf8_line_index_v1"}
```

The response contains the job UUID. From the repository root with the configured synthetic `.env`:

```bash
node --env-file=.env --import tsx apps/api/src/run-integrity-job.ts TENANT_UUID CASE_UUID JOB_UUID
```

Read job status and then its `/derivative` route with the existing internal session cookie. The command handles one explicitly scoped job; there is still no automatic dispatcher. The CLI name is retained for backwards compatibility; only its fixed internal job kinds execute. Standalone CLI invocation is not separately tested; actual library dispatch, PostgreSQL writes and TCP HTTP result retrieval are tested.

Local checks:

```bash
npm run lint
npm run typecheck
npm run build
node --import tsx --test apps/api/test/text-derivative.test.ts
npm run test:foundation
```

With disposable `INVEOS_TEST_DATABASE_URL` and `INVEOS_TEST_ADMIN_DATABASE_URL`, run `npm test --workspace @inveos/api`. The hosted workflow supplies PostgreSQL 15 and a non-superuser application role. It runs four processor tests and 32 PostgreSQL API tests, including four new derivative scenarios and inherited real HTTP/package checks. Tests cover Unicode/BOM/repeated lines/newline forms, bounds, deterministic hashes, immutable metadata, acquisition versus processing authority, concurrent workers/restart, API scope/client/revocation, binary rejection, transaction rollback/retry, stale completion and original/output tampering. See BUILD_HANDOFF.md for exact executed receipts; commands alone are not evidence of a pass.

## Boundaries, privacy and rollback

This first-party text operation does not execute upstream decoders. The namespace probe still fails with `Operation not permitted`; no attempt bypasses it. PDF/OCR experiments, resolved parser artefacts/licence approvals, malware checks and worker OS isolation remain blocked/unrun. Full PDF derivative chains, page/region review, derivative claim/export contracts, UI controls, scheduler/heartbeats and production worker-specific credentials remain unfinished. Existing original-byte manual review/report behaviour is preserved; this processor creates no claims, reviews or findings.

The local store and database remain trusted lab resources, not encrypted/WORM production custody. Hashes and append-only permissions are not signatures, factual proof or administrator-resistant anchors. Read-time checks observe current bytes; they do not prevent later disk modification. No new browser/native/offline/restore or production acceptance is claimed. Fixtures are fictional; no collection, transmission to an external processor, client release, deployment or automatic merge occurs.

Do not rewrite migration 004 or remove result rows to roll back. A prior API binary does not understand the new kind; stop dispatching new text jobs before any downgrade and retain the upgraded consumer/reader for persisted work. Prefer a reviewed forward fix. A database rollback requires a verified matching database/original-store backup and remains untested here.
