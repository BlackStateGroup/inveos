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
- [Offline report verification](25_OFFLINE_REPORT_VERIFIER.md) — standalone verification of the current internal JSON draft.
- [Internal exhibit packages](26_INTERNAL_EXHIBIT_PACKAGE.md) — versioned manifest, original exhibits and bounded offline package verification.
- [Complete workspace delivery plan](24_DELIVERY_PLAN.md) — reconciled capability states, five-stage build sequence, next slices and the fictional supplier acceptance milestone.

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
