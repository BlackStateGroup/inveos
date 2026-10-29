# 13 — Delivery roadmap, work sequencing and estimates

Updated 27 October 2026. This sequence orders delivery of the [complete workspace scope and fictional supplier milestone](24_DELIVERY_PLAN.md). Use its capability ledger and the [reconciled work packages](21_ENGINEERING_WORKPACKAGES.md) to distinguish planned, implemented, tested, deployed and pilot-accepted slices. PR #1 proves a local text-only synthetic loop; no stage below is complete merely because that loop works.

## Delivery slices

| Stage | Deliverable | Completion test |
|---|---|---|
| 1. Accounts, case workspace and secure evidence | Real agency identity/MFA, memberships, persistent brief/objectives/tasks/notes, encrypted originals, recoverable uploads and audit | An authorised team creates a case and uploads, retrieves and independently verifies originals; other tenants and unassigned contractors are denied |
| 2. Document processing, source review and reports | Isolated PDF/OCR jobs, page/region lineage, reviewable claims, basic chronology/questions, editable branded PDF and package verifier | Digital/scanned documents become reviewed findings; incomplete/unsupported citations block approval and the exported package verifies without the service |
| 3. Field, team workflows and client delivery | Native encrypted offline capture, handovers/review queues, release-only portal with approval/expiry/revocation | iPhone/Android restart/outage/retry tests lose no originals; clients receive approved deliverables and cannot access internal material |
| 4. Research and investigation reasoning | Approved source connectors, richer chronology, hypotheses/contrary evidence, entity resolution and relationship graph | Analysts resolve documented questions across connected material; every edge/candidate conclusion has provenance and reversible human decisions |
| 5. Supported pilot operations | Repeatable environments, monitored queues, restore/recovery, retention/holds, billing/quotas, quality evaluation and onboarding/support | Approved pilot users complete cases reliably; recovery and security/privacy gates pass, costs and quality are measured and acceptance is recorded |

Start customer discovery and operational/security work alongside stage 1; stage 5 is their acceptance gate, not their start date. The minimal supplier question record and approved release portal are pulled forward as needed for the first complete case. Full native field capability is tested separately and is not implied by a successful desktop supplier case.

The original foundation estimated a prototype at 1–3 weeks, MVP at 6–10 weeks, pilot beta at 3–4 months and commercial hardening at 4–6+ months. These remain unvalidated historical planning ranges, not dates for the expanded scope. Re-estimate after identity/storage decisions, the parser experiment and pilot discovery. Existing private NOIR/Recon code is not assumed reusable.

## Key dependencies and critical path

1. Scope/authority model precedes lawful intake and source connectors.
2. Evidence storage/digest + custody precede transcription, analysis and report citations.
3. Role scoping precedes search, graph, asynchronous workers and client portal.
4. Deterministic report/export verification precedes external delivery.
5. Native offline storage + receipt semantics precede a pilot involving field-only capture.
6. DPIA, retention, support/security procedures and restore verification precede live personal data.

## First complete fictional investigation

Implement [SYN-SUPPLIER-001](24_DELIVERY_PLAN.md#first-milestone--syn-supplier-001): case/authority → digital and scanned ownership records → verified originals → page-linked extraction → discrepancy, contrary evidence and alternative explanations → human-reviewed finding → branded report/package → independent verification → investigator-approved client release. Preserve explicit unknowns. Do not add automated external collection as a shortcut to this supplied-record milestone.

## Staffing and budget dependencies

- Architecture/backend, UI/mobile, QA/security and privacy/legal review are distinct responsibilities, even if one individual initially wears multiple hats.
- Cloud processing, encrypted storage, backup, OCR/ASR, third-party sources, mobile builds and penetration testing have recurring costs; no quoted estimates are validated yet.
- Research mirrors and large public datasets should not be committed into the main application repository.

## Definition of launch readiness

Zero unresolved critical auth/tenant vulnerabilities; documented lawful processing, security review and DPA; mobile data-loss drills; restore run completed; evidence verification and report release tests green; false-positive/hallucination evaluation; customer support/incident plan; pilot sign-off.
