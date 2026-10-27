# Bounded preview reads and audited original downloads

27 October 2026. Synthetic lab, incremental on the bounded processing dispatcher. No new parser, dependency, schema, original format or release permission.

## Changes

The workspace previously read each stored original with unbounded `readFile` before checking its digest. A replaced oversized file could consume excessive memory; a FIFO could hold the request open; a symlink to matching bytes could be accepted. The workspace now uses the existing maximum-plus-one bounded regular-file reader used by workers, review and reports: 256 KiB maximum, `O_NOFOLLOW` and `O_NONBLOCK`, regular-file check and original length/digest verification. Remove the now-unused unbounded original reader to prevent accidental reuse.

Valid UTF-8 originals still display exact text. Valid opaque binary originals retain empty text and their Quarantined state. Read errors, non-regular files, final-component symlinks and oversized replacements display Original unavailable with empty text; readable bytes whose length/digest differ display Integrity mismatch with empty text. This does not change immutable evidence metadata or repair corrupt originals. Workspace responses now include `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

The existing `GET /api/cases/:caseId/evidence/:evidenceId/original` route now verifies bytes and records `evidence.original_read` in the same database transaction as scoped lookup, before sending any original. Audit metadata contains original SHA-256, byte length, original kind and acquisition authority version. The summary says **Verified original prepared for download**, because the server cannot prove the recipient received or opened the bytes. Repeated authorised requests create separate access events. Audit failure denies delivery with the existing generic server error; integrity failure creates no successful-read event. Existing tenant/case/internal-role checks, attachment disposition, escaped filename and opaque-binary content type remain. Add no-store headers on the handler's success and error paths; authentication/schema rejection happens before the handler and is not newly covered by these headers.

These checks do not make the local store encrypted, WORM, malware-scanned or tamper-proof against administrators. `O_NOFOLLOW` protects the final path component, not hostile ancestor-directory substitution; the storage root and its directories remain trusted lab administration. Per-original bounds do not bound total workspace rows, response size, RSS or concurrency. Permission checks do not cancel an already authorised in-flight download when membership is revoked. Workspace preview reads are not individually audited in this slice; the new access event covers explicit original downloads. Production access telemetry, scoped storage, pagination and complete revocation semantics remain open.

## Reproduce and evidence

Use the existing local lab instructions with fictional data only. A valid original preview and original download still use the same routes and UI. Inspect the case activity history for the new prepared-download event; it does not claim client acknowledgement or release.

```bash
npm ci --no-audit --no-fund
npm run lint
npm run typecheck
npm run build
npm run test:foundation
# Disposable PostgreSQL credentials as in .github/workflows/checks.yml:
npm test --workspace @inveos/api
```

Local lint/types/build pass. Three added PostgreSQL scenarios are pending hosted execution; record the actual result in `BUILD_HANDOFF.md`:

- Actual loopback HTTP workspace requests accept a 256 KiB fictional original and reject an oversized replacement, same-sized corruption, a symlink to identical bytes, a directory, a FIFO with no writer and a missing file. Restore verifies the original preview again. Requests have a five-second timeout; the application must reject the FIFO without waiting for a writer.
- Actual HTTP text and arbitrary-byte binary downloads return exact original bytes as attachments, no-store/nosniff and unchanged quarantine state. Committed audit metadata is scoped and minimal, preserving acquisition authority after the current authority changes. No finding is created.
- An administrative test trigger rejects only the new read-audit insertion. The route returns no original; no successful event commits. A subsequent retry succeeds, while corrupt originals and client, outsider, foreign-tenant, wrong-case and revoked access cannot create successful-read events.

The existing full API, independent verifier, process-failure and migration suites remain required. These are API/database and local filesystem tests, not browser rendering/download acceptance, OS sandbox evidence, host restore or live storage acceptance. No third-party source or runtime artifact was introduced. Roll back the application code to the prior revision if necessary; retain the append-only access events. No migration reversal, evidence rewrite, merge or deployment.
