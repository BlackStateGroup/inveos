# INVEOS

**Investigation Operating System**  
**Black State Group** | Case platform and retained research foundation

> **Status:** A working persistent fictional-data lab, with reviewed evidence, document processing, offline browser Field, reports and explicitly approved fictional recipient releases. Delivery remains incomplete. The connected platform batch is in acceptance on draft PR #117; current failures, fixes, merged commits and external gates are in [BUILD_HANDOFF.md](BUILD_HANDOFF.md). No production service or live client deployment is approved.

INVEOS is a case-centred operating environment for lawful private, corporate, legal and insurance investigations. It combines six workspaces in one system: **Cases, Field, Research, Intelligence, Evidence and Results**, plus a restricted **Client Portal** and administrative controls. The product connects assignment through collection, analysis, human verification and report delivery.

## Start here

| Document | Purpose |
|---|---|
| [Run the current local platform](docs/148_LOCAL_PLATFORM_RUNBOOK.md) | Database roles, configuration, startup, acceptance and worker/recovery prerequisites |
| [Current delivery handoff](BUILD_HANDOFF.md) | Exact implementation, commit, merge, failed/passed and unrun evidence |
| [Remaining delivery plan](docs/71_REMAINING_DELIVERY_PLAN.md) | Current connected journeys and incomplete requirements |
| [Foundation delivery status](DELIVERY_STATUS.md) | Publication receipt, original foundation commit and verification results |
| [Local application](docs/23_LOCAL_APPLICATION.md) | Implemented visual surfaces, synthetic-lab architecture and explicit limitations |
| [Persistent casework verification](docs/evals/2026-10-27-casework.md) | Saved questions/hypotheses, tasks, notes, handovers, source links, report printing and offline JSON checks |
| [Complete workspace delivery plan](docs/24_DELIVERY_PLAN.md) | All 18 capability areas, current evidence, next build slices and the fictional supplier milestone |
| [Documentation index](docs/INDEX.md) | All plans, specifications, architecture and decisions |
| [Product requirements](docs/02_PRODUCT_REQUIREMENTS.md) | Scope and acceptance requirements for all modules |
| [System architecture](docs/06_ARCHITECTURE.md) | Data flows, deployment, tenancy and services |
| [Evidence integrity](docs/08_EVIDENCE_INTEGRITY.md) | Provenance, custody, hashing, originals and derivatives |
| [Build roadmap](docs/13_ROADMAP.md) | Phases, dependencies and definition of done |
| [Engineering tasks](docs/21_ENGINEERING_WORKPACKAGES.md) | Agent-ready development tickets |
| [Research catalogue](research/CATALOGUE.md) | GitHub projects, use cases and licence review states |
| [Research acquisition](research/ACQUISITION.md) | What can be cloned, copied, studied and eventually integrated |
| [Pinned research sources](research/locked_revisions.json) | Reproducible commits for selected candidate projects |
| [Source mining tool](tools/mine_sources.py) | List/search sources and optionally acquire approved local research copies |
| [Synthetic evidence flow](examples/README.md) | Runnable, non-production example of intake → source-linked claim → human review → report |

## Product shape

- **Desktop command:** case overview, assignments, people, organisations, places, timeline, evidence, graph, analyst review, report builder.
- **Mobile field:** assign/review, offline journal, timestamped observations, recordings, upload queue, explicit delivery receipts and conflict states.
- **AI analyst:** source-grounded extraction, interview transcription, timelines, contradictions and draft report sections; never a self-certifying finding.
- **Evidence vault:** immutable originals, reproducible hashes, separate derivatives, custody events, access log, disclosures and export verifier.
- **Client portal:** restricted releases, approvals, communications and invoices.
- **Agency administration:** tenancy, users, roles, retention, billing, audit and integrations.

## Quick local checks

No third-party libraries are required for the foundation validator or the synthetic reference:

```bash
python3 tools/validate_foundation.py
python3 -m unittest discover -s tests -v
python3 -m examples.evidence_flow_demo
python3 tools/mine_sources.py --list --priority P0
```

The example is **not** a production evidential service and must never be used with real people or client data; see [its limitations](examples/README.md).

The validator now checks repository sources and excludes local dependencies, build output and lab storage. `MANIFEST.sha256` remains the historical foundation-archive inventory, not a checksum of the developing application. Use `python3 tools/validate_foundation.py --verify-archive` only when checking an unchanged foundation archive; it deliberately reports mismatches on developed sources. Source validation does not claim that original archive hashes still match.

## Work order

Follow the [five-stage roadmap](docs/13_ROADMAP.md): real accounts/persistent case workspace/secure evidence → PDF/OCR/source review/reports → offline field/team workflows/approved client delivery → research/chronology/hypotheses/graph → supported pilot operations. The first complete milestone is a fictional supplier investigation ending in an independently verifiable report package and approved client release. The [capability ledger](docs/24_DELIVERY_PLAN.md) distinguishes implemented lab slices from the remaining work; no production deployment or pilot acceptance is claimed. All live integrations require lawful-source, licence and security review. **Do not merge any private NOIR or Recon code just because it is architecturally relevant.**

## Repository and redistribution policy

This foundation is intended for the public GitHub repository `BlackStateGroup/inveos`. It contains no secrets, customer data, private repository source code or operational datasets. Narrow permitted third-party adaptations retain their pinned provenance and notices in `third_party/`; acquired research source trees, binary packages and model weights remain in ignored local caches. The example test fixtures are fictional. Third-party links are not endorsements or permissions to reuse. The original INVEOS documents are **copyright © 2026 Black State Group. All rights reserved** pending an explicit licensing decision; see [NOTICE](NOTICE.md). No open-source licence has been granted to INVEOS itself. Each referenced project retains its own licence.

**Research-only references are not approved dependencies.** Separate and review application licence, bundled transitive dependencies, model/data licence, terms of service, privacy, source maintenance and security before incorporation.

## Publishing to the target repository

The complete 51-file foundation was published to `main` on **26 October 2026** after BlackStateGroup organisation access was enabled. The [original foundation commit](https://github.com/BlackStateGroup/inveos/commit/ac0fa52a1df37549a61abc16c29b465ae0e840d6) preserves the recovered archive exactly; every remote file was checked against its local Git blob hash. Subsequent publication-note updates record the resolved access issue.

See the [delivery receipt](DELIVERY_STATUS.md) and [GitHub handoff](docs/22_GITHUB_HANDOFF.md) for verification and next steps. Future engineering should use feature branches and draft pull requests. The bundled `tools/publish_to_github.sh` remains an initial-publication helper for an empty target and deliberately refuses to overwrite the now-populated remote `main`.
