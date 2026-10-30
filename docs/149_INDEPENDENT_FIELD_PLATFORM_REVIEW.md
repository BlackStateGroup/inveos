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

## Independent inspection conclusions and UI correction

The server correction above was pushed separately as
`a803fea708864796dc2a413489e0434dade30434` for root integration.

Reviewed the actual diff and connected implementation in Field authority,
capture/sync/recovery, sessions/observations, dispatch originals/application,
historical report provenance, restored-case gates/quarantine/CLI, case handling,
cited analysis/shared work creation and desktop batch/chunk intake. Inspected
associated migrations070–072,100–101,116–117,135 and the relevant client/vault
changes. The review does not cover every file in the235-file integration diff.

The inspected implementation keeps tenant/case keys on original/attachment and
request lookups; separates historical source authority from current recovery
acceptance; preserves append-only originals and correction predecessors; binds
independent reviews and explicit task recipients; and performs source/link/work
and audit writes in transactions. Executed tests above confirm the specified
negative/retry/rollback cases. Quarantine's post-lock current-role/recovery read
is retained unchanged. Actual dump/restore execution confirms that a fresh
login alone does not repair restored permissions: quarantine completion, new
authority and fresh handling remain required. No additional server defect was
reproduced within this review scope after the session fixes.

Client inspection checked the case/CSRF keys in App and FieldWorkbench, vault
identity/revision comparisons, authenticated backup inventories, generation
checks on unlock/restore, and original/receipt preservation. Offline local
history intentionally remains retained; server access revocation is not remote
erasure or native hardware attestation.

**UI finding (source-inspected; runtime gate open):** Field Controls' case and
agency-account selectors remained enabled during an in-flight request. Their
change handlers cleared visible state, but an older load could subsequently
populate that state under the newly selected scope. Both selectors are now
disabled while the operation is pending. This is a small correction to the
existing single-operation UI; it adds no new access or delivery mechanism.
The existing case/CSRF component remounts and denial clearing remain intact.

`apps/api/test/independent-field-controls.browser.test.ts` adds a real component,
HTTP and PostgreSQL regression using existing Vite/CDP support. It loads the
actual FieldControls component with a fictional persisted case/session, holds
the real case lock during a grant fetch, checks that both selectors remain
disabled, then removes membership and checks that a fresh denial clears the
retained grant. The isolated component props are fictional fixture inputs; API
responses are real. This is not full app-shell or native acceptance.

Actual attempted command (with the same restricted database URLs):

```sh
INVEOS_TEST_BROWSER=1 INVEOS_CHROME_PATH=/usr/bin/chromium \
node --import tsx --test apps/api/test/independent-field-controls.browser.test.ts
```

**0 passed, 1 failed, 0 skipped** (`browser-attempt.log`): timeout starting
sandboxed Chromium before any application navigation or assertion. This host's
previous direct sandbox diagnostic was `Failed to move to new namespace ...
Operation not permitted`; installing its normal sandbox package did not resolve
that policy. No sandbox disabling, namespace bypass, fake IndexedDB, remote
browser or production action was used. All new UI runtime assertions are
**unrun** and must execute on root's sandbox-capable browser host. The two UI
attribute changes and the browser definition compile and pass scoped lint;
that is not browser acceptance.

## Remaining gates

Root must rerun combined hosted checks after integrating this branch with its
later source-family, Tika, invoice-browser and other changes. This review stays
on exact8d58c956 plus its own commits and does not silently claim inspection of
those later integrations. No whole-product, full-suite, native/offline/device,
provider/SSO or production security approval is given.

The authenticated offline-vault/backup browser definition, end-to-end Field UI,
dispatch/session denied-content rendering, desktop reselection/navigation and
the new Field Controls race definition need qualified real-browser execution.
Historical Field report provenance was source-inspected here; its copied
verifier/render matrix was not independently rerun in this review. Operational
originals in the dispatch module intentionally retain unique orphan objects
on ambiguous/failed storage transactions for operator reconciliation; this
review does not claim automated orphan cleanup or production recovery readiness.

## Final additional checks

After the shared upload transaction change, the existing targeted API regression
also executed against the restricted disposable database:

```sh
node --import tsx --test --test-concurrency=1 \
  --test-name-pattern='^(?!real browser).*(binary|chunk|upload)' \
  apps/api/test/api.test.ts
```

**18 passed, 0 failed, 0 skipped** (`shared-upload-regression.log`,12.659s).
Includes exact binary/original persistence, text-claim separation, tenant/owner/
CSRF/expiry/quota denial, atomic original rollback, actual lost HTTP completion,
actual chunk-client restart/replay, cancellation/history and lifecycle fences.
No existing shared test file or inventory was edited for this command.

`npm run typecheck` passed for web/contracts/API (`final-workspace-types.log`).
Scoped ESLint passed for every changed API/UI file and both new test files;
`git diff --check` passed. Earlier setup attempts to restart the owned disposable
cluster without its loopback/socket options failed on the default socket path;
the correct explicit options restored only the owned test cluster. An initial
local edit script had an indentation error before changing any files. Neither
setup failure is represented as an application test pass.
