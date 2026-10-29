# Bounded quarantined binary-original intake

27 October 2026. Partial WP-02 delivery, building on the draft PR stack through #5. This adds an API path for preserving opaque source bytes without treating their extracted text as an original or invoking a parser. It does not complete document processing or secure production storage.

## Implemented boundary

`POST /api/cases/:caseId/evidence/binary` accepts canonical standard base64 for **1 byte to 256 KiB**, a safe filename, expected SHA-256, source timestamp with explicit timezone, acquisition method and UUID idempotency key. It uses the existing session, Origin/CSRF, tenant membership, case assignment, active-case and versioned-authority gates. Client role access is denied.

The server decodes once, checks the exact bytes and server digest, writes a new mode-0600 `.bin` object in the existing tenant/case store, fsyncs through the existing storage helper, and creates the immutable evidence row and audit event in one database transaction. No binary byte is decoded as text, normalised, rendered, scanned or executed. The original filename is metadata and cannot choose an object path. No MIME or format validation is claimed: a `.pdf` filename is not evidence of a valid PDF.

Binary receipts have `originalKind: opaque_binary`, `status: Quarantined`, an empty `text` field and `kind: Binary (unprocessed)`. SHA-256 agreement confirms only byte equality. Quarantine means **unscanned and unprocessed**; it is a policy state in the existing restricted local store, not a tested malware sandbox or separate encrypted vault. There is no transition to cleared/released in this slice.

The original UTF-8 endpoint keeps its old body and request-hash representation. Existing rows migrate to `original_utf8`/`Verified`. Both paths share the existing tenant/case/user/idempotency namespace; changed requests or switching representations with a reused key conflict. Identical retries return the original receipt and intake authority version, including after later authority changes. Separate acquisitions receive distinct evidence IDs even when bytes match. Successful retries rehash the stored original and reject missing/corrupt objects.

The workspace preserves `Quarantined` after independently verifying storage, and returns no binary content as text. Assigned internal actors can retrieve byte-exact originals through the existing download route, always as an attachment with `application/octet-stream`, `nosniff` and `X-INVEOS-Original-State: Quarantined`. This explicit original retrieval does not clear quarantine. Never open untrusted downloads outside an appropriate isolated environment.

Original-text claim creation, acceptance/replay and report generation reject binary evidence. A database trigger additionally blocks original-byte claims referencing binary rows even through the application database role. There is no derivative citation fallback. Authority/evidence/review/finding append-only protections remain in place. Declared JSON schemas now reject additional properties rather than silently removing them, including attempted `status`/`originalKind` overrides. Filenames containing unpaired Unicode surrogates are rejected before storage/download encoding.

## Exercise with fictional bytes only

Use the local lab and development session described in [the application instructions](23_LOCAL_APPLICATION.md). The endpoint requires the same cookies, allowed Origin and CSRF header as text intake. A representative JSON request body is:

```json
{
  "filename": "fictional-opaque-source.bin",
  "contentBase64": "YQ==",
  "expectedSha256": "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
  "sourceTime": "2026-01-12T10:30:00+01:30",
  "method": "Fictional one-byte integrity fixture; not a document",
  "idempotencyKey": "11111111-1111-4111-8111-111111111111"
}
```

That body represents one fictional byte `a`, not a real PDF. The API tests additionally use null bytes and invalid UTF-8 to prove binary preservation. Do not route base64 or extracted PDF text through the text-original endpoint.

```bash
npm run db:migrate
npm run lint
npm run typecheck
npm run build
npm run test:foundation
# With the documented disposable PostgreSQL credentials:
npm test --workspace @inveos/api
```

`runMigrations` reuses the ordered, checksummed migration ledger from concurrent draft PR #6 (`1e3992a9a04d607a93ab09a4e13b25197b4f3d97`), under its transaction/advisory lock. The binary migration is `003_binary_originals.sql`, reserving PR #6's `002_casework.sql` rather than duplicating its sequence number. PR #6 casework tables/UI are not incorporated in this branch. The new migration adds an immutable original-kind discriminator, enforces the kind/status pair and installs the claim guard. No original bytes or existing digest/pointer/authority values are rewritten.

## Tests and limits

Four new API/database tests cover binary byte round-trip including invalid UTF-8, quarantine metadata, canonical base64/digest/size/source-time/filename validation, no-authority/client/unassigned/foreign-tenant/cross-case/CSRF denial, concurrent identical retries, changed retries, retained authority version, distinct acquisitions, application and database claim denials, no binary data in workspace text, restart, repeat migration, legacy populated-schema upgrade and tampering. A deliberate insert constraint failure after object creation verifies database/audit rollback, object cleanup and a successful later retry. Existing seven tests retain the text review/report and offline package path.

See `BUILD_HANDOFF.md` for actual local and hosted results. No local PostgreSQL, new browser/device, live parser, malware scan, interrupted-chunk, host-crash/restore or worker-isolation execution is claimed. This is bounded API intake; the current browser uploader remains text-only and has no binary preview or upload controls. Its inventory displays binary kind/quarantine metadata but has not undergone new browser acceptance.

Remaining WP-02 gates include resumable reservations/chunks, interruption/commit-ambiguity recovery, encrypted object storage, malware scanning/isolation, hold/retention and independently anchored custody. A database commit whose acknowledgement is lost can still leave uncertain object/receipt state under the inherited storage transaction design; controlled rollback tests are not crash consistency proof. File immutability here is the existing no-overwrite application path and append-only rows, not WORM or protection from a privileged host administrator.

Next: durable tenant/case/evidence/authority-scoped processing jobs and immutable derivative lineage, followed by isolated parser tests and human-reviewed original-page citations. No worker should parse quarantined originals until its isolation and selected runtime artefacts are verified. Parser isolation is still blocked in this host. No third-party parser/dependency/model has been incorporated.

## Rollback and privacy

No deployment or automatic migration is performed by this PR. Review and apply in the disposable lab first. Do not revert to the old application while binary rows remain: the old workspace assumes all originals are text. To roll back safely, stop the development application and restore a verified pre-migration database **and matching object-store snapshot**, or keep the upgraded reader and disable the binary route. Do not drop the discriminator or relabel binary rows to `Verified`; do not delete originals to make an unsafe downgrade work. The automated legacy-upgrade test does not establish backup restore acceptance.

Use synthetic fixtures only. The feature adds no external service, telemetry, collection, dependency or licence approval. Downloads contain complete originals and are not client releases. Production identity, encrypted storage, legal/privacy approval and security assessment remain outstanding.
