# 16 — Reuse boundaries: NOIR, Recon and adjacent projects

## NOIR (Black State Group / EmotiveImpact historical R&D)

Existing operational ideas include event-journal, role-aware command UX, evidence/media workflows, sensing/analysis separation and durability tests. Current repo `EmotiveImpact/Noir` contains synthetic/replay operational tooling and later PRs. **Not a production PI platform; not automatically cleared for copying into a public org repo.** Potentially reuse architecture concepts, test fixtures designs and interfaces after scope/IP review. Do not copy source, protected diagrams or sensitive R&D into INVEOS by default.

Candidate common abstractions: `AuditEvent`, `EvidenceSource`, versioned state transitions, idempotent receipts, replay provenance and role-scoped UI. Keep live sensor/radio/edge workflows outside INVEOS's first release.

## Recon (`EmotiveImpact/Recon`)

Recon's verified public README describes business discovery from Overture/OSM/Companies House and site email collection for outreach. That is **not** already a legal/accuracy-vetted investigation source pipeline. Evaluate record matching and normalisation concepts for company research, but separate investigation consent, origin, lawful basis, licencing, audited capture and permitted purposes. Marketing email eligibility logic is not interchangeable with investigation data processing.

## ALFRED / voice

An ALFRED-style assistant is a future interaction layer: case briefings, source-grounded retrieval and task prompts under the same role policy. No ambient recording, unrestricted private memory or autonomous external actions. Every answer needs provenance and controlled data boundaries. No automatic import of unrelated personal memory.

## Decision process before code reuse

1. Establish source owner, branch/commit, copyright and actual licence/IP entitlement.
2. Identify reusable package boundary and contracts, not copy entire application.
3. Compare data classification, auth, tenancy, dependencies and threat model.
4. Prototype against fictional data and write an adaptation ADR.
5. Import via separately tracked pull request with licence attribution and tests.
6. Verify no unapproved external network calls, credentials, hard-coded tenants or operational data came across.
