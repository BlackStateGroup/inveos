# Session generations outside database recovery

28 October 2026. Synthetic lab recovery control, not production identity or automatic disaster recovery.

A database backup includes sessions. Restoring it can resurrect tokens revoked after backup. Migration 020 adds an immutable-in-use generation identity (`sessions.epoch`) to authentication records. Every API instance compares the stored value to its startup `INVEOS_SESSION_EPOCH`; new lab sessions receive that configured value. Other-session revocation considers only the current generation. Historical session and audit rows are not deleted or reassigned. This does not change evidence, cases, authority, findings or report bytes.

The setting is a UUID, not a secret or signing key. Malformed values fail startup; uppercase UUIDs normalise. For backwards-compatible synthetic lab operation, omission uses `00000000-0000-4000-8000-000000000000`, also assigned to pre-migration sessions. **Leaving that default unchanged does not protect a restored database.**

## Quiesced recovery procedure

1. Stop all API listeners and workers before the existing backup/restore exercise. Do not allow requests during recovery.
2. Restore the database and original objects, apply migrations, and verify the originals/report packages as documented in `54_SYNTHETIC_RESTORE.md`.
3. Generate a new UUID (for example `python3 -c 'import uuid; print(uuid.uuid4())'`). Set `INVEOS_SESSION_EPOCH` to it in runtime configuration kept separately from the restored database. Record the retired/current generations in controlled operational records.
4. Start every API instance with the same new value. Do not run an old-generation instance concurrently. Test that a pre-restore cookie receives 401, then explicitly enter the synthetic lab and confirm a new session works.
5. Never revert to a retired value: doing so would make its still-valid database rows eligible again. Rolling back this code requires keeping access stopped or separately invalidating sessions first; ordinary source rollback is not safe recovery policy.

Generation changes do not cancel requests already authorised, revoke external identity-provider tokens, change worker leases or retract downloaded bytes. Restoring runtime configuration along with the database defeats the separation. Production secret/config distribution, multi-host coordination, account recovery and real sign-in remain open requirements.

## Verification

Run standard lint/type/build/foundation checks, `node --import tsx --test apps/api/test/session-epoch.test.ts` and `INVEOS_TEST_BROWSER=1 npm test --workspace @inveos/api` with the disposable PostgreSQL/browser setup. The actual dump/drop/restore scenario now rotates the runtime generation after recovery, rejects restored cookies for original/report/session routes and verifies new-session access. Another PostgreSQL scenario covers generation restart stability, subsequent rotation, retained history and exclusion of retired sessions from revocation counts. A real Chrome journey rejects an old cookie and requires explicit re-entry. Configuration tests cover invalid values and normalisation.

Hosted [Checks run #103](https://github.com/BlackStateGroup/inveos/actions/runs/40714513427) passed at `6dc0c16bad74a2b46ca196001f972686443522ca`, tree `770ef28e5b221ffd136c7871a949ee2450709a85`: all 135 Node tests (98 PostgreSQL API/restore scenarios, five actual browser journeys, 32 helpers), zero failures/skips; 52 Python tests, lint/types/build/reference and actual isolation probes passed. Includes actual database/object restore followed by generation rotation, old-cookie denials, new-session access, restart stability, immutable generation enforcement and explicit Chrome re-entry. Draft PR #40 contains this slice; this follow-up changes documentation only. Local lint/types/build, configuration helper and foundation checks also passed. These tests do not establish complete production restore, native offline reconciliation or parser acceptance. No new dependency, live records, source redistribution, deployment or automatic merge.
