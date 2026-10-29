# Encrypted recovery and restored worker retirement

## Problem and operational boundary

A restored database can contain a still-live worker lease token. Rotating `INVEOS_SESSION_EPOCH` retires browser sessions, but it does not invalidate those worker tokens. The new actual PostgreSQL recovery test reproduces this: after dump/drop/restore, the old worker heartbeat still succeeds until restored work is explicitly retired.

`retireRestoredJobs` is a trusted operator entry point, with no HTTP route. A bounded transaction requires an explicitly supplied tenant, case, currently assigned reviewer and recovery reason. It cancels up to 25 queued/running jobs, removes their lease tokens/deadlines and appends both job history and case audit records. Completed outputs and original job identity/attempt history remain unchanged. Failure to write the audit rolls back the entire batch. Repeat batches until `moreRemaining` is false; an empty repeat is harmless. Jobs are not automatically retried: an investigator must explicitly request new work after source/authority checks.

The operator must stop **all** API/worker writers before backup/recovery, keep access closed throughout the procedure and use a fresh runtime session generation before reopening. `--confirm-quiesced` records that declaration; it does not discover or stop processes and is not a distributed maintenance lock. This does not protect against a forgotten old worker claiming newly queued work with still-valid database credentials. Retire old processes/credentials as part of recovery. No live backup, production database or external service is changed by this implementation.

## Disposable lab run

Follow [the quiesced recovery procedure](54_SYNTHETIC_RESTORE.md), [session generations](56_SESSION_RECOVERY_GENERATIONS.md) and [protected original keys](81_ENCRYPTED_ORIGINAL_CUSTODY.md). Restore database, encrypted object store and the separately protected key material to an isolated lab. Do not silently rename ciphertext, substitute plaintext or rewrite original IDs/digests. Protect backup/key directories and validate against separately retained fingerprints.

With all writers stopped and the restricted application role configured, run this command for each explicitly authorised restored case:

```sh
INVEOS_DEV_LAB=1 node --env-file=.env --import tsx \
  apps/api/src/recover-restored-jobs.ts --confirm-quiesced \
  TENANT_UUID CASE_UUID ASSIGNED_REVIEWER_UUID \
  'Fictional recovery rehearsal; writers stopped and backup identity checked.'
```

It uses `INVEOS_DATABASE_URL` and optional `INVEOS_WORKER_SCHEMA` (default `inveos`), never the administrator connection. It refuses production mode, missing confirmation, malformed scope and an unassigned/non-reviewer operator. An error prints a fixed message without database URLs, lease tokens or keys; keep writers stopped and inspect scoped history before retrying. When `moreRemaining` is true, run another bounded pass. Rotate `INVEOS_SESSION_EPOCH` to a new UUID held outside the database backup, then test old-cookie denial before admitting new sessions. Restart only the intended API/workers with the compatible original-key configuration.

## Actual acceptance and limitations

`apps/api/test/encrypted-restore.test.ts` uses a fresh random schema in the disposable `inveos_test` database. It performs real `pg_dump`/`pg_restore`, deletes only its generated schema/object/key paths, and restores originals encrypted under two key IDs. It verifies exact ciphertext/plaintext, immutable reviewed report bytes, completed text derivatives, authority/audit records, report idempotency and independent offline verification. It tests missing key configuration, an unavailable historical key while a newer-key original still works, retained-key recovery, plaintext substitution, old-session denial and explicit new work after recovery.

The same test reproduces a restored live lease, proves scoped/reviewer denial and audit rollback, exercises the actual recovery CLI with restricted PostgreSQL credentials, and verifies that retired tokens cannot renew or finish. Cancelling queued work does not touch already committed derivative records. The fixture's source and all identities are fictional. No fake database, cipher, dump tool or parser benchmark is used. The line-index worker is first-party processing, not PDF/OCR acceptance.

Run with compatible PostgreSQL client binaries and both disposable `INVEOS_TEST_*_DATABASE_URL` values:

```sh
node --import tsx --test apps/api/test/encrypted-restore.test.ts
```

This is a small, quiesced, single-host restore rehearsal. The logical database dump still contains plaintext metadata, derivatives and frozen reports; key files are permission-protected lab files, not KMS. Full backup encryption, off-site retention, PITR, live backup coordination, credential/provider recovery, capacity/RTO/RPO, native offline reconciliation and independent security/legal/privacy acceptance remain open. Restoring exact bytes does not establish source truth, legal admissibility or production readiness. Exact passing code/CI receipts belong in the current handoff.
