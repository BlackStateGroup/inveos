# Frozen document-backed report lineage

29 October 2026. R1 implementation, continuing draft PR #63. Internal synthetic lab only; no merge, deployment or incorporation approval.

## Behaviour and reference contract

The existing current-report and report-revision endpoints now include independently accepted document findings in a separate optional `documentFindings` array. Existing `findings` remain original-UTF-8 references with their unchanged original-byte contract. Each document entry is tagged `derived_document` and records its immutable original identity/digest, acquisition authority, distinct extraction authority/job/attempt/time, exact processing profile and hashes, selected candidate identity/digest, page/region/coordinate origin and extracted-UTF-8 range. Correspondence acceptance and interpretation acceptance retain separate identities, digests, reviewer identities, times and reasons. The quoted text is never interpreted as PDF byte offsets.

The report builder reuses the existing complete source/raw/normalised/citation/review/claim/decision verifier in the same scoped repeatable-read transaction. Current active extraction authority and the exact latest accepted correspondence decision are mandatory. A later acceptance with a different review identity does not silently rehabilitate an earlier finding. Findings require a fresh proposal/decision bound to that replacement. Rejected, superseded, corrupt or unavailable references fail the whole new report rather than disappearing from it.

Both reference types share the existing 1,000-finding and 32 MiB JSON limits. Entries are yielded one at a time to the shared budget. Document claim/review history bounds still apply. Frozen snapshots reuse existing append-only storage, audit, concurrent idempotency and restart semantics. Repeating an already committed freeze returns its historical receipt, even if the current source or review subsequently changes; this is recovery, not fresh approval. Download checks the stored snapshot digest. Explicit source verification rechecks only the frozen finding set against current records; newer unrelated findings do not alter that set.

The complete browser print view displays document interpretations separately, including exact quote, page/region, reviewer reasons, original/extraction/citation fingerprints and limitations. Failed fresh preparation clears the old verified preview. The browser's print callback is exercised in acceptance tests; generated PDF layout/fidelity is not certified by those tests.

## Deliberate intermediate gate

This snapshot records lineage fingerprints, not a self-contained derivative exhibit package. The existing Python report/package verifier explicitly rejects any `documentFindings` field, including empty or malformed values, so it cannot silently verify only the old array. Client disclosure is blocked for these snapshots even after independent internal report acceptance. R2 must implement bounded original/raw/canonical/candidate/review exports and independent replay; R3 must then qualify release/browser integration. Legacy original-only reports remain supported. Hashes are not signatures, evidence admissibility, truth or production readiness.

## Reproduce and tests

Use the existing local application instructions and restricted PostgreSQL test role. From repository root:

```bash
npm ci --no-audit --no-fund
npm run lint
npm run typecheck
npm run build
python3 -m unittest discover -s tests -v
INVEOS_TEST_BROWSER=1 npm test --workspace @inveos/api
```

The API harness requires `INVEOS_TEST_ADMIN_DATABASE_URL` and `INVEOS_TEST_DATABASE_URL` for a disposable database. The hosted Checks workflow supplies them and sandboxed Chrome. Four new actual-database/browser scenarios cover document-only snapshots, concurrent retries/restart, exact hashes, independent-review and disclosure denial, scoped access, stale review/authority, historical-byte preservation, audit rollback, changed originals and browser print preparation/clearing. A Python regression prevents ignored derivative fields. Fixtures reuse recorded fictional native-parser output: these are not fresh parser benchmarks.

Local lint/types/build and 102 Python tests passed. Hosted database/browser execution is pending publication; no passing result is claimed here until its exact receipt is recorded.

## Privacy, rollback and remaining work

No dependencies, migrations, live collection, third-party source or production services are added. Report downloads expose full internal reviewed wording and provenance to existing authorised internal users; current access checks remain mandatory. Preserve stored revisions during rollback. Older readers/verifiers do not understand the new field and must not be used to review or release document-backed snapshots; restore matching code or forward-fix the reader. R2/R3, comparative Tika/OCRmyPDF experiments, native devices, identity/storage and external sign-offs remain open in the active delivery plan.
