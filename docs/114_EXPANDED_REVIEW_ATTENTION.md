# Connected independent-review attention

This increment connects pending transcript interpretations, frozen report revisions, PDF copies and disclosure-capable DOCX copies to the existing personal attention queue. Its API, interface and navigation are implemented; hosted browser acceptance and merge remain pending. No new application dependency, upstream copy, production deployment or outside notification is introduced.

## Behaviour and boundaries

Current assigned reviewers see undecided records from other authors. PDF/DOCX reminders also exclude their copy creator and report author. Historical internal-only DOCX v1 copies have no disclosure-review reminder. A recorded decision removes that record from the pending pool; a report change request suppresses its copy-review reminders. These records remain in their ordinary immutable history. A reminder is not a request to override a decision.

Transcript reminders bind the exact claim digest and selected transcript version. Later segment corrections, changed source authority, withdrawal or a decision remove the old candidate. A person who corrected the selected transcript lineage cannot receive its independent-review reminder. The original proposal and any decisions remain unchanged.

Report/copy reminder revisions include their immutable fingerprint and current case authority version, so an acknowledgement under an earlier authority does not hide a later reminder. Acknowledgement changes only that user's queue; it creates no finding, review, release or task completion. Current tenant role, case membership and open lifecycle still gate each query and acknowledgement. Closed/archived cases have no new review reminders. The existing two-second query/lock bounds, 50-item keysets, saved preferences, immutable acknowledgement records and atomic audit apply.

Listing is not source verification or a statement of release eligibility. Report source-use, original integrity and current independent-review requirements are rechecked through the existing inspection/review endpoints. No queue record or browser selection grants access. Titles are bounded, supplied text is rendered as text, and clients receive no internal review queue. Refresh removes revoked scope; notification bodies are not persisted elsewhere.

## Exact context navigation

Opening a report/copy reminder loads its exact frozen revision even when it falls beyond the first 25 revisions, focuses that record for keyboard users and displays the named copy identity. Existing saved PDF/DOCX controls then load the file history for inspection. It does not automatically download or approve a copy. Opening a transcript reminder loads and focuses that exact proposal even beyond the first 50 proposals; the existing citation inspection verifies its original and selected transcript version.

The new report-receipt and individual transcript-record reads require current internal case access and return no-store metadata. They do not replace exact-byte verification. Review focus is local navigation state; normal navigation clears it. Existing revision/proposal pagination and source controls remain available.

This builds on INVEOS's existing attention, report and transcript mechanisms. Earlier permitted catalogue adaptations retain their notices and pins. Rewriting upstream code would not remove licence obligations; this batch incorporates no new upstream implementation or artifact.

## Verification

Thirteen focused actual PostgreSQL/API checks passed, including current roles/tenant/case denials over HTTP, no approval from acknowledgement, report-change suppression, authors/correctors, stale versions, withdrawal, case closure, authority-bound acknowledgements and retained v1 exclusion. Existing attention pagination, audit rollback, durable preferences and post-lock revocation also passed. Type checks, lint, build and workflow validation passed. Full local regression passed **395 Node,43 explicit browser skips,438 total,zero failures;179Python**. These skips do not count as browser acceptance. Source/privacy review inspected current SQL joins, independent-author/corrector exclusions, immutable reminder identities, receipt-only context reads, text rendering, session/case navigation and denied-access behaviour. Actual browser/render review remains required.

A new hosted browser journey creates a report beyond the first 25 revisions and a transcript proposal beyond the first 50, opens both through paged reminders, checks exact keyboard focus and original-source inspection, exercises a narrow viewport and removes revoked case reminders. It is written but not yet executed at this checkpoint. The workflow also runs it under development effect replay and retains a real screenshot. This is not a representative large-case performance benchmark or native-device acceptance.

## Reproduction and open work

Use the existing disposable PostgreSQL role/database from LOCAL_RUN.md. Install the locked dependencies with `npm ci`, then run `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:foundation` and `npm test --workspace @inveos/api` with the documented test database variables. For the focused API run:

```sh
node --import tsx --test --test-concurrency=1 --test-name-pattern='expanded review|expanded transcript review|historical DOCX v1|^attention' apps/api/test/api.test.ts
```

Set `INVEOS_TEST_BROWSER=1` only on a host with working sandboxed Chrome; local isolation is unavailable and must not be bypassed. No migration or original/report-byte format changes. Source correspondence, source-register and expense review reminders, individually assigned review ownership, contractor policy, external push, representative large-case performance and professional/security/privacy acceptance remain open.

## Hosted render correction

Initial head `662fc81bd780e753ea11cbf3dcadb927a62e5d06` passed **Checks41024064621 / job123957888419:438Node/179Python, zero failures/skips,43 production plus six development browser journeys**, both office profiles, host probes/lint/types/build. Render inspection then found horizontal overflow inside the notification dialog from long review-status badges; the old document-width assertion did not measure that inner scroll area. Scoped wrapping now keeps reminder headings/statuses/actions within the dialog, and browser checks measure both the dialog and queue widths on desktop and a narrow viewport. Final rerun and renders remain pending.

Layout head `7b22f85fb10469d63f10dde8ce1b3816bb8a11f3`, Checks41025243891, failed overall:437/438Node,179Python,zero skips. The expanded review browser and both actual width assertions passed; desktop/narrow renders were inspected and fit. An older case-creation journey clicked synthetic entry immediately after its consent checkbox, before React enabled the button. Its click helper now waits for the visible enabled control, retains a bounded timeout and still rejects an unavailable button. Development/office/host steps did not run after that API failure. Corrected full acceptance remains pending.

Final head `0c6a2a76665bab4bf783450063ba02dae4dd24f7` passed **Checks41026433536 / job123965540606:438Node/179Python,zero failures/skips,43production+6development browsers**, both actual office profiles, host probes/lint/types/build. Desktop/narrow renders inspected after the final run; source/privacy review complete and no outstanding feedback. PR108 merged as `dc75a5e33a4e520170777b166e31174e274794db`. Resulting-main41027166048 remains pending.

Resulting-main **Checks41027166048 / job123967907932** passed438Node/179Python,zero failures/skips,43production+6development browsers,both office profiles,unchanged host probes/lint/types/build at `dc75a5e33a4e520170777b166e31174e274794db`.
