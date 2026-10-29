# 21 — Agent-ready engineering work packages

Deliver each bounded slice as a separate draft pull request with tests and evidence. Prefer narrowly scoped work, clean integration and no change to production by default. The merged synthetic application partially implements several packages; it does not complete their production exit gates. Use the [delivery plan and capability ledger](24_DELIVERY_PLAN.md) for the complete scope, milestone and evidence states.

The current execution order and verified status are maintained in the [canonical remaining delivery plan](71_REMAINING_DELIVERY_PLAN.md) and [current handoff](../BUILD_HANDOFF.md). The dated reconciled baseline below is historical; use the later exact receipts rather than treating its old draft labels as current.

## Reconciled baseline — 27 October 2026

PR #1 (`95b5c35`) is merged. PR #2 (`36081f1`) is a separate draft research slice; do not count its contract as a running parser or as merged application code. No deployment or pilot acceptance is claimed.

| Package | Implemented slice | Remaining gate |
|---|---|---|
| WP-00 | TS workspaces, lockfile, schemas/contracts, migrations, lint/type/build commands, database harness and passing hosted CI in PR #3 | Secret scanning and remaining scaffold/policy checks; see the [CI receipt](14_TEST_PLAN.md#verification-receipt--27-october-2026) |
| WP-01 | Synthetic case/authority, demo session and selected role/tenant/case denials | Real identity/MFA, invitations, membership administration and full resource isolation |
| WP-02 | UTF-8 original intake, digests, local store, audit and idempotency | Encrypted object storage, binary/resumable intake, quarantine, holds and recovery |
| WP-03 | Persistent case/evidence/manual-review workflow plus versioned objectives, questions, tasks, notes, owners/deadlines and casework search | Real identity, richer brief/chronology/search and production acceptance; see the [casework receipt](evals/2026-10-27-casework.md) |
| WP-04 | Memory-only Field preview | Entire native encrypted/offline/device gate |
| WP-05 | Planned on main; PR #2 has research and synthetic provenance contract | Isolated parser benchmark, durable worker integration and citation lineage |
| WP-06 | Manual source-linked claims, separate review/finding records and approval gate | Actual AI/extraction service, evaluations, case Q&A and permission-scoped assistance |
| WP-07 | Internal JSON draft, complete branded browser print view, offline original/span verifier and export fingerprint | Canonical PDF/DOCX generation, frozen report versions, redaction, signed packages and release; JSON verifier does not certify printed PDF content |
| WP-08 | Fixed fictional portal preview | Operational release dataset, client identity, approval, expiry/revocation and acknowledgement |
| WP-09–WP-12 | Illustrative source/graph/interview/admin surfaces | Operational source, graph, interview and agency acceptance gates |
| WP-13 | Quiesced PostgreSQL restore/session-generation checks and encrypted original recovery; scoped worker retirement under verification (docs/84) | Off-site/PITR/live-backup and provider recovery, production operations, independent security/privacy evidence and pilot sign-off |
| WP-14 | Local versioned questions/hypotheses with supporting/contrary links, reverified source assessments and auditable decisions | Production identity/storage and wider reasoning validation |
| WP-15–WP-16 | Source chronology preserves original offsets; saved alleged accounts/uncertainty, typed sources, immutable corrections and frozen export verification in the verified [chronology increment](82_EVIDENTIAL_CHRONOLOGY.md); casework search and responsive forms | Chronology/browser acceptance passed at `d2638b3`; case search/private view acceptance passed at `09bf99c` ([docs/85](85_CASE_SEARCH_VIEWS.md)). Raw-document/richer-facet search, bulk actions, interview/observation inputs and representative large-case measurements |
| WP-17 | Persistent tasks/ownership/deadlines and recipient-acknowledged handovers | Internal work comments/mentions implemented in docs/86 with hosted acceptance in the handoff; contractor policy, preferences/queues/workload, broader notifications and production identity remain open |
| WP-18 | Planned customer-validation work | Actual interviews, approved pilots and measured acceptance |

PR #3 implements and tests the WP-00 CI slice without selecting production identity/storage providers or merging PR #2. Remaining WP-00 work includes secret scanning; the next application slices are WP-01 real identity/access and WP-02 encrypted storage after their provider/region decisions. Research worker execution remains gated on a host with proven isolation.

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

Extend incrementally to cited summaries, candidate entities/events/amounts, permitted case Q&A, account comparison, possible contradictions, suggested missing material/questions/research and report drafting from reviewed findings. Every output remains a suggestion with inspectable support and limits; a source's assertion is not proof of its truth. Keep the working manual review loop while introducing AI.

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

## WP-14 — Investigation questions and reasoning (P0 minimal for supplier milestone; P1 full)

Persist questions, competing hypotheses, supporting/contrary evidence references, uncertain or unresolved checks, owners and review history. No hypothesis or AI suggestion becomes a finding automatically. **Done when:** the supplier case records the ownership discrepancy and alternative explanations; cited evidence opens in context; closure requires an auditable investigator decision and permissions deny unrelated cases.

## WP-15 — Evidential chronology (P0 basic; P1 advanced)

Persist observations, correspondence, source records and interviews as searchable events. Keep alleged event time, source-recorded time, receipt time and processing/render time distinct. Support approximate ranges, original timezone/precision, competing accounts and corrections. **Done when:** contradictory/uncertain dates remain visible in the timeline and export without invented ordering or precision.

## WP-16 — Interface depth and case search (P0 core; P1 advanced)

Implement case-scoped search/filtering, saved views, bulk actions, keyboard use, robust loading/empty/error/retry states and side-by-side original/source review. **Done when:** real browser tests cover representative large cases and long documents, permissions apply to search and bulk actions, and investigators can find and review the cited material without losing case context.

## WP-17 — Team collaboration (P0 assignments/review; P1 richer coordination)

Persist ownership, deadlines, tasks, comments, mentions, review queues, handovers and workload. Notify on meaningful deadlines, failed uploads and pending approvals; provide preferences. **Done when:** a contractor sees only assigned work, handovers survive reload, revoked users receive no case notifications and every unresolved question/review has a visible owner or unassigned state.

## WP-18 — Customer and commercial validation (P0 discovery; no demand claim)

Test corporate due diligence and internal investigations as the first market hypothesis. Observe existing workflows, interview users, recruit a small approved pilot and validate willingness to pay, onboarding, templates and support. Measure storage/processing costs before fixing allowances/pricing. **Done when:** evidence supports the first segment/offer and pilot users complete the agreed case; no invented interviews, commitments or acceptance.

## How to select the next slice

Use the [delivery plan](24_DELIVERY_PLAN.md): select the next dependency-ready slice, state its exit test, implement it, run relevant positive/negative checks and produce a draft PR. Record implementation, testing, deployment and pilot acceptance separately with exact revisions. A blocker requires a concrete next action; a research slice needs a measured experiment and explicit integration decision as its exit. Preserve the no-production/no-automatic-merge boundaries.

## Acceptance template for every PR

- What changes and why; scope/tenant/data-classification impact.
- Repro steps, fixtures and actual test results with environment.
- Threat/privacy and licence/SBOM review, if applicable.
- Positive and negative states; accessibility and mobile test evidence where applicable.
- Open risks, explicit non-goals, migration/rollback plan and no implicit deployment.
