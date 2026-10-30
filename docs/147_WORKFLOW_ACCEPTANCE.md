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


## Composition validation hook (second isolated commit)

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
