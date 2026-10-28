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
into a fresh container; Python imports happen only inside that boundary. Distribution
version metadata for Docling itself may report unknown because it runs from the
verified source tree; the explicit source pin is the provenance authority.

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
actual hosted parser execution is pending. The research CI workflow runs the same
experiment. There is no application/schema integration, automatic finding, page
review UI or client release. Those gates remain open along with broader fixtures,
full runtime licence/security review and the other parser candidates.
