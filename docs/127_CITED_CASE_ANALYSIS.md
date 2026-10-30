# Cited source comparison and passage retrieval

Implementation phase, 30 October 2026. This is a bounded first-party rule workbench, not completed AI Case Analyst or production acceptance.

## Implemented

Research now connects selected reviewed text, document, supplied-transcript and speech findings to an immutable analysis run. The server resolves every selected reference inside current tenant/case membership, verifies original/citation/review provenance through the existing source service, and pins the exact finding fingerprint and case authority. Separate same-case foreign keys retain source identities. At most eight distinct findings and a200KB run payload are accepted; a case has at most1000 runs.

Three modes are available:

- Cited reading list retains exact source quotations, reviewed interpretations, source-recorded/received times and typed location descriptions.
- Question passage retrieval ranks selected quotations/interpretations by explicit word overlap. No matching passage returns an empty result; no semantic answer or unseen evidence is invented.
- Comparison considers passages from distinct original identities sharing at least three substantive words. It reports different currency literals, ISO-shaped dates or recognised negation wording as suggestions. Every suggestion preserves both exact quotations, the observed literals, rule explanation and suggested check. Neither a common entity/event nor a contradiction is established.

The run, request identity and rule profile are immutable. Repeated requests reuse the saved result only for the same actor and input. Inspection regenerates the deterministic output and checks current source fingerprints. Authority changes, new speech/transcript corrections, source withdrawal, blocked source use or original corruption prevent reuse. The earlier run remains retained rather than silently rewritten.

An independent case reviewer may request a human check or dismiss a suggestion with a reason. Each decision has an expected version, stable retry identity and append-only history. Decisions do not create findings, tasks or client releases. After an independent request for a check, an investigator can explicitly create an assigned follow-up question from the suggestion. Migration089 binds the exact triage version to one question; the question, both contextual source links, initial version snapshot and audit are written atomically. Stable retries recover the question, and later work edits remain in the normal Brief/Tasks history. This separation avoids treating a comparison hint as evidence or a resolved allegation.

The interface includes source filtering/selection, saved-run pages, exact passage locations, original navigation, side-by-side comparisons and triage history. Errors clear loaded source context. The API and interface use the existing locked dependencies and first-party source/review patterns; no new model, library, external service or upstream code was incorporated. No source text is executed as instructions or sent externally.

## Setup and current evidence

Apply migration080 using the disposable schema administrator after existing migrations; run the API with the restricted application role. Open a fictional active case with reviewed findings, choose Research → Cited case analysis, select sources and save a run. Use another authorised reviewer account to triage suggestions. A later edit to an underlying reviewed transcript requires a new run.

Web, contracts and API TypeScript compilation passes (`/tmp/inveos-analysis-compile.log`); the API-only compiler also passes (`/tmp/inveos-analysis-api-compile.log`). These are implementation feedback, not acceptance evidence. PostgreSQL migrations/API, browser/render, concurrency/lost-response, denied-access, corrupted-source and rule-quality checks are **unrun** and deferred to combined acceptance as requested.

Required acceptance includes same-case foreign keys; original tamper; cross-case/tenant/client rejection; revoked membership/source use; stable retry and conflicting identity; concurrent decision versions; exact source locations and source times; no-match questions; different currencies; formatting-only differences; unrelated subjects; common names; misleading instructions within quotations; Unicode and long context limits; current versus historical correction states; and desktop/narrow browser reload/navigation/denied-context clearing. Rule accuracy requires human-labelled fictional material and must be reported separately from software pass counts.

## Remaining

Semantic Q&A, model-generated summaries/entities/events, domain-qualified fraud rules, prompt-injection evaluation against an actual inference runtime, multilingual semantics, representative quality/cost evidence, broader source retrieval, model/provider/runtime/licence approval and professional acceptance remain open. No rule suggestion is an allegation, legal conclusion, independently verified truth or automatic client disclosure. Production/native/device/recovery gates remain in the delivery plan.


Follow-up implementation compiler feedback passes (`/tmp/inveos-analysis-followup-compile.log`). The shared work-creation routine is reused, including current owner membership/date validation and immutable initial history. Acceptance must additionally exercise transaction rollback after source-link/audit failure, concurrent/replayed follow-up creation, version-changed/dismissed triage, revoked assignees, exact links in the first question revision and navigation after reload. These checks are unrun.
