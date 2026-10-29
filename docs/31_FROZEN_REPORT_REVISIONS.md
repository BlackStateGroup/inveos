# Frozen internal report revisions

27 October 2026. WP-07 incremental lab API; not client release or production readiness.

The existing `GET /api/cases/:caseId/report` now builds its case, reviewed findings, source policy and working context through one PostgreSQL REPEATABLE READ transaction. Original files are independently rehashed; filesystem reads are not a database snapshot or object-lock guarantee.

`POST /api/cases/:caseId/report-revisions` accepts only `{"idempotencyKey":"<fresh UUID>"}` with the existing internal session, exact origin and CSRF token. It freezes the existing report format as exact UTF-8 JSON bytes in an append-only row, with SHA-256, creator, case and server creation time. The response contains `id`, `caseId`, `status: draft_not_released`, `sha256` and `createdAt`. No client-supplied narrative, hashes or approval fields are accepted. A reviewed finding is required. Limits are 1,000 findings and 32 MiB of serialised report bytes.

Retrying the same key as the same actor/case returns the original receipt even after case edits. A fresh key creates a new revision. Concurrent duplicate inserts resolve through the unique constraint and up to three complete snapshot-transaction attempts on serialization conflict. Revision and audit insert commit together. No original, claim, review or earlier revision is overwritten.

`GET /api/cases/:caseId/report-revisions/:revisionId` checks internal membership and role, rehashes the stored bytes, audits download and returns the exact JSON attachment with `Cache-Control: no-store`, `nosniff` and `X-INVEOS-Report-SHA256`. Access is evaluated against the transaction-start database snapshot; it is not a guarantee that revocation after that snapshot stops an in-flight response. Clients, unrelated cases and revoked assignments are denied on subsequent requests. Historical reports deliberately retain their embedded original bytes and verified review ranges: later source-store corruption prevents a new freeze but does not rewrite an earlier export.

Retain the receipt digest separately and verify the downloaded JSON:

```bash
python3 tools/verify_report.py frozen.json --expected-sha256 RETAINED_DIGEST --expected-case-id CASE_UUID
python3 tools/report_package.py build frozen.json exhibits.zip --expected-report-sha256 RETAINED_DIGEST
```

A hash stored beside the report does not authenticate a privileged rewrite of both. No signatures, external custody anchors or immutable physical storage are claimed. Exports include full cited originals and remain internal sensitive downloads; no external recipient or live data is used here.

## Verification and rollback

Run ordered migrations (007 adds only `report_revisions`), `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:foundation`, and `npm test --workspace @inveos/api` with the disposable PostgreSQL test credentials. Four new database scenarios cover concurrent idempotency, restart, edits/new revisions, original corruption versus historical bytes, actual offline verification, role/case/CSRF/revocation, immutable rows, deliberate stored-byte corruption rollback when audit fails, and a real second-connection edit committed between assembler queries with actual TCP download verification. Exact executed receipts are in BUILD_HANDOFF.md; hosted [Checks run #24](https://github.com/BlackStateGroup/inveos/actions/runs/40526873736) passed 39 PostgreSQL API tests, four processor tests and 42 Python tests at `ec923c9076daca78f3b9934f386c4f43e759529b`.

No dependencies or third-party source added. No browser controls are introduced; new browser/native/offline/restore/parser checks are unrun. UI revision selection, bounded streaming assembly for large cases, signed custody, PDF/DOCX/redaction and client approval/release remain open. Parser isolation and runtime licence gates remain unchanged. Do not label a frozen internal draft as a released report.

Rollback may leave the append-only table intact; preserve its records and use a reviewed forward migration for fixes. Do not rewrite applied migrations. Restoring a matching database/object-store backup is an operational gate still untested here. Nothing is merged or deployed.
