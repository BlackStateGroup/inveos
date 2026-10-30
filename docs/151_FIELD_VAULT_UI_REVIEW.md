# 151 — Independent Field vault UI/browser review

Inspected root base: **`8d58c956a84e9f2dc1e2b4dd07fd683c56229750`**, fetched from `origin/feat/platform-build-batch`. Fresh worktree `/code/inveos-field-vault-review`, branch `feat/field-vault-review`. Earlier research/Tika branches are unchanged. This review covers Field UI integration and its browser definitions, separately from the reviewer's authored research features.

## Hosted failure inspected

Downloaded the actual job log through `gh`:

```sh
gh run view 41080560270 --repo BlackStateGroup/inveos --json headSha,headBranch,status,conclusion,url
gh api /repos/BlackStateGroup/inveos/actions/jobs/124148654503/logs --allow-escape-sequences
```

[Checks job 124148654503](https://github.com/BlackStateGroup/inveos/actions/runs/41080560270/job/124148654503) ran head **`4216ad12c0d778849409100d6a061016236387b3`**. Its API integration step failed; the overall job/run was subsequently cancelled. Preserve both states. The log records the real browser Field offline/reload/lost-receipt journey failing after 16.86 seconds with `Timed out: vault creation`, at `api.test.ts:5103`. It contains no application vault error or final DOM state. Later development-browser/office/host stages were skipped; this is not a completed batch acceptance result. Local raw and ANSI-cleaned logs: `/tmp/field151-hosted.log`, `/tmp/field151-hosted-clean.log`.

## Findings and narrow changes

1. **False initial readiness.** The test waited for any enabled fieldset below `.field-workbench`. `FieldWorkbench` initially renders its create/unlock fieldset disabled while `FieldVault.exists()` checks IndexedDB, alongside an enabled restore fieldset. The predicate can therefore succeed before vault access is ready. The shared `binaryBrowserControls` click helper checked only `button.disabled`; this does not represent inherited fieldset disablement. Its synthetic `click()` can be ignored while the helper reports success. The helper now requires `button.matches(':enabled')`, and the Field test waits for the actual passphrase input to be enabled before typing. It verifies form validity before submitting.
2. **Capture consent targets a different form after integration.** The old `.field-workbench input[type=checkbox]` selector now encounters the earlier dispatch/session controls. Both captures in the journey now select the checkbox inside `form[aria-label="Field capture"]` explicitly. No consent or application validation is bypassed.
3. **More useful creation failure evidence.** Creation completion checks for the enabled encrypted-queue control, which appears only in the unlocked workspace after the action finishes. On failure it records visibility, status text, input types/labels/validity and button enablement. It never logs passphrase or input values. Existing deadlines remain unchanged.
4. **Storage privacy assertion lost binary content.** The separate v2 browser test used plain `JSON.stringify()` on IndexedDB rows. An `ArrayBuffer` becomes `{}`, so that representation cannot detect plaintext mistakenly stored inside such a buffer. The check now includes byte/decoded representations when scanning the fictional stored values. This strengthens the assertion without changing storage, crypto, backup formats or keys.

The actual initial component markup was rendered locally using existing Vite SSR plus React `renderToStaticMarkup`, then inspected with Python's standard-library `HTMLParser`. It showed:

```text
form 1 fieldset disabled True
Create Field vault: own_disabled False; inherited_disabled True
form 2 fieldset disabled False
Restore encrypted backup: own_disabled True; inherited_disabled False
Sessions renders checkbox before later capture form: True
```

Artifacts: `/tmp/field151-initial.html`, `/tmp/field151-sessions.html`. This is an actual static-component reproduction of the wrong readiness structure, **not browser execution or IndexedDB acceptance**. It supports the observed timeout mechanism; the hosted log alone cannot establish which precise scheduling interleaving occurred. The corrected journey must still run on root's supported browser host.

A separate executed Node negative control confirmed that plaintext bytes inside an `ArrayBuffer` are hidden by ordinary JSON serialization and detected by the strengthened representation. No synthetic result is being substituted for WebCrypto execution.

## Independent source review boundary

Read `FieldWorkbench`, `fieldVault`, Field sessions/dispatch/recovery/control integration, acknowledgement checks, the existing production-build browser journey and `field-vault-v2.browser.test.ts`. The main UI retains explicit unlock, generation/visibility locking, encrypted local records, case/grant preparation, original capture, separate delivery attempts and exact receipt acknowledgement. Inspection found no concrete crypto/product defect causing this timeout; this patch changes test behavior only.

The v2 browser definition deliberately invokes the real vault module directly on a Vite-served origin. It tests actual browser IndexedDB/WebCrypto and backup/replacement semantics with labelled synthetic server receipts. It does **not** submit the application's create-vault form or establish API/native acceptance, so it cannot catch the integrated UI selector failures above. The legacy production-build journey remains necessary for that coverage. No native iOS/Android, hardware attestation, remote erasure or full privacy/security qualification is claimed.

## Checks executed locally

- Existing lockfile dependencies installed with `npm ci --ignore-scripts`; no dependency/lockfile changes.
- Actual static rendering/HTML inspection and the binary-serialization negative control described above passed.
- **3/3 Field device/recovery tests passed, zero failures/skips**, against disposable restricted PostgreSQL 15 on loopback port 55468. This includes grant withdrawal/regrant, independently reviewed lost-device recovery with exact old bytes/authority, and an actual dropped HTTP response recovered after device revocation without another intake. Log: `/tmp/field151-device-recovery.log`.
- Workspace typecheck, targeted ESLint and production web build passed. Logs: `/tmp/field151-types.log`, `/tmp/field151-lint.log`, `/tmp/field151-build.log`. `git diff --check` passed.

Database command (requires the two disposable database URLs in the environment):

```sh
node --import tsx --test --test-concurrency=1 apps/api/test/field-device-recovery.test.ts
npm run typecheck
npx eslint apps/api/test/api.test.ts apps/api/test/field-vault-v2.browser.test.ts
npm run build -w @inveos/web
```

No local Chrome attempt was made in this review, as instructed. No sandbox settings, product files, migrations, CI, central handoff or INDEX were changed.

## Root's required hosted checks — unrun on this branch locally

With the existing sandboxed Chrome, restricted PostgreSQL environment and current production web build:

```sh
INVEOS_TEST_BROWSER=1 node --import tsx --test --test-concurrency=1 \
  --test-name-pattern='^real browser Field encrypts offline originals' apps/api/test/api.test.ts
INVEOS_TEST_BROWSER=1 node --import tsx --test --test-concurrency=1 \
  apps/api/test/field-vault-v2.browser.test.ts
```

The first must cover actual form creation, offline shell/cache exclusions, encrypted capture, wrong-passphrase denial, offline reload, lost HTTP receipt, stable retry, lock/reopen, revoked-device delivery denial and narrow layout. The second must cover real storage, originals/operations/context persistence, invalid receipt/backup negatives, reload, restore and replacement. Root's combined browser suite must also validate the stricter shared click helper. No passing hosted browser result, new rendered UI image or whole-batch acceptance is claimed here.

## Root hosted follow-through at 1d80e3fd

Checks41085834704/job124166647502 progressed through vault creation, offline capture/reload and lost-receipt recovery, then failed its old exact revocation-message assertion. The current versioned device gate returns409 and `Device is lost, revoked or changed. Preserve local originals and request independent recovery.` Root corrects the obsolete text expectation and additionally observes actual proxy HTTP409; the persisted-original counts and encrypted retained-queue assertions remain. This last revised assertion is awaiting hosted execution.

The separate vault-v2 and independent Field-control browser tests passed on this run. Overall API execution was cut off at600seconds after499 passes/1 failure, so this is not a complete suite pass. Log `/tmp/inveos-platform-checks-1d80.log`.
