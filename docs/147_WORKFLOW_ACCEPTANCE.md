# Focused workflow acceptance — actual results

Base: `d345524f9835dae7a14df6718bed0579e00db8e5`, branch
`feat/portal-workflow-acceptance`. Root owns broad regression and integration.
No production changes, external delivery, new application dependencies, PR or merge.

## Invoice fixture correction (first isolated commit)

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
