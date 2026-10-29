# Leased native-document research worker

29 October 2026. Continues PR #50; research-only execution, not runtime shipping
approval or production readiness. No upstream source/artifact is committed.

## Implemented flow

`runNativeDocumentJob` claims one explicitly scoped native PDF lab job, verifies
its binary original, prepares a fresh ignored private bundle from the previously
hash-locked wheels and exact pinned source, and executes the existing native
pipeline against that one original. Preparation reads upstream files as data;
only the offline container imports them. The same audited preparation function
is reused by the earlier two-run research experiment.

A complete matching runtime-host qualification receipt, less than 15 minutes
old, is required before claim. It must record network/write, timeout, stdout,
stderr, memory, PID and CPU probes and the pinned image. The receipt is trusted
operator evidence, not a signature or automatic proof that another host is
qualified. Run probes on this same Docker host before each research batch.
Container image inspection and exact runtime configuration checks happen again
for every attempt. Image-declared volumes and additional mounts are refused.

The Docker client always addresses the local Unix socket. It never pulls an
image or receives evidence-controlled commands. The container runs as 65534,
without networking, daemon logs, capabilities or privilege escalation, with a
read-only root and one read-only bundle mount. RAM/swap are 1 GiB, CPU 0.5, PIDs
32, scratch 512 MiB and output scratch 16 MiB; writable tmpfs mounts are noexec,
nosuid and nodev. Stdout/stderr share the existing 1 MiB capture bound. Conversion
is limited to two pages, 65,536 bytes and 20 seconds; the attached process has a
90-second wall limit and periodic scoped lease renewal. The five-minute attempt
ceiling remains enforced by PostgreSQL.

**Stopping the Docker CLI is not sufficient.** The supervisor always issues
`docker rm -f -v` for its random, known container name, then performs a successful
daemon listing to confirm absence. Cleanup ignores abort/lost-lease signals and
has its own bounded commands. Output is withheld until this completes. Failure
to confirm cleanup raises `container_cleanup_unconfirmed` and cannot attach a
result. This protects normal aborts and detected failures; it is not a guarantee
against host/daemon failure, SIGKILL of the orchestrator or a late daemon create
after a timed-out request. A labelled-orphan reconciliation service is still
required before unattended/production operation.

On success, the parent verifies the worker's original digest and success state,
constructs context from the scoped database job, then calls PR #50's transactional
attachment. The original is re-read and all lease/authority/membership checks
repeat there. Source/received/processed times retain their existing meaning.
The native JSON is parsed and serialised by the first-party parent before storage;
its raw digest covers those stored native bytes, not an alleged byte-for-byte
capture of stdout. It is not interchangeable with the Python research envelope.

Execution/output failures record `worker_execution_failed` if the lease and
scope remain current; no result exists. Unconfirmed cleanup records
`worker_cleanup_unconfirmed` where still authorised and raises an operational
error. Abort/renewal failures do not invent successful completion: cancellation
or changed scope may already have cancelled the job; otherwise the lease expires
and the existing bounded retry mechanism applies. Private per-attempt files are
removed in `finally`. Originals remain immutable/quarantined and results remain
unreviewed; no review, finding, report or release is created.

## Running the synthetic research worker

Use a qualified disposable Linux Docker host, the existing development PostgreSQL
roles/storage, Node 22, Python 3.11+ on the host and the pinned CPython 3.12 image.
Acquire/build only the ignored research artifacts using the commands in
`research/runtime_artifacts/PINNED_BUILD.md` and `NATIVE_EXPERIMENT.md`; no network
acquisition occurs during a leased job. The selected runtime and exact-source
wheel are re-hashed on every preparation. Native licence/security approval is
still open, so this entry point is restricted to explicitly fictional research.

Generate a current qualification receipt on that host:

```bash
python3 - <<'PYTHON'
import json
from pathlib import Path
from datetime import datetime, timezone
from tools.probe_worker_isolation import run_probe
from tools.build_docling_research import IMAGE
receipt = {**run_probe(IMAGE, runtime=True),
           'checkedAt': datetime.now(timezone.utc).isoformat()}
Path('.research-cache/worker-qualification.json').write_text(json.dumps(receipt))
PYTHON
```

Enable `INVEOS_DOCUMENT_LAB=1` only in the local API to queue the existing lab job
kind (see doc 59). Then explicitly execute one known job:

```bash
INVEOS_DEV_LAB=1 INVEOS_RESEARCH_NATIVE=1 node --env-file=.env --import tsx \
  apps/api/src/run-native-document-job.ts TENANT_UUID CASE_UUID JOB_UUID
```

The CLI uses the restricted `INVEOS_DATABASE_URL`, absolute
`INVEOS_STORAGE_ROOT` and default `inveos` schema. It rejects production mode,
missing research opt-in and invalid scope. It never discovers tenants or adds a
background dispatcher. SIGINT/SIGTERM request supervised cleanup. Receipt stdout
contains only job status/failure code. Host preparation uses `/usr/bin/python3`
and container commands use `/usr/bin/docker`; supported paths are deliberately
explicit. Do not mount database credentials, the whole repository or the original
store into the parser container.

## Verification

`node --import tsx --test apps/api/test/container-worker.test.ts` checks weakened
configuration rejection and the qualification contract locally. These unit tests
are not Docker evidence.

The research workflow now provisions a disposable PostgreSQL service and runs:

```bash
node --import tsx --test --test-concurrency=1 apps/api/test/native-worker.integration.ts
```

This separate integration file requires the already acquired/built research
runtime and fresh qualification receipt. It executes two real pinned parser jobs,
compares original/raw/profile digests and page-two references, retrieves durable
results through the API and rejects malformed PDF input. It also runs actual
daemon workloads to test lease loss, abort, output overflow, timeout, nonzero exit,
PostgreSQL cancellation and changed authority, confirming container absence and
no derivative attachment. These failure workloads are first-party shell probes,
not hostile PDFs or upstream exploit tests. Exact hosted evidence is pending.

## Remaining gates and rollback

Human original-page/region review and derivative citations, derivative-aware
exports, broader OCR/Tika comparison, native licence/security approval, dedicated
worker credentials/RLS, image maintenance and orphan reconciliation remain open.
No native-device, pilot or production readiness is asserted. Operators must keep
Docker daemon access away from the API and untrusted callers; this prototype
uses a trusted research orchestrator, not a production credential boundary.

No migration or npm dependency is added. Disable the research CLI/queue flag to
roll back; preserve prior jobs/results. Never remove containers belonging to
another service. The `inveos.research-worker=true` label and random names identify
this runner's workloads for an operator's reviewed recovery after a crash.
