# Existing-account case invitations

Connected application batch. Fictional fixtures only. Final hosted/browser acceptance and merge remain pending.

## Behaviour and boundaries

An existing internal case owner can offer case membership to another existing investigator/reviewer in the same tenant. An offer does not grant access. It deliberately discloses the case reference/title, original owner/recipient names, reason and pinned approved purpose/scope to that recipient. The invitation is available through Assignments → Case invitations even when the recipient has no assigned cases. Evidence, other case records and internal owner invitation history remain inaccessible until acceptance.

The owner offers access from Brief → Case collaborators → Invite an existing colleague. Expiry is server-recorded, from 1 to 168 hours. Creation requires current access version, current ownership, approved authority and Active/Review lifecycle. Acceptance rechecks those conditions under the case lock, plus current internal roles, owner membership and case capacity. Any ownership transfer after the offer invalidates acceptance, even if ownership later returns. Changed authority requires a fresh offer. Ordinary collaborator changes do not invalidate all other offers. Multiple offers are retained; after one acceptance, others cannot add a duplicate membership.

Acceptance atomically adds existing-role membership, advances the case access version, retains the response and access history, and writes an audit event. No role escalation or automated client release occurs. Stable operation identities recover a committed lost response. Replaying a previous acceptance after membership removal returns its old receipt and current membership state; it never restores access. Offer request field order does not alter its identity.

Decline records the recipient's decision, including for an expired/superseded offer. Cancellation is an explicit current-owner decision and only applies before a response. Cancellation and decline grant nothing. After acceptance the owner uses the existing collaborator removal path to revoke access. Accepted historical receipts and previously offered scope remain in the named recipient's inbox after removal; this is intentional retention of an already disclosed offer, not current case access. A removed internal role clears the inbox on the next request.

## Data and review

Migration 052 adds append-only offers, responses and cancellations. Foreign keys scope the original authority/access version and accepted access event to the case/tenant. Database immutability triggers and restricted app grants preserve history. Responses and cancellations serialise on the same case lock; collisions or different retries cannot make a second access decision. Fresh role checks occur after acquiring the lock. Every decision and its audit event share a transaction. Pages are bounded at 50 with UUID keysets; a case has at most 500 offers, 200 current collaborators and the existing 1,000 access-version limit.

Owner and recipient interfaces clear loaded scope/history on denied access and abort outstanding requests on unmount. They retain an unchanged pending operation across a lost HTTP response, with explicit refresh to compare the saved history. No secret invitation link, email, external communication or newly provisioned account is implemented. Real provider/MFA and new-account onboarding remain separate requirements.

This batch reuses INVEOS's existing access, scoped transaction, audit and operation-identity protocols. No new dependency or upstream code is incorporated. Previously integrated catalogue adaptations keep their pinned provenance/licence notices; rewriting code does not remove those obligations.

## Reproduction and executed evidence

Use README's disposable restricted-role PostgreSQL setup. Install the locked workspace with `npm ci --ignore-scripts`; run lint, typecheck and build. With `INVEOS_TEST_DATABASE_URL` and `INVEOS_TEST_ADMIN_DATABASE_URL` set, run `node --import tsx --test --test-concurrency=1 --test-name-pattern='case invitations|case invitation pages|migrations' apps/api/test/api.test.ts`.

Eight focused actual PostgreSQL/API/migration tests pass. They exercise no-access-before-acceptance, canonical retry/removed-member replay, real-clock expiry, cancellation/decline, changed authority/lifecycle/transfer-back, actual HTTP tenant/owner/recipient/client/CSRF/input boundaries, concurrent decisions, role revocation while waiting for a case lock, full audit rollback, bounded restart/pagination and ID collisions. Type checks pass.

The full browser journey is written: owner offer and lost-response recovery, cancellation, recipient with no cases, decline, acceptance/lost-response recovery, reload, actual case opening, narrow viewport and removed-access/role clearing. It is unrun locally because this host lacks working browser isolation. Qualified hosted Checks must execute it and retain actual owner/recipient renders. Full local regression passes **356 Node with 37 explicit browser skips (393 total), zero failures; 145 Python**. Lint/types/build/actionlint/foundation checks pass. The existing web chunk warning remains (551 kB). Final hosted acceptance remains pending at this checkpoint. No native-device, real provider or production-readiness claim.

Source/privacy review before draft publication: existing-role-only offers, named-recipient scope disclosure, current owner/authority/lifecycle checks, post-lock role refresh, same-transaction access/audit changes, immutable decisions, exact retries and removed-member replay, bounded listing and access-denial clearing inspected. Actual browser verification and rendered review remain required.

Initial invitation head `a216604895b829399a43b9f4be1caed60a98ffd1`: Checks **40998251325**, job **123876338539**, failed with exit 124 at the whole-suite 240-second limit, after 378 reported passing checks. The new actual invitation browser journey passed (4.7 seconds); both actual renders were inspected. This is not a complete passing suite. The expanded 393-test suite now has a bounded 360-second allowance; the owner render also waits for its response refresh to settle. Final complete rerun remains pending.
