# Fictional scanned-supplier OCR baseline

29 October 2026. Research-only Tesseract comparison; actual clean-scan hosted baseline measured.

## Why this experiment

The catalogue includes Tesseract, OCRmyPDF and Docling. Exact-source native Docling has already been measured for digital text and intentionally reports raster-only coverage gaps. The next supplier milestone needs actual scanned words and page/region mapping, not another replay of a synthetic extraction adapter.

This experiment selects the small Debian `tesseract-ocr=5.3.0-2` plus English language-data baseline in the existing digest-pinned Python image. It is explicitly a packaged release comparison, not the catalogue's Tesseract source-head pin, not the pinned OCRmyPDF experiment, and not a shipping dependency choice. Root Tesseract and English data notices must identify Apache-2.0 before OCR; every loaded native file is associated with its package version, SHA-256 and actual copyright-file SHA-256. The inventory includes all installed package versions and declared licence labels from native-provider notices. These are technical evidence, not expert interpretation of every term or security clearance.

The local installed tools have different package revisions and were not substituted. A current first-party namespace probe still fails with `Operation not permitted`; no local OCR/parser execution followed. Use the existing qualified hosted research workflow.

## Pipeline

1. Build only the first-party Dockerfile in a disposable context containing no original store, credentials or unrelated checkout. Networked package preparation has no case data. Keep the resulting image local; do not publish it.
2. Run existing non-root/read-only/no-network/capability/memory/PID/CPU/output/time/scratch qualification against the immutable image ID.
3. Inspect installed package metadata, model data, actual native dependency files and notices in a separate restricted container before OCR. The `ldd` library-resolution check is inside that isolation; it is not claimed as parser execution or a static-only check.
4. Reuse the existing hash-verified Docling/PDFium runtime bundle to render first-party fictional ownership documents. Embed those raster pages into a separate PDF original with no font or text layer. The source-generator and scan fingerprints are distinct.
5. Verify that the scan has no hidden digital text, render its two pages, then run bounded single-threaded English Tesseract TSV twice. Preserve each original page number, input image fingerprint, raw TSV fingerprint, pixel box, explicit scale-to-PDF-coordinate mapping and observed confidence. Scores are engine outputs, not probabilities that a finding is true.
6. Measure expected versus recovered fictional words, including the 100% declaration and older 60%/40% register. Report imperfect recovery rather than treating exit zero as accurate OCR. Reject malformed input, confirm scan bytes remain unchanged, and confirm repeat output identity. Remove each container and the temporary image tag.

The fixture is a clean, synthetically rasterised English document. It does not qualify noisy/skewed scans, multilingual material, tables, real acquisition authenticity, OCRmyPDF transformation/page mapping, or Tika. No output is attached to application jobs or turned into findings. The current API's Docling-native result profile must not be relabelled to accept Tesseract output; a separately versioned OCR lineage contract is still required.

## Run and evidence

The existing `Pinned Docling research build` workflow acquires the established source/runtime bundle, then runs:

```bash
python3 tools/experiment_tesseract_supplier.py
```

It prints a bounded JSON receipt with image identity, isolation checks, package/native/model inventory, per-page coordinates, extraction measurements and explicit limits. Third-party packages, binaries, model data and temporary PDFs remain in ignored cache/container storage. Only original first-party scripts, tests and metadata may be committed.

Local Python compilation, foundation validation and 107 Python tests pass. The new tests validate deterministic digital-versus-raster fixture construction and TSV geometry rejection; they do not execute OCR.

Actual [Research #28](https://github.com/BlackStateGroup/inveos/actions/runs/40901923672), job 123546231244, passed at `4a9a92af0051e1533a3daa493bb47e14b87282b4`, tree `08e223e4a9e7684f2814dd63bbde6431b2e912ad`. The [machine-readable receipt](scanned-supplier-ocr-receipt.json) preserves the full package/native/model/notice inventory and word coordinates. Both runs recovered all 17 expected tokens on page one and all 22 on page two, with identical respective TSV digests `19c769ce9ec702c6c5615b9beaf03b010f86f6ad64e406b2861467f4ae23feb7` and `c3a91b0227da8bf28ee30a2fdd4544adc252cd2eeb239bc9b566943122cabf99`. OCR calls took approximately 0.30–0.37 seconds per page on that disposable host; these are not production capacity estimates. The scan SHA-256 was `9da2e432913806c632f27cb0d017f1315b8f8928f1719cc3422d693de4f15be0`, unchanged after OCR. The scan had no hidden text layer, malformed input failed, all containers were removed and isolation/resource probes passed. The runtime inventory records 161 packages and 58 native/model files with owners and notice hashes. No general accuracy, source-head equivalence or licence/security approval follows from those counts.

The existing pinned Docling/native/raster and actual leased-worker/database failure tests also passed in that research run. [Checks #195](https://github.com/BlackStateGroup/inveos/actions/runs/40901923789), job 123546231507, passed all 234 Node and 107 Python tests with zero failures/skips, plus lint/types/build/reference, actual PostgreSQL/browser and host isolation. A follow-up adds an in-container deadline that survives host-attach loss; its separate hosted verification must be recorded before claiming that changed revision is tested.

## Reproducibility and remaining approval

Root OCR/data package versions and the base image are fixed. Transitive apt resolution is measured in the resulting inventory, not yet captured in a prior complete package-archive lock; a later apt resolution must not be represented as the same runtime without comparing its actual image/file hashes. Registry publication and application incorporation are not authorised by this experiment. Before choosing a shipping runtime, lock the full package/data closure, retain its required notices, audit vulnerabilities and build/source provenance, review all licence obligations, broaden the corpus and qualify the durable job/OCR citation boundary. Existing production/legal/privacy and real-device gates remain open.

The actual provider notices contain numerous component-specific terms, including copyleft, advertising-clause and unclear `noderivs`/`none`/public-domain labels. These package-wide labels do not establish which terms apply to each loaded binary. File-by-file applicability, source obligations and redistribution clearance remain unresolved; do not promote the packaged research image to an approved application runtime merely because the primary Tesseract/data notices say Apache-2.0.
