# Independently reviewed PDF disclosure

29 October 2026. Continues the canonical PDF and saved-rendition work, using fictional lab fixtures only.

## User journey

Create a frozen report and a PDF rendition. In **Reports → Saved PDF renditions**, download and verify the selected PDF. A different assigned reviewer inspects the actual file, retained content, redactions, scope and privilege, then records acceptance for disclosure or a change request. The report author and PDF creator cannot self-review. A review is permanent and binds the exact PDF and redaction fingerprints under the current case authority; changed decisions require a new rendition.

An assigned reviewer may then explicitly approve that exact PDF for one tenant client, with a reason and UTC expiry no more than seven days away. This is a PDF-only release: originals, the unredacted report JSON and provenance packages are not attached. Any retained case context or limitations in the PDF must be included in the human inspection. Whole-finding redaction does not guarantee removal of similar material elsewhere in a report.

The existing separate portal lists the released PDF fingerprint and frozen report fingerprint. It verifies the downloaded PDF before enabling an explicit recipient acknowledgement. Discovery is not a delivery receipt. Reviewer oversight uses the existing grant history and revocation controls. A downloaded copy cannot be retracted.

## Persistence and policy

Migration `029_reviewed_pdf_disclosures.sql` adds append-only PDF review records and disclosure-to-rendition bindings, with tenant/case/revision foreign keys. It preserves every old report, rendition, grant and review. The release references immutable rendition bytes instead of copying or regenerating a redacted report under a different identity.

New reviews and releases reverify the frozen report's current original/derivative/citation/finding lineage and authority. Release requires an independent acceptance from a currently assigned reviewer under the current authority, and no PDF or report change requests. The independent PDF review covers its exact narrative and redactions; a previous internal JSON review alone cannot authorise PDF delivery. The PDF creator may approve delivery only after someone else has recorded the required acceptance.

Grant creation is case-serialised and transactional with its rendition binding and audit event. Stable request identities recover a committed lost response; concurrent identical retries return one grant, while changed retries fail. A PDF request identity cannot be recovered as a JSON/package disclosure. Review retries similarly preserve one immutable decision per reviewer and rendition.

Portal discovery, download and acknowledgement share recipient, tenant, expiry, case-authority, issuer-membership, revocation and PDF-review eligibility checks. A reviewer's loss of case access or a later change request removes access. Every download and acknowledgement rechecks stored PDF/source bytes and audits atomically. A later source correspondence correction blocks new grants but does not rewrite already approved historical PDF bytes; withdraw existing access explicitly through revocation. This matches the historical package semantics.

## Verification and reproduction

```bash
npm ci --ignore-scripts
npm run lint
npm run typecheck
npm run build
node --import tsx --test apps/api/test/recipient-discovery.test.ts \
  apps/api/test/report-pdf-download.test.ts apps/api/test/report-pdf.test.ts
python3 tools/validate_foundation.py
python3 -m unittest discover -s tests
# Against the disposable restricted PostgreSQL role and documented browser host:
INVEOS_TEST_BROWSER=1 npm test --workspace @inveos/api
python3 tools/verify_report_pdf.py disclosure.pdf \
  --expected-pdf-sha256 <separately-retained-pdf-fingerprint> \
  --expected-report-sha256 <separately-retained-report-fingerprint>
```

Local lint/types/build, 105 Python tests and ten focused Node tests pass. [Checks #193](https://github.com/BlackStateGroup/inveos/actions/runs/40898591951), job 123534396199, passed at implementation `1c24b747cc91251dd180c2e26807a8c970f0d80f`, tree `7f818e895ba95b4bb3f5f23e3709bdcbcb53b3e1`: 234 Node and 105 Python tests, zero failures/skips, plus lint/types/build/reference and host isolation. Actual PostgreSQL scenarios passed independent/current reviewer gates, exact fingerprints, CSRF, concurrency, permanent review history, restart, immutable bindings, audit rollback, corruption/expiry/foreign-recipient denials, current-source denials, acknowledgement identity, revoked reviewer access and later change requests. The actual browser journey passed PDF download, independent acceptance, committed-release response loss, reload/recovery, recipient download, independent Python verification and acknowledgement of the exact PDF bytes. These fixtures use previously qualified extraction output; this is not a new OCR experiment or the complete supplier acceptance milestone.

## Remaining gates and rollback

This adds no dependency, parser/runtime artifact, font or third-party source. Existing source and redistribution rules remain in force. Hashes establish byte identity and the narrow profile's semantic consistency, not factual truth, legal clearance, signatures or uniform pixel rendering. Actual scanned OCR comparisons and the complete supplier scenario remain separate acceptance criteria.

R4 still includes DOCX/templates, a reviewed Unicode font artifact, broader viewer/pixel qualification, signed trust anchors and selected exhibit/package composition. Real identity, encrypted storage, native device/offline tests and external security/privacy/legal/licence approvals remain open. No production deployment or pilot acceptance is implied.

Rollback must retain migration 029 and immutable records. Do not deploy an old server that can mistake a PDF-bound grant for a JSON grant: withdraw PDF grants first or disable portal service during a reviewed forward fix. Restoring older application code alone is not a safe disclosure rollback. Preserve a verified matching database snapshot for lab recovery.
