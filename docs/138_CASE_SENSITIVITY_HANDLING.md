# Case sensitivity and handling decisions

Implementation on `feat/platform-build-batch`; migration115. Runtime acceptance is **unrun**. This implements the missing P0 case sensitivity tier and an explicit current sharing restriction. It is not a legal classification, encryption policy or production readiness claim.

## Behaviour

Case reviewers record append-only `standard`, `sensitive` or `restricted` labels, handling instructions, reason and a separate sharing setting. An unassessed case remains visibly unassessed and preserves its existing release controls. Labels alone do not alter access. `internal_only` prevents new recipient releases and existing recipient access; `existing_release_controls` still requires all existing independent report/copy reviews, recipient grants, expiry, source-use and current authority checks. Re-enabling a still-current grant restores its prior access; it does not create a new grant, reset expiry or remove revocations.

The declaration binds the exact current authority. Enabling sharing requires an active approved case and an assigned reviewer. If that authority changes or the authorising reviewer loses their case role, sharing remains blocked until a fresh decision. Internal-only restrictions continue to block regardless of later authority or membership changes. Reviewers may impose that restriction during intake, closure or other paused states. The final bounded version1000 is reserved for internal-only use.

No originals, prior decisions, report bytes, release records or custody entries are replaced. The handling decision is an operational access rule, not a retroactive statement embedded in historical reports. Internal originals and reports remain subject to their existing membership/source-use rules. These controls cannot retract copies already downloaded or enforce free-text instructions outside the application.

## Integration

- GET/POST `/api/cases/:caseId/handling`: case lock, current server membership, expected handling and authority versions, stable actor-bound request identity, immutable history, per-record SHA-256 and audit within the transaction.
- Database sequential insert/current-reviewer guards and append-only update/delete trigger; restricted application role receives SELECT/INSERT only. History pages contain25 records, at most1000 versions.
- Shared source-use release gate covers JSON, document packages, PDF and DOCX release creation and delivery, including feedback's exact-release loader. Existing portal eligibility also excludes current internal-only/stale decisions from discovery, acknowledgement and feedback. Recipient downloads acquire the case lock before rechecking policy and current client membership.
- Case brief exposes current instructions, sharing state and decision history. Failed access clears retained form/history context. No classification instructions are sent to recipients.
- Restricted collaborator work is a concurrent feature; root must wire `assertCaseSharing` into its publication/external scope after integration. Do not claim that unintegrated route is covered yet.

## Source and privacy decisions

First-party implementation using existing Fastify/PostgreSQL/React dependencies; no new upstream code or dependency. Instructions/reasons can contain sensitive case context and remain internal. Audit metadata records version, tier, sharing and digest rather than the instructions. SHA-256 detects consistency errors; it is not identity attestation or evidence admissibility.

## Verification and remaining work

`npm run typecheck` passes across web/contracts/API (`/tmp/inveos-case-handling-compile.log`). No migration, SQL trigger, API, browser, export or broad regression acceptance has run. This compiler receipt cannot establish current-access correctness.

After the connected feature build, add/run actual PostgreSQL/API checks for actor/case/tenant denial, stale authority/version, retry identity conflicts, transaction/audit rollback, immutable rows, history bounds, concurrent update, removal of authorising reviewer and final-version restriction. Exercise all four actual release formats and portal list/download/acknowledgement/feedback after restriction and re-enabling, including stale grants, revoked memberships and historical frozen-byte parity. Add actual browser create/reload/conflict/history/access-clearing checks and inspect desktop/narrow renders. Wire and test collaborator controls. Record failed and successful runs separately.
