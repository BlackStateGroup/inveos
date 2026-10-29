# Preservation holds and retention review

Implemented and verified development increment; [hosted evaluation and rendered review](evals/2026-10-29-preservation.md) record the actual evidence. Exact executed checks and merge status are recorded in [BUILD_HANDOFF.md](../BUILD_HANDOFF.md).

An assigned reviewer may record a case-wide preservation hold or a hold against one existing original. A hold records a declared authority reference, purpose, reason and actor; it does not determine legal validity or grant collection/disclosure authority. Case closure and authority supersession do not silently release holds. The original identity and target scope remain fixed. Reasoned amendments preserve prior versions; an explicit reviewer release is terminal, and a new instruction requires a new hold identity. Exact request retries must return current state without resurrecting a released hold.

The source anchor records the original identity, recorded digest, filename and pinned source-authority version. A preservation declaration must remain possible when bytes are unavailable or disputed, so this operation does not claim to have verified them. Use the existing Evidence verification workflow to inspect bytes. Internal members can inspect holds and history; clients, unrelated cases and other tenants cannot. All decisions require current reviewer membership, CSRF, bounded input, optimistic version checks and atomic audit. Existing source/claim/finding/release records remain separate.

The retention-review queue derives a **review date**, not automatic destruction authority, from each original's server receipt time plus its pinned case-authority retention days, each defined here as 24 elapsed hours so host timezone/daylight-saving changes cannot shift the interval. Original source time remains a separate supplied assertion. A case-wide active hold covers existing and later originals; an original-specific hold covers only its immutable target. Holds never expire automatically. The queue distinguishes active preservation, review due and the recorded interval, and exposes the exact basis rather than implying that elapsed days make deletion lawful. Per-source terms may require earlier review.

There is no committed-original destruction endpoint today. Upload rollback removes only an uncommitted failed intake; committed originals remain immutable. This increment must not claim provider Object Lock, backup erasure or executed destruction. Authorised destruction, object-delete verification, full copy inventory (including frozen exports/backups), legal approval and provider/WORM controls remain separate unmet gates. A future destruction path must recheck current holds under the case lock before acting and preserve its own authorisation/result record.

## Use and reproduce

Run the persistent lab using the [repository setup](../README.md). In a case’s **Evidence** section, use **Declare case hold**, or choose **Preserve original** beside an item in **Retention review**. Only a currently assigned reviewer can decide. Enter the instruction label, declared authority reference, purpose and reason. Open a saved hold to inspect its fixed target, amend the wording, read prior decisions or record an explicit release. Refresh restores saved state and discards unsent edits. An unchanged submission can be retried after a lost response; changed content under the same request identity is rejected. Released holds cannot be reopened.

The review queue and hold list use 50-item keyset pages, with status filters and a return to the first page. History uses 25-version pages. Limits are 200 hold identities per case and 100 versions per hold; version 100 remains available for release when amendments reach version 99. Two-second lock and five-second query deadlines apply. These are bounded development limits, not representative production capacity acceptance.

Migration `043_preservation_holds.sql` adds immutable targets and append-only attributed decisions, with a deferred current-version reference and an independently enforced terminal release. Server tenant/case/current-role checks run after acquiring the case lock. Every decision and its audit event commit together. This increment introduces no package dependency, research source copy, external collection, message or disclosure.

For disposable local PostgreSQL tests, supply `INVEOS_TEST_DATABASE_URL` for a restricted `inveos_app` role and `INVEOS_TEST_ADMIN_DATABASE_URL` for the separate schema-setup account, then run:

```sh
node --import tsx --test --test-concurrency=1 --test-name-pattern='preservation' apps/api/test/api.test.ts
npm run lint
npm run build
npm run test:foundation
npm test --workspace @inveos/api
```

Set `INVEOS_TEST_BROWSER=1` only on a host with working sandboxed Chrome, after the web build. Checks CI uses actual PostgreSQL and sandboxed Chrome. A skipped browser test is not a passing browser receipt. The fictional metadata-only paging/timezone fixtures do not claim to verify stored bytes; the core and browser fixtures use actual preserved originals.
