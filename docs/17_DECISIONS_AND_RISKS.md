# 17 — Architecture decisions and risk register

## ADR-001 — One product, three surfaces

**Accepted as design intent:** Command desktop, Field mobile and Client Portal share a single case/evidence platform with context-specific permissions. Reject disconnected apps that require manual handover.

## ADR-002 — Modular monolith before microservices

**Provisional:** modular API and transactional database with durable work queue; Python/media services isolated. Revisit only if scaling or security measurement supports separation.

## ADR-003 — Evidence as immutable originals plus derivations

**Accepted:** stable original bytes and server-recomputed SHA-256; source and custody metadata may be corrected only through audit-visible revisions. Cryptographic integrity does not certify authenticity.

## ADR-004 — No production-facing autonomous investigation agent

**Accepted for MVP:** AI can draft, extract and propose, but only a human reviewer can approve a finding, initiate intrusive research or publish a report. Source documents never grant tool permissions.

## ADR-005 — Relational graph initially

**Provisional:** PostgreSQL case-scoped entity + relation + evidence joins with Cytoscape.js UI. Reconsider graph database only after benchmarked query needs.

## ADR-006 — Public planning repository, no copied private source

**Required until repo privacy is changed:** plan documents and source references are public. Never commit customer content, private source from NOIR, secrets, live case metadata or unvetted external code. Choose an explicit INVEOS licence before publishing application source.

## ADR-008 — Versioned casework and bounded draft verification

Implemented in the local synthetic slice: keep objectives, questions, hypotheses,
tasks, notes and handovers within the existing tenant/case boundary. API-enforced kind
and parent references, optimistic revision checks, transactional audit and separate
append-only snapshots preserve corrections. Hypotheses remain separate records
from claims, reviews and findings; supporting/contrary links reverify exact bytes.
Historical ownership survives case-membership revocation, while access checks deny
revoked users. Ordered/checksummed migrations support the existing foundation.
The standalone JSON verifier checks supplied bytes/ranges and can compare an
independently trusted file fingerprint; browser printing is a separate internal
draft capability. These controls do not constitute production identity, signed
custody, PDF certification or authorised client release. See the
[verification receipt](evals/2026-10-27-casework.md).

## Risk register

| Risk | Severity | Mitigation / owner decision |
|---|---|---|
| Illegally or disproportionately collected personal information | Critical | Authority + LIA/DPIA/terms gates; trained investigator and counsel review |
| Cross-tenant data exposure | Critical | Defence in depth RLS/API/object/search, penetration tests before pilots |
| AI hallucination presented as truth | High | Source spans, human review and unsupported-claim release blocker |
| Lost or corrupted field original | Critical | Durable encrypted offline queue, hash receipts, outage/restore tests |
| False implied admissibility/forensic guarantees | High | Carefully qualified product wording and independent verification docs |
| Third-party copyleft licence contaminates desired closed-source app | High | Catalogue, SPDX/full licence review, boundary and counsel sign-off |
| Poor source quality or alias match harms reputation | High | Candidate-only extraction and reversible manual entity resolution |
| Costs of OCR/video/AI and long retention | Medium–High | Usage limits, model mix, measured storage/compute and billing allowances |
| Overbuilt platform before customer adoption | High | Deliver narrow field/evidence/report MVP and run interviews |
| Private code accidentally made public | Critical | Repo visibility and source-ownership gate; pre-commit scanners |

## Open decision log

- Repository visibility and release licence for original application code.
- Preferred stack, production data region, insurer/solicitor market first.
- Object storage WORM/retention guarantees versus commercial cost.
- Mobile platform specifics and secure offline retention policy.
- Model/inference service and whether customer-controlled local inference is required.
- Required legal review and industry-specific approvals for chosen launch market.
