# INVEOS current engineering handoff

Updated 29 October 2026. The canonical plan is [docs/71_REMAINING_DELIVERY_PLAN.md](docs/71_REMAINING_DELIVERY_PLAN.md). Prior dated receipts are preserved in [the historical handoff](docs/history/2026-10-29_BUILD_HANDOFF.md) and [delivery ledger](docs/history/2026-10-29_DELIVERY_RECEIPTS.md); their old draft/pending wording is historical.

## Current baseline and active work

Main includes cumulative PR #67 and research PR #2. Fresh inspection found open drafts #68–#71, no review threads on #71 and no overlapping implementation. This branch continues #71 head `014978c7cf437b76a5061f1471b2212ed2c3b1e2`; no new merge is authorised.

SYN-SUPPLIER-001 now has code for a separate `tesseract_scan_lab_v1` durable job, exact original → RGB PNG → raw TSV → normalised UTF-8 word/page/region lineage, preserved confidence/TSV row, independently replayable exhibits, browser inspection, existing independent correspondence/interpretation reviews and frozen PDF/restricted delivery. Migration 030 extends existing jobs/immutable derivatives; no competing scheduler or case model.

The OCR bundle selects two previously audited wheels (Pillow 13.0.0 and pypdfium2 5.14.0), rather than the whole Docling closure. A content lock checks all 161 installed package versions and 58 native/model/notice artifacts inside qualified isolation before each OCR job. This is not a complete package-archive lock, licence/source-obligation approval or production dependency selection.

## Verification at this checkpoint

Local lint, workspace types/build, foundation validation, 108 Python tests and 32 focused Node tests pass. The new boundary tests use fabricated bytes and are not parser/accuracy evidence. Existing actual OCR receipt at #71 code `077c0904aac021faa362290d411566f876ed2229` remains valid for its unchanged benchmark only. New actual isolated worker/database/browser/supplier report and delivery tests are implemented but pending hosted execution; do not mark them passed until a fresh receipt is recorded.

Use [docs/79_SCANNED_DOCUMENT_LINEAGE.md](docs/79_SCANNED_DOCUMENT_LINEAGE.md) for reproduction, trust limits and rollback. The existing research workflow runs the new actual case acceptance before removing the disposable image. Local Docker remains absent and namespace isolation denied; no parser executes on the host.

## Resume and remaining criteria

First inspect the new draft's Checks and research workflow. Fix failures, run the actual supplier journey, retain exact revision/run/job/fingerprint evidence and inspect feedback. Do not stop at helper tests or a draft PR. Then advance remaining representative OCR/Tika/OCRmyPDF comparisons, page fidelity/professional human acceptance and runtime/source obligations; keep those gates distinct from scripted role attestations.

Continue dependency-ready real identity/encrypted storage, chronology/search/reasoning, reviewed graph, cited assistance/interviews, native encrypted offline capture, team and agency/platform operations under the canonical plan and requirements. Real device/offline/restore and external legal/privacy/licence approvals remain open. No live collection, production deployment, spending, external contact or future automatic merge. The full product is incomplete.
