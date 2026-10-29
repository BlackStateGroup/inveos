# Document citation candidate workspace

29 October 2026. Continues PR #60 without changing original evidence, authority, claim or finding semantics.

The verified document inspection now offers a labelled passage selector and immutable candidate save. Whole extracted items up to 4096 UTF-8 bytes are supported; the selected page, occurrence and exact range are retained. This is candidate authoring, not human approval. Raster comparison remains a separate optional inspection with its existing fidelity limitations; saving does not attest that a rendered page was reviewed.

A stable UUID, item reference and derivative digest are retained before sending in session storage, scoped by a hash of the session CSRF token, case and extraction job. Quote text and credentials are not stored there. Lost responses are recovered by fetching that UUID first; only a 404 permits a POST with the same identity. An existing verified receipt can be recovered after authority changes, but new writes still require current matching authority. Invalid receipts or unavailable retry storage fail closed. Pending identity is cleared only after full receipt verification. Tab/sign-in loss loses unconfirmed retry identity; server-saved candidates remain discoverable in the list. There is no offline submission queue.

GET `/api/cases/:caseId/integrity-jobs/:jobId/document-citations?after=<uuid>` returns at most 50 verified candidates and a nullable next cursor. It enforces internal case access, re-reads original bytes and raw/normalised extraction, revalidates every returned candidate and records an audit event atomically. It returns no-store/nosniff. UUID pagination is stable for existing records, not a snapshot; refresh starts again to include concurrent additions before the cursor. No schema migration or new dependency is needed.

The browser rebuilds each citation from the previously verified extraction, checks exact page/region/UTF-8 occurrence, source and processing digests and unreviewed status, then verifies its SHA-256. It rejects substituted/rehashed page, quote, range or approval states. Refresh failures clear the candidate list rather than leave a stale list presented as freshly verified. Access revocation is enforced on subsequent server requests, not by an active push channel. Cryptographic checks establish byte linkage, not source truth or legal admissibility.

## Reproduce and evidence

Run `npm run lint`, `npm run typecheck`, `node --import tsx --test apps/api/test/document-derivative.test.ts`, `npm run test:foundation`. Follow `.github/workflows/checks.yml` for disposable PostgreSQL roles and `INVEOS_TEST_BROWSER=1 npm test --workspace @inveos/api` for actual database/browser tests. New cases cover 51-row pagination/restart/access/corruption, lost POST response after commit and reload recovery without duplication, and removal of the displayed list after source corruption. Helper cases test altered receipts, stable retry identity, storage failure and no quote persistence. Fixtures replay recorded fictional parser output; no new parser execution is claimed.

Local lint/type checks, 14 focused tests and 101 Python tests pass. Hosted database/browser results are pending at this implementation checkpoint; record the exact tested revision and run before claiming them.

## Remaining and rollback

Explicit human review, rejection/supersession, reviewed derived-claim/report eligibility, independent export lineage and richer sub-passage authoring remain open. Tika/OCRmyPDF comparative experiments and wider parser/runtime/licence/security/device/product gates remain open. Disable the UI/list route to roll back this slice while retaining immutable candidate history. No production readiness, approval, merge or deployment is implied.
