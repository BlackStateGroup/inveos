# Versioned case time budgets

Reviewers can record a whole-case planning allocation and compare it with current declared time. This extends the [time ledger](93_CASE_TIME_LEDGER.md) for WP-12. It does not create rates, expense claims, invoices, payments, subscriptions or financial approval, and does not block evidence collection when the allocation is exceeded.

Only a current reviewer assigned to the case can read budget history, read whole-case usage or record a decision. Investigator/client roles, other tenants, unassigned reviewers and revoked members are denied server-side. The interface appears only for reviewers. Case ownership alone does not expand access to other recorders’ time. After acquiring the case lock, the server rechecks current case membership and the authenticated role, including a role changed while the request waited.

## Decisions and usage

An allocation is an integer number of minutes from zero to 14,400,000, covering the whole case rather than additional time from that decision onwards. A meaningful reason, named actor, server timestamp, stable request UUID and expected current version accompany every allocation, revision or withdrawal. Withdrawals preserve the previous allocated minutes and all history. A later allocation is a new explicit version; it does not resurrect an earlier decision. Case closure retains administrative history and does not prevent an authorised planning correction.

Migration 046 stores append-only decisions with case/tenant foreign keys and scoped unique request identities. A database trigger enforces sequential versions, valid allocation/revision/withdrawal transitions and retention of the previous amount on withdrawal. Direct updates/deletions are denied. Audit failure rolls the decision back. Exact retries return the current snapshot and the version originally applied, without reverting newer decisions; changed request content or a different actor using the same request identity conflicts. Concurrent editors using the same expected version cannot both succeed.

Usage sums **every latest active time entry in this case**, including retained work by former members. It is not a sum of the visible time page. Corrections replace the prior amount in the total; withdrawals exclude an entry without erasing it. Declared overlaps are counted, and the recorder’s chargeable flag only contributes a separately labelled subtotal. No duration is independently verified or approved for charging. The case lock makes the budget and usage snapshot consistent with the existing time-write path. Its server observation time is separate from each original declared work time and budget decision time.

History uses 25-version keyset pages. Decisions are limited to 1,000 versions, with the final version reserved for withdrawal. The existing ledger permits 10,000 entry identities per case. Queries retain two-second lock and five-second statement deadlines. These bounds and small fixtures are not representative large-case performance certification. Budget snapshots contain counts/minutes rather than colleagues’ time descriptions and remain subject to reviewer access.

## Use and recovery

In a persistent lab reviewer session, open a case’s **Brief → Case time budget**. Choose **Set time budget**, enter minutes and a fictional planning reason, then save. Revise or withdraw explicitly; **Budget decision history** exposes retained decisions. A negative planning balance is shown as minutes over allocation. Refresh after a separate time entry changes, because the displayed total is a timestamped snapshot, not a live timer.

Retry an unchanged submission after a lost response. After a conflicting edit, refresh to inspect the current saved allocation before making another decision. Refresh discards unsent edits and hides the old totals while loading. Outages leave an explicit retry error; denied access clears budget data and the unsent editor and refreshes case context. No persistent offline cache or native-device acceptance is claimed.

Use the repository’s locked setup with a disposable PostgreSQL database and restricted `inveos_app` role:

```sh
node --import tsx --test --test-concurrency=1 --test-name-pattern='case budget|migrations' apps/api/test/api.test.ts
npm run lint
npm run build
npm run test:foundation
npm test --workspace @inveos/api
```

`INVEOS_TEST_BROWSER=1` requires working sandboxed Chrome and built web assets. Hosted CI runs the actual budget browser, including lost-response recovery, conflict/reload/history, over-allocation, outage/retry, narrow viewport, withdrawal and revoked data clearing. A narrow browser viewport is not native iOS/Android evidence. [Evaluation](evals/2026-10-30-case-budgets.md) and [handoff](../BUILD_HANDOFF.md) record what actually ran. Remaining financial budgets, expense/billing rules, workload, support boundaries, production identity/storage and external approvals are separate requirements.
