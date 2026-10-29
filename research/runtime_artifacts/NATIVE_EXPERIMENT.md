# Isolated native PDF research experiment

28 October 2026. Research execution only, never product incorporation or approval
for redistribution. Existing notice/dependency inventories identify the selected
artifacts; complete native licence/security clearance remains open. Fictional,
first-party fixtures only, no live collection or sensitive input.

This experiment uses the exact pinned Docling Git blobs and hash-verified runtime
wheel closure. It excludes the mismatching published docling-slim wheel. Dependency
wheels are expanded as data into a private ignored tree with bounds, rejecting
symlinks, .pth files, unsupported .data layouts and collisions. No upstream code is
imported or installed on the host. The source and runtime tree are mounted read-only
into a fresh container; Python imports happen only inside that boundary. The exact-source wheel is rebuilt twice with the prior recipe, retained only in
ignored cache via `--retain-wheel`, checked against the recorded digest and all
pinned package files, and used for genuine distribution/entry-point metadata.
The explicit source pin remains the provenance authority.

The runtime profile permits 1 GiB RAM/swap and 512 MiB noexec scratch, retaining
16 MiB noexec output, 0.5 CPU, 32 PIDs, no network, non-root, read-only root, no
capabilities, no-new-privileges and disabled daemon logs. All seven actual resource
and isolation probes must pass for this profile before upstream code executes.
Each attachment has a 90-second deadline and 1 MiB combined output cap. Containers
are forcibly removed on all outcomes. No temporary execution flag bypasses the
host sandbox; no installation, package download or model download occurs inside.

Two fresh runs use a deterministic two-page PDF with the same fictional ASCII
passage at known page coordinates. Both must return successful conversion, exactly
two correctly paged passages, full-item character spans and bounding boxes in the
known region. A malformed PDF must be rejected. Original and pinned source hashes
are rechecked; repeated text/provenance rows must match. Wall time covers conversion
and malformed rejection after imports; process peak RSS is reported, not a product
capacity promise. This tiny fixture is not OCR, table, multilingual or comparative
Docling/Tika/OCRmyPDF benchmarking. It does not test hostile exploit resistance.

Run the existing source/wheel acquisition commands from PINNED_BUILD.md and
NATIVE_AUDIT.md, then `timeout 240s python3 tools/experiment_native_pdf.py` on the
qualified host with its pinned image present. Local fixture and profile tests pass;
Hosted [research run #10](https://github.com/BlackStateGroup/inveos/actions/runs/40753018236) passed at `46df726afcf4301f244cb284e2122e87b89abcbb`, tree `fcdd20e7f3066e6c3ac782196c16ef4e82bbbf15`: actual pinned-source NativePdfPipeline and threaded Docling-parse executed in two fresh qualified runtime containers. Both recovered the same 33-character passage on pages 1 and 2 at bottom-left box [72, 697.516, 282.756, 708.616], rejected malformed input and preserved original SHA-256 `4d1c88eb334bd4128dacb6579ec90de296d8ed0b4a0e8501b4daff5f1bf776f9`. Measured conversion-plus-rejection times were 0.0250/0.0744 seconds after imports; peak process RSS 160,908/161,364 KiB. These are tiny-fixture observations, not capacity claims. All runtime-profile resource probes passed. [Checks #119](https://github.com/BlackStateGroup/inveos/actions/runs/40753018232) passed at the same revision: 135 Node tests (98 PostgreSQL API/restore, five actual Chrome journeys, 32 helpers), zero failures/skips; 74 Python tests, lint/types/build/reference and service isolation. See the [machine-readable receipt](native-pdf-receipt.json). The research CI workflow runs the same
experiment. There is no application/schema integration, automatic finding, page
review UI or client release. Those gates remain open along with broader fixtures,
full runtime licence/security review and the other parser candidates.


## Engineering decision from actual failures

Importing general DocumentConverter at this pin eagerly imports the ASR transformer
module and requires Torch even for the native PDF path. Do not add a model bundle
merely to satisfy that import. The bounded experiment instead calls InputDocument,
ThreadedDoclingParseDocumentBackend and NativePdfPipeline directly, with explicit
page/file limits, one parser thread, no image generation and no model processing.
A source-only attempt then failed because plugin discovery needs installed
entry-point metadata. Retaining the verified exact-source wheel supplies that
metadata without fabricating it or substituting the mismatching published wheel.
No upstream source was patched. This direct API is pinned research, not a promise
of compatibility with later Docling releases or complete converter behaviour.

The default builder still deletes its temporary outputs. The optional retained
copy lives only at `.research-cache/docling-exact/`; a differing existing copy is
rejected rather than overwritten. Nothing is uploaded as a third-party artifact.
The implementation revision above was tested; the receipt follow-up changes only
documentation and the recorded result.

## Page coverage extension

The extended experiment adds digital/raster and blank/digital two-page PDFs, a
raster-only PDF, three-page input beyond the configured two-page maximum and an
input above 65,536 bytes. The raster is a first-party checkerboard, not a scan or
OCR-language benchmark. Every case binds its original SHA-256. Two fresh runs must
agree on page coverage and rejections. Text rows keep original page numbering.

`tools/pdf_text_coverage.py` deliberately reports pages without text and marks
them `needs_page_review`, even when the parser reports success. It cannot decide
whether a page is blank, scanned, unsupported or partially lost. Even text on all
pages is only `unreviewed_text`, never verified completeness or a finding. This
research contract is not yet wired into the application. It prevents silent empty
page promotion in the experiment without weakening existing evidence semantics.

Hosted [research run #12](https://github.com/BlackStateGroup/inveos/actions/runs/40760701434) passed at `89f7dd9a6474a6d286356cbfc4cca544d7f541b8`, tree `990ef68b3e0627f50f088460da702f4be25145d8`. Two fresh isolated runs returned successful parser status yet no text on mixed page 2, blank page 1 and raster-only page 1; the coverage receipt correctly requires page review. Original numbering and hashes were preserved; three-page and oversized originals were rejected. Repeated digital page/region truth and malformed rejection still pass. Total conversion/rejection time after imports was 0.02086/0.02124 seconds, peak process RSS 160956/160576 KiB: tiny-fixture observations only. Exact builds, native inventory, provider inspection and runtime containment passed. [Checks #121](https://github.com/BlackStateGroup/inveos/actions/runs/40760701507) passed at the same revision: 135 Node tests (98 PostgreSQL API/restore, five Chrome journeys, 32 helpers), zero failures/skips; 78 Python tests, lint/types/build/reference and service isolation. See [machine receipt](native-coverage-receipt.json). This follow-up changes only evidence/documentation; tested implementation is the revision above.
No new dependencies, runtime artefacts or upstream source changes. Full native
licence/security review, OCR/multilingual/table/encrypted inputs and application
page review remain open. Reproduce with the same qualified-host command above.
