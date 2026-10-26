# 21 — Agent-ready engineering work packages

Each work package is a separate pull request with tests and evidence. Prefer narrowly scoped work, clean integration and no change to production by default. No implemented work packages are claimed yet.

## WP-00 — Repository scaffold and policy (P0)

Set up TS monorepo, package manager, shared schemas, API/test harness, Postgres migrations, application lint/format/type checks, CI, sample `.env.example`, secret scanning. Establish authorship and INVEOS licence policy. **Done when:** fresh checkout builds and synthetic unit tests run without production credentials.

## WP-01 — Auth, tenancy, case intake and policy gate (P0)

Implement users, membership, cases, authority records, role checks and source/collection blocks. **Done when:** cross-tenant/cross-case tests deny reads/search/jobs and invalid scope blocks ingestion.

## WP-02 — Original evidence intake and custody (P0)

Implement upload reservation, bounded chunks, server SHA-256, immutable storage pointer, source identity, custody/audit records and rejected file handling. **Done when:** corruption, duplicate/retry, interrupted upload and forbidden downloads all pass negative tests.

## WP-03 — Desktop case workspace (P0)

Implement case list, detail, chronology, tasks, source inventory, upload, audit and empty/error states following design system. **Done when:** actual browser + HTTP tests prove full synthetic case flow.

## WP-04 — Field mobile and offline (P0)

Expo mobile capture, encrypted local queue, stable device IDs/idempotency, explicit delivery and failed states, re-auth, media permissions. **Done when:** device/airplane-mode/restart tests on iOS and Android pass, original is recovered after outage.

## WP-05 — Document/voice processing (P0)

Quarantined worker, Tika/Docling/OCR/Whisper candidate benchmarks, page/timecode spans, extraction version records. **Done when:** no originals rewritten, malformed/malicious inputs safely fail, correct source links confirmed.

## WP-06 — AI review and claim provenance (P0)

Typed claims, extraction queue, human accept/reject, source passage viewer and report gate. **Done when:** hallucinated/unlinked claim cannot be approved and prompt injection cannot trigger privileged action.

## WP-07 — Report, exhibits and offline verifier (P0)

Build PDF and report model from approved findings, exhibit manifest, receipt and independent hash verification. **Done when:** tampering with document/manifest/event history is detected and valid export verifies without server.

## WP-08 — Client portal and release controls (P0 pilot)

Release-only identity and permissions, approved redaction, share expiration, revocation and disclosure audit. **Done when:** client cannot read internal/unreleased data by link guessing or query variations.

## WP-09 — Research source connector framework (P1)

Adapter policy/terms registry, manual URL capture, official corporate source connectors, rate limiting and provenance. **Done when:** source use is auditable and disabled without approved source policy.

## WP-10 — Intelligence entity/relationship graph (P1)

Case-scoped entities, candidate edges, reviewer confirmation, evidence inspector, layouts and query limits. **Done when:** every displayed edge resolves to records and ambiguous identities are not auto-merged.

## WP-11 — Interview intelligence and domain rules (P1)

Timecoded corrections, interviewer and speaker uncertainty, contradiction suggestions, fraud analysis rules with source links. **Done when:** raw/derived/reviewed transcript distinctions persist and outputs remain suggestions.

## WP-12 — Agency operations, invoicing and enterprise policies (P1/P2)

Dispatch board, budgets, time, subscriptions, SSO and custom retention, with correct audit. **Done when:** tested billing boundaries and admin support access controls.

## WP-13 — Hardened production and adoption (P0 before live customer data)

DPIA/legal/terms review, security assessment, incident response, backup restore, mobile loss scenario, observability/operations and controlled pilot. **Done when:** independent sign-offs and actual evidence are recorded.

## Acceptance template for every PR

- What changes and why; scope/tenant/data-classification impact.
- Repro steps, fixtures and actual test results with environment.
- Threat/privacy and licence/SBOM review, if applicable.
- Positive and negative states; accessibility and mobile test evidence where applicable.
- Open risks, explicit non-goals, migration/rollback plan and no implicit deployment.
