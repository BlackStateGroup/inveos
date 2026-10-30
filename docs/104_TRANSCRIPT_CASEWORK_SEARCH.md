# Transcript findings across casework and search

Active connected batch following merged PR97. Fictional fixtures only; product completion and production acceptance remain open.

## Implemented

Migration 050 adds a case/tenant-scoped transcript finding reference to the existing immutable work links. Each link has exactly one typed source. Supporting, contrary and context links use the existing actor-bound retry, explicit relevance reason, audit transaction and retained withdrawal protocol. Document and transcript endpoints share this implementation without changing document response shapes.

Question resolution and supported/disputed hypotheses reverify all current linked originals, selected transcript versions, independent decisions and case authority. A correction, withdrawal or changed authority cannot silently carry an earlier accepted interpretation into a new assessment. Assessments retain their exact link set in immutable revision history. Link withdrawal preserves that history and does not erase a finding or rewrite an old assessment.

The work interface can discover historical candidate findings, inspect the exact transcript quote/version/source timestamps/digest and decision, link or withdraw with lost-response retry, and reload history. The source inspector clears its retained content on access denial. Frozen report JSON, print and PDF include typed transcript reasoning joins; whole-finding PDF omission removes the related link metadata. Standalone verification checks scope, source kind, duplicate joins, dates and relations. Mixed document/transcript packages independently verify both families. Old reports without transcript links preserve their existing representation.

Case search/private saved views now include supplied transcripts, transcript proposals and separate reviewed findings. Search uses current corrected text while old versions remain in transcript history. Withdrawn and stale interpretations remain searchable with explicit status. A search match does not reverify source bytes or establish truth. Existing server membership filtering and bounded keyset pages apply.

## Verification and run instructions

Use the existing disposable restricted-role PostgreSQL setup in README. Run `npm ci --ignore-scripts`, `npm run lint`, `npm run typecheck`, `npm run build`, the API suite with `INVEOS_TEST_DATABASE_URL`/`INVEOS_TEST_ADMIN_DATABASE_URL`, and `python3 -m unittest discover -s tests -v`. Qualified hosted Checks runs the actual browser suite; local Chrome isolation must not be bypassed. The copied standalone `verify_report.py`/`report_package.py` and `verify_document_package.py`/`verify_ocr_derivative.py` checks need only Python's standard library.

Executed initial acceptance: 8 focused actual PostgreSQL/API tests, including migration and unchanged document-link regression; 8 focused Python verifier tests. Full local regression: 345 Node pass, 36 explicit browser skips, 381 total, zero failure; 144 Python pass. This precedes the final mixed-family test/access-clearing adjustment. The actual browser reasoning/search/reload/history/lost-response journey is written and unrun at this checkpoint. Final hosted combined checks, rendered review and merge remain pending. Existing >500 kB web chunk warning remains.

No new dependencies or copied upstream source in this increment; it reuses INVEOS's existing document-link/withdrawal and search protocols. Pinned permitted source adaptations already merged in docs/102 retain their provenance/notices. Media alignment, transcript-backed chronology/graph, representative performance, provider/native device and external approval gates remain open.

The additional actual API/export test passes: a single frozen package with document and transcript findings and both reasoning-link types is verified by copied standalone tools outside the repository. Final lint/types/build/actionlint/foundation checks pass after access-denial clearing was added to source mutation failures. Hosted full/browser acceptance remains pending.
