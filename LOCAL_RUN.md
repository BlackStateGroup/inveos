# Local synthetic application runbook

This runbook starts a **development-only, fictional-data** demonstration. It is
not a production service, real authentication system, custody certificate,
independent verifier, client portal, or legal-compliance control. Do not enter
real client, personal, investigative, or otherwise sensitive data.

## Requirements and local PostgreSQL

Use Node.js 22 and npm. The application expects a local PostgreSQL server on
`127.0.0.1:5432`. Its only databases are named `inveos_lab` and `inveos_test`.
A newly provisioned private development cluster may keep its files in the
ignored `.local-data/postgres/` directory, bind to loopback, and use local-only
authentication. This example is only for a new private cluster; an existing
configured PostgreSQL server keeps its own data directory. Original text
objects are stored under ignored `.local-data/objects/`. For example, on a
machine with PostgreSQL installed:

```bash
mkdir -p .local-data/postgres
chmod 700 .local-data
initdb --auth-local=trust --auth-host=trust -D .local-data/postgres
pg_ctl -D .local-data/postgres \
  -o "-h 127.0.0.1 -p 5432 -k $PWD/.local-data/postgres" \
  -l .local-data/postgres/server.log start
```

The database administrator used below is a local, privileged setup role. Create
it and the application role through the cluster's local administrator account.
The application role must not have `SUPERUSER`, `CREATEDB`, or `CREATEROLE`:

```sql
CREATE ROLE inveos_admin LOGIN SUPERUSER;
CREATE ROLE inveos_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE inveos_lab OWNER inveos_admin;
CREATE DATABASE inveos_test OWNER inveos_admin;
GRANT CONNECT ON DATABASE inveos_lab TO inveos_app;
GRANT CONNECT ON DATABASE inveos_test TO inveos_app;
```

If the roles or databases already exist, do not recreate or modify unrelated
databases. Use a separate setup role for migration/schema creation; the API
connects as `inveos_app`. The example uses trust auth only for a private
loopback development cluster, not as a production authentication design.

## Install, configure, and start

From the repository root:

```bash
npm install
cp .env.example .env
```

`.env` is ignored by Git. The sample URLs contain no passwords; adjust the
absolute `INVEOS_STORAGE_ROOT` path if this checkout is elsewhere. The API
refuses to start unless `INVEOS_DEV_LAB=1`, refuses `NODE_ENV=production`, and
binds only to `127.0.0.1`. The default Origin allowlist is exactly
`http://localhost:5173` and `http://127.0.0.1:5173`. An additional preview
origin may be enabled only by explicitly adding its exact origin to
`INVEOS_ALLOWED_ORIGINS`; wildcard CORS is not enabled.

Run the migration with the privileged local setup URL, then start the API:

```bash
npm run db:migrate
npm run dev
npm run dev:api
```

Keep each server running in its own shell. Vite serves `http://localhost:5173`;
the API listens on `http://127.0.0.1:3001`. PostgreSQL and the API bind only to
loopback. The existing Vite development script binds to all interfaces for
preview access, so use it only on a trusted development network. The configured
demo session always uses the single fictional reviewer and tenant in the
migration. It is not real user authentication and does not allow choosing an
identity or tenant.

## Data, authority, and evidence limitations

- Original text objects live under ignored `.local-data/objects/`. PostgreSQL
  data files remain in the configured local cluster and are not necessarily
  under `.local-data/`; the `.local-data/postgres/` example above applies only
  to a newly provisioned private cluster.
- Original object paths use generated tenant/case/evidence identifiers, not
  submitted filenames. Original files are created exclusively, mode `0600`,
  inside mode `0700` directories, then fsynced before their database receipt.
- An evidence receipt references the immutable authority version whose purpose,
  lawful basis, scope, retention period, and minimisation decision applied at
  intake. A later authority review does not rewrite that snapshot.
- A “Verified” receipt means only that the server-computed SHA-256 equals the
  supplied digest for the reconstructed UTF-8 bytes. It does not establish
  truth, authenticity, provenance, lawful collection, or admissibility.
- Database triggers reject ordinary updates/deletes for authority, evidence,
  review, finding, and audit rows. A privileged database administrator can
  bypass these controls or alter database/storage state; the local prototype
  has no external signature, anchor, object lock, or independent custody
  verifier.
- A process crash after the durable object write but before the database
  transaction commits can leave an unreferenced orphan file. A normal database
  failure triggers best-effort object cleanup. No automated retention deletion
  is implemented.
- The report endpoint emits an internal JSON draft containing only accepted
  findings and their verified cited originals/policy provenance. It is not a
  PDF, signed certificate, client release, or offline verifier.

## Tests

After applying the latest migrations, the persistent lab also supports objectives,
questions/hypotheses, tasks, notes, handovers, source links and revision history.
Existing lab sessions restore their case/view after reload. Run the real HTTP
exercise against the running loopback API with:

```bash
python3 tools/verify_casework.py
python3 tools/verify_report.py .local-data/casework-verification/draft.json
```

The first command creates explicitly fictional cases and records and writes a
JSON report, its fingerprint and a 32-check receipt under ignored `.local-data/`.
It accepts only a loopback HTTP lab, never an external service URL. To authenticate
a downloaded JSON report against a fingerprint received separately, run:

```bash
python3 tools/verify_report.py path/to/draft.json --expected-sha256 TRUSTED_FINGERPRINT
```

The report studio can print the complete branded internal draft. JSON integrity
verification and browser printing are separate checks; neither creates a client
release or a signed custody certificate. See the [casework receipt](docs/evals/2026-10-27-casework.md).

The [CI workflow](.github/workflows/checks.yml) runs lint, workspace type checks,
web build, foundation tests/reference and PostgreSQL API tests on pull requests.
It creates its own disposable database and restricted application role and does
not require the developer's `.env`. To run API tests with explicitly configured
test URLs in your shell instead of a dotenv file, use:

```bash
npm test --workspace @inveos/api
```

This command still requires the real test database/roles below; no mocks or
production credentials are used in CI. CI does not replace browser, native
device, parser isolation, outage, restore or security acceptance.

`npm run test:api` runs integration tests against the real `inveos_test`
PostgreSQL database. Each run creates a uniquely named isolated schema and
object root, applies the migration, and removes both at completion. Test setup
uses `INVEOS_TEST_ADMIN_DATABASE_URL`; never point it at another database. The
live `inveos_lab` schema and `.local-data/objects/` are not used by API tests.

The source fixture in `apps/api/fixtures/fictional_supplier_note.txt` is fully
synthetic. No test creates or uses real-person or client information.
