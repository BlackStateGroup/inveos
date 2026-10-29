# INVEOS current engineering handoff

Updated 29 October 2026. The canonical plan is [docs/71_REMAINING_DELIVERY_PLAN.md](docs/71_REMAINING_DELIVERY_PLAN.md). Prior dated receipts are preserved in [the historical handoff](docs/history/2026-10-29_BUILD_HANDOFF.md) and [delivery ledger](docs/history/2026-10-29_DELIVERY_RECEIPTS.md); their old draft/pending wording is historical.

## Current baseline and active work

Main includes cumulative PR #67 and research PR #2. Fresh inspection found open drafts #68–#71, no review threads on #71 and no overlapping implementation. This branch continues #71 head `014978c7cf437b76a5061f1471b2212ed2c3b1e2`; no new merge is authorised.

SYN-SUPPLIER-001 now has code for a separate `tesseract_scan_lab_v1` durable job, exact original → RGB PNG → raw TSV → normalised UTF-8 word/page/region lineage, preserved confidence/TSV row, independently replayable exhibits, browser inspection, existing independent correspondence/interpretation reviews and frozen PDF/restricted delivery. Migration 030 extends existing jobs/immutable derivatives; no competing scheduler or case model.

The OCR bundle selects two previously audited wheels (Pillow 13.0.0 and pypdfium2 5.14.0), rather than the whole Docling closure. A content lock checks all 161 installed package versions and 58 native/model/notice artifacts inside qualified isolation before each OCR job. This is not a complete package-archive lock, licence/source-obligation approval or production dependency selection.

## Verified source revision

Draft [PR #72](https://github.com/BlackStateGroup/inveos/pull/72) implementation `f57a05a082c35a89e6d3d29a55944bed4e0c6a8b`, tree `d41ea33e870f2cc5cf9cfd303c1938260d33cc45`, passed [Research #35](https://github.com/BlackStateGroup/inveos/actions/runs/40910846123), job 123578071521, and [Checks #202](https://github.com/BlackStateGroup/inveos/actions/runs/40910846195), job 123578072525: 239 Node/108 Python tests, zero failures/skips, actual PostgreSQL/API/browser and host isolation, plus the actual supplier test, raster test and five leased-worker/failure tests. Exact machine evidence: [supplier-case-acceptance.json](research/runtime_artifacts/supplier-case-acceptance.json).

The actual supplier test used a separate one-page digital declaration and raster-only register, ran OCR twice, compared the original-page raster/regions in a freshly reloaded sandboxed browser, preserved quarantine/originals and separate source/receipt/processing times, made two independent scripted correspondence/interpretation decisions retaining alternative explanations, froze report/exhibits, ran separate Python verifiers, denied premature disclosure, independently reviewed the exact PDF, approved one restricted fictional recipient, acknowledged, restarted and revoked access. Foreign tenant/case access, runtime qualification drift, malformed input, append-only mutation and cancelled attachment were denied. The historical two-page clean benchmark still reproduced 39/39 expected tokens; the register case has 18 OCR words. These are automated fictional reviewer roles, not professional human acceptance or general OCR/pixel-fidelity certification.

Initial hosted runs caught a combined fixture over the unchanged 65,536-byte limit, a migration-test expected list omitting 030 and an unredacted PDF incorrectly supplied a redaction reason. The fixture was split into its actual constituent records and the tests corrected; controls were preserved. Final implementation and exact environment passed. The final follow-up only records evidence/decisions; do not rerun this unchanged implementation just to re-report its receipt.

Reproduce with [docs/79_SCANNED_DOCUMENT_LINEAGE.md](docs/79_SCANNED_DOCUMENT_LINEAGE.md). Local Docker remains absent and namespace isolation denied; actual parser execution used the supported hosted isolated research workflow, not a host bypass.

## Active continuation: structured document reasoning

Branch `feat/document-finding-reasoning` continues #72 head `c850a79ff942605f4755bc0931beeaf83100d5ca`. Fresh inspection found only drafts #68–#72 and no #72 review threads. Main still contains #67/#2. No overlap or merge authorisation.

Migration 031 extends existing immutable work links to typed reviewed document findings, adds append-only withdrawals and revision source snapshots. Current original/derivative/review/authority verification is reused; correspondence and interpretation reviewers must retain case/reviewer access. Browser source selection/inspection/reload/history/withdrawal, current support/contrary assessment gates, question closure and frozen report/export joins are implemented. The actual supplier test now records two proposed alternatives and six typed links without claiming either explanation proven. See [contract, reproduction and rollback](docs/80_DOCUMENT_REASONING.md).

Local lint/types/build, 111 Python tests and five OCR interoperability helpers pass. Hosted database/browser and actual isolated supplier tests for this changed implementation remain pending; do not treat the earlier #72 receipt as verification of these changes. Resume the new branch's PR/CI, fix failures, inspect feedback and record exact passing evidence. Then advance real identity/encrypted custody and remaining chronology/search/graph/AI/interview/field/team/agency work in the canonical plan; no recurring helper/documentation-only diversion.

Complete package-archive/source closure, provider-specific obligations, representative OCR/Tika/OCRmyPDF comparisons, professional human and real device/offline/restore acceptance remain open. No live collection, production deployment, spending, external contact or future automatic merge. The full product is incomplete.
