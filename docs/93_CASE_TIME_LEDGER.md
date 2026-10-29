# Case time ledger

This is an internal WP-12 increment. It records declared work time, not an invoice, approved charge, pay record or independently verified duration. No rates, currency, subscription, payment or external delivery are activated. [The handoff](../BUILD_HANDOFF.md) records exact verification and merge status.

Assigned investigators see their own case entries. Assigned reviewers can read the case ledger, including retained entries from former colleagues. Only the original recorder can correct or withdraw an entry, and only while they retain a current internal case role. Clients, unrelated cases and other tenants are denied. Ownership of the case does not confer permission to rewrite another recorder’s time.

The declared start keeps its supplied known UTC offset beside the normalised UTC instant. Server receipt and each decision’s recorded time remain separate. Invalid calendar dates, unknown `-00:00` offsets and offset-free times are rejected. Declared duration is an integer from 1 to 1,440 minutes. The chargeable flag is the recorder’s designation only; overlaps are not automatically reconciled and page sums are not case totals.

Creates and changes have stable request UUIDs and canonical fingerprints independent of JSON field order. A changed replay conflicts. Optimistic version checks reject conflicting edits; exact earlier retries return the current record without reverting it. Corrections preserve every earlier value, reason and actor. Withdrawal is terminal and leaves the history available, while excluding the entry from active page sums. Of 100 versions, the final one remains available for withdrawal after corrections reach 99. The database independently protects entry identity and append-only decisions.

Case records use 50-item keyset pages, history uses 25-version pages, and listing filters include scope, status and chargeable designation. There is a development limit of 10,000 entry identities per case and two-second lock/five-second query deadlines. These bounds are not large-case performance or billing acceptance. Decisions and audit events share one transaction; membership and request role are rechecked after acquiring the case lock. Case closure does not destroy administrative time history or prevent correction of a retained work note.

## Use

Run the persistent lab from the [repository setup](../README.md), open a case’s **Brief**, then **Record case time**. Enter a start such as `2026-10-29T09:00:00+00:00`, duration and a fictional work description. Choose a saved entry to correct it, inspect prior decisions or withdraw it with a reason. Reviewers can switch **Visible time** to the whole case ledger. Refresh restores saved state and discards unsent edits. After a lost response, retry the unchanged submission; after a conflict, inspect the saved version before starting a new edit.

## Verification

Use a disposable PostgreSQL database with a restricted `inveos_app` account in `INVEOS_TEST_DATABASE_URL` and a separate setup account in `INVEOS_TEST_ADMIN_DATABASE_URL`:

```sh
node --import tsx --test --test-concurrency=1 --test-name-pattern='time ledger' apps/api/test/api.test.ts
npm run lint
npm run build
npm run test:foundation
npm test --workspace @inveos/api
```

`INVEOS_TEST_BROWSER=1` requires working sandboxed Chrome and a web build. Hosted CI runs it; a local skip is not a browser receipt. All fixtures are fictional. No new dependency or copied research source is introduced.

Migration 042 belongs to the unmerged draft #87 and is completed here before its first main merge. Main had no time-ledger rows or migration 042. A disposable schema created from the earlier draft must not have its checksum bypassed: retain any wanted fictional data and use a fresh test schema. No existing main or production data is rewritten. Full agency operations, budgets, reviewed billing rules, subscriptions, invitations/SSO/MFA qualification and support-access controls remain outstanding.
