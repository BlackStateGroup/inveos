# INVEOS foundation: delivery receipt (26 October 2026)

**Repository target:** https://github.com/BlackStateGroup/inveos

**Actual GitHub status:** Published to `main` on **26 October 2026**. The BlackStateGroup organisation installation is now visible, and successful file creation, commit creation and branch updates confirm write access. The repository is public.

**Original foundation snapshot:** [ac0fa52a1df37549a61abc16c29b465ae0e840d6](https://github.com/BlackStateGroup/inveos/commit/ac0fa52a1df37549a61abc16c29b465ae0e840d6). Its tree is `271ed0f73e8467356264c154a4ddad4a779cae7a`. All **51 remote files** match the recovered archive's file paths, contents and Git file modes. Later publication-note updates refresh the README, this receipt, the GitHub handoff and their manifest entries.

**Recovered archive:** `inveos-foundation-2026-10-26.zip`, version 2, SHA-256 `07b06d71ee71ddf4336eeb76cba4bd47150961915a8bac9da5c0f4d2fadee4d6`. The separately saved roadmap and engineering work packages were byte-identical to the archive copies.

## Foundation published

- Original product definition, workflows, case templates, user interface/navigation and design system
- Proposed modular-monolith architecture, case/tenant data model, API/events and example JSON schemas
- Evidence intake, custody, retention, verification, offline sync, AI source citations and report-release safety requirements
- UK-first privacy/legal review gates, risk register, security/QA, launch operations and commercial assumptions
- Detailed work packages and staged 6–10 week MVP, 3–4 month pilot, 4–6+ month hardening estimates
- 70 public GitHub repository candidates in human-readable Markdown, machine-readable JSON and CSV
- 22 exact upstream revisions in an independent pin ledger for reproducible local source research
- Precise code-folder/architecture research pointers for selected projects
- Opt-in research acquisition helper which stores clones **outside the committed repository**
- A synthetic, in-memory evidence/claim/review/report demonstration with 10 passing unit tests
- SHA-256 manifest of all included files and local validation/publishing helper

## Verification repeated before publication

- Foundation validator: passed, including the 50 manifest entries, JSON, local Markdown links, 70 research candidates and 22 revision pins.
- Reference unit tests: **10 passed**.
- Synthetic evidence-flow example: ran successfully; original-byte and event-chain verification returned true.
- Publication shell script: syntax check passed.
- GitHub original foundation tree: all 51 file paths, blob hashes and modes matched the local package; response was complete and untruncated.

These are local and repository-publication checks. No GitHub Actions workflow, live application, client release or deployment is claimed.

Run:

```bash
python3 tools/validate_foundation.py
python3 -m unittest discover -s tests -v
python3 -m examples.evidence_flow_demo
bash -n tools/publish_to_github.sh
```

The package is a **foundation**, not an operational product. It has no authentic private investigation records, production database, encryption service, full legal review, third-party cloned code, deployed API or mobile app. Reference models and external software have not been installed or cleared for commercial distribution.

## Previous access blocker resolved

The earlier archive correctly recorded a `403 Resource not accessible by integration` failure while only the EmotiveImpact personal installation was visible. Following the user's organisation-access change, the BlackStateGroup installation appeared and publication succeeded. The completed first publication used ordinary commits and non-force branch updates; no existing branch history was overwritten.

This receipt describes the original foundation publication. PR #1 subsequently added the local interface and persistent synthetic case/evidence workflow; see [the application receipt](docs/23_LOCAL_APPLICATION.md). Current implementation states, remaining work and the fictional supplier milestone are in the [delivery plan](docs/24_DELIVERY_PLAN.md) and [reconciled work packages](docs/21_ENGINEERING_WORKPACKAGES.md). See `docs/22_GITHUB_HANDOFF.md` for the published-repository workflow.
