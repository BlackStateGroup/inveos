# Quiesced synthetic database and original-store restore

28 October 2026. Adds a real PostgreSQL dump/restore acceptance scenario to the existing integration suite. This is a disposable lab recovery experiment, not a production backup utility or disaster-recovery sign-off.

The scenario creates its own `api_test_restore_<random UUID>` schema and private temporary original/backup directories. It uses the existing API to approve a fictional case, register an original, review a source-linked finding and freeze a report. It retains authority, audit and migration records, exact original/report bytes and the report's trusted digest.

All API/pool writers for that schema stop before `pg_dump --format=custom` and the original-store copy. The test drops only its generated schema and removes only its generated object directory, proves the schema is absent, then restores using `pg_restore --exit-on-error --single-transaction`. It first proves a restored database with missing objects cannot serve the original. After restoring the objects, it compares exact original and frozen report bytes, runs the independent offline report verifier, checks preserved authority/audit/migration rows, client denials, immutable guards and freeze idempotency. A corrupted restored original must be denied; replacement from the retained backup must recover it. Migration replay must leave its ledger unchanged. Cleanup restores the surrounding test context and removes the disposable schema/backups.

## Run

Use the restricted disposable `inveos_test` database setup in the existing CI workflow and `LOCAL_RUN.md`. Install PostgreSQL client tools compatible with the test server: `pg_dump` must support its version, and `pg_restore` must support the generated archive. No tool version fallback bypasses failure. The normal API suite runs this scenario, with no skip flag:

```bash
npm ci --no-audit --no-fund
npm run lint
npm run typecheck
npm run build
npm test --workspace @inveos/api
```

The existing database URL checks require `inveos_test`. Never point these administrative test credentials at operational data. Each dump/restore command is limited to 20 seconds, the scenario to 90 seconds and the hosted Node suite to 180 seconds. Credentials are supplied by the existing disposable test environment; no production credentials or backup artifacts are published. Fictional fixtures only.

Hosted [Checks run #97](https://github.com/BlackStateGroup/inveos/actions/runs/40697881625) passed at `e7ac35dc4f211395983a42e02ae195c7aedc7ae9`, tree `3148f0370e621f50f025d94425510abdd2b2066d`: all 129 Node tests (94 PostgreSQL API/restore scenarios, four real browser journeys, 31 helpers), zero failures/skips; 52 Python tests, lint/types/build/reference and actual isolation probes passed. The dump/drop/restore scenario passed in 0.879 seconds; this is a tiny fixture timing, not an RTO or capacity claim. Its ephemeral dump SHA-256 was `f48aafefb4457101ff085ecc11baf5f1fae7525dfdb3935225790356af4e9140`. The initial client connection failure was corrected with explicit PostgreSQL connection environment fields. Draft PR #38 contains this slice; this follow-up records documentation only. Local lint/types, foundation and 52 Python tests also passed.

## Remaining gates

This uses quiesced application writers on one host. A PostgreSQL snapshot alone is not an atomic snapshot of an active filesystem. Live backup coordination, encryption/key recovery, off-site retention, point-in-time recovery, multi-host failure, job leases across restore, external anchors, restored-session invalidation and native device/offline reconciliation remain untested. Sessions are deliberately retained only to exercise restored permission checks; this is not a recommended operational session policy. The dump digest is a local comparison, not a signature or independently trusted backup manifest. Existing parser/runtime/licence and full product gates remain open.

Rollback removes the test/documentation only. No application schema or runtime behaviour changes; no merge, deployment, live investigation or third-party redistribution.
