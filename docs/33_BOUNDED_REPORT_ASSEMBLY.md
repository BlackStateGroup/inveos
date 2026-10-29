# Bounded internal report assembly

27 October 2026. WP-07 incremental synthetic-lab implementation, stacked on report-history PR #13. No client release, production readiness or parser acceptance.

Both live JSON drafts and new frozen revisions now enforce a 32 MiB UTF-8 JSON budget during assembly. The budget counts the empty report envelope, each finding and working item, JSON escapes, Unicode bytes and array separators. Each finding reserves its original's base64 length before reading/encoding that original. Repeated citations count their repeated embedded originals; a unique-evidence count would understate this format's output size. The frozen route retains its final serialised-length check as defence in depth.

Findings and report-visible casework are transferred through transaction-local PostgreSQL cursors in batches of 32 rows, retaining the REPEATABLE READ snapshot. Each set is capped at 1,000 items, with an additional sentinel row to detect excess. Only objectives, questions, hypotheses and blocked tasks are queried for working context. Notes, handovers and other tasks are excluded at the query, rather than loaded then discarded. Exceeding a limit returns 422, never a silently truncated report. Failed freezes create neither a revision nor a report-frozen audit event. Retrying the same failed key remains safe; transaction completion/rollback closes cursors.

Verified-original reads used by review/report/intake-replay paths now reuse the existing bounded reader: regular files only, no final-component symlinks, at most 256 KiB plus a sentinel byte, with the descriptor closed on success or error. Digest and recorded-length checks remain mandatory. This is not complete filesystem sandboxing: trusted storage-root ancestry, physical immutability and privileged-host threats still need production controls. Workspace preview reads are outside this change.

These are per-report output and row-count limits, not a 32 MiB process-memory or concurrency guarantee. JSON serialisation, buffers and response transport require additional memory. Database query execution/sorting, unusually large administratively inserted metadata, concurrent exports and connection duration need separate quotas and load measurements. This implementation still assembles the bounded report in memory; it does not claim HTTP streaming.

## Reproduction and evidence

Use the existing disposable PostgreSQL 15 CI fixture and locked dependencies:

```bash
npm run lint
npm run typecheck
npm run build
npm run test:foundation
node --import tsx --test apps/api/test/report-budget.test.ts
# With INVEOS_TEST_DATABASE_URL and INVEOS_TEST_ADMIN_DATABASE_URL set:
npm test --workspace @inveos/api
```

Two direct byte-budget tests cover Unicode, JSON escaping, repeated originals, separators, exact boundaries and rejection before encoding. Four added PostgreSQL scenarios cover actual TCP oversized export rejection, repeated-original counting, rollback/idempotent retry/connection recovery, exactly 1,000 versus 1,001 findings and visible context items across cursor batches, excluded private notes, and oversized/symlink replacement originals. Bulk fixtures clone fictional API-created provenance using test administration; application privileges are not expanded. The existing concurrent-edit snapshot test now commits the second-connection edit after access establishes the snapshot and before report assembly. Existing independent offline-verifier, exact-download, scope and corruption tests remain required. Hosted [Checks run #28](https://github.com/BlackStateGroup/inveos/actions/runs/40544425068) passed at `bab0412d549af43772a604cefba39153f32e8fd2`: 45 PostgreSQL API tests, seven processor/download/budget helper tests and 42 Python tests, plus lint/types/build/reference checks. See BUILD_HANDOFF.md for the exact tree and remaining gates; unrun checks are not passes.

## Compatibility, privacy and rollback

No schema migration, dependency, third-party source or report-format change. Existing frozen revisions remain byte-for-byte unchanged and downloadable. Case/evidence/authority/review permissions remain mandatory. Limit errors expose no report fragments. An over-limit case needs a future explicitly scoped report-selection workflow; do not delete evidence or omit reviewed findings silently to make an export fit. No live data, external collection, deployment or automatic merge.

Rollback application code only; preserve immutable report and evidence tables. Reverting restores the earlier unbounded assembly behaviour, so retain the bounded implementation unless replacing it with a verified alternative. Browser acceptance, PDF/page extraction, signatures/redaction, release approval, native/offline/restore and broader product gates remain open.
