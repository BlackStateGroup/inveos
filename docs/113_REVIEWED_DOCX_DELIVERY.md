# Independently reviewed editable DOCX delivery

This increment adds exact-byte DOCX review and recipient delivery to the existing frozen-report workflow. Implementation is in progress; merge and hosted browser/office acceptance are not yet complete. No production deployment, billing or new dependency.

## Versioned exports and approval

Historical `inveos_report_docx_v1` copies keep their exact bytes, hashes, metadata and internal-only banner. They remain downloadable, independently verifiable and recoverable by the original idempotency key. They cannot enter disclosure review or release. New copies use `inveos_report_docx_v2`, whose banner requires separate disclosure approval and whose immutable profile/digest differs. Both profiles use the same bounded first-party OOXML writer and preserve the existing whole-finding/context redaction rules. Existing PDF profile/bytes stay unchanged.

A different current case reviewer must inspect the exact downloaded DOCX and redactions, then record acceptance or changes. Neither the report author nor copy creator can self-review. An investigator explicitly approves a named existing client recipient, expiry within seven days and a reason. Current authority, sources, source-use policy, case status, independent reviewer membership and absence of change requests gate release. Immutable review, disclosure and audit records remain separate. Post-case-lock access checks preserve the current role/membership boundary.

Migration 057 creates append-only DOCX review and disclosure associations, extends the profile constraint without rewriting old rows, and enforces one package/PDF/DOCX attachment choice with a shared immutable unique database record, including across repeatable-read snapshots. A disclosure cannot silently switch file type. Exact retries preserve their original identity and reject changed requests or cross-format recovery.

The client portal discovers only current grants, checks the exact file/report fingerprints before offering acknowledgement and downloads the original approved DOCX bytes. Expiry, withdrawal, authority changes, lost reviewer/creator membership and later change requests deny access through the existing grant policy. External edits change the fingerprint and inherit no approval. The portal never re-imports an edited copy or treats it as a new reviewed report. Previously downloaded copies cannot be retracted.

## Interface and verification

Saved editable copies expose independent review and recipient approval after a verified download. Pending release identity is scoped to the current CSRF/session fingerprint, case and rendition; a lost response can be recovered unchanged after reload. Denied access clears records/recovery state. Historic internal-only copies expose no release controls.

`tools/verify_report_docx.py` supports both immutable profiles and independently checks bounded canonical ZIP/XML, content model and visible paragraphs. Trusted external file/report fingerprints bind exact bytes; self-consistency alone is not authorship, approval, factual truth or legal admissibility. The browser download helper checks expected fingerprints, headers, size and ZIP signature; it is not a semantic office verifier.

A before/after check retained exact legacy fixture SHA-256 `197e880de5ab8ea5060e9758f86d318dbae4d8998896602a6fd0f8ab0f31df85`, with distinct v2 SHA-256 `7c6bcc94fe6cc1ae1c29fc83ef1945d979d366e89c3a512d4d6b6cfe320b878f`. Both passed the standalone verifier. A separate reproducible office fixture from `tools/make_disclosure_docx_fixture.mjs` is `tests/fixtures/fictional-disclosure-report.docx`, 6,470 bytes, SHA-256 `94b9331ae9d6492edf8a3b6363dcdaf40c6d209a9c52d65862c92a1608ff3ee7`. It contains fictional Latin, Greek, Japanese, XML punctuation and a tab. The old office fixture is preserved.

## Actual checks and failures so far

- Three real PostgreSQL migration checks passed.
- Six focused PDF/DOCX review/release API checks passed after correcting an expected client denial from 403 to the existing non-disclosing 404. The first focused run was 5/6 and is retained as a failed assertion, not an access defect.
- After adding the versioned profile, 12 focused migration/editable/review checks passed with one explicit local browser skip. Two additional legacy-retry and concurrent-attachment checks passed. The first legacy check failed because its test fixture used an absent session user field; using the established fictional user ID corrected that fixture.
- Historical byte equality and standalone verification of both profiles passed. Types/lint/workflow validation and 176 Python tests passed at the intermediate checkpoint. The full local regression passed **389 Node tests, 42 explicit browser skips, 431 total, zero failures**.
- Two local type failures during implementation were fixed before publishing: an overbroad edit added a DOCX argument to the PDF builder, and a test tuple spread did not type-check. No such change was merged.
- The actual browser journey is written to inspect/download, independently review, approve, lose/recover the committed release, discover/download in the client portal, verify offline, acknowledge and revoke. Hosted production and development runs remain pending.
- Actual local LibreOffice **7.4.7.2** opened/rendered/re-saved the new profile successfully: expected baseline text retained, original bytes unchanged and a re-save rejected against the trusted original digest. Its real first-page render was inspected (Latin/Greek/Japanese baseline visible). Hosted office acceptance remains pending. Baseline glyph limits and the earlier supplementary-emoji rendering failure in docs/109 remain open; this increment does not establish Microsoft Word/all-font/all-glyph qualification.

## Reproduction

Use the documented disposable PostgreSQL role/database only, with `INVEOS_TEST_DATABASE_URL` and `INVEOS_TEST_ADMIN_DATABASE_URL` set to that `inveos_test` instance.

```sh
npm ci
npm run typecheck
npm run lint
npm run build
npm run test:foundation
npm test --workspace @inveos/api
node --import tsx tools/make_disclosure_docx_fixture.mjs
python3 tools/eval_report_docx_office.py --disclosure-profile --output output/evals/docx-delivery/office
```

Set `INVEOS_TEST_BROWSER=1` only on a host with working sandboxed Chrome. CI retains the recipient render and office render/receipt as separate artifacts. Original DOCX copies and approved-delivery bytes are separate from editable external copies. Broader report composition, client re-import/correction workflows, professional/legal acceptance and full platform readiness remain outstanding.

## Hosted acceptance correction

Initial Checks41020339468 at `9347f36e928fb0c8036939e96d4494a95ad97080` was cancelled when integrating merged #106;176Python passed, no complete Node/browser acceptance is claimed. Integrated head `be280c6ea882a6ae04ff51b6b8719610eeba42ee` passed179Python locally and in hosted Checks41020748125 / job123947455147, but hosted Node acceptance failed **429/431, two browser failures, zero skips**. Both the old editable-history journey and new delivery journey refused saved downloads because the list query omitted `profile`; creation/recovery returned it correctly. The actual PostgreSQL list regression reproduced `undefined` for the retained v1 profile before the fix. Selecting the stored profile corrects both v1/v2 receipts without weakening browser fingerprint validation. Development and office steps did not run in the failed job. Final rerun remains pending.

At `8168d066305fff166d3ce58b8058b6f2bc7b05c9`, Checks41021696663 / job123950255076 passed **431Node/179Python, zero failures/skips,42 production plus five development browsers** and legacy LibreOffice acceptance. The actual DOCX recipient render was inspected. The overall job **failed** its unchanged worker-host memory probe: exit137 was observed but Docker did not record `OOMKilled=true`. The new disclosure-profile office step therefore did not run. No host success is claimed for that job and no isolation requirement was weakened.

Further source review reproduced a distinct database race: an older REPEATABLE READ snapshot could attach a second file type after the first committed; an advisory lock cannot refresh that snapshot. A shared unique attachment-choice row now guards all three attachment tables. Existing PDF/package choices are backfilled without changing bytes or approval records; a pre-existing hybrid grant fails migration for investigation. Five focused actual PostgreSQL checks passed, including old-snapshot denial, concurrent choices, audit rollback and legacy migration/rerun/immutability. The first two upgrade-fixture runs failed PostgreSQL parameter inference because one UUID was also used as text; explicit UUID/text casts fixed the fixture. Types/lint pass. Final full hosted acceptance remains required on the corrected head.
