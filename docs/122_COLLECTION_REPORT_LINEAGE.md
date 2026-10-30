# Collected-source report lineage

## Implemented scope

Reviewed findings from the bounded OSINT company-profile capture now freeze the original collection receipt, immutable case authority, scoped authorisation and independently reviewed source-policy version with their existing source-use proof. This is a historical record of permission at capture time. Current source-use decisions remain separate and continue to gate analysis, report reads, verification, rendition and client release.

The report uses the preserved original once. Collection provenance binds its digest, exact response/receipt timestamps, case and original authority. The independent Python verifier reconstructs the captured JSON fields from those original bytes and checks the receipt/profile, approval independence, chronology, expiry and retention bounds. A trusted report fingerprint remains necessary for authenticity. Self-consistency does not establish provider truth, actor authenticity, legal sufficiency or current permission.

Collection policy withdrawal prevents new collection but does not silently rewrite history or revoke an independently permitted historical source. Source-use blocking does prevent further report access, while the frozen bytes and audit history remain intact. This distinction is deliberate; no new collection is authorised by reading a report.

Complete browser print drafts, PDF and DOCX copies display the capture mode, response-time meaning and collection receipt/permission. Whole-finding redaction removes this collection metadata together with the quote and finding. Fictional captures explicitly say the provider was not contacted. No additional application dependency, external connector, licence approval or production activation is introduced.

## Reproduce

Use the fictional source-policy, collection command and source metadata/use-review steps in [121](121_OSINT_WORKBENCH.md). Independently review a claim quoting the captured original, then freeze a report in Reports. Print the complete draft or create a saved PDF/DOCX rendition. Collection permission alone cannot bypass the separate source-use and finding reviews.

For collected-source JSON reports, copy these trusted tools together, outside the repository:

```sh
cp tools/verify_report.py tools/verify_collection_context.py /tmp/fictional-report-review/
python3 /tmp/fictional-report-review/verify_report.py report.json --expected-sha256 TRUSTED_REPORT_DIGEST
```

Also copy `tools/report_package.py` to build/check an internal original-exhibit ZIP. Mixed document/transcript/speech reports still need the corresponding existing independent verifier modules. Never execute code supplied inside an untrusted package. Existing reports without collection provenance retain their previous verifier requirements.

Focused real PostgreSQL acceptance:

```sh
INVEOS_TEST_DATABASE_URL=postgres://inveos_app@127.0.0.1:55474/inveos_test \
INVEOS_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:55474/inveos_test \
node --import tsx --test --test-concurrency=1 --test-name-pattern='OSINT report lineage' apps/api/test/api.test.ts
python3 tools/eval_speech_docx_office.py --kind collection
```

Those database URLs describe the disposable local fixture, not production. The office check consumes the actual API-produced DOCX/receipt in ignored `output/evals/collection-office`, renders it with LibreOffice, checks the collection paragraphs, verifies re-saving invalidates the original fingerprint, and retains a first-page render. Hosted CI runs the browser in its qualified sandbox and retains desktop/narrow/office artifacts.

## Evidence and remaining work

The first focused run passed both real PostgreSQL/HTTP tests, zero skips, in `/tmp/inveos-collection-report-first.log`. It checks seven rehashed collection-history mutations with copied standalone tools, original-exhibit verification, PDF/DOCX whole-finding redaction, historical collection withdrawal, cross-case denial, current source-use blocking and unchanged frozen bytes. Type/lint/full suite/browser/office acceptance is pending at this checkpoint; do not infer those results from focused tests.

The initial adapter is UTF-8 company-profile JSON. Other future captured media need explicit equivalent original-byte support before they can use this provenance envelope. The historical schema is additive for old reports; deleting provenance and constructing a different self-consistent old-format document is detected by a separately trusted fingerprint, not by an authenticity claim based on a self-hash.

Live source approval and real-provider TLS/coverage qualification remain open in [121](121_OSINT_WORKBENCH.md). Wider OSINT providers, long media/cited intelligence, native device/offline capture, production platform operations and independent professional/security/privacy/legal approvals remain in [71](71_REMAINING_DELIVERY_PLAN.md).


Local regression passes428Node,zero failures,49explicit browser skips/477total;203Python;types/lint/build/foundation/actionlint. Logs `/tmp/inveos-collection-report-{full-api,python,types,lint,build}.log`. Actual LibreOffice7.4.7.2 render/re-save check passed and first page was inspected (`/tmp/inveos-collection-office-first.log`); original preserved and rewritten fingerprint rejected. Review then corrected the shared fictional collection fixture's descriptive authority from the generic dispatch-note text to its actual company-profile scope; focused collection acceptance is being rerun. No runtime permission relaxed. Hosted browser/final-head acceptance remains pending.

Privacy review: proof includes the historical scope, policy/terms references and approval identities, with no credential or request secret. Internal report access is case-scoped. Full report disclosure remains an explicit, independently reviewed release, subject to current source-use permission; redacted rendition removes the entire finding's collection context. No new outside recipient or automatic source contact is enabled.

After correcting only fictional authority wording, focused acceptance passes9 checks with1explicit browser skip (`/tmp/inveos-collection-report-focused2.log`); actual LibreOffice rerender/re-save passes (`/tmp/inveos-collection-office-second.log`). No failing run was hidden or sandbox requirement bypassed.


PR116 initial head2edadbffb4944eb9e824e42e184ef54731d441ed Checks41058870344/job124073230538 failed. The new browser rendered collection history but its corruption check expected the document-derivative error wording rather than the UTF-8 original-digest error. It timed out after15seconds; the growing full run later reached its unchanged360second deadline after420passed/1failed checks, before completing477tests. No full-suite count is claimed. Python203 passed; later development/office stages did not run. Corrected the assertion to the actual original-digest error and added direct API corruption/verify-sources checks plus an explicit assertion that printing was not called. Preserve /tmp/inveos-collection-host-first.log. Final-head acceptance remains pending.

Resulting-main115 Checks41058762796/job124072863706 passed474Node/203Python,zero failures/skips,48production+11development browser journeys and office/host/lint/types/build; /tmp/inveos-main115.log.
