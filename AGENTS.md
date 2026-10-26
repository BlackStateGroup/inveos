# INVEOS engineering instructions

Read `README.md`, `docs/INDEX.md`, `docs/02_PRODUCT_REQUIREMENTS.md`, `docs/06_ARCHITECTURE.md`, `docs/08_EVIDENCE_INTEGRITY.md`, `docs/11_SECURITY_LEGAL.md`, `docs/13_ROADMAP.md`, `research/ACQUISITION.md` and `docs/21_ENGINEERING_WORKPACKAGES.md` in that order.

## Fixed principles

- An investigation is one case-scoped system, not 12 disconnected apps. Each client release follows an explicit investigator approval.
- Preserve source time separately from ingest time and UI-render time. Never silently replace original files, claims, history or evidence identities.
- AI suggestions, extracted facts, reviewed findings and allegations must be different states and different storage records. Evidence references are mandatory for reviewable findings.
- Every tenant boundary is enforced on the server, object storage, jobs, search, graph, embeddings, exports and event subscriptions. Deny access by default.
- Never design covert collection, unauthorised system access, stalking or automated individual surveillance as default features. Every external collector requires legal-source approval, scope, logging and rate controls.
- Preserve consent/authority, purpose, lawful basis, retention and minimisation decisions at case and source level.
- No direct production deployments, branch merges, repository rewrites or copying code from other private projects without explicit authorisation.
- When cloning open-source research projects, retain provenance, use the pinned revision, perform licence and security checks, and keep checkouts in ignored local research cache.
- No actual client or personal data in fixtures, documentation, demos or tests. Use clearly labelled fictional data.
- Do not label an app ready because tests passed on mocks. Report actual API, browser, iOS/Android, outage, restore and security evidence separately.

## Development discipline

Create small feature branches and draft PRs; include a decision record for architectural departures, tests for negative states, privacy review and an evidence trail of verification. Write clear run instructions. Add deterministic fixtures, type checks, unit/integration/API tests, browser checks and offline/device tests where relevant. Do not imply evidence admissibility or legal compliance from cryptographic checks alone.

## Build orientation

Preferred starting point: typed web app + lightweight API + PostgreSQL and relational evidence graph, encrypted S3-compatible object store, background workers, typed events and separate mobile offline store; see the ADR for alternatives. Technologies are candidates until proved with the first vertical slice.

## Available non-production reference

Run `python3 -m unittest discover -s tests -v` and `python3 -m examples.evidence_flow_demo`. These demonstrate original intake bytes, proposed source-linked claims, review and a draft report only. Never mistake these in-memory tests for production custody, digital signatures, access control or evidence admissibility.
