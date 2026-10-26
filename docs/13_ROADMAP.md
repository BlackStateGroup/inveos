# 13 — Delivery roadmap, work sequencing and estimates

**Estimates are planning ranges only**, assuming one senior full-stack engineer supported by AI tooling, specialist security/UX review and rapid product decisions. Parallel staff can shorten calendar time but cannot bypass field/device/security gates. Existing NOIR/Recon code is not assumed reusable before audit.

## Delivery slices

| Stage | Indicative elapsed time | Scope | Exit gate |
|---|---|---|---|
| 0. Discovery, research, contracts | Week 0–1 | Customer interviews, legal/privacy check, architecture ADRs, source audit, synthetic demo case | Documented assumptions, security model, 5 user interviews, no unstated reuse licences |
| 1. Real case and evidence backbone | Weeks 1–3 | Auth/roles, case intake, task/notes, direct upload, immutable original/hash, custody and audit | Two tenants cannot cross-read, object can be independently hash-verified |
| 2. Desktop and field journal | Weeks 3–5 | Case command UX, mobile capture, offline encrypted queue, retries/receipts, media previews | iOS and Android reconnect/outage trials with no lost/duplicated originals |
| 3. Analysis and reporting MVP | Weeks 5–8 | OCR/ASR, source spans, review queue, basic timeline, report builder, PDF and exhibit export | End-to-end case from intake to reviewed report, offline verifier passes |
| 4. Controlled client pilot | Weeks 8–10 | Portal release, redactions, approvals, retention, billing basics, consent/policy flows | Internal penetration test, restore drill, DPIA/legal review, pilot launch criteria |
| 5. Intelligence beta | Months 3–4 | Source connectors, relation graph, entity resolution, agency workflows | Proven source permissions and human verification; useful analyst metrics |
| 6. Hardened commercial | Months 4–6+ | Scale, SSO, monitoring, disaster recovery, security remediation, templates, enterprise trials | External security/legal readiness checks, customer acceptance and reliable operations |

A visual **prototype** may be delivered in 1–3 weeks. A genuinely functional **MVP** is estimated at 6–10 weeks; a **pilot-ready beta** at 3–4 months; a fully **commercially hardened** release at 4–6+ months. This is not a promise that one conversation performs weeks of work or that current code already satisfies the roadmap.

## Key dependencies and critical path

1. Scope/authority model precedes lawful intake and source connectors.
2. Evidence storage/digest + custody precede transcription, analysis and report citations.
3. Role scoping precedes search, graph, asynchronous workers and client portal.
4. Deterministic report/export verification precedes external delivery.
5. Native offline storage + receipt semantics precede a pilot involving field-only capture.
6. DPIA, retention, support/security procedures and restore verification precede live personal data.

## Two-week vertical demonstration target

Use a fully synthetic corporate supplier case. Create case → upload two sample PDFs → compute/verify digests → propose two extracted facts from exact pages → human review → generate sourced draft report → export with manifest. Do not add OSINT automation until this loop works and is measured.

## Staffing and budget dependencies

- Architecture/backend, UI/mobile, QA/security and privacy/legal review are distinct responsibilities, even if one individual initially wears multiple hats.
- Cloud processing, encrypted storage, backup, OCR/ASR, third-party sources, mobile builds and penetration testing have recurring costs; no quoted estimates are validated yet.
- Research mirrors and large public datasets should not be committed into the main application repository.

## Definition of launch readiness

Zero unresolved critical auth/tenant vulnerabilities; documented lawful processing, security review and DPA; mobile data-loss drills; restore run completed; evidence verification and report release tests green; false-positive/hallucination evaluation; customer support/incident plan; pilot sign-off.
