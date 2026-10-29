# Document processing: bounded research decision

27 October 2026. Based on merged application commit `95b5c35` (PR #1).
Status: **research spike; no production dependency approval, parser benchmark or live collection**.

## Decision

Prioritise a **Docling native-PDF worker experiment** for digital documents, because its source exposes page, bounding-box and character-span provenance. Evaluate a separately packaged **OCRmyPDF worker** for scanned-document derivatives, then extract page-linked text from that derivative with an explicit two-stage lineage. Keep **Tika as the comparison/fallback candidate** for broad document detection and metadata, using an explicitly limited parser set. None belongs inside the Fastify request process. This is a source-informed engineering choice, not a measured quality ranking.

The existing application continues unchanged: original UTF-8 intake, original-byte quote checks, versioned authority, human review and internal drafts. Do not send extracted PDF text through the existing original-evidence endpoint and imply it is the original PDF. This PR provides an original, executable extraction-boundary contract in `contract.py`, with synthetic Docling-shaped inputs, rather than weakening the existing evidence architecture to accept PDFs prematurely.

## Acquired and verified

| Candidate | Exact research revision | Actual root terms and declared dependencies | Disposition |
|---|---|---|---|
| Docling | `90234a71b16785d08fd2f46ec62668dd2396db76` | LICENSE is MIT. At this pin the main project is `docling-slim` 2.142.1; `docling` is a meta-package pulling standard extras. Base dependencies include docling-core, Pydantic, requests, certifi, pluggy and langcodes. PDF extras add docling-parse and pypdfium2; standard extras also bring model packages, Torch and OCR. | First isolated digital-PDF candidate; use minimal native pipeline, not default standard/model bundle. |
| Apache Tika | `f45b9498f35d55445af28737407586362b2e37fc` | LICENSE.txt begins Apache-2.0 but includes separate component terms. NOTICE.txt identifies jhighlight CDDL/LGPL and PRONOM OGL 3.0; LICENSE.txt also lists UnRAR restrictions, optional SQLite and H2 terms. Parent build declares Java 17, PDFBox 3.0.8, POI 6.0.0; PDF parser declares PDFBox and PDFBox tools. | Isolated reduced-parser comparison candidate; full all-format distribution remains research-only until artifact-specific review. |
| OCRmyPDF | `b457e9efa68c3a46be2470ffb222ed1bccc4dcbc` | LICENSE is MPL-2.0. pyproject declares 17.13.1, Python >=3.11, pikepdf[pdfa]>=10.17, pypdfium2>=5, pdfminer.six, fpdf2, img2pdf, Pillow, pluggy, Pydantic, rich and uharfbuzz. Tesseract is a system dependency. HEIC extra explicitly warns of bundled GPLv2 x265. | Isolated scan worker candidate; no vendoring or packaging approval. |

Each source HEAD matched its pin; all three worktrees were clean. No `.gitmodules` was present in these three roots. Original upstream notices remain in the ignored checkouts. [source-audit.json](source-audit.json) contains exact file SHA-256 values, pinned source URLs and machine-readable declared requirements. It is **not a resolved dependency SBOM**. Requirement ranges are not reproducible runtime locks. No upstream code, fixtures, models or binaries are added to INVEOS.

Tika lacked a pin in the initial 22-reference inventory. Its new pin was observed through the upstream commit API on 27 October, with upstream commit timestamp 26 October; the inventory now has 23. Existing pins were not moved. No maintenance or vulnerability clearance follows from a recent commit.

### Licence and dependency implications

MIT and Apache root labels do not clear transitive packages, model weights or packaged native libraries. Before shipping, resolve a minimal artifact, retain its exact notices, inspect every included component and record the existing licence-approval fields. MPL-covered modifications and executable distribution require specific review; process separation does not erase licence obligations. No legal sign-off is represented here.

At the OCRmyPDF pin, installation documentation describes Ghostscript as **optional**, with pypdfium2 rasterisation and pikepdf internal PDF/A handling. Some older paragraphs in introduction/security documentation still describe Ghostscript as mandatory. Use the selected build's actual configuration and dependencies, not the older blanket statement. If included, Ghostscript's own terms must be reviewed separately. Avoid HEIC and optional optimisation utilities in the first experiment. Model weights and OCR language data need their own checks and checksums.

## Requirements comparison

| INVEOS requirement | Docling | Tika | OCRmyPDF |
|---|---|---|---|
| Preserve immutable original | Worker receives a read-only copy; output is separate JSON/text. | Same; extracted XHTML/metadata is a derivative. | Output PDF must always be a separate derivative, including when appearance is retained. |
| Precise source links | Native pipeline creates page number, box and full-item charspan. Preserve coordinate origin, native item reference and UTF-8 offsets separately. | PDF XHTML emits page divisions, but plain text/recursive metadata is not a generic exact-region map. Page boundaries must be validated per parser, including embedded documents. | Searchable PDF and sidecar are not sufficient for exact region citations. Require page mapping and subsequent extraction/word coordinates. |
| Extraction provenance | Record backend, tool revision/version, config, model identity if used, raw output digest and original digest. | Record parser set and parser metadata, recursion/truncation state, tool/config identities and output hashes. | Record OCR engine/language data, transformation settings, original/output hashes and per-page processing status. |
| Partial/ambiguous results | Reject unsupported multi-page/partial spans in this prototype. A future adapter must preserve them explicitly. | Truncation, exceptions and embedded-resource paths must survive normalisation. Never infer completion from exit status alone. | Sidecar excludes existing digital text and can omit unprocessed/skipped pages. Never number sidecar fragments as original pages without a verified map. |
| Human-reviewed findings | All extracted content remains unreviewed; reviewer sees original page plus derivative location. | Same. | Same, including comparison with original scan, OCR uncertainty and transformed geometry. |

Primary implementation evidence (all paths are under the pinned revisions in the audit): Docling `docling/pipeline/native_pdf_pipeline.py`, particularly `_add_text_items`, and `docling/backend/pdf_backend.py`; Tika `tika-parsers/tika-parsers-standard/tika-parsers-standard-modules/tika-parser-pdf-module/src/main/java/org/apache/tika/parser/pdf/AbstractPDF2XHTML.java` and `PDFParserConfig.java`; OCRmyPDF `docs/cookbook.md`, `docs/installation.md`, `docs/pdfsecurity.md`. Docling's other pipelines may emit zero-length or otherwise different spans: native text support is not universal document-format support.

FollowTheMoney, Cytoscape.js and WatermelonDB remain catalogue references in this slice. Entity mapping, graph display and offline persistence do not unblock the document provenance boundary, so their pins and application dependencies were not changed or represented as reviewed.

## Executable synthetic contract

`contract.py` accepts original bytes, original digest, trusted job context and a narrow Docling-shaped JSON text array. It validates tenant/case/evidence/authority equality, page numbers, coordinate origin and finite boxes. It hashes raw output and configuration, builds deterministic derivative identity and stores explicit UTF-8 byte ranges. Citation verification rebuilds the derivative from raw output and checks an explicitly selected occurrence. Repeated text on different pages cannot silently select the first match. Results remain `unreviewed_derivative_citation`, never findings.

The limit is 2 MB for original/raw/text, 1,000 text items, single-page full-text items only. Fixtures are original fictional English/Portuguese/Arabic text with Unicode currency/emoji and repeated passages. The original-byte fixture is explicitly a placeholder, **not a valid PDF**. No claim is made that this ran Docling or achieved OCR accuracy. The contract has no storage, authentication, job queue, server routes or report-release authority; trusted context is a caller requirement, not a security credential. Hashes bind a supplied record but are not signatures or protection against an attacker replacing every input.

## Verification and environment limits

- Python 3.12.14: `python3 -m unittest discover -s tests -v`: **28 tests passed**, including 15 new contract tests and 13 existing foundation tests.
- Positive cases: repeatability, byte offsets for Unicode, repeated quotes with explicit page selection, both coordinate origins and preserved source/received times.
- Negative cases: cross-tenant/case/evidence/authority context, original/text/raw/config tampering, missing/partial/multiple provenance, invalid boxes, fabricated/out-of-range quotes, duplicate items, empty output and resource bounds.
- `python3 tools/audit_document_sources.py`: three clean checkouts verified against pins, dependency declarations and source-file hashes recorded.
- Parser isolation probe: `bwrap --ro-bind / / --unshare-net -- /usr/bin/ocrmypdf --version` failed with `Creating new namespace failed: Operation not permitted`. Docker and Maven are absent; Docling is not installed in the active Python environment. System OCRmyPDF exists but was not executed outside the isolation probe or substituted for the pinned source.
- **Unrun:** all three upstream parser benchmarks, resolved dependency installation, vulnerability/secret scan of upstream trees, runtime SBOM, malicious-PDF tests, CPU/memory/accuracy comparison, API/PostgreSQL/browser/device/outage/restore tests. The application code is unchanged; previous PR evidence is not claimed as a fresh test run.

No parser installation or upstream build was attempted after the isolation failure. Source acquisition is read-only research, not sandboxed execution. This is an environment capability failure, not an approval request.

## Reproduce

From repository root, Python 3.11+ and git:

```bash
python3 tools/mine_sources.py --fetch docling-project/docling
python3 tools/mine_sources.py --fetch apache/tika
python3 tools/mine_sources.py --fetch ocrmypdf/OCRmyPDF --allow-study-only
python3 tools/audit_document_sources.py
python3 -m unittest discover -s tests -v
python3 tools/validate_foundation.py
```

Compare audit JSON with the committed inventory. These commands fetch source but do not execute upstream code. Local cache receipts contain the checked-out SHA and licence-file hashes. They are intentionally ignored. To undo this spike, close its PR or revert the original INVEOS research changes; no migration or application data rollback is needed.

## Next bounded integration gate

1. On a container/VM host, build minimal pinned workers with resolved hashes, SBOM, licence notices and vulnerability review. Disable egress, run non-root, mount one original read-only, provide a private scratch volume and separate output mount; cap CPU/RAM/PIDs, wall time, pages and expanded archive bytes. Verify those restrictions with negative tests before parsing.
2. Generate three original synthetic PDFs: digital multi-page repeated quotes; mixed digital/scanned pages; multilingual scanned/table content. Save expected page/region truth. Include malformed, oversized, encrypted and partial-result cases. Benchmark each eligible tool twice, recording original/output hashes, process outcome, wall/CPU time, peak RSS, correct page/region rate and missing/incorrect text. Do not require OCR byte-identical output across builds.
3. Add durable extraction/run records scoped to existing tenant/case/evidence and authority version. Server authorises dispatch and completion; stale authority, missing originals and context mismatch block attachment. Worker never owns evidence or writes findings. Run records preserve processed-at, attempt, failure/partial status and runtime image/model/config digests separately from source and received times. Retried jobs are idempotent; changed tool/config creates a new extraction.
4. Extend claims with an explicit `original_utf8` versus `derived_document` citation union. PDF citations bind original ID/digest, extraction ID, derivative digest, embedded-document path where needed, page/box and derivative UTF-8 range. OCR followed by Docling retains both derivation edges and any page transforms. Preserve all existing original-byte claim semantics.
5. Add original-page/region review UI and negative API/DB tests. Reviewer approval is a separate existing domain action, with re-verification of the complete lineage at review/export. No parser result can approve itself or be released to clients automatically.

These gates complete WP-05 incrementally; this spike does not mark WP-05 done.
