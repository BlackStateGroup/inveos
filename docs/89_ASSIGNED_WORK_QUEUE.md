# Personal assigned-work queue

The persistent Assignments view lists the authenticated internal user's work across currently accessible cases. An assignment does not grant case access. This is coordination context, not a reviewed finding, notification service, contractor-specific isolation policy or production workload acceptance.

## Query and navigation contract

`GET /api/work/queue` joins current tenant, owner and case membership on every page and rejects client roles. It returns bounded titles, 260-character excerpts, case references, recorded deadlines, status and revision metadata. Full work bodies, source links and other users' assignments are not part of the queue response. Opening a row refreshes the authorised workspace and verifies that the case/work record still exists there before entering its current task or brief view.

Optional `kind` and `status` filters use the existing work vocabulary. Results order by deadline, undated last, then stable work identity. A page contains at most 100 records; `next` gives `{id,dueDate}`. Pass both `afterId` and `afterDue` (`none` for an undated cursor) for the next page. Invalid/incomplete cursors, impossible dates and unknown parameters are rejected. Membership and ownership always filter the query, including forged cursors. Index migration 038 supports tenant/owner/deadline access and a two-second SQL deadline bounds each query.

The UI supports filtering, previous/next pages, refresh, retry, reload and keyboard-native navigation. Failed fetches clear prior results; case revocation removes that case's work on the next read. The global Assignments view is separate from a selected case's taskboard. Deadlines are displayed as recorded dates; the queue does not invent a timezone, claim a task is overdue or send messages. Filters and page position are temporary, not private saved-view records.

This is a live list, not a frozen snapshot. A change to ownership, deadline, status or membership while paging can move or remove a record; refresh starts again. The existing workspace loader used when opening case work remains a separate large-case performance concern. No representative production capacity is claimed from the small fixtures.

## Verification and operation

Use the existing disposable lab setup and `npm run db:migrate`, then lint, typecheck, build and foundation commands. With the documented restricted/admin PostgreSQL URLs, run `node --import tsx --test --test-concurrency=1 apps/api/test/*.test.ts`; focus API checks with `--test-name-pattern='^assigned (work )?queue' apps/api/test/api.test.ts`. On a supported sandboxed Chrome host use `INVEOS_TEST_BROWSER=1`; hosted Checks retains `assigned-work-browser`.

The initial API-only PR #83 at `a2632aa942ad1fff8c9c66aad8641302c5383b03` passed Checks 40940481310 (280 Node/116 Python, no skips). Review found a permanent first-100-row truncation and no Assignments interface or actual bounds test. The follow-up adds pagination, filters and navigation. Focused real PostgreSQL acceptance covers 201 dated/undated records, complete page traversal with no duplicates, excerpt bounds, filters, malformed cursors, same-user multi-tenant separation, reassignment/deadline changes, current client role and membership revocation. These SQL fixtures measure the query contract, not a complete 201-task investigation history or production workload.

The browser journey pages forwards/backwards, filters status, opens the correct case, reloads, checks narrow-screen overflow and removes revoked-case work. Final implementation `b91b90623` passes Checks 40944589175 with 287 Node/116 Python tests and no failures/skips, including all 23 actual browser journeys and worker probes. [The retained render and source/privacy review](evals/2026-10-29-assigned-work.md) passed. BUILD_HANDOFF.md records current merge state. No new dependency, external contact or copied research source is introduced. The migration is an additive index; rollback does not require dropping case data or history. Production migration/deployment is outside this development increment.
