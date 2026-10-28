# Lease-aware first-party process supervision

28 October 2026. `runLeasedWorker` connects the existing scoped PostgreSQL renewal
helper to `superviseWorker`. The latter supervises trusted first-party Linux
commands, not arbitrary user-selected executables or evidence-supplied arguments.
It is not exposed through HTTP and is not a replacement for parser isolation.

Before spawn, periodically (default 20 seconds) and after successful process exit,
it requires a successful lease check. Null/false, database error or a five-second
renewal timeout stops work and discards output. Late renewal results cannot return
output or commit a result. Database calls are not forcibly cancelled by the timeout;
existing SQL timeouts bound normal queries, while a broken connection may remain
pending in the pool. Result attachment must still revalidate the token and authority
inside the existing transaction; a successful subprocess cannot complete a job.

The child receives no inherited credentials/environment, no stdin and no shell.
Only LANG is supplied. Output is capped at 1 MiB across stdout and stderr; stderr is
discarded and exception messages contain fixed codes only. The child lifetime is
bounded to at most four minutes, below the five-minute attempt ceiling, including
final revalidation. Initial preflight has its own five-second bound. Abort,
timeout, output overflow, nonzero exit and spawn errors fail closed. Linux process
groups are killed on stop and parent exit, including descendants holding pipes.

This is process lifecycle control, not an OS security boundary. It cannot contain
malicious children that escape the process group, constrain their CPU/RAM/network,
or remove daemon-managed containers. Do not use it for upstream parsers or Docker
attachments without the separately qualified isolation and explicit container
cleanup adapter. Only original fictional Node fixtures execute in this slice.
The existing Python isolated research runner remains unchanged.

Reproduce local process tests with:

```sh
node --import tsx --test apps/api/test/leased-worker.test.ts
```

The normal API suite also starts an actual first-party subprocess against real
PostgreSQL, cancels/revises authority while it runs, confirms its marker stops
changing and checks that the old worker cannot finish the job. Other process cases
cover healthy output, environment stripping, initial/final lease denial, thrown or
stalled renewal, running abort, combined output limits, wall timeout, nonzero exit,
spawn failure and inherited-pipe cleanup. Hosted full verification is pending.

No dependency, migration, production deployment or parser approval. No application
job kind invokes this helper yet; PDF dispatch/result attachment, original-page
human review, dedicated worker credentials and runtime clearance remain open.
Rollback is removal of this additive helper and tests; no data migration required.
