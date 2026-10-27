# Bounded case-scoped processing dispatch

27 October 2026. Synthetic lab only; stacked on the verified derivative inspector. This consumes existing queued checksum and UTF-8 index jobs. It does not collect sources, execute PDF/OCR tools or approve findings.

## Behaviour and limits

`dispatchIntegrityJobs(pool, storageRoot, {tenantId,caseId}, limit, signal)` processes at most 1–25 selected records per invocation (default 10), sequentially. Both UUIDs are mandatory; there is no global queue scan. Each selection locks the oldest eligible `(created_at,id)` row in that exact case with `FOR UPDATE SKIP LOCKED`. Queued records and expired running leases are eligible. Concurrent consumers can select different rows; locked rows and live leases are skipped. An `empty` receipt means no currently claimable row, **not** that the case has no outstanding work or that every worker has finished.

Named-job execution and dispatch share the same locked claim and processing implementation. Requester membership, internal role, active case and current authority remain checked at claim and completion. Invalid scope cancels the job; three exhausted attempts fail it. These terminal transitions count towards the pass limit so a revoked backlog cannot cause an unbounded sweep. Every transition retains the existing append-only job events. Processing preserves bounded regular-file reads, original digests, immutable derivative lineage and atomic result/completion. No public completion or dispatch route is added.

A job that loses its lease before committing returns `lease_lost`, not success. Original/data failures are recorded by the existing consumer and the pass continues. Unexpected database/transaction errors stop the pass; preceding committed outcomes remain recorded and no success receipt is invented. A claimed job stays running until lease expiry if its result transaction rolls back or its process dies. A later invocation can retry; old tokens cannot finish a replacement attempt.

Selection transactions use a two-second lock timeout and five-second statement timeout. The 25-record cap bounds a pass's work count, not total process time, memory, database connection establishment or completion-query time. There is no heartbeat, daemon, service installation, polling scheduler or external job broker. A supervisor may invoke another pass within an explicitly configured case; none is installed here. SIGTERM/SIGINT asks the CLI to stop before its next claim; an in-flight claim/job can finish. Hard process death relies on lease recovery. Do not treat signal handling or SQL timeouts as parser isolation.

## Reproduce

Use the existing disposable lab setup and migrations from `23_LOCAL_APPLICATION.md`, with fictional originals and processing requests created through the evidence workspace or existing API. Run from repository root with Node 22+ and the existing locked dependencies:

```bash
npm ci --no-audit --no-fund
npm run db:migrate
node --env-file=.env --import tsx apps/api/src/dispatch-integrity-jobs.ts TENANT_UUID CASE_UUID 10
```

Replace both uppercase placeholders with the explicit lab tenant and case UUIDs. The CLI requires `INVEOS_DEV_LAB=1`, a non-production `NODE_ENV`, `INVEOS_DATABASE_URL` and an absolute `INVEOS_STORAGE_ROOT`. It uses only the restricted application database URL, never the administrator URL, and does not migrate. `INVEOS_WORKER_SCHEMA` optionally selects a validated lab schema (default `inveos`), used by the isolated test harness. This is **application-level scope enforcement**, not a case-limited database credential: production worker-specific roles, RLS/capabilities and isolated storage mounts remain required.

Stdout is one bounded JSON receipt: selected count, `limit`/`empty`/`aborted`, and job ID/status/attempt/failure code. No source bytes, paths, requester IDs, credentials or lease tokens are printed. A configuration or unexpected runtime failure writes one generic diagnostic to stderr and exits 1. Consult the scoped history API to reconcile earlier commits before retrying. Domain failures such as a digest mismatch are recorded outcomes in an otherwise successful pass; consumers must inspect each result, not only the process exit code. No raw exception stack is printed.

## Verification

Local lint, type checks, build, dispatch input guard and all 42 Python tests pass. Six new real-PostgreSQL scenarios are included in the existing API suite; their hosted result must be recorded in `BUILD_HANDOFF.md` before claiming verification:

- A held row lock is skipped; concurrent passes consume six jobs once with unique attempts/events and three immutable text outputs. Incorrect tenant/case scopes and an aborted pass leave queued work untouched.
- Actual CLI subprocess invocation with the restricted application role and no administrator URL produces one result, leaves the next queued job, and supplies a derivative verified through actual TCP HTTP and the client verifier. Unsafe configurations and malformed limits fail without leaking the fake credential fixture or claiming that next job.
- A real child process commits a claim, is killed with SIGKILL and leaves a live lease. Dispatch skips it until the test administrator advances expiry, then completes attempt 2 and rejects the old token. Also checks attempt exhaustion, authority replacement and membership revocation.
- Actual SIGTERM while a CLI is blocked in its authority check permits that in-flight job to finish, returns an aborted receipt and leaves the next queued job untouched.
- A separate held authority lock exceeds the two-second timeout; its claim/event transaction rolls back. Recorded digest failures subsequently consume their bounded pass without aborting it.
- A database trigger deliberately rejects derivative persistence. Dispatch stops, success/event/output roll back together, another queued job remains untouched, and expiry/retry yields exactly one immutable derivative and successful event.

The expiry tests alter only the fictional lease clock using the test administrator, rather than waiting 60 seconds. They prove PostgreSQL/process recovery, not host reboot, infrastructure outage or restore. A pre-aborted signal and actual operating-system graceful SIGTERM are exercised; host reboot and supervisor restart remain unrun. No browser change or new browser acceptance is claimed. Parser sandbox, licence/runtime approval, page/region review, native/offline/device/restore and production gates remain open.

```bash
npm run lint
npm run typecheck
npm run build
npm run test:foundation
node --import tsx --test apps/api/test/dispatch.test.ts
# Disposable PostgreSQL URLs as documented in .github/workflows/checks.yml:
npm test --workspace @inveos/api
```

Migration 010 adds a partial candidate index only. Existing applied migrations and table permissions are unchanged; the upgrade test includes all ten migrations. Roll back application use by stopping invocation of the new CLI and restoring the prior application revision. Existing jobs, events and derivatives remain compatible; retain the migration ledger and index. Do not delete custody records or rewrite migration checksums. No dependencies or third-party source/runtime artifacts were added; source-study and licence approvals are unchanged. No merge or deployment is implied.
