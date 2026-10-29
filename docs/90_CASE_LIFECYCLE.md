# Case lifecycle and collection fencing

The case brief records Intake, Scope review, Active, Review, Released, Closed and Archived stages, with reviewer-attributed reasons and immutable version history. A stage is a coordination decision; it does not turn a source assertion into a finding or grant client access. The case list and overview use the current stage. Closed and Archived cases remain available to their authorised members.

## Decision: separate stage, authority and release

The original `cases.status` distinguishes Scope review from Active authority. Reusing it for operational stages would invalidate retained source reviews and recipient grants whenever a case moved to review or closure. Migration 039 therefore adds a separate stage and version, backed by append-only events. Existing cases receive an explicitly labelled migration checkpoint of their existing status; earlier stage transitions, investigator attribution or original transition timestamps are not invented. Checkpoint actor is explicitly null. New cases start at Intake. The existing explicit reviewer authority approval can complete intake/scope review and records an Active stage alongside the new immutable authority version in the same transaction.

Only a current case-member reviewer can change stages. Each request includes a stable UUID, expected version and bounded reason. Competing decisions produce a conflict; exact retries return the current state without repeating a historical transition. The database requires the head to reference a retained event and advance one version at a time. History is bounded to 1,000 events and paged in groups of 50. Case row locks and query deadlines bound reads/writes. No authority, original, review, source timestamp or recipient grant is silently rewritten.

| From | Available explicit stages |
|---|---|
| Intake | Scope review, Closed |
| Scope review | Closed; reviewer authority approval starts Active |
| Active | Review, Closed |
| Review | Active, Released, Closed |
| Released | Active, Review, Closed |
| Closed | Scope review, Archived |
| Archived | Scope review |

Released requires an existing, current, explicitly approved disclosure from this case, with current authority, issuer/recipient roles, review eligibility, expiry and revocation checked using the portal's existing eligibility predicate. The stage event pins its disclosure identity. The selector lists the latest 50 eligible grants; the API also checks an explicitly supplied older identity directly. Marking Released creates no grant and is not an integrity/download receipt. Later expiry/revocation does not erase the historical stage decision; the portal still applies its live checks.

## Closure and reopening

Original intake, new upload reservations/chunks/completion and new worker jobs require both approved authority and an Active or Review stage. Released pauses collection until a reviewer deliberately returns the case to Active/Review. Closed/Archived and reopened Scope review also deny new collection. Completed intake retries may still recover an existing verified receipt; they do not ingest new bytes. Pending staging can be cancelled or expired using the existing audited maintenance controls.

Worker claim, renewal and final publication share the case lock and recheck stage/authority. Closing fences new claims and publication; existing processes may run until their next heartbeat/normal bounded stop. This is not an instantaneous process-kill guarantee. Evidence committed before the closing transaction remains retained. Reopening goes through Scope review and requires a newly approved authority version before collection resumes, so an old worker token cannot regain publication rights under reopened authority.

Closed cases deny new report disclosure grants and PDF disclosure acceptance. Existing recipient grants retain their explicit expiry/revocation controls; closure does not silently revoke a delivered report. Historical evidence, source verification, internal report preparation, work notes and explicit corrections remain available under their existing permissions. Closure is not a database-wide read-only mode, deletion instruction, legal hold or declaration that all questions are resolved. The reviewer must record outstanding work/responsibility in the decision reason. Preservation, legal holds, destruction approval, sensitivity/ownership/member lifecycle and production policy qualification remain separate requirements.

## Verification and reproduction

Apply migration 039 with the existing disposable development setup, then run lint, typecheck/build and foundation checks. With restricted/admin test database URLs, run `node --import tsx --test --test-concurrency=1 apps/api/test/*.test.ts`; focus on `--test-name-pattern='^case lifecycle' apps/api/test/api.test.ts`. Hosted `INVEOS_TEST_BROWSER=1` uses actual sandboxed Chrome and retains `case-lifecycle-browser`. Never bypass a local browser sandbox restriction.

Five focused actual PostgreSQL tests cover an actual upgrade from migrations 001–038 with retained authority and honestly timed/unattributed checkpoints; transitions/restart/replay/races, immutable history and head fencing; closed intake/upload/worker denial; real approved release and revocation; actual loopback HTTP membership/role/CSRF boundaries; audit-failure rollback and history paging. The browser journey closes/reloads/reopens a case, inspects history, checks narrow-screen overflow and clears revoked stage data. BUILD_HANDOFF.md records exact executed revisions and pending checks. No new dependency, copied research source, production migration/deployment, live data or external contact is introduced.

Final implementation `77488eb2984a9bd3b77d63cf91b26bd31dcfb0bb` passes Checks 40947709745 (293 Node/116 Python, no failures/skips), including all 24 browser journeys and worker probes. Research 40947709670 passes the actual isolated supplier and leased-worker acceptance. [Detailed review, machine receipt and inspected final render](evals/2026-10-29-case-lifecycle.md). BUILD_HANDOFF.md records current merge state.
