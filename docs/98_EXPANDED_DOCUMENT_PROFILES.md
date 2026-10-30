# Versioned larger-input OCR and page rendering

This increment adds `tesseract_scan_lab_v2` and `pdf_raster_lab_v2`, each permitting originals through **262,144 bytes**. They remain opt-in fictional research jobs. The existing native PDF, OCR v1 and raster v1 profiles retain their **65,536-byte** bounds, exact profile bytes/digests and historical records. Larger originals cannot be enqueued under a legacy profile. No original, extraction, citation, review or frozen report is relabelled or replaced.

| Profile | SHA-256 | Original limit |
|---|---|---|
| OCR v1 | `3eaf9e8346c3496729f98a2c846abc75d4afac066f3e8c3c9b4ada6acb323e76` | 65,536 bytes |
| OCR v2 | `f759250b341ee423d8939d4b6f0755ed451931a4860b633be29df435bf32aaa3` | 262,144 bytes |
| Raster v1 | `80bf6d3f398ca89c0c192371fbed4af8899eefb4bdda8e764dc89ecebed5d569` | 65,536 bytes |
| Raster v2 | `0086bbb11f0633d6964266bd5770994ac134cbe5d1e04c6717213cac04c54f0c` | 262,144 bytes |

Only the declared original byte bound changes in the processing profiles. OCR remains English Tesseract 5.3.0-2 with its locked model/runtime and two hash-locked Python wheels, 144 dpi, page segmentation mode 6 and one thread. Both paths remain limited to two pages, bounded dimensions/pixels and 262,144-byte PNGs. OCR keeps its 30-second subprocess deadline, 131,072-byte TSV bound, 1,000-word limit and one-MiB derivative bound. Existing networkless, unprivileged, read-only isolation, CPU/memory/process limits, lease renewal and confirmed cleanup remain mandatory. No new runtime dependency or source acquisition is introduced. Existing runtime/package/licence approvals remain separate and incomplete.

V2 uses a distinct processing kind and profile digest. Its raw/normalised data retains the v1 JSON schema because field meanings and citation coordinates are unchanged; the stored profile identifies the version. API attachment and reads select the bound/profile from the immutable job kind, verify the original and reconstruct the exact derivative. A result for the other profile cannot attach. Migration 045 recognises both new kinds and extends the existing deferred atomic-result constraints and immutable derivative foreign keys.

Page inspection recognises both versions, labels v2 explicitly and retains original-page comparison. Search labels both OCR variants as unreviewed OCR. Source review, independent interpretation, frozen report/exhibit lineage and explicit release gates continue unchanged. The independent standard-library package verifier recognises both exact OCR profile digests and applies the matching original bound. It does not infer source truth, visual accuracy, legal validity or approval from hashes.

## Acceptance and reproduction

Run the normal locked setup/migrations from LOCAL_RUN.md against disposable PostgreSQL. Run lint, build/type checks, foundation validation and the complete API suite. Local boundary fixtures deliberately do not execute PDF/OCR libraries; they test malformed/profile/size/context handling, immutable legacy digests, Python replay, current access, corrupt-source denial, restart and atomic storage. They do not count as parser benchmarks.

The qualified **Pinned Docling research build** workflow runs each controlled adversity condition twice under v1 and twice under v2. It retains separate measurements and exact TSV bytes/digests, including every rejection. Output existence, repeat stability, character/word errors and numeric-token errors are separate results; success of the experiment is not accuracy certification. No representative scan, language or handwriting coverage is claimed.

The actual supplier acceptance runs the complete encrypted-original → OCR/native → original-page comparison → cited independent review → frozen package/PDF → restricted approved fictional delivery workflow for each version. The v2 scan is the same first-party scanned fixture with explicitly labelled PDF comment padding inserted before its xref table and a corrected startxref offset, placing it above 65,536 bytes without altering page content. This is a real larger parsed PDF, not representative scan complexity. V1 rejection of that source is checked. The actual adversity corpus supplies the separate degraded-input experiment. Both suites must pass before merge; [evaluation](evals/2026-10-30-expanded-document-profiles.md) and the handoff record exact evidence.

Use the existing explicit single-job OCR worker command and qualified receipts; it selects v1/v2 from the already-enqueued scoped job. No automatic worker discovery or production activation is added. Roll back application code without dropping profile rows or rewriting migrations; historical v1 records remain readable with prior code, while v2 records require this implementation and verifier. Do not silently down-convert them.
