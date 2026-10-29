# Independent citation correspondence review

29 October 2026. Implements the C1/C2 slice of [the remaining delivery plan](71_REMAINING_DELIVERY_PLAN.md), on draft PR #61. A correspondence decision assesses whether an extracted passage/region matches its source. It does not establish source truth, approve a claim's interpretation, create a finding, clear quarantine or grant report/disclosure eligibility.

Migration 025 adds append-only review records. GET/POST `/api/cases/:caseId/integrity-jobs/:jobId/document-citations/:citationId/reviews` reverify original bytes, raw/normalised extraction, candidate and the complete bounded review chain before returning anything. Replies are no-store/nosniff and reads/writes are audited. Client roles cannot read; only a case-assigned reviewer other than the candidate author can write. New decisions require an active case and current authority matching the extraction. Recovering the same already-recorded decision remains a historical read/retry after authority changes; it grants no new approval.

POST body: `{id,previousReviewId,citationDigest,decision,reason,originalCompared}`. `id` is a stable UUID, predecessor is null for the first review, decision is `accepted` or `rejected`, and reason is non-blank and at most 4096 UTF-8 bytes. Acceptance requires explicit `originalCompared:true`. This is a recorded human attestation, not proof the human performed the comparison. Rendering alone cannot satisfy it. A replacement supplies the last review UUID; case locking and sequence uniqueness reject stale concurrent decisions. History is bounded at 100 decisions per candidate, with no destructive pruning. Each canonical record binds the exact candidate/context, predecessor ID/digest, reviewer, timestamp, decision and reason. Alterations are not updates: the earlier decisions remain intact.

The browser exposes exact candidate identity and reasoned accept/reject controls, verifies every review digest and predecessor and displays current status separately from immutable candidate status. Lost POST responses retain the request in component memory for idempotent recovery; after navigation/reload, reload server history before making another decision. No review reason or attestation is written to browser storage. HTTP errors clear displayed review history; fresh reads still enforce revocation. There is no push invalidation or independently signed reviewer identity.

## Reproduce

Run `npm run lint`, `npm run typecheck`, `node --import tsx --test apps/api/test/document-derivative.test.ts`, `npm run test:foundation`. Use the disposable PostgreSQL/browser environment in `.github/workflows/checks.yml` and run `INVEOS_TEST_BROWSER=1 npm test --workspace @inveos/api`.

New database tests cover concurrent identical retries and competing replacements, restart, immutable history, no finding creation, reviewer/self-review/CSRF/scope/current-authority controls, audit rollback, and review/source corruption. The browser test uses a candidate authored by another fictional investigator, accepts correspondence, loses/retrieves the response, records a replacement rejection and reloads both decisions. Helper tests reject fabricated/rehashed review states and predecessors. Fixtures replay previously recorded fictional parser output; no fresh parser execution is claimed.

Local lint/type checks, 16 focused tests and 101 Python tests pass. Hosted database/browser checks are pending at this checkpoint.

## Rollback and remaining criteria

Disable review writes/UI if rolling back; retain immutable migration/history. Derived claims/findings, report freezing, independent derivative export and release integration are the next separate gates C3/R1–R3. Review decisions must be revalidated when those gates are implemented, including latest rejection and authority changes. Full product, native/device/offline, comparative parser, runtime/licence/security and production/pilot approvals remain open. Nothing merged or deployed.
