# Focused workflow acceptance — actual results

Base: `d345524f9835dae7a14df6718bed0579e00db8e5`, branch
`feat/portal-workflow-acceptance`. Root owns broad regression and integration.
No production changes, external delivery, new application dependencies, PR or merge.

## Invoice fixture correction (first isolated commit)

Pushed commit: `3374ad75216d673608515df16eda5919bd5e9026`.

Actual PostgreSQL15, disposable database `inveos_test`, loopback port55471;
separate `inveos_admin` and `inveos_app` login roles, neither a superuser.
Application role also has no CREATEDB/CREATEROLE. Every test gets a unique schema.
Existing migrations run unchanged. Existing npm lockfile installed with `npm ci`.

Initial focused baseline (invoice arithmetic, invoice API and handling): **10
checks,8passed,2failed,0skipped**. The invoice recipient test failed at its
`DELETE memberships` fixture statement with23503:
`sessions_tenant_id_user_id_fkey`. The existing recipient session was retained.
The corrected fixture changes that principal's role to `investigator`, removing
recipient eligibility while retaining membership/session/history. No FK,
application authorisation or audit control is relaxed.

Actual isolated rerun:

```sh
INVEOS_TEST_DATABASE_URL=postgres://inveos_app@127.0.0.1:55471/inveos_test \
INVEOS_TEST_ADMIN_DATABASE_URL=postgres://inveos_admin@127.0.0.1:55471/inveos_test \
node --import tsx --test \
  --test-name-pattern='agency declarations and currency/recipient boundaries' \
  apps/api/test/agency-invoicing.test.ts
```

**1passed,0failed,0skipped**, including invalidated recipient eligibility and
rejection of a new declaration. Logs are in ignored
`.local-data/acceptance/baseline.log` and `invoice-fixture-corrected.log`.
The other initial failure was an outdated handling fixture freezing an empty
report; its separate correction and wider acceptance follow in a later commit.

Broader feature acceptance, browser checks and final type/lint validation are
not claimed by this isolated invoice-fixture receipt.


## Composition validation hook (second isolated commit)

Pushed commit: `48cf9fdc188706ac1c35fc2b98a567f043225de9`.

The first actual composition POST stalled until the 45-second test timeout
(`composition-first.log`). Its Fastify `preValidation: strict` function was
synchronous and neither returned a promise nor invoked a callback. Declaring
that hook `async` completes successful validation and preserves thrown validation
errors. This is an application fix, with no schema or authorisation relaxation.

Audited the analogous `restricted-work.ts` factory: its **returned hook is
already async**. No collaborator hook change is needed. Actual collaborator
create, publish, invitation, submission and independent acceptance paths execute
in the added PostgreSQL test.

Actual targeted rerun (same restricted database URLs as above):

```sh
node --import tsx --test --test-concurrency=1 \
  apps/api/test/report-portal-acceptance.test.ts
```

**3 passed, 0 failed, 0 skipped** (`report-portal-second.log`). The composition
case saves and independently accepts an outline, freezes ordered findings and
separate context fields, corrects the outline without changing frozen bytes,
and downloads the actual verification kit. Copied Python scripts execute outside
the checkout with an empty PYTHONPATH: JSON, PDF and DOCX, including whole-finding
redactions, give **5 valid-copy passes and 5 changed-byte/content rejections**.
The other two cases exercise release-bound feedback visibility/resolution and
restricted collaborator acceptance/privacy with current handling denial.

These are API/database and copied-verifier checks; they do not establish native
Office rendering, qualified browser acceptance, provider identity or production
readiness. Wider acceptance is continuing separately.

## Remaining focused acceptance and fixes

The template workflow reproduced the same hook defect: its initial valid POST
waited until the 60-second test timeout (`templates-first.log`). The template
`strict` hook now returns a promise. Typed invalid inputs still return 422;
the actual HTTP check covers composition, template and collaborator validation.
The other source change is the composition hook in the preceding commit. No
shared intake, source-use, creator, session or sharing control was weakened.

The handling test previously attempted to freeze an empty report and received
422. Its fixture now creates actual fictional original bytes, a source-linked
claim and independent review before freezing/releasing. The release handling
assertions stay intact. Root may retain an equivalent fixture correction when
integrating; no report completeness restriction is changed.

The following command executed against the restricted disposable PostgreSQL
with the two exported URLs documented above:

```sh
node --import tsx --test --test-concurrency=1 \
  apps/api/test/agency-invoice-arithmetic.test.ts \
  apps/api/test/agency-invoicing.test.ts \
  apps/api/test/case-handling.test.ts \
  apps/api/test/portal-evidence-acceptance.test.ts \
  apps/api/test/task-template-acceptance.test.ts \
  apps/api/test/report-portal-acceptance.test.ts
```

**21 passed, 0 failed, 0 skipped** (`focused-combined.log`). This is the latest
combined run of those files, not the entire repository suite. It covers:

- Invoice half-up ties, bounded multiplication beyond floating-point-safe
  intermediate values, exact source revisions, source reservation races,
  withdrawal/correction lineage, currency/recipient separation, independent
  review and corrupt export denial.
- Real immutable portal originals at 1, 32769 and 262144 bytes; declared source
  time preserved separately; parallel completion producing one receipt;
  interrupted receipt lookup; mismatched retries and corrupted stored bytes
  denied; chunk cleanup; append-only receipts; no internal identifiers/context
  in the external DTO.
- Other recipient/tenant denial, explicit internal-only handling, removed
  publication/handling reviewer access, stale authority, publication correction,
  expiry and terminal revocation. Read, chunk, completion, cancellation and
  retry paths are checked. Superseded publication receipts remain internal.
- Separate source registration, metadata acceptance and source-use approval;
  wrong receipt reference rejected; no analysis job accepted before those gates;
  recipient response correction requires renewed metadata/review/use, and
  withdrawal blocks further source use. The opaque binary has no text-analysis
  profile; successful parser execution is not claimed.
- Receipt finalisation audit failure rolling back database rows **and stored
  original bytes**; a real blocked case-lock request followed by session
  revocation returning 401 after the lock releases.
- All four template entry types, explicit owner/deadline choices, pinned
  accepted version despite a newer unapproved correction, concurrent retry
  returning one exact application receipt, rollback after the second work
  item's audit failure, stale review/creator access denial and immutable history.
- Shared analysis/template creator integration: actual reviewed source findings
  produce a reviewed analysis follow-up whose initial revision retains both
  source links; subsequent template-created initial revisions remain source-free.
- Composition/verifier, feedback and collaborator paths described above.

Two additional executing checks passed individually:

```sh
node --import tsx --test apps/api/test/invoice-verifier-acceptance.test.ts
node --import tsx --test apps/api/test/workflow-http-privacy.test.ts
```

Each: **1 passed, 0 failed, 0 skipped** (`invoice-verifier.log`,
`http-privacy-second.log`). This makes **23 distinct passing checks** across the
combined run and the two additional runs, not a claimed single 23-test run.
The first copies the standalone invoice verifier outside the checkout, verifies
an actual reviewed API export with the expected digest and exact net=1/tax=1/
total=2 arithmetic, and rejects altered frozen totals. The second uses a real
loopback HTTP listener and fetch (not injection) to check private DTOs,
`Cache-Control: no-store` on successes and errors, origin/CSRF denial, typed
validation, absence of mutations after rejected requests, and revoked-session
read/write denial.

Development failures retained in ignored logs: the first portal run used an
incorrect expected schema status (400; the application's actual validation
contract is 422), and its lock-observation fixture queried restricted
`pg_stat_activity` details. The fixture now observes an actual ungranted
`pg_locks` entry and releases its owned lock in `finally`; the subsequent portal
runs pass. The first HTTP case used an unregistered case-detail GET (404),
corrected to the real internal composition route for its 403 assertion.
Initial API typecheck found an unchecked Buffer index in a tamper test; lint
found an unused browser-test destructuring binding. Both test-only defects were
fixed. No failed run is counted as passed.

## Browser execution gate and remaining limits

Existing lockfile dependencies were installed. PostgreSQL15 and the system
Chromium sandbox package were installed as test tools; no application dependency
was added. The web production build succeeded (`web-build.log`), retaining the
existing large-chunk advisory. Workspace web/contracts/API typechecks (`npm run typecheck`) and focused ESLint
passed after fixing the test-only issues above (`workspace-typecheck.log`,
`composition-lint.log`, `focused-lint-final.log`).

The explicit real browser definition is
`apps/api/test/workflow-browser.integration.ts`. It uses the existing first-party
CDP harness, compiled web assets, a real HTTP API/proxy and the restricted
PostgreSQL fixture. It defines actual recipient file selection/upload/receipt
verification, reload recovery, external DTO/DOM privacy, desktop/narrow layout,
handling denial clearing UI state, separate internal source registration and an
ungranted recipient session. It does not mock API responses.

Actual attempt:

```sh
npm run build -w @inveos/web
INVEOS_CHROME_PATH=/usr/bin/chromium \
node --import tsx --test apps/api/test/workflow-browser.integration.ts
```

**0 passed, 1 failed, 0 skipped**: Chromium could not start with its sandbox.
Installing the system sandbox package did not resolve the host restriction.
Direct sandbox-enabled launch reported:
`Failed to move to new namespace ... errno = Operation not permitted`.
The test reports `Timed out: sandboxed Chrome startup` before any application
navigation (`workflow-browser.log`, `sandbox-browser-3.log`). A preliminary
browser-harness launch opened only about:blank; when its default disabled-sandbox
flag was observed, that browser was immediately closed without loading the app.
No disabled-sandbox acceptance or bypass was performed.

All UI assertions and screenshots in the new browser definition are therefore
**unrun**. Root should execute that command with the two disposable database URLs
on a host permitting Chromium's sandbox. No qualified browser, mobile/offline,
Office-native, provider/SSO, restore/outage or production acceptance is claimed.
Tests use local synthetic session fixtures, not proof of an external identity
provider. This branch remains based on exact d345524f plus its own changes;
root's later quarantine/snapshot/Field integrations require root's combined run.
No full Node/Python suite or shared CI/inventory edit was performed here.
