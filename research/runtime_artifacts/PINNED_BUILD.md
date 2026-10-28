# Exact-source Docling wheel experiment

28 October 2026. Research build only; **no parser run, runtime incorporation,
redistribution approval or product-completion claim**.

The published Docling 2.142.1 wheel differs from source pin
`90234a71b16785d08fd2f46ec62668dd2396db76`. This experiment builds the pin itself,
then checks every packaged `docling/` file and the root licence against immutable
Git blobs. It must produce identical wheel bytes in two fresh, isolated containers.
The earlier same-version wheel remains unsuitable as evidence for that pin.

## Build inputs and terms

The pinned `pyproject.toml` uses Hatchling with no custom build hooks. The helper
accepts only that exact backend/configuration and package identity. It snapshots
318 regular Git blobs (4,094,294 bytes), including 313 package files and five build
support files. It rejects symlinks/submodules, unsafe paths, missing support files,
oversized blobs and unexpected build configuration. No working-tree modifications
or untracked files enter the build. The local snapshot manifest SHA-256 is
`85f74307cb5e3918da6ae7cc3e033dfb460846c4480bc25113cac4d8d68aadb1`.

`docling-build.lock` binds six wheel-only build artifacts; `docling-build.json`
records actual metadata, notice hashes, Python bounds and transitive declarations.
The acquired notices were read, rather than inferring permission from project names:

| Build tool | Selected version | Observed terms |
| --- | --- | --- |
| Hatchling | 1.33.0 | MIT |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause; MIT adaptation in licence code |
| pathspec | 1.1.1 | MPL-2.0 in the actual included LICENSE |
| pluggy | 1.7.0 | MIT |
| tomlkit | 0.15.2 | MIT |
| trove-classifiers | 2026.9.21.13 | Apache-2.0 in the actual included LICENSE |

Hatchling's TOMLi requirement applies only below Python 3.11; the selected builder
uses Python 3.12. No pathspec optional native matching extras are selected. These
unmodified tools are used only inside a temporary offline research builder. MPL
and bundled terms still matter if tools or outputs are later distributed. The
notice scanner can include code under a directory named `licenses`; that inventory
is deliberately conservative and is not a legal approval or a complete SBOM.

The disposable Linux amd64 builder is pinned to
`python@sha256:623674a14ef93d052bb9b0de4dbf5f28eb578a35263838941cc8aa43213c1487`.
The official registry manifest identifies Python 3.12.16 on Debian bookworm-slim,
Docker-library source revision `3d7e95597e56a415d9e4abc0f15877e005d2cb2e`, and base
digest `sha256:a3bba7dc7dbcc1f37c2856c51fc9a7fac96608f50cb87b1b4e4d8b8c85ae988e`.
The source [Dockerfile](https://github.com/docker-library/python/blob/3d7e95597e56a415d9e4abc0f15877e005d2cb2e/3.12/slim-bookworm/Dockerfile)
declares CPython source SHA-256
`b5796915dc45ff745cfb4e990a7e7c93d6f546328a102ce31448d69ebc37575c`.
The Docker-library [LICENSE](https://github.com/docker-library/python/blob/3d7e95597e56a415d9e4abc0f15877e005d2cb2e/LICENSE)
is MIT; the CPython [LICENSE](https://github.com/python/cpython/blob/v3.12.16/LICENSE)
contains PSF and historical licence terms. These do **not** license every Debian
package in the image. This is a disposable build tool, not a selected application
parser image. Complete native-image SBOM, security/redistribution review and the
47-artifact parser runtime review remain open. No image or upstream code is copied
into INVEOS or uploaded as a workflow artifact.

## Isolation and result verification

Acquisition occurs before execution. The existing first-party host probes must
pass against this exact image, including RAM/PID/CPU/output enforcement. Two fresh
containers then use the captured image ID, non-root UID, no network, read-only
source/wheels/root, no capabilities, no-new-privileges, 128 MiB RAM/swap, 0.5 CPU,
32 PIDs and separate 16 MiB scratch/output tmpfs. Daemon logging stays disabled.
Each build has a 45-second attachment deadline and 4 MiB combined capture cap.
Only the checked bundle is mounted; no repository, credentials or Docker socket.

Pip installs only hash-locked build tools offline into scratch. Hatchling packages
source but does not import Docling or install its runtime dependencies. The source
date epoch is fixed. Wheel bytes return as bounded base64, are checked for a safe
and exact package file set, size/expansion bounds, individual source hashes, licence
hash and distribution identity, and are compared across both builds. Containers
and temporary wheels are destroyed even on failure. Source hashes are rechecked.
No application evidence/derivative record is written by this experiment.

## Reproduce and verification

On a disposable supported Docker host, Python 3.12 and Git:

```bash
python3 tools/mine_sources.py --fetch docling-project/docling
python3 -m pip download --only-binary=:all: --require-hashes -r research/runtime_artifacts/docling-build.lock --dest .research-cache/docling-build-wheels
docker pull python@sha256:623674a14ef93d052bb9b0de4dbf5f28eb578a35263838941cc8aa43213c1487
timeout 180s python3 tools/build_docling_research.py --source .research-cache/sources/docling-project/docling --wheels .research-cache/docling-build-wheels
```

The separate `Pinned Docling research build` workflow runs the same commands on
relevant PR changes or manual dispatch. Local four synthetic verifier/configuration
tests and the actual pinned-source snapshot pass. Hosted build execution is pending.
Local Docker remains absent; no upstream tool was executed outside isolation.

Next gates: actual isolated exact-pin build receipt, full native/runtime audit and
minimal pipeline import qualification, then synthetic PDF page/region comparisons
with rejected malformed/partial/encrypted inputs. Tika/OCRmyPDF remain unexecuted.
Successful packaging would resolve source provenance only; it would not establish
extraction quality, runtime completeness, licence approval or production safety.
