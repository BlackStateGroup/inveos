# Independent Field and platform review

Inspected integration: `8d58c956a84e9f2dc1e2b4dd07fd683c56229750`.
Independent branch: `review/field-platform-boundaries`, created at that exact
commit. Inspected `origin/main...8d58c956`; main and merge base were both
`ca899421bcd8c183eb645fc62ff20b9c57ca64bc`. This is a focused review of work by
other implementation agents, not approval of the whole PR or production use.
Root owns integration and PR117. No CI, central handoff/index, migrations,
dependencies, outside delivery or production changes.

## Reproduced finding: session revocation during transaction waits

**Priority: high.** Initial authentication was not repeated at the transaction
boundary in Field/device/session/dispatch controls, handling, analysis reads,
initial Field intake and the desktop metadata/upload paths. Case membership
checks do not substitute for a still-current authenticated session.

Actual restricted PostgreSQL reproductions held a case/device row or an audit
advisory lock, observed the request actually waiting in `pg_locks`, revoked only
that synthetic session, then released the lock. Field sessions, dispatch options,
recovery history, current Field context, handling and analysis content returned
200 after revocation. A device-state decision and initial Field original also
returned 200. A separate late-audit test reproduced desktop manifest/handling
writes returning 200 after revocation. A further test reproduced an upload
reservation returning 200 after the case-lock wait.

The fix mandatorily injects the existing `assertCurrentSession` helper into the
reviewed modules. Each transaction checks it before work and again before
commit/return, including historical retries. The helper retains its current
role, expiry, revocation, epoch and identity/profile checks. The shared original
intake and completed-upload receipt callback also check it. Intake rollback
still removes only its newly written object. Argument positions for Field
recovery and restricted recipient permits remain unchanged. Operator quarantine
has no HTTP session and retains its existing current-reviewer/quiescence gates;
its trusted CLI actor is not made into an application-session bypass.

No identity, membership, sharing, original or receipt format was relaxed.

## Executed database evidence for the first fix commit

Existing lockfile installed using `npm ci --ignore-scripts --no-audit --no-fund`.
PostgreSQL15.19 runs only on loopback55471 in a disposable `inveos_test` database.
`inveos_admin` and `inveos_app` are non-superuser roles; application role has no
CREATEDB/CREATEROLE. Tests apply unchanged migrations to fresh random schemas.
All session/data fixtures are explicitly fictional. Logs are ignored local
artifacts under `.local-data/review/`.

Export these two URLs for the following commands:

```sh
export INVEOS_TEST_DATABASE_URL=postgres://inveos_app@127.0.0.1:55471/inveos_test
export INVEOS_TEST_ADMIN_DATABASE_URL=postgres://inveos_admin@127.0.0.1:55471/inveos_test
```

New executing regression: `apps/api/test/independent-session-boundaries.test.ts`.
Initial runs: **2 failed** (`session-baseline.log`), **1 failed**
(`audit-race-baseline.log`), **1 failed** (`upload-session-baseline.log`). These
are reproduced application failures, not fixture-status substitutions. The
first corrected three-test run passed (`session-fixed.log`). The intake case
was then strengthened to revoke during its final audit after the object write,
assert zero accepted evidence/audit and an empty original directory, and verify
that a fresh-session retry accepts the unchanged bytes.

```sh
node --import tsx --test --test-concurrency=1 \
  apps/api/test/independent-session-boundaries.test.ts \
  apps/api/test/field-device-recovery.test.ts \
  apps/api/test/field-sessions.test.ts \
  apps/api/test/field-dispatch.test.ts \
  apps/api/test/restored-case-quarantine.test.ts \
  apps/api/test/case-handling.test.ts \
  apps/api/test/portal-evidence-acceptance.test.ts
```

**32 passed, 0 failed, 0 skipped** (`combined-focused.log`,93.726s), before the
additional upload-staging regression/fix. This includes actual `pg_dump` /
schema drop / `pg_restore`, all three queue-family retirement gates, recovery
reopen/new-authority/fresh-handling requirements, actual lost HTTP response
recovery, independent recovery/context review, exact original/correction
lineage, dispatch recipient/task/device boundaries, session attachment/audit
rollback, handling release denial, analysis follow-up atomicity, desktop HTTP
chunk recovery and portal source-use/session fences.

After extending the fix to shared desktop upload staging:

```sh
node --import tsx --test --test-concurrency=1 \
  apps/api/test/independent-session-boundaries.test.ts \
  apps/api/test/case-handling.test.ts \
  apps/api/test/portal-evidence-acceptance.test.ts
```

**17 passed, 0 failed, 0 skipped** (`desktop-final.log`,53.095s). The new fourth
regression checks reservation/chunk/cancellation/status denial after revocation,
no lost retained staging on denied cancellation, and successful exact completion
retry with a current session. Counts overlap; these are **33 distinct passing
checks**, not49 independent checks or a full repository run.

API compilation and scoped ESLint passed. Final review scope, remaining UI
execution gates and any additional checks will be recorded separately after
this reproduced server fix is published for root integration.
