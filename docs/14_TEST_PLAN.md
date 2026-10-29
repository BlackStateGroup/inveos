# 14 — Verification and acceptance plan

Do not declare tests green without command, revision, runtime, input fixture, count, failures and environment evidence. The merged local synthetic application has real PostgreSQL/API and recorded browser verification; see [the 26 October receipt](23_LOCAL_APPLICATION.md#local-verification--26-october-2026). Those results cover the bounded text-only lab, not the complete product. PR #2's synthetic derivative-contract tests belong to its unmerged revision, not to main.

The main end-to-end acceptance target is [SYN-SUPPLIER-001](24_DELIVERY_PLAN.md#first-milestone--syn-supplier-001): intake through investigator-approved client delivery with a package that verifies independently. Its corpus must include digital/scanned records, contradictory ownership/date assertions, repeated names and misleading instructions inside sources. Include poor recordings as transcription work is introduced. Report citation correctness, missing/incorrect extraction, mistaken entity matches and unsupported conclusions separately from test pass counts.

## Continuous integration baseline

[Checks](../.github/workflows/checks.yml) runs on pull requests, pushes to main and manual dispatch. It uses the committed npm lockfile, Node 22/Python 3.11, a disposable PostgreSQL 15 service and a restricted `inveos_app` role. Lint, all workspace type checks, web build, Python source validation/tests, the synthetic reference and real-database API tests must pass without a private `.env` or production credentials. Actions are pinned to revisions; the workflow has read-only repository access and does not deploy.

The API suite uses HTTP injection against Fastify plus a real database and filesystem. This is not a browser or network transport test. It covers the persisted workflow, selected tenant/case/role denials, invalid scope/input/digests, concurrent/replayed uploads and review decisions, source mutation and session revocation. Keep browser, native-device, worker isolation, restore and production security results separate. Adding the workflow does not prove a hosted run or complete WP-00; record actual run results in a verification receipt. Secret scanning remains outstanding.

## Verification receipt — 27 October 2026

Code/workflow revision: `f8080132657ed6a890e1b4ba0ffa43b91b40fe16` in [draft PR #3](https://github.com/BlackStateGroup/inveos/pull/3). Later receipt-only documentation does not change the tested workflow or API test code.

| Environment / check | Observed result |
|---|---|
| Local Debian 12 ARM64; Node 24.22.1, npm 11.19.1, Python 3.11.2, PostgreSQL 15.19 | Locked install, lint, all workspace type checks and web build passed |
| `npm run test:foundation` | Source validator and 13 Python tests passed; original archive hashes are not re-certified |
| `python3 -m examples.evidence_flow_demo` | Synthetic original-byte and event-chain checks passed; in-memory reference only |
| `npm test --workspace @inveos/api` with explicit test URLs | 7 API tests passed against a fresh local `inveos_test`; restricted application role had no superuser/create-role/create-database/RLS-bypass privileges |
| `node --import tsx --test --test-concurrency=1 apps/api/test/api.test.ts` from repository root | Same 7 API tests passed, proving both invocation locations after the fixture-path fix |
| actionlint 1.7.12; `git diff --check` | Passed; downloaded actionlint release archive matched its published SHA-256 |
| [Hosted Checks run #1](https://github.com/BlackStateGroup/inveos/actions/runs/40482566496), Ubuntu 24.04 x64, Node 22.23.3/npm 10.9.9, Python 3.11.17, PostgreSQL 15.19 | All job steps passed, including 13 Python tests, 7 real-database API tests and clean tracked sources |

The initial workspace invocation reproduced a fixture lookup failure after 6 of 7 API tests passed: it searched `apps/api/apps/api/fixtures/fictional_supplier_note.txt`. Resolving the fixture from `import.meta.url` fixed it. Inputs are generated fictional cases and the existing labelled synthetic text fixture; tests remove their schemas/object roots. The temporary local database was stopped after verification.

The isolation probe `unshare --user --map-root-user --net true` failed with `Operation not permitted`. PDF/OCR parsing, worker benchmarks, new browser checks, iOS/Android, outage, restore and production security assessment were not run. These results do not complete the supplier milestone, the other WP-00 gates or any live-data readiness gate. Existing rights-reserved licensing applies; the CI database credentials are disposable fictional configuration, not operational secrets.

## Test layers

- **Schema/unit:** validation, state-machine transitions, idempotency, permissions, licence inventory checks, canonical hashes.
- **Database/integration:** transaction/outbox atomicity, RLS, tenant/case scope, custody ledger, referential constraints, rollback and migrations.
- **API:** positive and denied requests for every resource, rate limits, token revocation, pagination, concurrency and repeated retries.
- **Storage:** chunk loss, duplicate chunks, corrupted bytes, early `complete`, quota breach, malware, invalid media, cross-tenant object URL.
- **Field mobile/device:** airplane mode, app restart, OS kill, disk pressure, battery loss, bad time zones, time skew, token expiry, assignment revocation, repeated sync, iOS/Android OS limitations.
- **Document/AI:** scanned PDFs, OCR noise, malformed files, conflicting statements, citation accuracy, model leak tests, prompt injection, unavailable model, unsupported finding gates.
- **Graph:** false entity matches, redacted edges, stale source, relation without backing evidence blocked, confirmation/rejection audit.
- **Reports/portal:** withheld internal content, export citation integrity, redaction leak, revoked share, concurrent approval, verifier independent run.
- **Operational:** restore to separate account, backup checksum, rotation, region failover, audit access controls, log scrubbing and DPA compliance.

## Non-negotiable acceptance cases

| ID | Scenario | Must happen |
|---|---|---|
| TEN-01 | User in tenant A knows case ID in tenant B | `403/404`, no metadata, bytes, search, embeddings or timing leak |
| EVI-01 | One byte altered after intake | Export/verification fails and reports exact mismatched exhibit |
| EVI-02 | One custody record removed or reordered | Chain verifier identifies break |
| EVI-03 | Same media sent twice after lost receipt | One canonical original plus two historically accurate acquisition records if applicable |
| MOB-01 | Offline capture, app force-kill, reboot and reconnect | Original persists encrypted; exact upload and receipt status preserved |
| MOB-02 | Local device time incorrect | Claimed device and independent receipt times separate in UI/export |
| AI-01 | AI suggests finding without supporting source span | Block final approval; visible unsupported warning |
| AI-02 | Malicious source PDF instructs exfiltration | No tool action, no outbound data, event logged |
| GRAPH-01 | Similar names but distinct company numbers | Automatic merge rejected; analyst sees evidence of conflict |
| PORT-01 | Client guesses URL for draft exhibit | Access denied and audited |
| REL-01 | Approved report cites unverified file | Release blocked; no partial publication |
| HOLD-01 | Scheduled deletion while legal hold active | No deletion; hold/action logged |
| RESTORE-01 | Primary database/object store recovery simulation | Valid originals and custody recover with documented RPO/RTO |

## Pilot observation metrics

- Case completion time (baseline versus pilot), field transcription edit time, report drafting/review time.
- Lost/duplicate upload count, mean upload receipt latency, offline failure recovery and evidence integrity check pass rate.
- Hallucinated or unsupported AI claim incidence and citation correctness measured by human reviewers.
- Number of client disclosure corrections, security incidents, unjustified access events and privacy complaints.

## Research dependency tests

Open-source candidates enter the app only with a pinned release/commit, SPDX plus full licence review, transitive dependency SBOM, upstream security posture, integration PoC and maintenance/compatibility verdict.
