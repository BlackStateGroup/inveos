# Source archaeology: specific modules and folders worth studying

**Checked against the GitHub public contents API on 26 October 2026.** These are verified *paths* in current upstream repositories, not copied source files and not proof that the implementations are secure or appropriate to redistribute. Recheck at the pinned commit before coding. The suggested uses are original INVEOS design/integration investigations.

## 1. FollowTheMoney (`alephdata/followthemoney`, MIT metadata)

- `followthemoney/model.py`, `followthemoney/schema.py`, `followthemoney/ontology.py`: entity schema/ontology design.
- `followthemoney/graph.py`, `followthemoney/compare.py`, `followthemoney/mapping/`: graph/identity/translation behaviours.
- `followthemoney/schema/Company.yaml`, `Person.yaml`, `Directorship.yaml`, `Ownership.yaml`, `Payment.yaml`, `Contract.yaml`, `CourtCase.yaml`, `RealEstate.yaml`: particularly relevant investigated entity concepts. **These are upstream files, not approved reusable INVEOS schemas yet.**
- **Spike:** create two fictional supplier identities, reconcile unique corporate ID and aliases, reject false matches. Make every relationship carry a case-specific evidence reference and reviewer state.

## 2. OpenAleph (`openaleph/openaleph`, MIT metadata)

- `aleph/model/document.py`, `entity.py`, `permission.py`, `collection.py`: document/entity/role data relationships.
- `aleph/repository/`, `aleph/index/`, `aleph/search/`, `aleph/authz.py`: ingestion, search and authorisation boundaries.
- `ui/`: desktop document discovery UX reference.
- **Spike:** search 100 synthetic documents under separate cases; inspect source visibility and enforce case/tenant isolation.

## 3. Timesketch (`google/timesketch`, Apache-2.0 metadata)

- `timesketch/lib/analyzers/`, `graphs/`, `stories/`, `plaso_compat.py`: timeline enrichment and narratives.
- `timesketch/models/`, `timesketch/frontend-v3/`: event/search/visualisation model.
- `api_client/`, `importer_client/`: integration surface candidates.
- **Spike:** import mock timestamp events with timezone ambiguity, duplicate events and source order uncertainty. Preserve original and acquired times.

## 4. Docling (`docling-project/docling`, MIT metadata)

- `docling/document_converter.py`, `document_extractor.py`, `chunking/`, `backend/`, `datamodel/`: text/layout extraction and structured output.
- `docling/pipeline/standard_pdf_pipeline.py`, `native_pdf_pipeline.py`, `asr_pipeline.py`: task/format pipelines.
- **Spike:** page+paragraph anchors across scanned PDF, multi-column contract and malformed upload; compare resource usage and accuracy against Tika/Tesseract.

## 5. WatermelonDB (`Nozbe/WatermelonDB`, MIT metadata)

- `src/sync/`, `src/sync/impl/`, `src/adapters/`, `src/Database/`, `src/Schema/`: local storage and synchronisation architecture.
- `native/`, `examples/`: native/persistence approaches.
- **Spike:** capture an evidence record and an unsent metadata revision in airplane mode, kill app, restart, reconnect twice and prove unchanged bytes and exactly one server verified receipt.

## 6. whisper.cpp (`ggml-org/whisper.cpp`, MIT metadata)

- `src/`, `include/`, `bindings/` for inference interface; `examples/whisper.android/`, `whisper.swiftui/`, `stream/`, `server/`: field/mobile/service execution patterns.
- `models/` is a download/reference area; **model licences, weights and data terms require separate review**.
- **Spike:** test consenting/synthetic noisy speech, timecodes, device CPU/battery/storage, interruption/restart and reviewable transcript correction. No always-on microphone.

## 7. Cytoscape.js (`cytoscape/cytoscape.js`, MIT metadata)

- `src/collection/`, `core/`, `selector/`, `style/`, `extensions/`: graph queries, styling and interaction.
- `playwright-tests/`, `test/`, `index.d.ts`: testing/types reference.
- **Spike:** show a case graph of 100–2,000 nodes (if needed), interactive edge inspector with evidence references, keyboard traversal and review-state styles.

## 8. WeasyPrint (`Kozea/WeasyPrint`, BSD-3-Clause metadata)

- `weasyprint/document.py`, `html.py`, `pdf/`, `layout/`, `text/`, `anchors.py`: document layout and link/citation functionality.
- `tests/`: layout/regression reference.
- **Spike:** deterministic paginated report and exhibit index, hyperlinks/timecode citations, 100-page document, watermarks and redaction checks. Sanitise externally supplied HTML and resource URLs.

## 9. Bellingcat Auto Archiver (`bellingcat/auto-archiver`, MIT metadata)

- `src/auto_archiver/core/`, `modules/`, `utils/`: capture adapter orchestration, supported targets, error handling.
- `PLATFORM_STATUS.md`, `platform_status.json`: declared service status/limitations.
- **Spike:** archive only an explicitly approved publicly accessible test page with retention limits and clear source/time/hash metadata. Never auto-archive whole personal profiles.

## 10. DFIR-IRIS (`dfir-iris/iris-web`, LGPL-3.0 GitHub metadata)

- `iris-backend` and `iris-frontend` appear as **Git submodules**; they are separate repositories and must be checked separately for their own licences, dependencies and code ownership.
- `docs/`, `docker-compose.yml`: incident workflow and orchestration design reference.
- **Spike:** study case lifecycle, analyst assignment, activity timeline and reviewer accountability as UX concepts only until all licences are individually reviewed.

## Additional pinned references

`log2timeline/plaso` for event extraction; `ocrmypdf/OCRmyPDF` for searchable scans; `SYSTRAN/faster-whisper` for server ASR; `OpenOSINT/OpenOSINT` for passive adapter design; `thunderstornX/forenix-oss` for experimental chained audit; `getodk/collect` for Android field forms; `gotenberg/gotenberg` for PDF conversion; `sigstore/cosign` for signed artifact workflows. Validate actual licences and exact APIs before any dependency decision.

## Important non-conclusions

- This directory map does not establish API compatibility, operational fitness, forensic admissibility, licences of submodules, or security posture.
- No direct copying, vendoring, dependency installation or execution was undertaken during this archaeology pass.
- All code-path discovery is for engineering research, and should be followed by narrow, documented proof-of-concept tests with fictional data.
