# 02 — Comprehensive product requirements

Priority definitions: **P0** required for pilot MVP; **P1** next commercial beta; **P2** specialist/enterprise. Each module must support tenancy, audit, correction and appropriate privacy safeguards.

## A. Case / Investigator OS

- **P0** Create case; client/agency identity; instruction and agreed purpose; authorised activities; lawful basis/assessment status; start/close; sensitivity tier; owner; collaborators; unique case number.
- **P0** Overview of objectives, open questions, deadlines, tasks, notes, sources, activity and work status; lifecycle `intake → scope review → active → review → released → archived/closed`.
- **P0** Role-based membership; document/evidence access; versioned assignment and status history; case-scoped search.
- **P1** Templates, budget/time/expense, invoices, SLA, subcontractor assignment, case communication, approvals; reusable tasks.
- **P2** Cross-case insights only when lawful, authorised and tenant isolated; no covert cross-customer graph.

## B. Field Operations / Surveillance Command

- **P0** Mobile assignments, field session start/end, structured observation and text/voice notes, time and optional location metadata, photos/video/audio with consent/authority indicators, offline encrypted draft queue, retry/receipts, media upload status.
- **P0** Separate `captured_on_device`, `queued`, `sending`, `received`, `verified`, `failed`, `conflict` states. Show original captured-at time; preserve upload time separately. No fake live status.
- **P0** Explicit revision/correction rather than overwriting a submitted observation.
- **P1** Supervisor dispatch, team check-ins, configurable field prompts, shift logs, multi-investigator coordination, safe incident status and shift handover.
- **P2** Operational map and equipment integration; never auto-activate unauthorised tracking or recordings.

## C. Evidence Vault

- **P0** Immutable original bytes and digest; acquisition method/source; verified receipt; evidence ID; separate derivatives and annotations; custody/access audit; legal hold; case retention configuration.
- **P0** Media preview from derivatives, upload chunking/resumption, malware/content checks, server-side integrity verification, evidence-to-assertion links; role-guarded download.
- **P0** Export ordered exhibit manifest with hashes, handling history, signatures or integrity checks as applicable, and independent re-verification utility. Keep source and export times.
- **P1** Storage policy/WORM where supported, retention jobs and destruction approvals, per-client sharing, preservation package formats.
- **P2** Specialist digital forensic tool ingestion/importers and case-linked tool output provenance.

## D. AI Case Analyst / Interview Intelligence

- **P0** Async OCR/transcription; typed source spans (page/timecode), structured summaries, report suggestions tagged **draft/unverified**; human review queue; clickable source backlinks.
- **P0** Flag ambiguity, missing sources and conflicting testimony with uncertainty; do not invent confidence. Export raw transcript separately from edited transcript.
- **P1** Timelines, named-entity extraction, relationship candidates, question answering over case-permitted sources, document comparison and contradictions.
- **P1** Interview transcript corrections and speaker boundaries with audit; derived redactions and review.
- **P2** Fraud-specific rule library, anomaly scoring, model routing/local inference options, reviewed analytic playbooks.

## E. OSINT Workbench / Intelligence Graph

- **P0** Manual public-source URL/document capture, retrieval time, publisher, capture method, source trust grade, terms/authority note, annotation, change history.
- **P1** Approved connectors: Companies House and published registries, company/LEI references where licensed, public-domain source data, per-source terms/rate limits; entity resolution candidate/confirmed/rejected relationships.
- **P1** Queryable case graph for people, companies, assets, places, incidents and documents; every edge points to one or more evidence references and an analyst review state.
- **P2** Cross-jurisdiction sources via per-country legal/terms review; network centrality and patterns not treated as proof; scheduled research with change detection and expiry.

## F. Reports and Client Portal

- **P0** Report builder with reviewed findings, claim-level citations, chronology, method, limitations, exhibits and author/reviewer sign-off; PDF export and verifiable manifest.
- **P0** Client release workflow: internal draft → reviewer approved → scope/privilege/redaction check → published version. Client sees explicitly released items only.
- **P1** Editable DOCX templates, branded exports, digital acknowledgements, evidence requests, messaging and client activity audit.
- **P2** Billing/invoices, custom enterprise templates, client-side encrypted export where required and legally feasible.

## G. Platform and business suite

- **P0** Tenant isolation, SSO-ready identity, strong MFA, audit trail, policies, encrypted storage, secrets management, backups/restore, retention and scoped staff roles.
- **P1** Agency dashboard, case allocation, time tracking, subscriptions, usage controls and support tooling with audited elevated access.
- **P2** API/enterprise integrations, granular organisations, custom retention policies, regional storage and self-host options.

## H. Investigation reasoning and chronology

- **P0** Case questions, objectives and unresolved checks have owners, deadlines and history. The overview shows what is supported, what is uncertain, next actions and blockers from persisted case records.
- **P0** A minimal question record links supporting and contrary material to the supplier milestone. A reviewed finding remains distinct from a hypothesis, source assertion or allegation.
- **P1** Competing hypotheses, evidence for/against each, alternative explanations and auditable investigator closure decisions. AI may suggest checks but cannot resolve a question by itself.
- **P0** Basic chronology links source material and preserves alleged event time, source-recorded time and ingest/receipt time separately from processing/render time.
- **P1** Searchable combined observations, correspondence and interviews with approximate ranges, timezone/precision, conflicting accounts and corrections; never invent a precise date or silently collapse disagreement.

## I. Team coordination and interface depth

- **P0** Persist assignments, tasks, notes, deadlines, review ownership and handovers. Contractors see only their assigned cases. Every relevant view reflects the same saved case state after reload.
- **P1** Comments, mentions, workload, review queues and notifications for meaningful failures/deadlines/approvals with user preferences and access revocation.
- **P0** Fast case overview, evidence viewer and side-by-side source review with keyboard operation and useful loading/empty/error/retry states.
- **P1** Case-scoped search/filtering, saved views and bulk actions; validate permissions, long documents and representative large cases.

The [delivery plan](24_DELIVERY_PLAN.md) maps all 18 capability areas to implementation packages and records the complete fictional supplier acceptance target. Corporate due diligence/internal investigations are the first market hypothesis to test, not validated demand. No capability is deployed or pilot-accepted without separate evidence.

## Universal functional gates

1. Every viewed/created object carries tenant + case authorisation checks on API and background workers.
2. Client portal cannot access draft, privilege-tagged, internal research or unreleased evidence by URL guessing.
3. Every AI sentence proposed as a finding must resolve to at least one verified source location or be marked unsupported and blocked from approval.
4. Offline uploads are idempotent and do not create duplicate originals on reconnect or retry.
5. Completed case exports remain verifiable without access to the running SaaS service.
6. No analytics/telemetry captures client content by default. Operational logging avoids personal or secret payloads.

## Boundaries

AI cannot automatically open people-related investigations, start data collection, declare a person guilty, release external reports or bypass compliance sign-off. Lawful-basis and case scope fields are substantive authorisation checks, not decorative checkboxes.
