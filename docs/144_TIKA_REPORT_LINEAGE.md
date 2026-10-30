# Tika page-text report lineage — implementation handoff

Implementation branch: `feat/tika-report-lineage`, fresh worktree from exact root
base `6cdcc69d02034e4dc87088f7c0e741538c64f1db` on
`origin/feat/platform-build-batch`. The previous Tika application branch remains
untouched. Root owns integration and combined acceptance. This is a build receipt,
not parser/runtime, legal, production, browser or client-release approval.

## Connected workflow

1. Use the existing Processing → Tika PDF inspection to save an exact occurrence
   in one normalized extracted page. Compare it against the preserved original;
   an independent current case reviewer decides correspondence. Propose a linked
   interpretation and obtain a separate independent interpretation decision.
2. Inspection now displays **report eligibility**, including withdrawal, changed
   correspondence/authority, and missing current author/reviewer case roles.
   Acceptance alone does not add anything to a report.
3. In Reports → saved report outlines, load verified finding choices. Select the
   distinct `tika` family, inspect its source/review receipt before selection,
   add it explicitly to a named section, save and independently review the outline.
   Freeze that accepted selection with the existing report revision controls.
   Legacy “freeze current draft” and draft export do not automatically add Tika.
4. Reverify sources; download the exact JSON revision and document report package.
   Create PDF/DOCX copies using the existing whole-finding redaction controls.
   The saved PDF download now also offers **Open verified PDF for printing**;
   the browser PDF viewer prints those exact verified bytes. This is an internal
   copy, not a new release or a renderer qualification claim.
5. Existing independent exact-copy review and explicit recipient release controls
   remain. All new release paths revalidate the frozen Tika finding against current
   original/raw/derivative/profile/review/role/authority/source-use state.

An interpretation can be terminally withdrawn with a reason in Tika inspection.
The server endpoint permits withdrawal by a current internal case member even
when processing authority or source-use has expired; withdrawal does not require
reading source bytes. Inspection itself still respects current source access.
The immutable interpretation and decisions remain; correction means a new
proposal/independent decision. A new correspondence decision invalidates claims
bound to an earlier correspondence digest, even if the new decision accepts the
same passage. Creating an unrelated new claim does not silently withdraw another
claim. Withdraw the superseded interpretation explicitly.

## Separate typed finding and precise provenance

`ReportDraft.tikaFindings` is optional and omitted when absent. Each entry has
`kind: reviewed_tika_page_text` and uses the accepted interpretation decision UUID
as its stable finding identity. Its snapshot includes:

- Original evidence ID, filename, SHA-256, source time, receipt time and original
  authority ID/version. Source time is never replaced with processing time.
- Processing job, attempt, authority version, processing time, exact profile text
  and digest, original raw output digest, XHTML digest, derivative digest and
  runtime-receipt digest. Original and processing authority snapshots have
  separate digests.
- The full citation author receipt, exact typed `tika_pdf_page_text` location,
  parser XHTML page path, page-text hash, derived UTF-8 occurrence and quote.
- The complete bounded correspondence decision chain, exact claim/author receipt,
  accepted independent interpretation decision and all their fingerprints.

The location basis remains `tika_xhtml_page_utf8_not_original_bytes`. There is no
invented geometry, visual region, original-PDF byte span, OCR, page completeness
assertion or automatic finding. The reduced pinned **PDF-only** runtime and profile
are unchanged. Office, DOCX, spreadsheets, supplied text-as-Tika, encrypted PDF,
OCR, embedded-document traversal and unsupported PDF/profile bounds remain
unsupported. This work neither runs nor broadens that parser.

The source loader reconstructs immutable derivative and citation/review records
using the existing Tika implementation. Report eligibility additionally requires
current independent correspondence/interpretation reviewers in this case,
current internal citation/claim authors, matching active processing authority,
current permitted lifecycle and source-use. Selected unavailable IDs fail closed;
the discovery list offers currently eligible candidates only. A current eligibility
check is not a historical reviewer identity attestation.

## API, persistence and audit

Migration **130_tika_interpretation_withdrawals.sql** adds a scoped append-only
withdrawal receipt, foreign-keyed to the exact claim. Update/delete are rejected.
The insert guard checks the claim/decision binding and current internal actor;
case locks serialize withdrawal and later decisions. A decision insert guard
rejects a withdrawn claim. Application idempotency binds the operation ID, actor
and request digest. Reserved **131–134 are unused**.

New endpoint:

`POST /api/cases/:caseId/integrity-jobs/:jobId/tika/citations/:citationId/claims/:claimId/withdraw`

Body: `{id, claimDigest, reason}`. A different retry or second withdrawal conflicts;
the original exact retry returns the retained receipt. Existing context exports
retain their format; only withdrawn claims gain an optional withdrawal receipt.

`GET /api/cases/:caseId/report-compositions/findings/:findingId/tika` provides a
current, case-scoped verified selection receipt. Existing composition endpoints
now accept the `tika` selection kind. Discovery/selection never writes a finding
or automatic report. Freeze, inspection, withdrawal and package export retain
existing audit history plus the new Tika identities/actions.

`verifyFrozenSources` includes selected Tika identities in its stable-set and
exact-record comparisons. It is reused by source reverification, package creation,
copy creation/review and **new** JSON/package/PDF/DOCX release. Withdrawal, a newer
correspondence decision, role/access loss, changed processing authority or changed
source-use prevents a stale new release. Existing immutable historical reports,
copy bytes and already-issued grants are not rewritten or retroactively revoked;
use existing disclosure revocation for an already-issued grant. Existing portal
source-use/authority/expiry/revocation controls remain in force.

## Package, rendering and compatibility

Tika-containing packages use **`inveos_document_report_package_v2`** at the existing
`document-package` endpoint. It retains the exact report bytes/digest, existing
`exhibits` unchanged, and adds `tikaExhibits`. Each distinct Tika finding has one
`inveos.tika_report_exhibit.v1` containing its exact original PDF, raw parser output,
derivative bytes, runtime receipts, original and processing authority snapshots,
successful job receipt and only that selected citation/interpretation (with its
complete correspondence chain). No parser/network execution occurs on export.

Package bytes are deterministic for unchanged frozen sources; no export/render
clock or requesting user's role is added. The exhibit inspection has
`canReview: false`: it grants no review capability. Its `canChange: true` and
eligible receipt describe the successful current server validation when assembled,
not a durable access grant. The existing 32 MiB report, 64 MiB package and 1000
finding bounds remain. The existing per-PDF/raw/page/citation bounds also remain;
repeated per-finding originals may reach the package bound sooner.

Full package disclosure requires confirmation of its exact package fingerprint,
as for existing document packages. Whole-finding-redacted PDF/DOCX copies contain
only visible semantic content and never attach the package/original/extraction.
The Tika renderer checks redaction **before** text, quote, identities, source times,
authority, reviews, hashes, Field history or research receipts. Existing composition
free-text withholding on any redaction remains. Visible Tika findings use the
existing Field/research provenance renderers. DOCX and PDF share the same finding
renderer; browser printing uses the generated PDF. Existing PDF repertoire and
DOCX profile constraints still apply.

Reports without Tika keep the legacy package-v1 shape and optional-field omission;
existing document geometry, speech/transcript/research/Field/composition paths and
renderer profile identifiers remain. No stored report, source, copy, original,
profile or migration is rewritten. Empirical byte-for-byte legacy compatibility
and rendered output still require acceptance; they were not run in this build.

## Independent verification and offline kit closure

New standalone helper: **`tools/verify_tika_report.py`**.
Its sole local dependency is **`tools/verify_tika_context.py`** (standard library
only). Both are in `verificationKitFiles`; kit instructions name the dependency.
The existing context helper now exposes the same immutable-material validation
core to the report helper, without fabricating an export timestamp or parser run.
It still checks old context envelopes/source-use and understands withdrawal.

`tools/verify_document_package.py` verifies package v1 or v2 and invokes the new
Tika helper for every Tika exhibit. It compares the entire frozen finding against
independently reconstructed raw/derivative/citation/decision material, original
and processing authority, source identities and the accepted review chain. Shared
composition, source-use and Field verification now include the Tika family without
conflating it with document geometry. `verify_report.py` fails closed for Tika-only
JSON and directs callers to the package verifier; it cannot verify omitted PDF/raw
exhibits from a metadata-only report. PDF/DOCX independent copy verifiers continue
to reconstruct their unchanged semantic/container profiles, including the new
visible text and redacted absence; they do not attest parser truth.

For combined acceptance, use the existing package verifier with separately trusted
report/package fingerprints. The standalone helper can also inspect a bounded
JSON `{finding, exhibit, caseId}` pair; its consistency result does not authenticate
who supplied that pair. Keep the helper files together in the offline kit. No
external Python package is required. No checks confer runtime execution, legal
approval, factual truth, signatures, reviewer authenticity or current permission.

## Verification receipt and remaining acceptance

Actually run in this branch during build:

- `npm ci --ignore-scripts` using the existing lockfile (no dependency changes).
- `npm run typecheck`: web, contracts and API passed.
- Targeted existing ESLint on changed TypeScript/TSX sources: passed.
- `python3 -m py_compile` for the six changed/new verifier modules: passed syntax.
- `git diff --check`: passed.

**Unrun:** migration application/rollback/DB trigger execution; real isolated Tika
worker/runtime qualification; API/release/concurrency tests; standalone verifier
execution or tamper acceptance; PDF/DOCX generation and independent copy execution;
redaction leakage inspection; deterministic package reproduction; old report/copy
byte regression; offline ZIP dependency execution; browser/print/accessibility
acceptance. No new broad test suite was written or run, as instructed. SQL was
reviewed by inspection only, not labelled syntax-validated by a database.

Root acceptance should cover mixed and Tika-only explicit compositions; exact
source/authority/exhibit binding; cross-case/tenant rejection; Unicode occurrences;
withdrawal and newer correspondence decisions between freeze/review/release;
current author/reviewer removal or role changes; authority/source-use expiry;
withdrawal-vs-decision/release races; retry recovery; historical context exports;
redaction of all Tika details alongside Field/research receipts; print/PDF/DOCX
agreement; v1/v2 package bounds, tampering and trusted-digest mismatch; offline kit
execution without the repository; and unchanged old family/render formats.

No additional application dependency, copied third-party source, parser/runtime
installation, live collection, production change, outside contact, benchmark or
qualification claim was introduced. Existing pinned Tika notices/provenance from
docs136 and research/tika remain unchanged. Central BUILD_HANDOFF, INDEX and shared
CI/test inventory were not edited. No PR, main merge or deployment is part of this
batch.
