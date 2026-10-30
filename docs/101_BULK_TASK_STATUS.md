# Case-scoped bulk task status changes

The persistent case taskboard can change the status of up to 50 explicitly selected tasks in one decision. This advances WP-16 coordination without adding bulk finding approval, question closure, hypothesis assessment, handover acknowledgement or evidence mutation. Those distinct review paths retain their existing checks.

## Recorded decision

`POST /api/cases/:caseId/work/task-status-batches` accepts a stable UUID, a list of task UUIDs with expected versions, one existing task status and a meaningful reason. Submitted scalar types are checked before schema coercion. Empty/oversized/duplicate selections, non-task records, unchanged statuses, invalid reasons and unknown fields are rejected. UUID case and selection order do not change the request identity.

The current internal actor must have current tenant/case membership and a valid session/CSRF token. Assignment alone never grants access. The server takes the case lock and rechecks membership/role before resolving every selected task inside that case. Any missing, unrelated or stale task rejects the whole decision. A task's title, body, owner, deadline, parent and links remain unchanged. Every changed task gets its normal immutable revision, frozen links and an attributed audit event with the batch identity and reason. A final batch audit and append-only receipt commit in the same transaction; failure rolls everything back.

An exact same-actor retry returns the versions originally applied plus the tasks' current records. It never overwrites later individual or batch decisions. Changed-content and different-actor reuse conflicts. Migration 047 stores only scoped request hashes and applied identity/version pairs, with immutable update/delete protection and case/tenant foreign keys. No source bytes or unrelated case details enter the receipt. Two-second lock and five-second statement deadlines apply. At most 1,000 new batches may be recorded per case; retries and normal individual revisions remain available afterwards.

## Interface and recovery

Open a persistent case's **Tasks** view. Use each task's selection checkbox, then inspect the explicit selected titles, versions and prior statuses. Filtering does not silently remove selections: the list remains visible. Choose a status and give a fictional reason, then save. Every task must change status. A saved task's **History** retains its earlier versions and decision reason.

A failed submission freezes its exact body and identity. **Retry unchanged task batch** recovers a committed response loss. **Discard selection and refresh tasks** clears unsent input and loads current versions after conflicts. Refresh hides the old taskboard until it succeeds; an outage keeps an explicit retry state. Permission denial clears selected records and reasons and refreshes case context. Case switching remounts the taskboard. Unsent selection is deliberately temporary; reloading restores saved work rather than an offline queue.

This is an internal coordination action, not verification that work was performed or permission to release a report. No external notification, collector, billing service, dependency or production deployment is introduced. Former owners remain historical ownership context; the batch does not grant them access or reassign their work.

## Reproduction and limits

Use the existing locked setup and disposable PostgreSQL test database with restricted `inveos_app` and administrator migration URLs:

```sh
node --import tsx --test --test-concurrency=1 --test-name-pattern='task status batch|ordered migrations' apps/api/test/api.test.ts
npm run lint
npm run typecheck
npm run build
npm run test:foundation
npm test --workspace @inveos/api
```

`INVEOS_TEST_BROWSER=1` requires working sandboxed Chrome. Hosted Checks exercises actual HTTP response interruption, stable retry, reload, competing edits, history, filtering, refresh outage/recovery, narrow viewport and revoked selections. Its artifact is `task-batch-browser-render`. [Evaluation](evals/2026-10-30-task-status-batches.md) records actual executions; do not count a written test as passed. The 50-task fixture is a transaction-boundary check, not representative large-case performance or native-device evidence. The migration is additive; retain receipts and task revisions when reverting application code. Production database changes are not authorised.
