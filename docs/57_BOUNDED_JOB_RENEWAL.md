# Bounded worker lease renewal

28 October 2026. The isolated document experiment permits 90 seconds, while the
application's existing job lease lasts 60 seconds. Before attaching longer parser
runs, trusted workers need renewal without reviving expired or cancelled work.

`renewIntegrityJob(pool, {tenantId, caseId, jobId}, token)` renews only a currently
live matching attempt. It rechecks case authority/status and requester membership,
then extends to the earlier of database now + 60 seconds and the attempt's fixed
five-minute deadline. Concurrent calls cannot accumulate duration. It returns
expiry/deadline/attempt, or null when the worker must stop. Lock/statement waits are
bounded to two/five seconds; database errors are not successful heartbeats. A
future worker must stop its subprocess on a null result or unresolved renewal
error, and retain an independent wall-clock/container limit. Renewal is not an OS
sandbox or permission to exceed those limits.

Migration 021 adds an attempt deadline, an expiry ceiling constraint and a trigger
preventing extension/removal of a deadline while the lease token is unchanged.
Existing running leases with no deadline can still finish within their original
expiry but cannot renew; the next claimed attempt gets a deadline. Expired attempts
remain reclaimable through the existing three-attempt policy. New claims keep the
existing token fencing and immutable source/authority identity.

The helper has no HTTP route, lease tokens remain absent from client receipts,
and heartbeat traffic does not append duplicate running events. Claim/terminal
history remains auditable. Existing workers are short first-party operations and
do not need a heartbeat loop; PDF orchestration/attachment is still unimplemented.
No parser dependency or licence approval is introduced by this change.

Run `npm test --workspace @inveos/api` with the documented restricted PostgreSQL
and admin test URLs. New actual-database tests cover restart, completion, scope,
token/expiry/cancellation fencing, authority/membership withdrawal, concurrent
renewals, the immutable ceiling and lock-timeout rollback/retry. Hosted [Checks #127](https://github.com/BlackStateGroup/inveos/actions/runs/40783925491) passed at `b5996ae4da26cde107eae91215f1519fcd8d84ac`, tree `398305bfa4ae9a682606c685bc396a04fb064005`: all 140 Node tests, zero failures/skips, including five new actual PostgreSQL renewal scenarios, migration upgrade, restore and five Chrome journeys. All 98 Python tests, lint/types/build/reference and worker isolation probes passed. The first run found an outdated expected migration list; adding migration 021 corrected it, and the complete suite reran successfully. Local lint/types/build, Python and foundation validation also pass. This evidence follow-up changes documentation only; parser research was not rerun or represented as new evidence. Local
lint/types, Python and build checks are recorded separately in the handoff.

Rollback application code before removing the additive migration; leaving its
nullable column/constraints in place is compatible with prior workers. Do not edit
an applied migration. No deployment, merge, production readiness or worker-specific
credentials/RLS are claimed. PDF attachment, human page review, native runtime
approval and wider product gates remain open.
