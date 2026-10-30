# Composition and reusable-template browser acceptance

Inspected base: `e2f1f39df17955d5d8f4dd0980611012fadf01c7` from
`origin/feat/platform-build-batch`. Independent branch:
`test/composition-template-browser`. This change adds focused acceptance definitions
and their dedicated support only. It changes no product code, migrations, shared
`api.test.ts`, CI, central handoff or index. No new dependencies, external delivery,
release approval or production action is involved.

## Explicit browser execution gate

`apps/api/test/composition-template-browser.integration.ts` contains two actual
browser journeys using the existing sandbox-enabled CDP launcher, built web app,
real HTTP API proxy and `workflowFixture` disposable PostgreSQL schema. They do
not skip when flags, Chrome, built assets or database configuration are missing.
There is no mock route, direct React-state manipulation or sandbox fallback.
Author/reviewer switching uses distinct fixture sessions and new page documents;
editing, decisions, selection, preview and application use visible controls.

**Browser execution is UNRUN here.** Root explicitly requested no further local
Chrome attempt. Root owns wiring the explicit hosted `.integration.ts` command,
running it with a working sandbox and inspecting the resulting screenshots and
copies. Compiler success is not browser acceptance. These definitions may expose
selector, rendering or product failures when first executed; failures must remain
failures until reproduced and corrected.

## Defined journeys

1. Investigator saves an outline selecting one reviewed fictional finding;
   independent reviewer accepts v1. The investigator corrects scope, adds a second
   section/finding and changes section order. V2 starts unreviewed and cannot
   inherit v1 acceptance. A separate reviewer accepts exact v2. The investigator
   inspects selected source receipts and freezes it through the UI. The persisted
   JSON must bind the exact outline/reviewer and selected order, excluding the
   third unselected finding. UI-created PDF and DOCX copies omit the entire alpha
   finding. Assertions inspect actual saved fingerprints, decoded semantic models
   and visible PDF streams / DOCX XML for omitted text, original digest, identity,
   composition context and section names. The beta finding remains. The frozen
   report remains byte-identical and no client disclosure is created. Revoking
   the investigator session and refreshing must clear the composition panel's
   loaded detail, preview, revision/review history and selection data.
2. Investigator types separate task/objective/question/note boilerplate despite
   an unrelated source already existing in the case. A separate reviewer accepts
   exact v1. The investigator saves a newer unreviewed draft, explicitly pins
   historical accepted v1, and chooses every owner/deadline (one existing owner,
   others intentionally unassigned; explicit no-deadline declarations). Preview
   must create no work. Session storage may retain only its UUID pointer. Reload
   recovers the same version/digest/review receipt and requires renewed apply
   confirmation. Apply creates exactly four source-free initial work records with
   typed initial statuses and no parents. Retry recovers the same receipt without
   duplicates; reload and application history recover it again. Revoking case
   membership denies the server receipt and refreshing clears the template panel.

Desktop (1440×1000) and narrow (390×844) screenshots are generated under ignored
`output/evals/composition-templates/`, alongside the actual redacted PDF/DOCX and
browser downloads. Each capture asserts no document horizontal overflow.
Root must inspect these artifacts; file generation alone does not establish
visual quality. The tests do not open a client-release or outside-delivery flow.

## Commands and evidence

Executed for the initial definition:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck -w @inveos/api
npx eslint apps/api/test/composition-template-browser.integration.ts apps/api/test/support/composition-template-browser.ts
git diff --check
```

These completed successfully. They installed the existing lockfile dependencies
and checked TypeScript/lint/whitespace only. No browser, API journey or PostgreSQL
test execution is included in this initial receipt.

Initial compiled definition was pushed as
`ea0c899e116f6e9536f2e8dece1ad5fbc2300971` before the follow-through below.

### Subsequent review and executed supporting checks

Source review caught an assertion mismatch in that initial definition:
`workflowFixture.finding()` prefixes the reviewed claim with an attribution. The
browser assertion now expects that exact finding text and identifies source
selection by its original quotation. This was a definition correction discovered
by inspection, not an observed browser or product failure. The helper also waits
for enabled asynchronous select controls, all eight owner/deadline selectors and
new documents on reload, with bounded retries across navigation-context changes.
On a hosted journey failure it saves fictional page text and a screenshot without
dumping cookies, session tokens or storage, then preserves the failing test.

Executed against the restricted disposable PostgreSQL cluster on port 55471:

```sh
INVEOS_TEST_DATABASE_URL=postgres://inveos_app@127.0.0.1:55471/inveos_test \
INVEOS_TEST_ADMIN_DATABASE_URL=postgres://inveos_admin@127.0.0.1:55471/inveos_test \
node --import tsx --test --test-concurrency=1 \
  --test-name-pattern='^(composition freezes|pinned templates)' \
  apps/api/test/report-portal-acceptance.test.ts \
  apps/api/test/task-template-acceptance.test.ts
```

Result: **2 passed, 0 failed, 0 skipped**, 7.512 seconds. The selected existing
checks exercised real composition freezing/retained bytes and copied JSON/PDF/DOCX
verifiers with tampering rejection, plus pinned-template atomic concurrent retry,
source-free initial revisions and withdrawal. These are supporting API/database
checks, **not execution of either new browser journey**. Log:
`.local-data/composition-template-review/api-fixture-checks.log` (ignored).

`npm run build -w @inveos/web` passed. Vite reported the existing large-bundle
warning; no bundle or dependency change was made. API typecheck, scoped ESLint and
`git diff --check` passed again after the definition corrections. No product
failure was reproduced in these two checks and no product file was changed.

Hosted execution (root supplies restricted disposable URLs, not production):

```sh
npm run build -w @inveos/web
INVEOS_TEST_DATABASE_URL=postgres://inveos_app@127.0.0.1:5432/inveos_test \
INVEOS_TEST_ADMIN_DATABASE_URL=postgres://inveos_admin@127.0.0.1:5432/inveos_test \
node --import tsx --test --test-concurrency=1 apps/api/test/composition-template-browser.integration.ts
```

Use the runner's sandbox-capable Chrome through the existing launcher default or
`INVEOS_CHROME_PATH`. The application role must be restricted; the schema owner
applies migrations in an isolated random schema. The fixture removes its schema
and original storage, and the helper closes its browser and HTTP servers.

## Remaining gates and scope

Both new browser journeys and all render inspections remain unrun. The negative
clearing assertions cover the owned composition/template panels after an explicit
refresh; they do not establish whole-app background revocation, every sibling
report/work panel, or erasure of previously downloaded files. This fixture covers
text findings; mixed Field/research/Tika/document/speech provenance needs its
existing separate acceptance. PDF/DOCX semantic checks here do not replace copied
independent verifier execution, Office rendering, accessibility or full regression.
Native devices, identity providers, operational recovery and production readiness
are not claimed.
