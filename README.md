# INVEOS

**Investigation Operating System**  
**Black State Group** | Product and research foundation, 26 October 2026

> **Status:** Comprehensive research and engineering blueprint plus one synthetic-only, independently tested evidence-flow demonstration. There is no deployed or operational INVEOS application yet. The plans, timelines and commercial assumptions remain hypotheses to validate.

INVEOS is a case-centred operating environment for lawful private, corporate, legal and insurance investigations. It combines six workspaces in one system: **Cases, Field, Research, Intelligence, Evidence and Results**, plus a restricted **Client Portal** and administrative controls. The product connects assignment through collection, analysis, human verification and report delivery.

## Start here

| Document | Purpose |
|---|---|
| [Foundation delivery status](DELIVERY_STATUS.md) | Precisely what has been assembled, verified and not pushed |
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

## Work order

Build the foundational case/evidence schema first, then desktop case workspace and secure media intake, then offline field workflow, reporting and client release. Research/graph and richer agency features follow. All live integrations require lawful-source, licence and security review. **Do not merge any private NOIR or Recon code just because it is architecturally relevant.**

## Repository and redistribution policy

This foundation is intended for the public GitHub repository `BlackStateGroup/inveos`. It contains no secrets, customer data, private repository source code, datasets, model weights or copied third-party software. The example test fixtures are fictional. Third-party links are not endorsements or permissions to reuse. The original INVEOS documents are **copyright © 2026 Black State Group. All rights reserved** pending an explicit licensing decision; see [NOTICE](NOTICE.md). No open-source licence has been granted to INVEOS itself. Each referenced project retains its own licence.

**Research-only references are not approved dependencies.** Separate and review application licence, bundled transitive dependencies, model/data licence, terms of service, privacy, source maintenance and security before incorporation.

## Publishing to the target repository

The connected GitHub app lacks installation access to the BlackStateGroup organisation at preparation time, so this archive has **not** been pushed. See [GitHub handoff](docs/22_GITHUB_HANDOFF.md). Once you have authorised GitHub access, a local operator can run `bash tools/publish_to_github.sh` from this extracted folder; the script deliberately refuses to overwrite a non-empty remote `main`.
