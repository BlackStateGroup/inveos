# Field operations browser acceptance

Root definition `apps/api/test/field-operations-browser.integration.ts` exercises the built application, actual loopback HTTP and restricted disposable PostgreSQL through sandboxed Chrome. Fictional data only. No new dependency or native/device claim.

The journey creates an encrypted vault and saves current device/case scope through visible controls. With Chrome network access offline, it starts a session, records a supplied account with an explicitly manual place declaration and unknown coordinates/uncertainty, then records a correction as a separate original. No server evidence exists while offline. After reconnecting, a new page and vault unlock must recover the originals. Each original needs separate intake and organisation receipts. The test inspects server correction history and distinct original hashes, retained timezone-bearing source time and the absence of automatically created claims.

A reviewer publishes fictional dispatch instructions through the actual API as fixture setup. Recipient UI controls then save acknowledgement and session-linked check-in offline. Reconnection delivers operational originals and applies them with separate receipts. Assertions keep those originals outside evidence, preserve observation hashes and clear loaded records when the vault locks. Desktop/narrow captures assert no horizontal overflow. This is recipient operational UI acceptance, not a claim that supervisor publication UI, native devices, every handover/incident path or complete outage/restore behaviour was tested.

## Execution status

**New browser journey and render inspection are unrun.** API TypeScript, scoped ESLint, actionlint and whitespace checks pass after definition corrections. The first compile caught a definition mistake (`original` instead of the session receipt's `source` field), corrected before execution. Initial task fixture was aligned with the actual required creation contract during source review. These are definition corrections, not reproduced product defects.

Existing combined acceptance at `1d80e3fd` passed526 Node with54 explicit local browser skips. It predates this new definition and must not be counted as its execution.

Hosted command, after the web build and existing restricted/admin disposable PostgreSQL variables are configured:

```sh
node --import tsx --test --test-concurrency=1 apps/api/test/field-operations-browser.integration.ts
```

The Checks `connected-workflows` job executes this file explicitly. Artifacts are retained under `output/evals/field-operations/`. The normal local API glob does not execute `.integration.ts` browser journeys. Local Chromium namespace creation is blocked; no further local launch or sandbox weakening is attempted. Root must record actual hosted pass/failure and inspect render artifacts before acceptance.
