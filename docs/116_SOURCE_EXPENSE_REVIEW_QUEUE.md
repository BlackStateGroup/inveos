# Source, correspondence and expense review reminders

The personal review queue now connects the three remaining existing review workflows: extraction correspondence, supplied-source metadata and expense declarations. A reviewer can open the exact pending record from another case or beyond the first page, inspect its source/history and use the existing independent decision controls. No reminder acknowledgement creates a decision, finding, payment or client release.

## Current records, independent actors and access

All three categories use the existing statement-scoped joins to current tenant roles and case membership, two-second query/lock bounds, 50-item keyset pagination, saved review preferences and append-only personal acknowledgement/audit. Clients receive no internal queue; revoked memberships/roles disappear on refresh. Closed/archived cases have no new review reminders. An active case is required. Listing metadata is not original verification, source truth or approval eligibility.

- Correspondence reminders identify the exact job and citation. The immutable citation digest identifies the pending revision; job identity is part of the reminder key because citation IDs are scoped to jobs. The extraction must have succeeded under current case authority, the reviewer must differ from its proposer, and no correspondence decision may already exist. Accepting/rejecting correspondence removes the initial reminder; it does not invent an interpretation or finding. Replacement decisions still use the existing history controls.
- Source-metadata reminders bind the current register revision/digest and original authority version. Withdrawn/reviewed revisions and any reviewer who authored any register version are excluded. A correction returns as a fresh reminder, including after personal acknowledgement or a prior rejection. Metadata review remains separate from the registered source-use policy and any future collection approval.
- Expense reminders bind the current declaration version, exclude its recorder and omit withdrawn/reviewed declarations. Corrections require another independent decision. Missing receipts may still need review/rejection; acceptance continues to require the existing original-byte/source-use/current-authority checks. Currency totals and recorded decisions are unchanged. Nothing records or authorises payment.

## Exact navigation and retained behaviour

The source register selects and focuses the requested record. The expense panel fetches the exact current declaration if it is outside the first 50 entries, then focuses it without opening a decision automatically. Its new single-record endpoint has the same internal-case/role rules as the ledger: reviewers see case entries, investigators only their own, clients never. Responses are no-store; IDs are not access grants.

For correspondence, the existing job/derivative inspector verifies the original and derivative, and the existing exact-citation endpoint verifies the requested candidate. Browser verification checks its document context and identity before rendering/focusing it. The candidate remains unreviewed. Loading subsequent pages deduplicates an already displayed focused candidate without changing server cursors. Selecting another extraction does not carry the citation into it. Normal navigation clears reminder context; session/case keys and request aborts preserve existing denied-access clearing. Focus moves only once per requested record.

No schema, evidence identity, original bytes, review/export format or new application dependency changes. The implementation extends existing first-party queue, ledger, source-register and citation verification code. No new upstream implementation is copied; existing catalogue adaptations retain their pins/notices. Rewriting upstream code would not remove its licence obligations.

## Verification and privacy review

Thirteen focused actual PostgreSQL/API checks passed at the implementation checkpoint. Four new cases cover source corrections/previous authors, expense acknowledgements and exact-version decisions, correspondence versus interpretation, stale source authority and closed cases. Actual HTTP checks on the new expense read cover reviewer/recorder success, another recorder, client, unrelated/foreign tenant, wrong case and revoked membership; successful responses are no-store. Existing preference, pagination, audit/lock and expanded report-review tests also pass. Type checks, lint, build and workflow validation pass.

The new browser journey is written and pending actual execution: it supplies three fictional cases to one independent reviewer, creates expenses/citations beyond the first 50, pages through reminders, checks exact keyboard focus, verifies a source original, opens the existing expense/correspondence review controls, asserts that no decision was silently created and clears all reminders after revocation. Production/development browser runs retain source/expense/correspondence renders for inspection. Citation fixtures replay recorded native output; this queue increment is not a new actual parser benchmark. Full local regression passed399Node,44explicit browser skips,443total,zero failures;179Python. Skips are not browser evidence. Hosted browser/render acceptance remains pending at this checkpoint.

Source/privacy review covers composite citation identity, exact correction tokens, prior-author exclusions, every tenant/case join, record-read ownership, safe text rendering, session/case navigation and abort/denial handling. No live collection, external message, invoice, payment, new disclosure or production activation occurs. Representative large-case performance, individually assigned review ownership, contractor policy, external notifications and independent professional/security/privacy approval remain open.

## Reproduce

Follow `LOCAL_RUN.md` with the disposable restricted PostgreSQL role and locked `npm ci`. Run:

```sh
npm run typecheck
npm run lint
npm run build
npm run test:foundation
# Set the two documented INVEOS_TEST_*DATABASE_URL variables first.
node --import tsx --test --test-concurrency=1 --test-name-pattern='remaining review attention|expanded review attention|^attention' apps/api/test/api.test.ts
npm test --workspace @inveos/api
```

Only enable `INVEOS_TEST_BROWSER=1` where sandboxed Chrome is actually qualified. Local isolation remains unavailable and is not bypassed. The Checks workflow runs the new browser journey in both the production bundle and development effect replay. Historical failures remain in earlier receipts; unrun acceptance is not passed evidence.
