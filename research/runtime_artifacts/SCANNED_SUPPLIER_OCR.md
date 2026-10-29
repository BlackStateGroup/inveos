# Fictional scanned-supplier OCR baseline

29 October 2026. Research-only Tesseract comparison; actual hosted execution pending.

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

Local Python compilation, foundation validation and 107 Python tests pass. The new tests validate deterministic digital-versus-raster fixture construction and TSV geometry rejection; they do not execute OCR. Actual hosted results remain pending until their exact receipt is recorded.

## Reproducibility and remaining approval

Root OCR/data package versions and the base image are fixed. Transitive apt resolution is measured in the resulting inventory, not yet captured in a prior complete package-archive lock; a later apt resolution must not be represented as the same runtime without comparing its actual image/file hashes. Registry publication and application incorporation are not authorised by this experiment. Before choosing a shipping runtime, lock the full package/data closure, retain its required notices, audit vulnerabilities and build/source provenance, review all licence obligations, broaden the corpus and qualify the durable job/OCR citation boundary. Existing production/legal/privacy and real-device gates remain open.
