# Durable document citation candidates

29 October 2026. Continues PR #59. Migration 024 creates append-only document citation candidates referencing the exact tenant/case/extraction job. They are separate from claims, reviews and findings; no route can promote one or release it to clients.

Internal POST and GET `/api/cases/:caseId/integrity-jobs/:jobId/document-citations/:citationId` save/retrieve a candidate. The caller supplies a stable UUID and `{derivativeDigest,itemRef,startByte,endByte,quote}`. The server revalidates original bytes, raw parser output, runtime profile and canonical derivative, then requires the quote to match an exact UTF-8 range wholly inside the named extracted occurrence. It preserves original context, raw/profile/derivative digests, page and region. Offsets are explicitly extracted UTF-8, never PDF byte offsets. No quote normalisation or first-match search occurs.

Save requires CSRF, internal case membership, active case and current authority matching the extraction. Case locking serialises concurrent retries. Existing IDs cannot change content or author. Audit and candidate insertion commit atomically. GET revalidates stored selection and bytes against current originals and derivative data; historical candidates retain their original authority version and confer no current approval. Clients are denied. Replies are no-store/nosniff. No personal or source text enters audit summaries.

## Reproduce

Run `npm run lint`, `npm run typecheck`, `node --import tsx --test apps/api/test/document-derivative.test.ts`, `npm run test:foundation`. Follow `.github/workflows/checks.yml` for disposable PostgreSQL roles/environment and `INVEOS_TEST_BROWSER=1 npm test --workspace @inveos/api`. New API cases cover concurrent retries, restart, conflicts, immutable rows, role/CSRF/membership/current authority, source corruption, stored selection tampering and audit rollback. Focused tests cover repeated occurrences and UTF-8 boundaries. Fixtures replay recorded native output, not fresh parser execution.

## Remaining and rollback

Browser candidate authoring/recovery, candidate listing, explicit human review/approval, derived-claim/report integration and independent export verification remain open. No human review is claimed by candidate creation. Keep migration and immutable history on rollback; disable candidate writes rather than delete records. No runtime/dependency/approval changes, merge or production deployment. Wider product/security/licence gates remain open.
