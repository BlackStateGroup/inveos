# Frozen editable report copies

Internal DOCX export increment, 30 October 2026. This is not product completion or client-delivery approval.

Assigned reviewers can create an immutable editable copy of an existing frozen report revision from **Reports → Editable DOCX copies**. The saved DOCX, source report, profile, redaction plan and redacted content model have separate SHA-256 fingerprints. Stable actor/case request identities recover committed responses; paged history downloads the original stored bytes without creating another copy. PDF and DOCX redaction forms now list frozen finding text, type and source identity instead of requiring copied UUIDs. Selection spans bounded 25-item pages; a denied source/case clears the displayed choices. Invalid DOCX requests rejected with 400/422 clear their pending request so the user can correct the form. A correction in an office editor changes the file identity and inherits no approval. DOCX copies have no review/disclosure/recipient routes in this increment; approved JSON/package/PDF delivery remains separate.

## Integrity, scope and privacy

Migration 055 stores append-only scoped copies with immutable source revision references. Each revision allows at most 100 DOCX copies, with a 32 MiB file, 8 MiB model, 48,000 paragraph and 1,000 redacted-finding bound. Listing selects receipt metadata rather than loading every document. Every route locks the case and freshly checks membership and exact reviewer role. New copies reverify frozen source bytes, reviewed findings and authority. Saved downloads reproduce their bytes from frozen inputs and check current registered-source analysis permission. Historical findings are not silently rewritten after a later decision; historical downloads do not assert that a previous interpretation remains accepted. Audit failure prevents creation or byte release.

Whole-finding redaction shares the existing PDF selection/omission rules: text, document or transcript findings, associated source metadata, linked chronology and transcript reasoning are withheld. DOCX additionally preserves document reasoning links in working context and withholds those links with their source finding. Retained content includes precise citations and separately labelled source/receipt times. The package contains only five fixed parts; there are no macros, remote relationships, attachments, scripts, tracked changes or hidden unredacted source report. Working context and user-written redaction reasons can repeat sensitive text and require human inspection; whole-finding omission is not arbitrary text redaction.

The first-party UTF-8 OOXML writer uses stored ZIP entries with fixed headers, CRC32 and deterministic order; no new runtime dependency or upstream source is incorporated. It follows the main-document structure described by [Microsoft's WordprocessingML documentation](https://learn.microsoft.com/en-us/office/open-xml/word/structure-of-a-wordprocessingml-document). PDF v1 keeps its existing WinAnsi rendering and byte representation for unchanged frozen inputs. Obsolete document-verification wording is corrected only for newly generated report drafts; saved revisions remain unchanged.

The browser hashes actual download bytes and compares the saved receipt and response fingerprints before saving. Recovery stores a one-way sign-in scope, request identity, selected finding IDs and entered reason in tab session storage, never the session/CSRF token. Denied access clears this panel's history, pending record and unsent form. Report/database bytes still have the existing development storage limitations; this does not complete all-data encryption or device-loss controls.

## Independent verification and reproduction

Use README's locked setup and a disposable restricted-role PostgreSQL database. No production data or provider is needed.

```sh
npm run lint
npm run typecheck
npm run build
npm run test:foundation
INVEOS_TEST_DATABASE_URL=postgres://inveos_app@127.0.0.1:55474/inveos_test \
INVEOS_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:55474/inveos_test \
npm test --workspace @inveos/api
python3 tools/verify_report_docx.py path/to/internal-report.docx \
  --expected-docx-sha256 RETAINED_DOCX_SHA256 \
  --expected-report-sha256 RETAINED_FROZEN_REPORT_SHA256
```

`verify_report_docx.py` can be copied alone with the file. It bounds input before reading, rejects duplicate/unexpected/traversal/compressed parts, unexpected relationships, malformed models, active or extra content, and reconstructs exact visible paragraphs, ZIP headers and directory bytes. A separately trusted whole-file fingerprint is indispensable against a coherent replacement of both model and document. Consistency does not prove source truth, redaction completeness, permission, authenticity, signature or legal admissibility. An office re-save is expected to fail this original-file verification.

For actual office acceptance, install LibreOffice Writer, Poppler utilities and Noto CJK fonts as **test-host tools**, then run:

```sh
python3 tools/eval_report_docx_office.py --output output/evals/docx-office
```

This actually opens/renders the first-party fictional fixture, extracts expected Latin/Greek/Japanese text, verifies preserved input bytes and confirms a real office re-save fails the original fingerprint. It retains PDF, PNG and JSON receipt. CI also runs production and development browser recovery/history/download/revocation journeys. No font binary or office runtime is shipped with the app.

## Executed and pending evidence

Local PostgreSQL/API regression passed **376 Node, 40 explicit browser skips (416 total), zero failures**. Focused migration/PDF/DOCX checks passed; actual HTTP roles/foreign tenant, concurrent retries, restart, immutable rows, audit rollback, source blocks, stored-byte corruption and post-lock membership/role withdrawal are exercised. Transcript/chronology omission assertions use the shared DOCX model. All **164 Python tests** pass; seven independent adversarial DOCX checks pass, including coherent tampering with/without a trusted hash, extra/macro/traversal/compressed entries and malformed input.

An initial selector build also exposed a TypeScript discriminated-union narrowing error; the explicit transcript source guard was corrected. Initial focused runs failed test setup: a foreign-tenant session was created with the default tenant; after correcting that, the unassigned client assertion expected 403 although the case boundary returned 404. Corrected fixture/expectation; neither changed authorisation. The first office render exposed missing Japanese/emoji fonts. With CJK fonts installed Greek/Japanese render. LibreOffice 7.4.7.2 plus Noto Color Emoji did not visibly render the supplementary emoji and affected nearby output; this remains **failed glyph/layout qualification**, despite preserved Unicode bytes and extracted text. The baseline office fixture deliberately checks Latin/Greek/Japanese/tab/XML characters; the separate API artifact retains the supplementary emoji and verifies its exact UTF-8 bytes. Never relabel the supplementary-glyph render as passed. Microsoft Word, all-font/glyph coverage and Unicode PDF remain unqualified.

Lint, types, web build, foundation validation and actionlint pass (the existing build chunk warning remains). Baseline office output was visually inspected; its source SHA-256 is `6c1d77c845531a955a6d1c04500cf581e5e6391b2ae967b02476fd267d56609d`. Hosted browser/office acceptance, final review and merge are pending. Exact committed evidence will be recorded in the handoff and history. Internal export is implemented; DOCX review/release/re-import, broader report composition and external approvals remain open.
