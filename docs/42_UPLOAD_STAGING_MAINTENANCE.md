# Upload staging maintenance and cancelled-request recovery

27 October 2026. Synthetic lab slice, stacked on draft PR #22. Not production retention, secure erasure, browser acceptance or WP-02 completion.

## Behaviour and decision

Expired reservations previously occupied the ten-open-upload quota until their original owner cancelled them. A revoked owner could strand staging indefinitely. Assigned reviewers can now close expired reservations in a bounded, explicit pass and cancel another uploader's open reservation with a reason. This uses the existing reviewer role and case membership gate, not a new tenant-wide administrator privilege. Closing transient incomplete staging does not destroy received evidence or implement evidence retention/legal-hold policy.

All mutations use the same case-then-reservation locking order as finalisation. A pass closes at most ten expired open reservations (caller chooses 1–10); the server database clock decides expiry. It marks them `cancelled`, removes only their transient chunks and writes `upload.expired` events with removed-chunk counts in the same transaction. Failure rolls the whole pass back. There is no automatic scheduler. Repeat passes select only still-open rows and create no duplicate events. Explicit reviewer cancellation records a bounded reason and `upload.reviewer_cancelled`; terminal cancellation replay does not replace its first reason or create another event. Completed originals cannot be cancelled through this route.

Immutable reservation identities, source metadata, original authority versions, expiry dates and existing audit history remain. Expiry/cancellation remains available after case authority changes, provided the reviewer retains current case access. No intake or processing authority is granted. Source bodies, filenames, raw chunks and retry keys are excluded from pending listing. Review reasons are visible in internal audit records: use minimal fictional operational explanations.

## API and UI

All paths start `/api/cases/:caseId/uploads`, require an authenticated internal case member, and return `Cache-Control: no-store`. Mutations require the existing CSRF/origin checks.

| Method/path | Behaviour |
|---|---|
| GET base | At most ten open reservations, sorted by expiry/ID; investigator sees their own, reviewer sees the case. Includes reserved size, original authority, expiry, server expiry flag and ownership; no source metadata or chunks. |
| POST `/expire` with `{"limit":10}` | Reviewer only; bounded atomic expiry pass, returns case ID and closed reservation IDs. |
| POST `/:uploadId/reviewer-cancel` with `{"reason":"Fictional uploader assignment ended"}` | Reviewer only, non-blank 10–500-character reason; close unfinished staging even after owner revocation. Completed original gives 409. |
| GET `/by-key/:requestKey` | Owner-only lookup of an existing reservation using its original request UUID. Returns minimal status plus echoed request key; never an original or source metadata. Unknown/other owner/case gives 404. |

The evidence workspace's Pending uploads panel explicitly refreshes the list, offers expiry maintenance to reviewers and cancellation of individual pending transfers. Another uploader's cancellation needs a reason. Controls are mutually excluded with intake/reconciliation in the same component. The server resolves concurrent operations from other tabs or clients; stale completed rows fail cancellation without deleting evidence. Confirmed action receipts remain visible if a following refresh fails.

After cancellation, the intake panel can confirm the terminal cancellation by its stored chunk request key before removing the matching local retry record. It requires the same case/key, cancelled state and no evidence ID, and checks that the pending fingerprint/key has not changed during the request. Open/completed/unknown/unavailable/foreign replies retain the key. Legacy whole-file requests cannot use this operation: recover their original receipt with the same file/metadata. An expired but not yet closed reservation also retains its key until cancellation or reviewer expiry maintenance succeeds. This is tab recovery, not offline encrypted storage.

## Reproduce and verification

Use the fictional local-lab setup in `23_LOCAL_APPLICATION.md`. Apply additive migration `012_upload_maintenance.sql`; do not modify migration 011. It adds only a partial candidate index, no new data shape or dependency. Start the API/web app, reserve a fictional upload, pause, refresh pending uploads and cancel it; then confirm cancellation to clear the local retry and register a replacement. Database administrators may backdate expiry only in isolated test fixtures; application users cannot alter expiry or reservation identities.

```
npm run lint
npm run typecheck
npm run build
npm run test:foundation
node --import tsx --test apps/api/test/binary-intake.test.ts
npm run test:api
```

Five new PostgreSQL scenarios cover concurrent actual TCP expiry passes, quota recovery, exact original preservation, metadata minimisation, actor/role/tenant/case/CSRF boundaries, revoked-owner administration, authority changes, audit failure rollback/retry, finalisation races and client-helper reconciliation against real API/database state. The helper suite covers uncertain/mismatched/terminal receipts, changed pending requests and unavailable storage. A race test accepts either valid serialised outcome and checks evidence/staging invariants; it is not exhaustive interleaving exploration. Local Node checks do not imply browser interaction acceptance. Hosted Checks run #56 passed at `85fae851f4cd8d07c62c2d11922a901355e5d6f8`: 71 PostgreSQL API tests, 25 helpers, 42 Python tests and lint/types/build/reference checks. Exact tree and run link are in BUILD_HANDOFF.md.

## Limits and rollback

No automated cleanup service or administrator-wide listing is installed. Reviewers must have case access. Closed reservation/audit metadata and database backups are retained; deleting rows from live staging is not a secure-erasure guarantee. Retention, legal holds, encrypted original/object storage, storage quotas across cases, RLS/dedicated credentials, malware scanning, actual parser isolation and native/offline/restore remain separate gates. Browser cancellation, navigation, accessibility and cross-tab interaction tests remain unrun on this host. No third-party source, dependency, licence approval, collection, deployment or merge.

Rollback application/UI routes together if needed; the additive index may remain. Never reverse terminal states, recreate purged chunks or delete completed evidence as a code rollback. Preserve audit and historical reservation receipts.
