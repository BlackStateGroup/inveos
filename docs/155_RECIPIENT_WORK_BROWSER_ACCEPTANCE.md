# Recipient feedback and restricted collaborator acceptance

Inspected base: `1d80e3fd8453128a4ca4c15c33d8b9578dad3442`, fetched from
`origin/feat/platform-build-batch`. Independent branch:
`test/recipient-collaborator-browser`. All data is fictional. No new dependency,
provider activation, external delivery, production action, merge, PR, CI, shared
`api.test.ts`, central handoff or INDEX edit is included.

The implementation review covered `PortalFeedback.tsx`, `RecipientPortal.tsx`,
`RestrictedWork.tsx`, their API modules, the shared disclosure/acknowledgement
routes, case handling, public contracts and the existing real workflow fixture.
Docs128 and137 describe the implemented gates; their historical build-phase
unrun lists are not treated as current execution evidence.

## Reproduced acknowledgement defect and narrow fix

`POST /api/portal/disclosures/:disclosureId/acknowledge` authenticated before
waiting for its case lock but did not recheck the session inside the transaction.
A request from a session revoked during that wait still returned **200** and
recorded acknowledgement. The same race existed during the final audit insert.

The only product change is two calls to the existing `assertCurrentSession` in
`apps/api/src/app.ts`: after acquiring the case lock and immediately before the
acknowledgement transaction returns. Current session, expiry/epoch, membership
role and existing provider-binding checks are reused. No FK, permission,
disclosure policy, immutable receipt or original-byte control is relaxed.

The new support regression uses a real PostgreSQL case-row lock, then a separate
advisory lock in a fixture-only audit trigger. It confirms the API is waiting on
the exact owned backend using `pg_blocking_pids`, revokes the specific session,
then releases the lock. This is not a timer-only request race or mocked database.

Observed execution:

- Baseline: **0 pass / 1 fail**, expected401, actual200 after the case-lock wait.
  Log `.local-data/recipient-work-review/ack-race-before.log` (ignored).
- With only the post-lock check: **0 pass / 1 fail**, expected401, actual200 during
  the final audit write. Log `ack-race-intermediate.log` in the same directory.
- With both checks: **3 pass / 0 fail / 0 skipped** in 8.781 seconds for the full
  new support file. The race check verifies zero acknowledgement and audit rows
  after both denials, a valid fresh-session retry, one stable receipt/audit on
  repeated success, and denial of a retained-receipt retry from a revoked session.
  Log `fixture-contracts-fixed.log` in the same directory.

The other two support checks execute the new fixture contracts against actual
restricted PostgreSQL through Fastify injection:

- Independently approved PDF with distinct report/copy hashes; wrong hash and
  wrong recipient denied; corrected request and independent response publication;
  hidden internal draft/review data; stale response cannot resolve newer request
  text; release revocation fences history and retries; original copy unchanged.
- Saved task/draft grant; independent publication; a second instruction version
  requires new acknowledgement; stale acknowledgement and submission denied;
  accepted submission does not complete the task or add membership; public DTOs
  omit private task IDs/body/fingerprint and review reasons; handling, session and
  grant revocation fence reads/writes/retries while internal history is retained.

Reproduction and final support command (restricted disposable database only):

```sh
INVEOS_TEST_DATABASE_URL=postgres://inveos_app@127.0.0.1:55471/inveos_test \
INVEOS_TEST_ADMIN_DATABASE_URL=postgres://inveos_admin@127.0.0.1:55471/inveos_test \
node --import tsx --test --test-concurrency=1 \
  apps/api/test/support/recipient-work-fixtures.test.ts
```

Use `--test-name-pattern='^recipient acknowledgement'` before the file argument
for the isolated race. Every fixture migrates and removes its own random schema
and temporary original storage. The application role is nonsuperuser without
database/role creation privileges; the schema owner is separate.

The API TypeScript compiler, scoped ESLint including the changed app route and
new browser/support files, and `git diff --check` passed after the fix. Two existing
focused feedback/collaborator workflows also passed (2 pass / 0 fail / 0 skipped,
6.893 seconds) before the narrow acknowledgement correction. Their command was:

```sh
INVEOS_TEST_DATABASE_URL=postgres://inveos_app@127.0.0.1:55471/inveos_test \
INVEOS_TEST_ADMIN_DATABASE_URL=postgres://inveos_admin@127.0.0.1:55471/inveos_test \
node --import tsx --test --test-concurrency=1 \
  --test-name-pattern='^(portal feedback|restricted collaborator)' \
  apps/api/test/report-portal-acceptance.test.ts
```

`npm ci --ignore-scripts --no-audit --no-fund` installed the existing lockfile.
`npm run build -w @inveos/web` passed, with the existing large-bundle Vite warning.
That build predates the API-only acknowledgement fix; no web product file changed.

After the fix, the existing real HTTP acknowledgement checks also completed:
**3 pass / 0 fail / 0 skipped**, 5.588 seconds. They cover exact fingerprints,
restart/retry, scope/role/CSRF/origin/attestation denials, audit rollback, foreign
tenants, expired grants and corrupted snapshots. No shared test file was edited.

```sh
INVEOS_TEST_DATABASE_URL=postgres://inveos_app@127.0.0.1:55471/inveos_test \
INVEOS_TEST_ADMIN_DATABASE_URL=postgres://inveos_admin@127.0.0.1:55471/inveos_test \
node --import tsx --test --test-concurrency=1 \
  --test-name-pattern='^(recipient acknowledgement|acknowledgements fail closed)' \
  apps/api/test/api.test.ts
```

Log: `.local-data/recipient-work-review/existing-ack-http-fixed.log` (ignored).
Together with the new support file, this is six distinct focused checks passing
after the fix. Compiler/scoped lint/whitespace checks passed again for the final
browser definitions. These counts contain no browser test execution.

## Browser execution gate

The route fix and its executing tests were pushed separately as
`fe80f8cd2362778c73ecbc9692457326e5c66f36`. The subsequent browser definition is
`apps/api/test/recipient-work-browser.integration.ts`; its dedicated support is
`apps/api/test/support/recipient-work-browser.ts` and the fixture files above.
Root owns adding explicit hosted commands; no shared inventory or CI file changed.

**No browser journey was executed locally.** Root explicitly forbids another
local Chrome attempt and owns hosted execution and render inspection. Compiler
and PostgreSQL successes are not browser passes. No synthetic route, mocked
response, React-state injection, skipped-browser success or sandbox fallback is
used. The launcher fails if sandboxed Chrome is unavailable. Missing database
configuration or built web assets also fails the explicit journeys.

The helper serves the built application, forwards actual HTTP to the real API,
and reuses `workflowFixture` with actual isolated PostgreSQL and original storage.
It switches fixture sessions through cookies and a new document between roles;
browser forms use visible controls, mouse input, text insertion and native select
keyboard events. Checkbox actions establish checked state rather than invert an
already checked acknowledgement retained by the current collaborator form. They
do not claim a separate fresh-checkbox consent gate beyond the current product.

### Defined feedback journey — UNRUN

- Fixture setup creates one frozen report/PDF, rejects author self-review, records
  independent exact-copy acceptance and creates one explicit recipient grant.
  It then adds an unreleased finding with private marker text. Release creation
  is setup through real APIs, not a browser claim for the release workbench.
- An unrelated recipient sees no release and cannot fetch its identifier. The
  intended recipient verifies/downloads and acknowledges the exact PDF through
  the portal. The persisted acknowledgement must name the recipient/copy digest.
- The recipient creates and corrects a release-scoped change request, retaining
  both versions and the separate report/copy fingerprints.
- Investigator saves a response draft, which is absent from recipient DTO and
  page; investigator corrects it. Independent reviewer opens the exact proposed
  digest and publishes it. Only the approved response and public correction reason
  reach the recipient; private review reason and unreleased source markers do not.
- Recipient resolves and reopens explicitly, inspects four immutable request
  revisions and the one published response. The released PDF is byte-identical.
- Revocation occurs through the real internal API while the feedback is loaded.
  Refresh must clear the entire portal's loaded request, histories, response and
  release identifiers/digests; server access is denied and database history stays.

### Defined collaborator journey — UNRUN

- Fixture setup creates an open saved internal task and private draft grant.
  Neither draft nor task context appears externally. The author cannot publish;
  a distinct reviewer publishes instructions through the internal UI.
- Only the named recipient sees the assignment, acknowledges its exact publication
  and records progress/submission. It acquires no case membership and does not
  complete the internal task.
- Investigator corrects/rebinds instructions through the UI. The draft leaves
  the prior publication unchanged. Independent publication of v2 resets invitation
  acceptance; old-publication acknowledgement is rejected and new acknowledgement
  is required before submission.
- Reviewer requests changes with separate public feedback/private reason; the
  recipient corrects its submission; reviewer accepts that exact record. External
  UI/history/DTOs omit internal task identifiers, private snapshot digest, actors,
  private reasons and task body. Acceptance still leaves the internal task open.
- Explicit `internal_only` handling while the recipient page is loaded denies
  access and refresh clears instructions, submissions, feedback and history.
  A fresh enabling handling decision restores access. Terminal grant revocation
  then clears the loaded content again while retaining immutable internal records.

The definitions capture desktop1440×1000 and narrow390×844 PNGs under ignored
`output/evals/recipient-work/` and assert no document horizontal overflow. Browser
downloads use that directory's `downloads/` subdirectory. On journey failure,
best-effort screenshot and rendered-page diagnostics are retained without dumping
cookies/tokens/storage. Root must inspect actual hosted images; merely producing
screenshots is not visual acceptance. No local render artifacts are claimed.

Hosted browser command after configuring a sandbox-capable Chrome and restricted
disposable PostgreSQL (the same URL variables as above, with the runner's port):

```sh
npm run build -w @inveos/web
node --import tsx --test --test-concurrency=1 \
  apps/api/test/recipient-work-browser.integration.ts
```

There is no `INVEOS_TEST_BROWSER` skip flag in this explicit file. Root may select
its existing Chrome via `INVEOS_CHROME_PATH`; no sandbox-disabling option is added.

## Remaining gates

Both browser journeys, screenshots, keyboard/select behavior and responsive
rendering remain **unrun**. The narrow negative assertions exercise explicit
refresh after policy/revocation, not real-time cross-tab erasure or recall of
previously downloaded files. Grant/disclosure expiry timers, browser session
revocation during an in-flight response, offline/lost-response browser recovery,
multi-tab races, every finding family, copied-verifier/Office rendering and full
regression remain separate gates. New grant drafting with date pickers and
initial report/copy release controls are fixture setup here, not browser coverage.
Real providers, native devices, restore operations and production readiness are
not claimed.
