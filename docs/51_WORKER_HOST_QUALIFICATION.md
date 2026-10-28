# Worker host qualification

This first-party probe is a prerequisite experiment for WP-05, not a parser benchmark or permission to ship dependencies. Local Docker is absent; unsupported hosts fail closed. On the disposable CI host it reuses the already-present PostgreSQL test image, replaces its entrypoint with first-party shell checks and never starts another database, pulls an image or executes a document parser. The image tag is resolved once to its immutable local image ID, which is recorded in the receipt. This convenience image is not selected or licensed as the future parser runtime.

Run `python3 tools/probe_worker_isolation.py --image postgres:15` on a supported Docker host after its existing test image is present. CI bounds the whole command to 90 seconds. The probe creates random named containers with UID/GID 65534, no network, no capabilities, no new privileges, read-only root and original, bounded noexec scratch, 0.5 CPU, 128 MiB RAM/swap total and 32 PIDs. Only a fictional original is host-mounted read-only. Output uses a separate 16 MiB noexec tmpfs; it cannot fill a host output directory. Image-defined volumes are replaced with bounded read-only tmpfs, with unsafe or conflicting paths rejected. No host credentials, repository or Docker socket is passed into the container. Temporary output is not trusted application evidence.

It checks actual denial of original/root writes and host-loopback access (against a confirmed listener), absence of a default route and Docker socket, zero effective capabilities, no-new-privileges, cgroup-visible limits, successful separate output, scratch and output exhaustion, original hash preservation and forced removal after a wall-time expiry. The original probe inspected CPU/RAM/PID caps; the resource-enforcement extension below now exercises them. It does not claim resistance to kernel exploits, malicious PDFs, complete egress analysis, production tenancy or a safe arbitrary parser executor. Python policy tests deliberately weaken settings and require rejection; those tests alone do not prove isolation.

All containers and anonymous volumes are removed even on probe failure. There is no application/schema change; rollback removes the CI step, probe and tests. Before parsing: select minimal runtime artifacts, resolve hashes/SBOM/notices and vulnerability review, rerun and strengthen these checks with that exact image, retain image-volume overrides and output caps, bound pages/archive expansion and test malformed/partial results. Docling/Tika/OCRmyPDF remain unexecuted and unapproved for incorporation.

## Verification receipt — 28 October 2026

[Checks run #85](https://github.com/BlackStateGroup/inveos/actions/runs/40666029560) passed at `728d57ad674a1040498f45d1ab1fa4a160fe88d0` (tree `5ee6cf36725f32cd242fd2865c494cb6eaf45bf5`). Both actual probe cases passed on Ubuntu 24.04 hosted CI. Image ID: `sha256:245fc027b7f3755bbd21b4375c2a0ebc7fa5d16c4573da497be9850a823973c8`; repository digest: `postgres@sha256:64b99032e218b66b1d1a6334995056e1aa57f50a0c522cc856e72dff0e4b0d63`. Original SHA-256 remained `1651f4fbefda7bbe2392733ed07f5ce88677462304db3609c6cd2b5a825c1cb3`. All 123 Node tests with zero skips and 45 Python tests passed, alongside lint/types/build/reference checks. Parser execution remains false. This establishes a host path for the next experiment, not parser quality or production readiness.

## Containment extension

Policy checks now raise explicitly under normal and optimised Python (`-O`), rather than relying on removable assertions. Both scratch and output exhaustion are exercised. Image volume destinations are validated and overridden read-only before execution, and write attempts against them must fail. Inspected mounts reject unexpected destinations and writable host output. Output equality is checked inside the container before destruction; this probe does not export untrusted parser output. Six local policy tests include a real optimised-interpreter negative case. [Checks run #89](https://github.com/BlackStateGroup/inveos/actions/runs/40679684132) passed at `38dcafb27f182cd499e2b66ae70211c4fa30ee7f`, tree `6b3b6e1d3039060e76b6e12a2efeadc69430898e`: all 123 Node tests with zero skips/failures, 52 Python tests, lint/types/build/reference and actual strengthened isolation probes passed. The receipt confirms `/var/lib/postgresql/data` was overridden read-only, scratch/output exhaustion and timeout cleanup passed, and original SHA-256 remained unchanged. Image ID `sha256:245fc027b7f3755bbd21b4375c2a0ebc7fa5d16c4573da497be9850a823973c8`; repository digest remains the run #85 image. No parser executed.

## Resource and subprocess extension — 28 October 2026

The probe now disables Docker daemon logging (`--log-driver=none`) and rejects any
other configured logging driver. Limiting Python capture alone would leave an
independent, potentially unbounded daemon log on disk. No image, upstream code,
new package or application dependency is introduced.

`tools/bounded_process.py` concurrently drains stdout and stderr as bytes with a
**combined** byte cap, fixed-size reads and a monotonic deadline. It does not use a
shell, inherits no stdin, keeps binary output intact and includes no captured
output in limit exceptions. It kills the CLI process group, including ordinary
children holding inherited pipes. Container removal remains unconditional in the
caller: killing `docker start -a` does not kill the daemon-managed workload. All
Docker management commands use bounded capture too (1 MiB, normally 20 seconds);
probe attachment uses 16 KiB combined stdout/stderr. A process which creates a
new session can escape process-group cleanup; this helper is **not** a sandbox or
a replacement for container/cgroup enforcement.

Actual first-party probes now require:

- Repeated stdout and stderr floods to cross the capture cap, followed by forced
  container removal and an absent-container check.
- Main-shell memory growth to exit 137 with Docker recording `OOMKilled=true`.
  A generic non-zero exit is insufficient evidence of memory enforcement.
- A short-lived process burst to produce a positive `pids.events` max counter.
- A CPU loop to increase `cpu.stat` throttled microseconds under the 0.5 CPU cap.

The receipt records kernel observations, immutable image identity, the capture
bound and the original hash. Counter values and timing vary with host scheduling;
these are enforcement observations, not capacity/throughput promises. The whole
CI command retains its 90-second ceiling. Failure to observe a boundary fails the
probe rather than skipping it. The existing scratch/output exhaustion, immutable
mount, network and timeout probes still run.

Reproduce with `python3 -m unittest tests.test_bounded_process tests.test_worker_isolation_probe -v`
and, on the supported host with its already-present test image,
`timeout 90s python3 tools/probe_worker_isolation.py --image postgres:15`.
Local subprocess/policy tests passed; local Docker is absent and its probe fails
closed. Hosted resource observations are pending publication and CI verification.

This still executes only first-party shell fixtures. Exact-source Docling builds,
native dependency/SBOM/licence review, selected parser image qualification,
malformed PDF/partial-result tests and all three parser benchmarks remain open.
Do not infer parser readiness or hostile-kernel/exploit resistance from this gate.
Rollback removes this extension and its helper/tests; there is no schema or data
migration. The older host receipt above remains evidence for its exact revision.
