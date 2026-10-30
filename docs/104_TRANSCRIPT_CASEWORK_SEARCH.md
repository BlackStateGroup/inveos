# Transcript findings across casework and search

Merged PR98 following merged PR97. Earlier pending checkpoints below are historical; the final receipt supersedes their status. Fictional fixtures only; product completion and production acceptance remain open.

## Implemented

Migration 050 adds a case/tenant-scoped transcript finding reference to the existing immutable work links. Each link has exactly one typed source. Supporting, contrary and context links use the existing actor-bound retry, explicit relevance reason, audit transaction and retained withdrawal protocol. Document and transcript endpoints share this implementation without changing document response shapes.

Question resolution and supported/disputed hypotheses reverify all current linked originals, selected transcript versions, independent decisions and case authority. A correction, withdrawal or changed authority cannot silently carry an earlier accepted interpretation into a new assessment. Assessments retain their exact link set in immutable revision history. Link withdrawal preserves that history and does not erase a finding or rewrite an old assessment.

The work interface can discover historical candidate findings, inspect the exact transcript quote/version/source timestamps/digest and decision, link or withdraw with lost-response retry, and reload history. The source inspector clears its retained content on access denial. Frozen report JSON, print and PDF include typed transcript reasoning joins; whole-finding PDF omission removes the related link metadata. Standalone verification checks scope, source kind, duplicate joins, dates and relations. Mixed document/transcript packages independently verify both families. Old reports without transcript links preserve their existing representation.

Case search/private saved views now include supplied transcripts, transcript proposals and separate reviewed findings. Search uses current corrected text while old versions remain in transcript history. Withdrawn and stale interpretations remain searchable with explicit status. A search match does not reverify source bytes or establish truth. Existing server membership filtering and bounded keyset pages apply.

## Verification and run instructions

Use the existing disposable restricted-role PostgreSQL setup in README. Run `npm ci --ignore-scripts`, `npm run lint`, `npm run typecheck`, `npm run build`, the API suite with `INVEOS_TEST_DATABASE_URL`/`INVEOS_TEST_ADMIN_DATABASE_URL`, and `python3 -m unittest discover -s tests -v`. Qualified hosted Checks runs the actual browser suite; local Chrome isolation must not be bypassed. The copied standalone `verify_report.py`/`report_package.py` and `verify_document_package.py`/`verify_ocr_derivative.py` checks need only Python's standard library.

Executed initial acceptance: 8 focused actual PostgreSQL/API tests, including migration and unchanged document-link regression; 8 focused Python verifier tests. Full local regression: 345 Node pass, 36 explicit browser skips, 381 total, zero failure; 144 Python pass. This precedes the final mixed-family test/access-clearing adjustment. The actual browser reasoning/search/reload/history/lost-response journey is written and unrun at this checkpoint. Final hosted combined checks, rendered review and merge remain pending. Existing >500 kB web chunk warning remains.

No new dependencies or copied upstream source in this increment; it reuses INVEOS's existing document-link/withdrawal and search protocols. Pinned permitted source adaptations already merged in docs/102 retain their provenance/notices. Media alignment, representative performance, provider/native device and external approval gates remain open. The chronology/graph extension is implemented below, with final acceptance pending.

The additional actual API/export test passes: a single frozen package with document and transcript findings and both reasoning-link types is verified by copied standalone tools outside the repository. Final lint/types/build/actionlint/foundation checks pass after access-denial clearing was added to source mutation failures. Hosted full/browser acceptance remains pending.

## Combined chronology and graph extension

Draft PR98 initial head `8014abf7b0363d29b56a886bbdcee6b1e93adc8b` passed Checks **40994732221** (job **123865106294**): **382 Node/144 Python, zero failures/skips, 36 actual browsers**. Research **40994732226** (job **123865105866**) passed actual source/runtime/archive, both supplier profiles/corpora, raster and worker-failure acceptance. Actual source-link render inspected: metadata/buttons touched, now separated into a metadata paragraph and spaced action row for both document and transcript sources.

Migration 051 and the shared typed source contract now connect reviewed transcript findings to alleged chronology accounts, graph relationship proposals and entity attributes. Independent relationship decisions remain distinct from transcript review. Full source fingerprints pin the selected transcript version; correction/withdrawal marks affected relationships stale, and fresh inspections/assessments fail closed. Original entity/source/relationship history survives withdrawal. Declared transcript timecodes never become calendar event dates. Frozen chronology and whole-finding PDF redaction use the same typed reference, independently checked by the standalone verifier. A shared source inspector preserves precise citations and separate source/receipt/review times for all three source families.

Five focused actual migration/chronology/graph checks pass, including prior text-source regressions and cross-case/stale/withdrawal checks. Full combined local regression: **348 Node pass, 36 explicit browser skips, 384 total, zero failure; 145 Python pass**. Final lint/types/build/actionlint pass after the spacing fix. The browser journey now follows transcript citations from reasoning/search into chronology and graph, with actual screenshots retained by CI. Its expanded execution and final source/render review/merge remain pending. Initial head acceptance is not final-head evidence.

## Final integration review follow-up

At expanded head `78c2b14a93268d3ac1898fd464acd15f1ef5077b`, Checks **40995503955**, job **123867562061**, failed **383/384 Node, zero skips**. The expanded transcript reasoning/search/chronology/graph browser journey passed. An existing team/entity browser waited only for the page heading, then clicked an entity before records loaded; it now waits for the exact enabled saved-entity control. Actual expanded reasoning and graph renders were inspected and the metadata/button spacing fix verified. Research **40995498127** passed independently; do not relabel the failed application run.

Review also reproduced a functional gap through the real API: searching a saved entity alias returned zero records. Case search now includes values from the current attributed entity revision only. The failing reproduction is retained in the task log; five focused real PostgreSQL search/private-view/access/alias tests now pass, including superseded-alias exclusion while history retains it. The browser journey now exercises alias discovery too. Final lint/types pass. A complete final-head hosted rerun and merge remain pending; no current claim of 385 passing tests.

## Final reviewed merge and main receipt

Exact reviewed head `588c94ecaa41fb4c9827985fd1ecddaf8d261e06` passed Checks **40996258156**, job **123869976068**: **385 Node/145 Python, zero failures/skips, 36 actual browser journeys**, lint/types/build and host probes. Research **40996257930**, job **123869975034**, passed actual pinned source/runtime/archive qualification, native/OCR supplier paths/corpora, raster and five daemon/failure/isolation checks. Final reasoning and graph renders were inspected; retained images are in docs/evals/assets/transcript-reasoning-desktop.png and transcript-graph-desktop.png.

Source/privacy review covered current case/tenant/authority boundaries, safe fixed-column SQL, selected transcript versions and withdrawal, stable retries/immutable history, typed export joins/redaction, old-output compatibility and access-denial clearing. No outstanding PR feedback remained. PR98 merged as `ad891d055dc0efebab2b2e5dfd32b481087f5bfc`. Resulting-main Checks **40997304678**, job **123873299925**, passed **385 Node/145 Python with zero failures/skips**, including all 36 actual browser journeys. Preserve the failed earlier run described above. No source-truth, media-alignment or production-readiness claim.
