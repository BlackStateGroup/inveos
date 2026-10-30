# Scoped restored-case quarantine

Build handoff, 2026-10-30. Started from platform integration `97535ab7318144ca1e0935aea5bfdfac8a8f1872`; pulled/rebased before push onto `d345524f9835dae7a14df6718bed0579e00db8e5` (including Tika lineage and portal evidence intake). This is a non-production operator recovery implementation, not production restore approval. No database restore, API/browser/device acceptance or native acceptance was executed during this build.

Database rollback can restore an active device, old case membership, old authority, a recipient grant or source approval that was subsequently withdrawn. Rotating a session epoch only prevents reuse of old sessions: a new login can still see those restored decisions. Retiring a worker lease alone does not repair that problem. Post-backup decisions cannot be reconstructed from the restored database.

## Implemented

Migration **135_restored_case_quarantine.sql** adds immutable case-scoped recovery requests and immutable ordered retirement receipts. It binds a current assigned reviewer, exact operator reason, stable UUID, supplied SHA256 backup fingerprint, explicit quiescence declaration, pre-recovery authority version, exact internal-only handling version and closed/archived lifecycle version. Foreign keys, insertion guards, sequence guards and a deferred initial-receipt constraint prevent a committed initial request without its retirement receipt. Update/delete is rejected. No historical grants, authority or originals are changed.

`restored-case-quarantine.ts` locks one case, rechecks reviewer membership after obtaining that lock, then performs one transaction:

1. Reuses `recordCaseHandling`, extracted from the normal handling API, including the original canonical hash, text/version checks, immutable insert and audit. It retains the current sensitivity tier (or chooses restricted if absent) and explicitly records internal-only handling.
2. Reuses `appendCaseStage`, including ordinary stage-transition choices, to close collection. An already closed or archived case retains that terminal lifecycle version. This does not alter historical authority or misuse the legacy `cases.status` projection.
3. Reuses the transaction body of `retireRestoredJobs` for queued/running integrity workers, then the shared ordinary collector cancellation writer for queued/running Companies House jobs and research runs. All leases are cleared, status becomes cancelled with `restore_recovery`, and existing immutable job events and audit are retained. Completed work and original captures remain intact. No transport is invoked, job retried or provider contacted.
4. Saves a receipt naming exactly the retired job/run IDs, handling ID/hash/version, lifecycle version, actor, reason, backup fingerprint, original authority version, separate server receipt time, remaining-work flag and next batch. Audit failure rolls back every change in that batch, including the initial handling and lifecycle decisions.

The limit is **1–25 total jobs across all three queues per transaction**, integrity first, collection second, research third. Continuations use the same request and limit plus the next explicit batch number; sequence is bounded at 10,000. A continuation requires the unchanged quarantine handling/lifecycle/authority and current original actor's reviewer membership. Missing receipts, skipped batches, a newer quarantine, altered input or changed gates fail closed. No auto-discovery of tenants/cases occurs.

An exact request/batch retry returns its retained receipt without another cancellation or audit event. A lost response must therefore be recovered by repeating that exact batch, not selecting a new request ID. A receipt is a historical statement about that committed batch, not a certificate of the database's present state. Replaying an early partial receipt remains partial even after a later batch completed.

## Runtime gates

`restored-case-gates.ts` centralises recovery eligibility. In a quarantined case it requires a completed retirement receipt, a **strictly newer authority version**, and a **later current-reviewer handling decision bound to that new authority**. Cases without a recovery request retain their existing behaviour.

| Existing path | Recovery integration |
| --- | --- |
| Normal internal case writes | Shared authenticated CSRF pre-handler blocks writes with a case route parameter until recovery eligibility is satisfied. Existing authority, lifecycle, handling and access controls remain available for reviewer recovery. Their existing roles and invariants still apply. This also covers restricted-work internal mutations using session CSRF. |
| Lifecycle and handling decisions | Canonical writers reject partial retirement. Ordinary closed/archived → scope review → new authority remains necessary; no new reopen route or automatic authority decision was added. |
| Field grant/context, capture acceptance, recovery acceptance, session/observation review and dispatch | `findCase` carries current recovery eligibility into `collectionOpen`. Closed quarantine blocks these current-work paths. New authority invalidates old grants and dispatch authority. Existing exact original/receipt/history read paths are retained. |
| Integrity job enqueue, claim, renew and finish | Persisted current authority queries include the recovery predicate. Retired tokens remain unusable. No isolated worker/profile boundary is bypassed. |
| Companies House/research capture | Existing locked `findCase` / `collectionOpen` checks fence collection; shared cancellation retains normal event history. Policy approvals and rate reservations are untouched. |
| Report disclosures / restricted collaborators | Both discovery eligibility and the existing exact `assertCaseSharing` / `caseSharingState` helper include recovery eligibility. Internal-only handling denies access; old disclosures/grants still fail their old authority binding after reopening. |

The ordinary resumption sequence is: finish every retirement batch; explicitly reopen to scope review; independently reconsider and approve new authority; explicitly record handling **under that new authority**. Internal-only handling can enable internal work without enabling recipients. Recipient use needs an explicit later/current `existing_release_controls` decision, current independent report/source reviews and a new appropriate recipient grant. Existing Field queues remain retained: historical manifests are not rewritten to impersonate new authority, and any ordinary reviewer recovery must use current target grants and its existing independent review rules. Old dispatch instructions need explicit republication under current case/task scope.

The CLI does not record source/device times because it makes no source capture. Existing source times, device times, ingest/receipt times and Field provenance are left byte-for-byte/in-row unchanged. Its new timestamps only describe recovery decisions and receipts.

## Operator command and exact retry

The existing `recover-restored-jobs.ts` has a new **`--quarantine-case`** mode. There is no HTTP recovery route. The legacy `--confirm-quiesced` worker-only mode remains compatible; it does **not** quarantine restored grants and must not be mistaken for this workflow.

The new mode requires `INVEOS_DEV_LAB=1`, `NODE_ENV=test` or `development`, an explicit PostgreSQL URL for database **inveos_test**, and an explicit valid schema beginning **quarantine_**, **restored_** or **test_**. There is no default schema in this mode. Use an already authorised disposable lab with migrations applied; do not repoint production to satisfy these guards. Database/schema names and a caller declaration are not infrastructure attestation.

With writers and ingress stopped, the positional form is:

```sh
node --import tsx apps/api/src/recover-restored-jobs.ts \
  --quarantine-case --confirm-quiesced \
  "$RECOVERY_TENANT_ID" "$RECOVERY_CASE_ID" "$RECOVERY_REVIEWER_ID" \
  "$RECOVERY_REQUEST_ID" "$RECOVERY_BACKUP_SHA256" \
  "$RECOVERY_BATCH" "$RECOVERY_LIMIT" "$RECOVERY_REASON"
```

Set `INVEOS_DATABASE_URL`, `INVEOS_WORKER_SCHEMA`, `INVEOS_DEV_LAB` and `NODE_ENV` in the controlled lab environment. Scope and request identifiers are lowercase UUIDs; the fingerprint is 64 lowercase hex characters. The CLI validates arguments and environment before opening its pool. The backup fingerprint is an operator-supplied archive/manifest identity; this command neither reads nor authenticates the archive. Compute and verify it separately against the retained backup record.

- **Exit 0:** the named batch receipt has `moreRemaining:false`. Case closure and internal-only handling still remain; this is not permission to restart all writers.
- **Exit 2:** a partial batch committed and its JSON receipt is on stdout. Keep writers stopped. Inspect/persist it, then explicitly repeat the same inputs with `nextBatch`. If stdout was lost, retry the original batch unchanged first.
- **Exit 1:** failed closed. Keep writers stopped. Inspect scoped history and retry the same identity after resolving the cause. Do not change the reviewer/request/reason to hide partial state. If that reviewer is no longer valid, recovery is blocked for operator reconciliation; no automatic reassignment is performed.

## Responsibilities outside this transaction

Quiescence is an operator declaration, not something the CLI can prove. Stop ingress/API instances, active uploads/chunks and completion writers, batch submitters, Field synchronisers, integrity/OCR/Tika workers, company/research collectors and scheduled dispatchers before restoring and keep them stopped throughout retirement. Stop processes holding old database transactions and object-write capabilities. A case-scoped transaction is not a distributed maintenance lock, cannot recall an HTTP response already sent, and does not stop an in-flight provider request. The shared HTTP preflight alone is not a concurrent-writer barrier; existing locked acceptance checks and actual writer quiescence remain necessary.

Restore database, immutable object store and separate encryption-key recovery material consistently. Preserve unsent encrypted browser originals and lost-receipt recovery copies. Verify original/receipt/export consistency separately. Do not reset vaults, remotely wipe devices, erase unacknowledged originals, rewrite raw Field provenance or discard storage after a failed recovery command.

Keep the configured **session epoch**, authentication-provider state/credentials, worker credentials, object-store credentials, encryption keys and collector/provider secrets in the recovery inventory **outside the rolled-back database**. Rotate/reconcile them through their established operator procedures before exposing the restored system. This CLI does not mutate sessions or globally revoke devices. Namespaced cases on the same device are unaffected unless separately scoped for quarantine. If a database backup spans other cases, each affected case needs its own explicit reconciliation/quarantine decision; this command provides no global traversal.

A reviewer role in the restored database may itself be stale. Verify that named reviewer and current case members against independent records before using the CLI. Reconcile post-backup device loss/revocations, case grants/recovery approvals, collaborator invitations/submissions/revocations, recipient disclosures, source-use and connector-policy reviews/withdrawals, task assignments, authority scope, retention decisions and releases using ordinary versioned decisions. The command does not assert that missing decisions never existed and never automatically approves a policy or legal basis.

Tenant-level connector policy editing, global software-device registration/state decisions, authentication/session operations, unrelated cases and direct database/object-store/operator writes remain outside this case quarantine. Read-only internal inspection and audit-producing GETs remain available to current members; this is not a case confidentiality lock against already authorised internal users. Inspect direct/internal worker entry points when adding future writers: they must carry the recovery predicate or use a fresh locked case with `collectionOpen`. Safety workflows that are deliberately blocked by the blanket case-write guard can be reconciled through current scope/access/handling controls; do not bypass the guard with ad-hoc SQL.

## Verification and acceptance handoff

Build checks passed: API TypeScript compilation (including the new test definition, repeated after integration rebase), scoped ESLint, and `git diff --check`. None is runtime acceptance or a SQL migration execution.

`apps/api/test/restored-case-quarantine.test.ts` defines a **real `pg_dump --format=custom` / schema drop / `pg_restore --single-transaction`** regression using the restricted disposable test database and fictional fixtures. It saves original objects, a Field session/receipt/grant, dispatch, reviewed report/disclosure, restricted collaborator publication and actual persisted queues; records post-backup lost-device, authority, handling and recipient revocation decisions; restores; rotates the application session epoch; and demonstrates that new login still revives restored permissions before quarantine. It then covers scope/role/quiescence denial, audit rollback, all three queue families, live integrity token fencing, partial CLI exit/receipt replay, unchanged other case/device history, and explicit reopening/new authority/fresh handling. The collector queues are created via actual API workflows; no provider fetch or synthetic parser benchmark is represented as acceptance.

**UNRUN:** that restore regression and its API assertions; migration 135 execution; API/worker concurrency and fault-injection acceptance; real browser encrypted queue interruption/re-auth/lost receipt, backup-v2 round trip, Field/device/offline/dispatch/bulk families; combined repository suites. Native Expo packaging, approved native dependencies/toolchains, signed iOS/Android builds and physical-device checks remain separate named gates. No native/hardware attestation, hardware device, production or whole-product completion claim.

Root owns integration and broad regression. After root confirms this quarantine commit is merged, start a fresh acceptance branch from the latest combined integration and run the assigned focused Field/device/offline/backup-v2/dispatch/bulk/restore families, fixing actual failures there. No central handoff, index, CI or migration inventory edits are included.

## Focused acceptance — 30 October 2026

Acceptance branch `feat/field-recovery-acceptance` was explicitly authorised to start at `e201e621` while root preserved its separate broad-run revision. The first published correction is **32883535a34418f826fc4a0ff413124bf3028433**: the dispatch role fixture now uses valid matching fresh initial identities, so its intended role denial is reached. The initial response body was `Invalid Field dispatch: first dispatch identity/state`; no product validation was weakened. Actual dispatch suite: **5 passed, 0 failed, 0 skipped**, 23.886s.

All following database runs used local PostgreSQL **15.19**, Node **24.22.1**, the disposable `inveos_test` database, a restricted non-superuser/non-bypass `inveos_app` role, per-fixture schemas, fictional data, and one test worker. No production connection or provider transport was used. Environment URLs are in an ignored local file; no credentials were committed.

| Actual focused command (prefix `node --env-file=.env.acceptance --import tsx --test --test-concurrency=1`) | Result |
| --- | --- |
| `apps/api/test/restored-case-quarantine.test.ts apps/api/test/encrypted-restore.test.ts apps/api/test/field-sessions.test.ts apps/api/test/processing-batches.test.ts` | **15 passed, 0 failed, 0 skipped**, 96.147s, before the post-lock read correction below. Includes actual `pg_dump`, schema drop, `pg_restore`, restored active grants after new login, scoped quarantine and ordinary reopening/reauthorisation; separate encrypted object/key restore; seven session/observation cases; six processing-batch cases. |
| `apps/api/test/field-device-recovery.test.ts` | New definitions executed: **3 passed, 0 failed, 0 skipped**, 22.903s. Versioned withdraw/restore cannot revive old manifests; independently approved lost-source-device recovery retains old source/device/authority bytes with separately current acceptance; current reviewer/target fences and audit rollback; an actual loopback HTTP response is dropped after commit, then its exact receipt is recovered after revocation with one retained original. |
| `--test-name-pattern='^field \|^task status batch \|^task planning batch ' apps/api/test/api.test.ts` | Initial run: 17 passed, **2 failed** at lock-observation waits. After correction: **19 passed, 0 failed, 0 skipped**, 14.117s. No shared test/CI/migration inventory changed. The command's regex uses literal `|` alternation, without Markdown escaping when run in the shell. |
| `apps/api/test/restored-case-quarantine.test.ts apps/api/test/field-device-recovery.test.ts` | After the post-lock read correction: **4 passed, 0 failed, 0 skipped**, 32.963s; repeats the actual quarantine dump/restore and all three new device/recovery cases. |

The two lock-observation failures were reproduced: adding the recovery predicate to `findCase`'s initial `SELECT` pushed its `FOR UPDATE OF c` beyond PostgreSQL's default tracked query-text length. Existing concurrency tests could not observe the wait. The correction keeps the case-lock query short, then reads recovery eligibility **in a fresh statement after the lock and membership recheck**. This also avoids retaining an earlier statement snapshot's recovery permission while waiting for the lock. The predicate and denial policy are unchanged. TypeScript API compilation, scoped ESLint and diff checks passed for the follow-up.

Raw run logs remain ignored local artifacts in `output/evals/field-recovery/`: `dispatch-initial.tap`, `dispatch-response.tap`, `dispatch-fixed.tap`, `focused-initial.tap`, `device-initial.tap`, `field-work-batches.tap`, `field-work-batches-fixed.tap`, and `recovery-after-lock-fix.tap`. Passing counts above describe those specific runs; repeated subsets are not additional distinct coverage.

### Browser gate and prepared v2 regression

**Browser/offline/backup-v2 acceptance remains unrun here.** The existing sandboxed Chromium launcher was attempted. Initially it reported a missing sandbox package. Installing the standard `chromium-sandbox` tool package did not resolve the host restriction: Chromium exits with `Failed to move to new namespace ... errno = Operation not permitted` and `Zygote process exited prematurely with exit code 1` (exit signal6). No `--no-sandbox`, namespace/security policy changes, remote browser, fake IndexedDB or native emulation was used. Its fresh temporary browser profiles were cleaned up; no browser remains running.

`apps/api/test/field-vault-v2.browser.test.ts` adds a separately labelled, compiled **UNRUN** actual-browser definition for a sandbox-capable host. It imports the actual Field vault through existing Vite (no new dependency), uses actual IndexedDB/WebCrypto and CDP network-offline mode, queues session originals, dispatch instructions/publication/status, retains unknown delivery and full optional receipt data, reloads, exports/authenticates v2 inventory, rejects nonempty restore/wrong passphrase/removed operations/ciphertext tampering/v2 downgrade, restores exact records, and replaces software identity while rejecting the stale key. Receipt objects in this storage-specific test are explicitly **synthetic validation fixtures**, not claimed server acceptance or hardware attestation. The separately executed device test covers actual API receipts and lost HTTP response; the existing Field UI browser journey covers full offline app-shell reload when executed on a capable host.

Root can run the new definition with `INVEOS_TEST_BROWSER=1 node --env-file=.env.acceptance --import tsx --test --test-concurrency=1 apps/api/test/field-vault-v2.browser.test.ts` on the supported browser host, then its existing `real browser Field encrypts offline originals` journey after the normal web build. Browser UI, actual browser backup-v2/offline execution, physical iOS/Android, native packaging and production recovery remain separate gates. No native success, browser success or comprehensive product acceptance is claimed by these PostgreSQL and HTTP results.
