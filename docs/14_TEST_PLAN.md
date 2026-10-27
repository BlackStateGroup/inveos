# 14 — Verification and acceptance plan

Do not declare tests green without command, revision, runtime, input fixture, count, failures and environment evidence. The merged local synthetic application has real PostgreSQL/API and recorded browser verification; see [the 26 October receipt](23_LOCAL_APPLICATION.md#local-verification--26-october-2026). Those results cover the bounded text-only lab, not the complete product. PR #2's synthetic derivative-contract tests belong to its unmerged revision, not to main.

The main end-to-end acceptance target is [SYN-SUPPLIER-001](24_DELIVERY_PLAN.md#first-milestone--syn-supplier-001): intake through investigator-approved client delivery with a package that verifies independently. Its corpus must include digital/scanned records, contradictory ownership/date assertions, repeated names and misleading instructions inside sources. Include poor recordings as transcription work is introduced. Report citation correctness, missing/incorrect extraction, mistaken entity matches and unsupported conclusions separately from test pass counts.

## Continuous integration baseline

[Checks](../.github/workflows/checks.yml) runs on pull requests, pushes to main and manual dispatch. It uses the committed npm lockfile, Node 22/Python 3.11, a disposable PostgreSQL 15 service and a restricted `inveos_app` role. Lint, all workspace type checks, web build, Python source validation/tests, the synthetic reference and real-database API tests must pass without a private `.env` or production credentials. Actions are pinned to revisions; the workflow has read-only repository access and does not deploy.

The API suite uses HTTP injection against Fastify plus a real database and filesystem. This is not a browser or network transport test. It covers the persisted workflow, selected tenant/case/role denials, invalid scope/input/digests, concurrent/replayed uploads and review decisions, source mutation and session revocation. Keep browser, native-device, worker isolation, restore and production security results separate. Adding the workflow does not prove a hosted run or complete WP-00; record actual run results in a verification receipt. Secret scanning remains outstanding.

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
