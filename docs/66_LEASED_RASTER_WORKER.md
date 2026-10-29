# Leased raster worker research integration

29 October 2026. Continues PR #56. `runRasterDocumentJob` is a trusted research-only function, not an HTTP execution endpoint or an automatic dispatcher. It accepts only raster jobs and reuses the existing fresh image qualification, original verification, renewable authority-bound lease, bounded no-network non-root read-only container and mandatory cleanup. The native document entry point remains document-only.

The first-party renderer is shared by the existing pixel-ground-truth experiment and single-original worker. Hash-locked wheels are expanded as data; native imports occur only inside the qualified container. Output passes the existing strict PNG/profile/context boundary and atomic append-only attachment. Originals remain quarantined; rendering cannot create findings or approve citations. No dependency version, licence approval, schema or production setting changes.

## Reproduction

Run `npm run lint`, `npm run typecheck`, `npm run test:foundation`. Use `.github/workflows/docling-build-research.yml` for exact pinned acquisition/build, licence/native inventory replay, actual image isolation probes, pixel experiments and fresh qualification. With its disposable PostgreSQL roles and environment, run `node --import tsx --test --test-concurrency=1 apps/api/test/native-worker.integration.ts`. The workflow supplies all prerequisites; do not invoke native Python runners on the host.

Actual acceptance covers two durable raster jobs, equal page hashes, scoped PNG retrieval, unchanged source identity, quarantine, repeat invocation, malformed PDF rejection and container/bundle cleanup. Shared daemon tests exercise cancellation and authority revocation for both job kinds, plus overflow, timeout, abort and orchestrator crash deadline. Local Docker remains unavailable; hosted outcomes must be recorded explicitly.

## Remaining work

Page review UI/overlays, human-reviewed derivative citations and export lineage, raster dispatch policy, orphan reconciliation, wider document fidelity and legal/security/runtime approval remain open. Tika and OCRmyPDF comparative benchmarks remain unrun. Disable lab queueing to stop new research jobs; preserve existing immutable results and history. Nothing merged or deployed.

## Executed evidence

Draft PR #57 passed [Research #26](https://github.com/BlackStateGroup/inveos/actions/runs/40834655992), job 123316498313, at `c475b138cd3aa83ea1c86f23f7a98872b31bc0ac`, tree `b0ef13613b2448ca367394efdabe36091b4ad0d3`: five actual Docker/PostgreSQL worker tests, zero failures/skips. Two durable raster jobs produced identical 612×792 pages (3,567 bytes; SHA-256 50e3726dbc53662c02291c03b3800b2d22d4f75d35f8bacfb7b0d48181de94ce), served verified page bytes and preserved source digest/quarantine. Malformed inputs attached no results; repeated invocation returned no new work; containers and temporary bundles were absent after completion. Both job kinds passed running-worker cancellation/authority checks. Existing parser, crash-deadline, bounded-output, exact build/native inventory, pixel experiment and separate raster boundary checks passed. [Checks #148](https://github.com/BlackStateGroup/inveos/actions/runs/40834656042), job 123316498612, passed 182 Node tests and 101 Python tests, zero failures/skips, lint/types/build/reference, browser/restore and host-isolation probes. Local lint/types, Python compilation and all 101 Python tests passed. Evidence follow-up changes documentation/receipt only; resume #57 after fresh main/review checks. No production or licence approval is implied.
