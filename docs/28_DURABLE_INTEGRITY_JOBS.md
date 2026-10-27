# Durable scoped original-integrity jobs

This WP-02/WP-05 prerequisite runs a bounded SHA-256 recheck of an existing original. It is a real database-backed job with a working byte-check consumer, **not** a PDF parser, extraction worker, malware clearance or derivative pipeline. Binary evidence remains quarantined even when its integrity job succeeds. No findings, review decisions or originals are changed.

## Use in the synthetic lab

Apply the existing migration command after review. Migration `004_integrity_jobs.sql` adds jobs and append-only state events; existing records are unchanged. From an assigned internal session, with existing Origin/CSRF controls:

- POST `/api/cases/:caseId/integrity-jobs` with `evidenceId` and a UUID `idempotencyKey`.
- GET `/api/cases/:caseId/integrity-jobs/:jobId` to read the receipt/state.
- POST `/api/cases/:caseId/integrity-jobs/:jobId/cancel` with `{}` to cancel a queued or running job.

Identical requests replay one receipt; reusing a key for another evidence ID conflicts. Requesting captures the original digest and the current case authority version. Original acquisition authority is unchanged. Client, unassigned and foreign-case access is denied. No filesystem path or worker lease token is returned by these endpoints. Queue/cancel actions record the human actor in the case audit within the same transaction.

A trusted operator runs one scoped job using the existing development configuration:

```bash
node --env-file=.env --import tsx apps/api/src/run-integrity-job.ts TENANT_UUID CASE_UUID JOB_UUID
```

The worker accepts explicit tenant/case/job IDs, not a global dequeue. It revalidates the requester's tenant membership, case assignment, active case and current authority version at claim and completion. Changed scope cancels the job. This trusted CLI has database credentials; it is not an end-user authentication mechanism. Separate production worker credentials/RLS and an automated dispatcher remain outstanding. There is no HTTP worker-completion endpoint.

## Durable state and failure rules

States are queued, running, succeeded, failed and cancelled. PostgreSQL row locks give one claimant a 60-second random-token lease; another claimant cannot take a live lease. Expired leases can be reclaimed up to three attempts. Completion requires the exact live token, so stale/late workers cannot overwrite cancellation or a newer attempt. Attempts exhausted after expiry become failed. A successful/failed/cancelled job is terminal; request a fresh idempotency key for a new check. Lease recovery is driven by the next explicit scoped worker invocation, not a running scheduler.

The worker only reads bytes, bounded to 256 KiB plus one sentinel byte, and compares length and SHA-256 with immutable evidence and job records. Missing, oversized and unreadable originals fail with `original_unavailable`; digest/length differences fail with `digest_mismatch`. These codes do not expose paths or file contents. A crash or database outage leaves a running lease to expire; exceptions are not falsely recorded as success. There is no heartbeat because this bounded checksum operation is intended to finish inside the lease. Concurrent scope/cancellation transactions may cause PostgreSQL to abort a transaction; retry the scoped invocation after the transient failure/lease expiry.

Job identity, scope, digest, requester, authority, kind and creation time cannot be updated. State events are append-only and retain attempts and timestamps. This is not a signed custody chain or proof against privileged database administrators. The existing local filesystem is not WORM/encrypted storage. Results describe bytes observed during that run, not perpetual integrity or factual truth.

## Verification and remaining work

The PostgreSQL API suite covers concurrent idempotent enqueue, restart persistence, actual file hashing, success replay, scope/client/CSRF denials, exclusive leases, expiry/reclaim, stale completion, cancellation, maximum attempts, authority change, revoked membership, corrupt/oversized/missing originals. Existing integrated casework/report/HTTP and migration tests remain in the suite. Run `npm test --workspace @inveos/api` with the documented disposable test database; use `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run test:foundation` for source checks. Exact executed results are in `BUILD_HANDOFF.md`.

No parser binaries, third-party source, model artefacts or new dependencies were incorporated. Parser isolation remains a separate blocked gate. Next: immutable extraction/run lineage with approved isolated runtime identities, derivative manifests and human-reviewed page/region citations. This job does not claim parser isolation or mark WP-05 complete. Browser job controls, worker-specific credentials, scheduler/recovery service, native/offline/restore tests and production operations are unimplemented.

Rollback: stop invoking this worker and revert the routes/module while retaining job/event tables and migration history. Do not rewrite applied migrations or delete evidence/history. No production deployment, automatic merge, live investigative collection or external data transfer is performed.
