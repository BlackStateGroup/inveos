# Versioned independent-review ownership

Reviewers can coordinate the existing independent-review queue with a named reviewer, return work to the pool, filter work assigned to themselves or needing reassignment, and inspect reasons and history. This is coordination of one exact pending record. Assignment neither approves evidence or delivery nor grants access, and another eligible case reviewer can still decide the review.

## Current scope and independence

The assignment API reuses the queue's current eligibility query for claims, document interpretations, extraction correspondence, supplied source metadata, expenses, transcript interpretations, frozen reports and PDF/DOCX copies. Both the coordinating actor and chosen assignee must currently be eligible independent reviewers for that record. Source previous authors and transcript correctors remain excluded. Preferences and personal acknowledgements do not determine eligibility. Closed/stale/completed records cannot receive new assignment decisions.

The composite case, reminder key and revision bind ownership to the exact pending version. A correction starts unassigned; prior assignment history remains available to current authorised case reviewers through the same API, even after a review is completed. There is no automatic carry-forward of ownership or approval. Assignment history is append-only, records names at the time of the decision, and retains a reason, actor and server timestamp. Live membership/role checks label a removed or downgraded assignee unavailable. Historical names are retained deliberately; they confer no current authority.

Migration058 adds `case_review_assignments` and binds personal acknowledgements to the assignment version. Existing acknowledgements retain their identity/time at assignment version0. Changing ownership returns that pending record to personal reminders without deleting older acknowledgements. A stale acknowledgement cannot hide newly assigned work. Saved reminder preferences still apply; this is not email/push delivery or a guaranteed notification service.

## API, transactions and interface

`GET /api/cases/:caseId/review-assignments?key=…&revision=…` returns the current assignment, pending eligibility, the newest50 decisions and the first50 eligible reviewers. `before` pages history; `after` pages current eligible reviewers. The same reminder query enforces candidate independence. Histories are limited to1000 decisions per exact record version; case collaborator limits remain200. Queries and locks retain two-second bounds. Current case access is rechecked after acquiring the case lock.

`POST` accepts a stable UUID `id`, exact key/revision, `expectedVersion`, nullable `assigneeId` and a10–2000 character reason. Competing edits cannot overwrite one another. Identical retries return the recorded version/current receipt, including after the underlying review is completed; changed reuse of a request identity conflicts. The assignment and its audit event commit together. Clients/investigators cannot use these endpoints; another tenant, unassigned or revoked case member cannot read or mutate them. All responses are no-store.

`GET /api/attention` adds `ownership=all|mine|unassigned`; the latter includes an unavailable named assignee. It preserves case-scoped keyset pagination, categories and saved preferences. Acknowledgement now accepts the observed `assignmentVersion` (omission means legacy version0).

The existing attention dialog opens a keyboard-focused ownership panel. It offers eligible reviewers, a reason, current ownership, paged history and paged candidates. Pending requests abort on unmount. Failed/denied loads clear displayed assignment details; explicit refresh checks the saved result after an uncertain submission before another edit. Saving reloads the queue. Browser history is currently entered from pending reminders; completed-version history remains accessible through its authorised exact API and audit trail. A broader completed-review history browser, contractor policy and capacity planning remain open.

## Verification and retained failures

Initial focused PostgreSQL regression failed5/11 checks: joining the current assignment made the acknowledgement lookup's unqualified `item_key` ambiguous. Qualifying `x.item_key` fixed the regression; all11 focused checks passed on rerun, with zero skips. Initial test type checks also caught possibly undefined fixture selections; explicit fixture non-null assertions resolve those test-only errors. Do not relabel those first runs passed.

Eight new PostgreSQL/API tests cover actual HTTP role/case/tenant/CSRF and no-store boundaries, prior source authors, fresh assignee/actor access after lock waits, stable retry/collision, stale versions, corrections and completed reviews, another independent reviewer's decision, serial competing assignments, immutable storage, atomic audit rollback, candidate/history pagination and acknowledgement invalidation. A real populated-schema migration test proves existing acknowledgement identities/timestamps survive as version0. Full local and hosted results are recorded below as they actually complete.

The browser journey assigns an expense review, filters personal work, acknowledges it, receives reassignment, reloads saved history, checks a390px dialog, labels a removed assignee and clears a revoked case. It verifies no expense review was silently recorded. The Checks workflow executes the journey in production and development bundles and retains desktop/mobile renders. No local sandbox bypass is used; local browser skips are not acceptance.

## Source reuse, privacy and remaining gates

This increment extends the existing first-party attention, access, review and append-only transaction patterns. No upstream implementation or new dependency is incorporated. Existing permitted catalogue adaptations retain their notices and provenance. The actual Debian signed-index/source/archive qualification from109 remains recorded separately; copying or rewriting upstream code does not remove its licence obligations.

Source/privacy review checks every tenant/case join, saved-name visibility, candidate independence, stale/revoked access, text-only rendering, conflict/retry semantics and the separation of assignment from review/release. Fictional fixtures only. Representative large-case performance, broader collaboration/contractor policy, external delivery, professional/security/privacy/legal approvals and production readiness remain unmet.

## Reproduce

Follow `LOCAL_RUN.md`, locked `npm ci`, and its disposable restricted PostgreSQL setup. Set both `INVEOS_TEST_DATABASE_URL` and `INVEOS_TEST_ADMIN_DATABASE_URL` before the Node command.

```sh
npm run typecheck
npm run lint
npm run build
npm run test:foundation
node --import tsx --test --test-concurrency=1 apps/api/test/*.test.ts
# Qualified sandboxed browser host only:
INVEOS_TEST_BROWSER=1 node --import tsx --test --test-concurrency=1 --test-name-pattern='real browser assigns independent reviews' apps/api/test/api.test.ts
```

Initial full local regression passed405Node,failed1,skipped45browsers (451total): the explicit migration inventory still stopped at057. Adding058 to that expected inventory and the populated-acknowledgement upgrade test produced9/9focused ownership/migration passes,zero skips. Types/lint/build,188Python and workflow validation pass. Final local/hosted browser acceptance remains pending.
