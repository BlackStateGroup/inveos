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

## Browser execution gate

The focused browser definitions are delivered separately from the reproduced
route fix. **No browser journey was executed locally.** Root explicitly forbids
another local Chrome attempt and owns hosted execution and render inspection.
Compiler and PostgreSQL successes are not browser passes. Full regression,
expiry timers, real providers, native devices, restore operations and production
readiness are not claimed.
