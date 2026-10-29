# Independent container execution deadline

29 October 2026. Research-only hardening of PR #51's worker lifecycle.

The research container now starts `/usr/bin/timeout` as PID 1, with SIGKILL at
100 seconds, wrapping the trusted shell command. Trusted tests may select an
integer duration from 1 to 120 seconds; zero, fractional and unbounded values
are rejected before Docker is invoked. The image is still the same pinned
Debian/Python research image: no dependency, parser configuration, source pin,
licence approval or derivative format changes. The existing 20-second parser
limit, 90-second host attachment limit and database lease ceiling remain.

Docker restart is explicitly disabled. Before start, inspection must match the
exact timeout entrypoint, duration, shell and trusted script, as well as the
existing image/mount/resource/isolation policy. A daemon-side command change or
restart policy cannot silently remove the deadline.

This addresses a concrete gap: SIGKILL of the Node orchestrator prevents its
`finally` block from removing a daemon-owned container. The independent timer
can still stop the workload. Ordinary supervised cancellation, lease failure and
cleanup retain their existing behaviour, and no result can attach after the
orchestrator dies. The deadline starts when the container starts, not when the
job is queued or the runtime bundle is prepared.

## Verification and reproduction

```bash
npm run lint
npm run typecheck
node --import tsx --test apps/api/test/container-worker.test.ts
# On the qualified research host with the existing pinned runtime and test DB:
node --import tsx --test --test-concurrency=1 apps/api/test/native-worker.integration.ts
```

The new actual Docker test waits until the workload is running, SIGKILLs its
separate Node orchestrator, verifies the container subsequently exits with 137
under a three-second internal deadline, and confirms the fictional original is
unchanged. It then explicitly removes the stopped container. This is an actual
process-crash test, not a simulated lease rejection. Existing actual parser,
malformed-input, cancellation and resource tests run alongside it. Hosted [research #18](https://github.com/BlackStateGroup/inveos/actions/runs/40806476762), job 123226538492, passed at `a36184fc5b2aec7ded921198021362685878c057`, tree `99013b6cb3ee3e3f16199b8282ac58ebb86e8703`: four actual Docker/PostgreSQL integration tests passed, including SIGKILL of a separate orchestrator followed by independent container exit 137 and unchanged fictional original. The stopped container was explicitly removed by the test; automatic orphan deletion is not claimed. Two actual pinned-parser jobs, malformed-input rejection, normal failure/cancellation cleanup, exact source builds, native/provider inventories and qualification probes also passed. [Checks #135](https://github.com/BlackStateGroup/inveos/actions/runs/40806476854), job 123226538385, passed all 168 Node tests and 98 Python tests, zero failures/skips, plus lint/types/build/reference and actual browser/restore/isolation checks. Local lint/types, four policy tests and foundation validation passed; local Docker remains unavailable. The follow-up records documentation only; local policy tests are not Docker evidence.

## Limits and rollback

This bounds continued workload execution while the daemon/kernel remain
operational. It does not claim host-outage recovery, hostile-parser exploit
resistance, a strict real-time deadline under a suspended host, or removal of
stopped container metadata and private bundle files after orchestrator death.
A scoped orphan reconciler and crash-aware bundle retention remain required for
unattended production operation. No automatic global Docker deletion is added.

Rollback restores the previous entrypoint after stopping research dispatch;
there is no schema migration or history rewrite. Retain the no-production,
no-auto-merge and runtime licence/security gates. Human original-page review,
derivative citations and exports remain the next application work.
