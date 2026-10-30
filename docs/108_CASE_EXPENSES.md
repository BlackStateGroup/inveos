# Case expenses and spending

Active connected application batch; final acceptance and merge pending. Fictional fixtures only. This implements attributed expense declarations, independent review and a spending plan alongside the existing time ledger and time budgets. No payment, tax calculation, currency conversion, billing activation or client invoice is produced.

## Declarations and receipts

An assigned internal member records a calendar date, GBP/EUR/USD amount, description and optional preserved receipt original. All three supported currencies use integer minor units with two display decimals. No floating-point amount is accepted by the API. Declared expense date, original source/receipt times and server recording time stay separate. The UI selects existing case originals and opens the preserved receipt from the declaration.

Only the original recorder can correct or withdraw their declaration. Each correction retains earlier fields, receipt identity, reason, actor and recorded time. Withdrawal is terminal and preserves earlier reviews. A reviewer may accept or reject one exact current revision, independently of its recorder. Acceptance requires an intact preserved receipt, current matching acquisition authority and permitted use if the original is in the supplied-source register. Missing, substituted, corrupted or blocked receipt originals cannot be accepted. A correction requires another review; prior reviews remain attached to their original versions. A rejection or withdrawal remains possible when a receipt is unavailable or a case is closed.

Investigators see their own declarations; assigned current reviewers see the case ledger and aggregate spending. Client, other-tenant, unassigned and removed users cannot use these endpoints. The same case lock and fresh membership/role check as the other workflows apply after waiting. Stable operation identities recover a committed lost response; conflicting versions or changed payloads fail rather than replacing saved decisions. Audit failure rolls back the whole mutation. Migration 054 enforces scoped receipt/revision foreign keys, immutable revisions/reviews/budgets and protected declaration heads.

## Spending allocations and history

A reviewer records a separate allocation for each supported currency. Current totals include every active declaration, beyond the visible ledger page and including retained declarations by former colleagues. Accepted, pending and rejected amounts remain separate. The planning balance subtracts all declared active expenses from the selected currency's allocation; it never combines or converts currencies. The snapshot has an explicit observed time. Allocations can be revised or withdrawn with reason and history; zero is valid.

Review totals retain decisions recorded at the time. They do not silently revalidate historical receipts or become payment authorisation when a reviewer leaves, authority changes or a source is later blocked. A new linking/acceptance operation checks current authority, permission and bytes again. Spending plans do not block evidence intake. New declarations, corrections, acceptance and allocations require an active/review-stage case; terminal withdrawals and rejections preserve cleanup paths after closure.

The case holds at most 10,000 expense identities, each with at most 100 revisions. Revision 100 is reserved for withdrawal. Each currency has at most 1,000 allocation decisions, with the final one reserved for withdrawal. Expense amounts are bounded at 1,000,000,000 minor units; allocation amounts at 1,000,000,000,000. Aggregate integers stay within exact JavaScript integer range under these bounds. History pages retain every identity and version.

## Reproduction and evidence

Use README's locked setup and disposable restricted-role PostgreSQL database. Run:

```sh
npm run lint
npm run typecheck
npm run build
# Set the documented disposable INVEOS_TEST_DATABASE_URL and admin URL first.
node --import tsx --test --test-concurrency=1 --test-name-pattern='case expenses|migrations' apps/api/test/api.test.ts
```

**Nine focused PostgreSQL/API/migration checks pass**, covering persistence and restart; exact currency totals beyond a page; immutable receipt/review history; corrections and withdrawal; malformed input and numeric coercion; original corruption/substitution/current source policy; actual HTTP boundaries; concurrent corrections; fresh access after a real PostgreSQL lock wait; atomic audit failure; closed-case cleanup and final-version reservation. Lint, types, build and actionlint pass; the existing chunk-size warning remains.

Initial test scaffolding used an absent assignment helper and omitted the new migration from the expected list. Those were corrected before the first five checks passed. The expanded suite then exhausted a shared application rate-limit bucket; fixtures now use the existing per-fixture app-restart pattern without changing production limits, and all nine pass. A test HTTP JSON type was corrected before type checks passed. These failures are not passing evidence.

The actual browser journey is written for declaration and preserved receipt selection, committed-response loss/retry, independent review, reload, correction/history, separate spending allocations, withdrawal, narrow layout, outage recovery and revoked-access clearing. CI runs it in production and development modes to exercise real effect replay. Full local regression passed **373 Node, 39 explicit browser skips, 412 total, zero failures**. Final hosted acceptance and actual render inspection remain pending. Local browser isolation is unavailable and must not be bypassed.

This does not complete invoices, rates, reimbursement/payment authorisation, financial policy, agency billing, real provider/native delivery or independent professional/security/privacy/legal approval. No dependency or upstream code is added; existing first-party versioned-decision and scoped-source protocols are reused, with existing third-party notices preserved.

Initial hosted Checks **41004293130 / job 123895547534**, head `01f905de5dbeed4d0fba61a8b9e00d4d5f204328`, passed **411 of 412 Node checks, zero skips**, including the new actual expense journey; 157 Python passed. The overall run failed the existing document-search browser assertion because it searched the whole page for “Recorded review” and now matched the expense panel’s “Recorded reviews” explanatory text. The assertion is narrowed to its actual search-result region, preserving the check that extracted passages are not presented as reviewed findings. Development-mode journeys were skipped after the failure and are still pending. No application behaviour is changed by this test correction.

## Final review and merge

PR #102 merged as `70194886113fc622251dd77b8b468b2daa830a77`. Reviewed head `214e140b183cece3073137225b412f055cc3a749` passed **Checks 41004995654 / job 123897770713: 412 Node/157 Python, zero failures/skips, 39 production plus three development browser journeys**, lint/types/build/host probes. Source/privacy review and actual expense render inspection completed; no outstanding feedback. **Resulting-main 41005679284 / job 123899920153 passed the same 412/157 and 39+3 browsers, zero failures/skips.** Initial Checks 41004293130 at `01f905d` failed one existing whole-page search assertion (411/412 passed, including the new expense browser); the fix scopes the assertion to unreviewed search results. Development checks did not run in that initial failed job. Earlier local fixture/type failures remain in docs/108. No payment/billing activation or new dependency.
