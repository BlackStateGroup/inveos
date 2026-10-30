# Atomic task assignment and deadline planning

An investigator can select up to 50 current tasks and assign a case colleague, remove ownership, set a calendar deadline or remove the deadline in one recorded decision. Each field offers an explicit keep option. Status, content, parent links and source references are preserved. Existing batch status changes remain available.

## Behaviour and boundaries

`POST /api/cases/:caseId/work/task-plan-batches` accepts a stable request ID, distinct task IDs with expected versions, a reason and at least one of `ownerChange: {ownerId}` or `dueDateChange: {dueDate}`. Null clears a value; omission preserves each task's existing value. IDs are canonicalised, task order is normalised for retry, dates must be real calendar dates, and raw scalar types are validated before schema coercion. Every selected task must actually change.

The complete selection is resolved under the existing case lock and a bounded transaction. Current actor membership/role and assignee membership are checked after the lock. An invalid, stale, foreign, non-task or unchanged selection prevents every update. Concurrent batches and individual edits preserve optimistic versions. Each successful task gains an immutable revision and audit event; an immutable receipt records the applied versions. An audit failure rolls back the whole transaction.

Migration 056 adds the append-only `task_plan_batches` receipt table with tenant/case keys. The application role can select/insert, and the immutable trigger also protects administrator mutations. The separate status receipt format and its request hashes remain compatible. Each batch type is bounded to 1,000 receipts per case; exact retries and individual task revisions remain available at the limit. Retain receipt/history data when reverting application code; do not drop the table as a routine rollback.

The browser reuses the taskboard selection, version display and recovery controls. It keeps an unchanged pending operation for explicit retry after a lost response, reloads current tasks after confirmation, and clears inaccessible selections and unsent input. Pending operations are held in the mounted tab, not a durable offline queue. Refresh/reload abandons the unsent selection and loads saved records. Native offline dispatch, contractor policy and automatic workload balancing remain separate requirements.

No evidence, findings, legal authority or original bytes change. No external notification, payment, new dependency, upstream copy or production activation is introduced. Assignment choices are limited to the case's current internal collaborators.

## Verification and reproduction

```bash
npm ci --ignore-scripts
npm run typecheck --workspaces --if-present
npm run lint
npm run build --workspace @inveos/web
INVEOS_TEST_DATABASE_URL=postgres://inveos_app@127.0.0.1:55474/inveos_test \
INVEOS_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:55474/inveos_test \
node --import tsx --test --test-concurrency=1 --test-name-pattern='task (status|planning) batch|migration' apps/api/test/api.test.ts
```

Use the documented disposable PostgreSQL role/database setup; never point these tests at production. Local focused acceptance passed **16 actual PostgreSQL/API checks**, including prior status behaviour, stable actor-bound retries/restart, exact date/null handling, denied assignees, case/tenant/CSRF HTTP boundaries, conflicting versions, 50-task transactions, audit rollback, receipt quota and real case-lock waits with actor/assignee withdrawal. Lint, types, build and workflow validation pass. Full local regression passed **382 Node tests, 41 explicit browser skips, 423 total, zero failures**. The new actual browser journey remains pending hosted qualification.

The browser test exercises a real owner/deadline change, lost committed response, unchanged retry, reload/history, explicit clearing, narrow layout and revoked-access clearing. Its screenshot is retained as `task-planning-browser` in CI. Hosted acceptance and review must pass before merge. No device, production or professional acceptance follows from these checks.
