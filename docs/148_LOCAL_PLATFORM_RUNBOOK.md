# Local platform runbook

Use fictional records on a disposable local PostgreSQL server. The current delivery state, merged commit and failed/unrun checks are recorded in [BUILD_HANDOFF](../BUILD_HANDOFF.md) and the [remaining plan](71_REMAINING_DELIVERY_PLAN.md). A running lab is not a production deployment. The static prototype and persistent lab are different entry points.

## Prerequisites

Use Node22+, npm, Python3.11+ and PostgreSQL15 with `psql`, `pg_dump` and `pg_restore` available. Install this checkout's locked application dependencies with `npm ci --no-audit --no-fund`. Do not substitute unpinned application packages. The test suite's document-copy checks also need Poppler (`pdftotext`); Office rendering needs LibreOffice Writer. The Ubuntu reference configuration is executable in `.github/workflows/checks.yml`.

Actual browser checks require a Chromium/Chrome host supporting its normal sandbox. If namespace creation is denied, record the browser checks as unrun and use a permitted host; do not disable the sandbox. Actual document/speech workers additionally require the exact pinned artifacts and isolation qualification described below. They are not needed to open the ordinary case workspace.

## Create the disposable databases once

Connect `psql` as your local PostgreSQL administrator. On a **new disposable server**, create separate schema-administrator and application roles:

```sql
CREATE ROLE inveos_admin LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE inveos_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE DATABASE inveos_lab OWNER inveos_admin;
CREATE DATABASE inveos_test OWNER inveos_admin;
REVOKE ALL ON DATABASE inveos_lab, inveos_test FROM PUBLIC;
GRANT CONNECT ON DATABASE inveos_lab, inveos_test TO inveos_app;
```

Set local passwords using `\password inveos_admin` and `\password inveos_app` when your server uses password authentication. Use your server's normal local authentication policy. Keep credentials outside Git. If these roles/databases already exist, inspect and reuse the intended lab configuration; the commands above deliberately do not drop or overwrite anything.

The schema administrator owns migrations and disposable test schemas. The API/worker uses `inveos_app`; never use the schema administrator as the application identity. The migrations grant bounded table privileges themselves. Application case checks remain necessary; this is not production worker-specific credential or RLS qualification.

## Configure and start

Copy `.env.example` to a new ignored `.env` only when `.env` does not already exist. Set the four PostgreSQL URLs to your local server, preserving `inveos_lab` for development and `inveos_test` for disposable acceptance. Set `INVEOS_STORAGE_ROOT` to an absolute private directory belonging to this lab, such as the checkout's `.local-data/objects`. The historical path in the template is an example, not a required location.

Keep `INVEOS_DEV_LAB=1`, a non-production `NODE_ENV`, loopback API host and the exact local browser origins. For a new lab, set a fresh UUID for `INVEOS_SESSION_EPOCH` using `node -e 'console.log(crypto.randomUUID())'`. Keep the epoch consistent across that lab's API instances. Recovery requires a fresh epoch outside the restored database backup; follow the recovery instructions, not a simple restart.

For a **new empty original store**, configure encrypted mode using [encrypted original custody](81_ENCRYPTED_ORIGINAL_CUSTODY.md). Retain its key file separately from objects and database backups. Do not switch an existing store's mode or overwrite keys to make it start. The plaintext local mode is a development option and provides no at-rest encryption claim. Optional development OIDC configuration is in [provider identity](83_PROVIDER_IDENTITY.md); it is not a production provider/MFA approval.

From the repository root, apply the checked migrations:

```sh
npm run db:migrate
```

Start two terminals from that same checkout:

```sh
npm run dev:api
```

```sh
npm run dev --workspace @inveos/web -- --host 127.0.0.1
```

Open `http://localhost:5173`, choose **Open persistent lab**, acknowledge fictional use and enter the lab. The API stays on `127.0.0.1:3001`; Vite proxies `/api`. The chosen database, original directory and keys determine the saved records. Starting another branch against another store does not move those records. Do not point an older checkout at a newer migrated database.

The investigator case tabs expose Brief, Timeline, Tasks, Evidence, Findings, Report, Billing and Audit. Research provides cited rules and the approved-source workbench. Field is the encrypted browser workspace, with separate device/case-grant and recovery controls. `/portal` and `/collaborator` require an explicitly provisioned restricted principal and current approved grants; the internal demo session does not confer recipient access. Reports and invoices are separate: an internal invoice draft is not a client release or a payment.

## Reproduce acceptance

With the disposable test URLs in the ignored `.env`:

```sh
npm run lint
npm run typecheck
npm run build
npm run test:foundation
npm run test:api
```

Alternatively export the two test URLs and run `npm test --workspace @inveos/api`; it does not load `.env`. Tests create random schemas in `inveos_test` and remove them afterwards. Run serially (`--test-concurrency=1`, already configured). Local runs without `INVEOS_TEST_BROWSER=1` explicitly skip browser definitions; those are not browser passes. On a permitted browser host, use that flag and the workflow's explicit `.integration.ts` commands as well. Some fixtures render documents, restore disposable schemas and deliberately corrupt their own originals; never use a real case store as a test fixture.

To retain and render the research/Field report-copy matrix, export the disposable test URLs and run:

```sh
INVEOS_ACCEPTANCE_ARTIFACTS=/tmp/inveos-source-copies \
node --import tsx --test --test-concurrency=1 \
  apps/api/test/research-api.test.ts apps/api/test/tika-report-acceptance.test.ts
python3 tools/eval_source_family_copies.py /tmp/inveos-source-copies
```

These Tika report tests use explicitly labelled synthetic parser contracts. Actual Tika application execution is separately reproduced by `.github/workflows/tika-research.yml` and [source-family acceptance](146_SOURCE_FAMILY_ACCEPTANCE.md), which acquire pinned sources, build/qualify the locked runtime and run the real worker/CLI against restricted PostgreSQL. Native/OCR and speech have their own pinned research workflows and recorded limits. No unavailable parser is replaced with a synthetic benchmark.

For backup/restore, first read [encrypted restore](84_ENCRYPTED_RESTORE.md) and [restored-case quarantine](145_RESTORED_CASE_QUARANTINE.md). Database, objects, keys, session epochs, provider credentials and post-backup access changes have distinct recovery duties. A successful `pg_restore` alone must not reopen case work or recipient access.

## Remaining gates

This runbook does not complete native iOS/Android delivery, semantic AI, live registry activation, real provider/MFA/KMS/WORM/PITR/offsite recovery, representative parser quality or external licence/privacy/security/professional approval. Current implemented, tested, merged and blocked states remain separate in the handoff. Never infer readiness from the prototype, a compiler result or a count of tests.

## Executed setup receipt

Root exercised the schema/startup path on2026-10-30 at95bfda8f with a newly created disposable database and a separate non-superuser schema administrator (no CREATEDB/CREATEROLE/INHERIT/BYPASSRLS). All99 checked migration files applied; a second migration run was unchanged and succeeded. The actual API entry point started with the restricted `inveos_app` role; real HTTP session creation, fictional case creation, authority approval and workspace readback passed. The owned API process, temporary database, role and original directory were removed. Receipt `/tmp/inveos-runbook-smoke.log`. This verifies the local PostgreSQL/API path; it does not establish native runtime/browser/production readiness.
