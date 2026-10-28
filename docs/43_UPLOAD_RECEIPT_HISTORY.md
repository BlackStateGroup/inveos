# Upload receipt history

28 October 2026. Synthetic lab slice stacked on draft PR #23; no production or browser acceptance claim.

Pending uploads alone cannot explain what happened after tab state is lost. The evidence workspace now offers explicit refresh and older-page controls for reservation history, including open, cancelled and completed records. A completed record identifies the original evidence receipt; inspect and verify that original separately. History does not rehash files, remove quarantine, clear retry keys or initiate a replacement upload. Existing maintenance and cancellation-recovery controls remain unchanged.

`GET /api/cases/:caseId/uploads/history` requires an internal case member. Reviewers see the case's reservations; investigators see only their own. Clients, unrelated cases/tenants and revoked members are denied. Returns `caseId`, `items` and nullable `nextCursor`; each item contains reservation ID, case ID, status, reserved byte length, original authority version, creation/expiry times, ownership flag, chunk size and nullable completed evidence ID. No source metadata, filenames, chunks, retry keys or uploader identifiers are included. Responses are no-store/nosniff.

Default page size is 25, maximum 50 (`limit`). `before` is a reservation UUID resolved within the caller's current visibility boundary. Ordering uses immutable database `created_at` and UUID descending, retaining microsecond precision when resolving cursors. Unknown or inaccessible cursors return 404. Newer inserts do not displace older-page traversal. Status is current when each page is read; this is not a multi-request snapshot. The UI replaces each page rather than accumulating unbounded history, keeps the prior page on error and aborts requests on case/sign-in navigation. Refresh returns to the latest page.

Additive migration `013_upload_history.sql` adds case/owner history indexes. No existing migrations, identity, source bytes, authority or audit records are changed. Roll back the routes/UI together if required; unused indexes can remain. Never delete historical reservations or evidence as a code rollback.

Reproduce with the synthetic lab instructions in `23_LOCAL_APPLICATION.md`, apply migrations, then create/complete/cancel fictional uploads and use the Pending uploads panel's history controls. Run:

```
npm run lint
npm run typecheck
npm run build
npm run test:foundation
npm run test:api
```

Two PostgreSQL scenarios exercise actual TCP pagination after application restart, equal and microsecond-separated creation timestamps, concurrent newer inserts, terminal receipts, status changes, metadata minimisation and owner/reviewer/case/tenant/client/revocation/cursor/validation boundaries. Timestamp manipulation is isolated test-administrator setup, not an application capability. Hosted results are recorded in BUILD_HANDOFF.md after execution. Browser accessibility/navigation and actual device/outage/restore tests remain unrun. This does not recover local file contents or authorise automatic duplicate suppression after sign-in loss.

No new dependency, third-party source, parser or licence approval. Automatic staging maintenance, full receipt matching after lost file metadata, encrypted storage, real identity, parser isolation/benchmarks, page review, release and other product gates remain unfinished. No merge or deployment.
