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

- [Synthetic restore acceptance](54_SYNTHETIC_RESTORE.md) — actual quiesced PostgreSQL and original-store recovery with negative integrity checks.

- [Other-session revocation](55_OTHER_SESSION_REVOCATION.md) — bounded self-service session control and atomic audit.

- [Session recovery generations](56_SESSION_RECOVERY_GENERATIONS.md) — reject restored cookies using separately managed runtime configuration.

- [Pinned Docling build](../research/runtime_artifacts/PINNED_BUILD.md) — isolated exact-source packaging, build dependency terms and whole-package provenance verification.

- [Native runtime audit](../research/runtime_artifacts/NATIVE_AUDIT.md) — hash-bound ELF dependencies and independent static comparison.

- [Pinned image providers](../research/runtime_artifacts/IMAGE_AUDIT.md) — isolated native library and package provenance inspection.

- [Native PDF experiment](../research/runtime_artifacts/NATIVE_EXPERIMENT.md) — isolated fictional page/region extraction and malformed input checks.

- [Actual parser citation boundary](../research/runtime_artifacts/NATIVE_BOUNDARY.md) — scoped, reverified page citations from isolated native output.

- [Bounded worker renewal](57_BOUNDED_JOB_RENEWAL.md) — live-token renewal with authority checks and a fixed attempt ceiling.

- [Lease-aware process supervision](58_LEASED_PROCESS_SUPERVISION.md) — bounded first-party worker shutdown on renewal failure.

- [Durable document results](59_DURABLE_DOCUMENT_RESULTS.md) — fenced native-result attachment and unreviewed page/region inspection.

- [Leased native research worker](60_LEASED_NATIVE_RESEARCH_WORKER.md) — qualified container execution, explicit cleanup and durable PDF attachment.

- [Container crash deadline](61_CONTAINER_CRASH_DEADLINE.md) — independent execution limit after orchestrator loss.

- [Document region map](62_DOCUMENT_REGION_MAP.md) — page-scaled unreviewed extraction locations.

- [Isolated page rendering](63_ISOLATED_PAGE_RENDERING.md) — bounded original-page raster research.

- [Raster derivative boundary](64_RASTER_DERIVATIVE_BOUNDARY.md) — bounded PNG validation and original-linked manifests.

- [Durable raster results](65_DURABLE_RASTER_RESULTS.md) — fenced attachment and reverified PNG page delivery.

- [Leased raster worker](66_LEASED_RASTER_WORKER.md) — qualified isolated rendering attached to durable research jobs.

- [Verified raster page inspection](67_RASTER_PAGE_INSPECTION.md) — bounded verified page display with stale-image cleanup.

- [Raster passage comparison](68_RASTER_PASSAGE_COMPARISON.md) — explicit lineage-matched extraction overlays.

- [Document citation candidates](69_DOCUMENT_CITATION_CANDIDATES.md) — durable exact extracted selections, separate from approval.

- [Document citation workspace](70_DOCUMENT_CITATION_WORKSPACE.md)

- [Remaining delivery plan after PR #61](71_REMAINING_DELIVERY_PLAN.md)

- [Independent document citation review](72_DOCUMENT_CITATION_REVIEW.md)
- [Document-derived claims and findings](73_DOCUMENT_DERIVED_FINDINGS.md)
- [Frozen document-backed report lineage](74_DOCUMENT_REPORT_LINEAGE.md)
- [Independent document report packages](75_DOCUMENT_REPORT_PACKAGE.md)
- [Browser-verified document package release](76_DOCUMENT_PACKAGE_RELEASE.md)
- [Canonical internal report PDF and redaction](77_CANONICAL_REPORT_PDF.md)
- [Independent PDF review and recipient release](78_REVIEWED_PDF_RELEASE.md)
- [Document-processing research decision and synthetic contract](../research/document_processing/DECISION.md): pinned licence/dependency review, worker boundary and explicit verification limits.

- [Scanned document lineage and supplier case acceptance](79_SCANNED_DOCUMENT_LINEAGE.md)

- [Document findings in investigation reasoning](80_DOCUMENT_REASONING.md)

- [Encrypted immutable original custody](81_ENCRYPTED_ORIGINAL_CUSTODY.md)

- [82 — Evidential chronology](82_EVIDENTIAL_CHRONOLOGY.md): uncertain alleged dates, typed sources, immutable corrections and frozen verified report context.

- [Encrypted recovery and restored worker retirement](84_ENCRYPTED_RESTORE.md): actual database/object/key restoration, stale worker/session denial and remaining production recovery gates.

- [Provider identity sessions](83_PROVIDER_IDENTITY.md): limited code/PKCE integration, membership enrolment/revocation, investigator and client sign-in, explicit remaining provider/MFA acceptance.

- [Case search and private saved views](85_CASE_SEARCH_VIEWS.md): permission-filtered stored records, private versioned filters and actual test boundaries.


- [Internal work discussions and case mentions](86_WORK_DISCUSSIONS.md): attributed comments, immutable corrections, scoped mentions and explicit per-version read state.

- [Reviewed case graph](87_CASE_GRAPH.md) — separate ambiguous entities, pinned source-linked relationship proposals, independent decisions and immutable history.

- [Manual supplied-source register](88_MANUAL_SOURCE_REGISTER.md) — original-linked capture metadata, source policy notes, independent metadata review and correction history.

- [Personal assigned-work queue](89_ASSIGNED_WORK_QUEUE.md) — current membership/ownership pages, bounded excerpts, filters and case-context navigation.

- [90 — Case lifecycle and collection fencing](90_CASE_LIFECYCLE.md)

- [91 — Supplied transcript lineage](91_SUPPLIED_TRANSCRIPTS.md)

- [92 — Case collaborators and ownership](92_CASE_ACCESS.md)

- [Preservation holds and retention review](94_PRESERVATION_HOLDS.md) — fixed case/original targets, reasoned decisions, terminal release and review dates without destruction authority.
- [Case time ledger](93_CASE_TIME_LEDGER.md) — attributed declared time, recorder-only corrections and withdrawal, bounded reviewer visibility and immutable history.

- [Controlled OCR adversity corpus](95_OCR_ADVERSITY_CORPUS.md) — actual runtime measurements separated from profile rejection, synthetic definition tests and remaining representative-corpus gates.

- [96 — Stored document text search and exact job inspection](96_DOCUMENT_TEXT_SEARCH.md)

- [97 — Personal attention and reminder preferences](97_PERSONAL_ATTENTION.md)

- [98 — Versioned larger-input OCR and page rendering](98_EXPANDED_DOCUMENT_PROFILES.md)

- [99 — Locked Debian archives for the OCR research runtime](99_OCR_PACKAGE_ARCHIVES.md)
- [100 — Versioned case time budgets](100_CASE_TIME_BUDGETS.md)

- [101 — Case-scoped bulk task status changes](101_BULK_TASK_STATUS.md)

- [Field, team workload and entity attributes](102_FIELD_TEAM_ENTITY_BATCH.md) — combined browser Field/platform increment; acceptance and native gates recorded separately.
