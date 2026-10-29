# Personal attention and saved reminder preferences

The notification button opens an internal personal queue followed by the existing current-case mentions. This increment sends no outside messages. It does not complete contractor assignment policy, workload balancing, all approval types or native push delivery.

Current database records generate reminders on request. Own unfinished objectives/tasks/questions/handovers with recorded deadlines through seven days ahead appear, including overdue work. Dates use the server's UTC day, independent of the database/session/browser timezone; source-recorded dates remain unchanged. Closed/archived cases suppress work and review reminders. Own open upload reservations past expiry and own failed processing jobs remain visible until acknowledged or their current state stops qualifying. Cancellation is not described as an upload failure. An expiry notice does not delete chunks or originals.

Reviewers see other authors' text and document claims awaiting a decision under current case authority. These belong to the reviewer pool and are visibly unassigned to an individual reviewer. Suggestions, reviewed findings and allegations remain separate. This queue performs no integrity or legal validation: context inspection and existing independent review gates remain mandatory. A document claim opens its exact verified extraction; a failed job or upload opens Evidence with its identity available in the reminder. No live collector, AI service or third-party dependency is introduced.

A personal acknowledgement hides that exact reminder revision by default. It cannot complete work, retry processing, approve a claim or release anything. A corrected deadline and an upcoming deadline that becomes overdue reappear. Include acknowledged current items to inspect still-qualifying reminders. This is not a historical case-event viewer; underlying immutable histories and audit remain available through their established routes.

Preferences enable deadlines, failures and claim reviews separately, initially all enabled. They are scoped to the authenticated user and organisation, stored as append-only versions, with optimistic concurrency and stable request identities. Lost-response replay returns current preferences without reverting later versions. Version changes and acknowledgements commit atomically with their audits. Preferences hold no case content; acknowledgement records store only scoped identities/revision keys and receipt time. Muting does not change case permissions or review requirements. No decorative unread badge or aggregate unread count is claimed.

## Access and bounds

Every queue statement joins current tenant membership, role and case membership. Owning work or a persisted acknowledgement never grants case access. Clients cannot read or mutate the queue/preferences. Acknowledgement acquires the case lock and rechecks current access before matching the exact current reminder; stale versions return conflict. Preferences serialise through a per-account PostgreSQL transaction advisory lock and recheck current internal role after waiting. This avoids granting account-table mutation privileges to the restricted application role.

Pages contain at most 50 reminders, with a complete identity cursor and optional category filter. Ordering is deterministic by type/case/identity, not claimed to be urgency ranking. Concurrent changes can move records between pages; refresh starts again. Queries and lock waits have two-second bounds. Browser requests have a 15-second deadline, cancel replaced requests and clear stale results on error. Successful refresh also removes revoked case reminders. There is no unauthenticated cache, service-worker delivery, background subscription or notification payload store.

Migration 044 adds append-only preference/acknowledgement tables and two query indexes. Run normal migrations against a disposable database first. Roll back application code without dropping history; do not rewrite applied migrations or delete acknowledgements. Existing original storage and report/export formats are unchanged.

## Reproduction and limits

Use the restricted-role PostgreSQL setup in LOCAL_RUN.md. Run `npm ci`, `npm run lint`, `npm run build`, `npm run test:foundation`, then the API suite with the documented test database variables. Focused command:

```sh
node --import tsx --test --test-name-pattern='^attention' apps/api/test/api.test.ts
```

The focused suite uses actual PostgreSQL, an actual HTTP listener for access/CSRF denials, concurrent requests, application restart, audit-failure injection and lock-wait revocation. Saved job state and retained document output fixtures exercise queue semantics, not new parser benchmarks. The hosted sandboxed browser exercises preferences/reload, acknowledgement without completion, context navigation, response-loss recovery, narrow viewport and revocation. Only completed runs count as evidence; see [evaluation](evals/2026-10-29-attention.md) and the current handoff.

Native devices, external providers, representative high-volume measurements, professional/privacy/security acceptance and wider product requirements remain open.
