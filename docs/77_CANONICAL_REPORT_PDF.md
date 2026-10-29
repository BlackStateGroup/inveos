# Canonical internal report PDF and whole-finding redaction

29 October 2026. First bounded R4 slice, continuing draft PR #66. Fictional lab material only.

## Implemented contract

Migration 028 stores append-only, versioned PDF renditions of an immutable frozen report. Each record binds the source report fingerprint, generation-profile fingerprint, exact redaction plan and fingerprint, redacted semantic model and fingerprint, exact PDF bytes and delivery fingerprint. Reviewer-only creation revalidates the current frozen finding lineage and authority before a new rendition is written. The stable idempotency key survives a lost browser response. A historical exact retry and download remain reproducible from the immutable report, plan and bytes; later source-review changes block a new rendition but do not rewrite the old one.

The first-party `inveos_report_pdf_v1` generator uses PDF 1.4, the standard Helvetica font and WinAnsi encoding. It adds no package, font file, native executable, model or redistributed third-party source. Every visible line is encoded as an explicit hexadecimal text operation. A redaction omits an entire selected finding and all of its source/extraction/citation metadata, substituting only a numbered redaction marker and the reviewer-supplied reason. The embedded semantic model contains only the redacted visible line set, not the source finding IDs or omitted values.

This narrow profile rejects duplicate, foreign or malformed finding IDs, short reasons, control characters, unsupported Unicode, excessive line counts and oversized output. Rejection is deliberate: no glyph substitution or transliteration may silently change a report. Full Unicode output needs an exact embedded-font artifact and separate licence/runtime approval.

The reviewer UI can create an unredacted PDF or a whole-finding redacted PDF. It retains only a stable pending request payload in tab storage, verifies the returned bounded PDF bytes and source-report header, and downloads the internal file. Neither operation grants a disclosure. The existing client package release remains unchanged and does not treat a rendition as released.

## Independent semantic verification

`tools/verify_report_pdf.py` is a Python standard-library verifier independent of the TypeScript generator. It is intentionally not a general PDF parser. It rejects active/attached content, requires the exact INVEOS profile and fingerprints, checks the embedded redacted model digest, independently rebuilds WinAnsi text streams from that model and requires every visible page stream to match exactly. `--expected-pdf-sha256` and `--expected-report-sha256` anchor byte identity and source identity separately.

This distinguishes three claims:

- the browser checks the exact downloaded bytes and source-report fingerprint;
- the independent CLI checks the PDF profile and semantic text-stream correspondence;
- neither check proves pixel-level behaviour in every viewer, factual truth, lawful redaction, signature validity or legal approval.

## Verification

```bash
npm run lint
npm run typecheck
npm run build
node --import tsx --test apps/api/test/report-pdf.test.ts apps/api/test/report-pdf-download.test.ts
python3 tools/validate_foundation.py
python3 -m unittest discover -s tests -v
INVEOS_TEST_BROWSER=1 npm test --workspace @inveos/api
python3 tools/verify_report_pdf.py internal-report.pdf \
  --expected-pdf-sha256 <trusted-pdf-sha256> \
  --expected-report-sha256 <trusted-report-sha256>
```

Local lint, type checks, production build, five focused Node tests, foundation validation and all 102 Python tests pass. The local host has no configured PostgreSQL or browser, so migration/API/browser claims await the hosted Checks run and are not marked complete here.

The database scenario covers concurrent stable creation, independent verification, redaction leakage, listing/restart, role boundaries, append-only enforcement, stored-byte corruption, changed retries, later correspondence withdrawal and historical rendition access. Hosted evidence will be recorded only after the exact implementation revision passes.

## Rollback and remaining R4 work

Application rollback removes the new routes/UI/generator but preserves migration 028 and every stored rendition. Do not drop immutable rendition rows during rollback. No rendition is released through the portal in this slice.

R4 remains partial. Still open: DOCX and template selection; reviewed Unicode font artifact; pixel/viewer-fidelity qualification; redaction annotations and independent redaction approval; signature/trust anchors; approved rendition/package composition and portal release; retention/encrypted object storage; and legal/privacy/licence sign-off. The earlier P1 parser comparison and wider product gates also remain open.
