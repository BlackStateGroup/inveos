# INVEOS documentation map

## Product

- `01_VISION.md` — why the product exists, audiences, jobs-to-be-done and non-goals.
- `02_PRODUCT_REQUIREMENTS.md` — comprehensive feature taxonomy, priorities and conditions of acceptance.
- `03_USER_JOURNEYS.md` — complete investigation flows, including exception paths.
- `04_INFORMATION_ARCHITECTURE.md` — desktop, field and portal layouts and screen inventory.
- `05_DESIGN_SYSTEM.md` — visual language and UX conventions.

## Engineering

- `06_ARCHITECTURE.md` — modular system diagram, layers, boundaries and build choices.
- `07_DATA_MODEL.md` — core entities, lifecycle and joins.
- `08_EVIDENCE_INTEGRITY.md` — originals, audit, chain of custody, exports and verification.
- `09_AI_ANALYST.md` — AI processing, review gates, evaluation and hallucination controls.
- `10_RESEARCH_OSINT.md` — authorised source acquisition, provenance, entity resolution and graph.
- `11_SECURITY_LEGAL.md` — legal obligations, threat model, privacy and security gates.
- `12_API_AND_EVENTS.md` — integration contracts, offline sync, event shapes and API semantics.

## Execution and business

- `13_ROADMAP.md` — delivery slices, dates expressed as relative weeks, estimates and staffing assumptions.
- `14_TEST_PLAN.md` — acceptance matrix and verification receipts.
- `15_COMMERCIAL.md` — target segments, competitor baseline, pricing hypotheses and discovery.
- `16_INTEGRATION_BOUNDARIES.md` — relationship to NOIR, Recon and possible services.
- `17_DECISIONS_AND_RISKS.md` — ADRs, open decisions and risk register.
- `18_OPERATIONS.md` — environments, deployment, monitoring, backup and recovery.
- `19_CASE_TEMPLATES.md` — investigator templates and report outlines.
- `20_LANDSCAPE.md` — competing products and market research.
- `21_ENGINEERING_WORKPACKAGES.md` — vertical slices with exit criteria.
- `22_GITHUB_HANDOFF.md` — repository write-access finding and publication steps.
- [Local application and scope decision](23_LOCAL_APPLICATION.md) — visual prototype, persistent synthetic lab and non-production boundaries.
- [Explicit source occurrences](30_EXPLICIT_SOURCE_SPANS.md) — exact original-byte selection and stable reviewed citations.
- [Immutable text derivatives](29_IMMUTABLE_TEXT_DERIVATIVES.md) — durable first-party UTF-8 processing and immutable, reverified lineage.
- [Offline report verification](25_OFFLINE_REPORT_VERIFIER.md) — standalone verification of the current internal JSON draft.
- [Quarantined binary intake](27_QUARANTINED_BINARY_INTAKE.md) — bounded opaque-original API storage with authority, integrity and claim guards.
- [Internal exhibit packages](26_INTERNAL_EXHIBIT_PACKAGE.md) — versioned manifest, original exhibits and bounded offline package verification.
- [Complete workspace delivery plan](24_DELIVERY_PLAN.md) — reconciled capability states, five-stage build sequence, next slices and the fictional supplier acceptance milestone.

- [Report revision history](32_REPORT_REVISION_HISTORY.md) — saved draft controls, scoped pagination and verified downloads.

## Open-source mining

- [`research/CATALOGUE.md`](../research/CATALOGUE.md) — candidate projects and comparison table.
- [`research/projects.json`](../research/projects.json) — machine-readable candidates, licence metadata and dispositions.
- [`research/locked_revisions.json`](../research/locked_revisions.json) — observed full commits, not implied package versions.
- [`research/ACQUISITION.md`](../research/ACQUISITION.md) — clone/copy/redistribute gates and repeatable research procedure.
- [`research/DEEP_DIVE_MODULE_MAP.md`](../research/DEEP_DIVE_MODULE_MAP.md) — real upstream code paths and PoC experiments.
- [`research/SEARCH_PLAYBOOK.md`](../research/SEARCH_PLAYBOOK.md) — future GitHub discovery queries and review workflow.
- [`research/LICENCE_REVIEW.md`](../research/LICENCE_REVIEW.md) — commercial incorporation due diligence.

**Evidence note:** All plans distinguish proposed behaviour from implemented, tested and deployed behaviour. Research findings are a starting point, not a certification of upstream security, quality or legal suitability.

## Runnable reference and verification

- [Synthetic evidence flow example](../examples/README.md): non-production demonstrator with 10 isolated unit tests.
- [Source inventory tool](../tools/mine_sources.py): list, audit and obtain pinned, git-ignored local research checkouts.
- [Foundation validator](../tools/validate_foundation.py): JSON, links, licence flags, source locks, file inventory.

- [Delivery status and GitHub access](../DELIVERY_STATUS.md).

- [Bounded report assembly](33_BOUNDED_REPORT_ASSEMBLY.md) — incremental JSON budgets, database batches, bounded verified-original reads and failure tests.

- [Report freeze recovery](34_REPORT_FREEZE_RECOVERY.md) — pending request persistence, receipt checks and acknowledgement-loss tests.

- [Processing job history](35_PROCESSING_JOB_HISTORY.md) — scoped processing receipts, attempts and cancellation controls.

- [Verified derivative inspection](36_VERIFIED_DERIVATIVE_INSPECTION.md) — client lineage, byte-range verification and unreviewed line display.

- [Bounded processing dispatch](37_BOUNDED_PROCESSING_DISPATCH.md) — case-scoped queue consumption, lease recovery and actual CLI tests.

- [Original access hardening](38_ORIGINAL_ACCESS_HARDENING.md) — bounded workspace previews and audited, verified original downloads.

- [Recoverable binary file intake](39_RECOVERABLE_BINARY_INTAKE.md) — bounded file selection, fingerprints and acknowledgement recovery.

- [Resumable binary upload API](40_RESUMABLE_UPLOAD_API.md) — reservations, bounded chunks, verified finalisation and cancellation.

- [Resumable upload client](41_RESUMABLE_UPLOAD_CLIENT.md) — missing-range transfer, acknowledged progress, pause and safe legacy retries.

- [Upload staging maintenance](42_UPLOAD_STAGING_MAINTENANCE.md) — bounded expiry, reviewer cancellation and confirmed cancelled-request recovery.

- [Upload receipt history](43_UPLOAD_RECEIPT_HISTORY.md) — bounded scoped history after tab/sign-in loss.

- [Frozen internal report review](44_FROZEN_REPORT_REVIEW.md) — separate reviewer decisions bound to immutable snapshot fingerprints.

- [Frozen source verification](45_FROZEN_SOURCE_VERIFICATION.md) — audited revalidation of a frozen revision’s cited originals and review links.

- [Scoped report disclosure](46_SCOPED_REPORT_DISCLOSURE.md) — explicit recipient grants, expiry, revocation and audited snapshot delivery.

- [Recipient disclosure discovery](47_RECIPIENT_DISCOVERY.md) — bounded recipient-only listing with current access gates.

- [Disclosure acknowledgement](48_DISCLOSURE_ACKNOWLEDGEMENT.md) — explicit fingerprint-bound receipt assertions and client sign-out.

- [Case disclosure oversight](49_DISCLOSURE_OVERSIGHT.md) — reviewer-scoped grant, acknowledgement and revocation history.

- [Portal browser acceptance](50_PORTAL_BROWSER_ACCEPTANCE.md) — real sandboxed Chrome, HTTP and PostgreSQL test harness.

- [Worker host qualification](51_WORKER_HOST_QUALIFICATION.md) — first-party isolation probes before parser runtime selection.

- [Selected Docling artifacts](../research/runtime_artifacts/README.md) — exact wheel hashes, nested notice inventory and pinned-source mismatch.

- [Binary browser recovery](52_BINARY_BROWSER_RECOVERY.md) — pause, lost acknowledgement, reload and explicit cancellation acceptance.

- [Verified original downloads](53_VERIFIED_ORIGINAL_DOWNLOAD.md) — bounded browser byte verification through existing audited access.
