# Native runtime declarations — 28 October 2026

Research inspection only. No wheel was installed, imported or executed. The exact
47-artifact acquisition lock was replayed into ignored cache and matched against
the recorded SHA-256 inventory before scanning. Source and wheel redistribution
remain unapproved. The mismatching published Docling wheel remains a reference;
use the verified exact-source recipe for any future runtime experiment.

## Measured result

The 317,397,612 expanded bytes contain **219 ELF binaries**: SciPy 111, pandas 45,
Pillow 26, NumPy 22, lxml seven, charset-normalizer two, and one each in
Docling-parse, pydantic-core, pypdfium2, PyYAML, rpds-py and Rtree. The JSON inventory
binds each binary to its wheel digest, member path, size and SHA-256, and records
DT_NEEDED, SONAME, RPATH and RUNPATH directly from ELF program/dynamic tables.

Every dependency/search-path record matched independent `readelf --dynamic --wide`
inspection using GNU Binutils for Ubuntu 2.42. Temporary comparison files are
non-executable, private, removed afterwards and never loaded. `ldd` is not used.

Ten dependency names have no bundled filename/SONAME candidate: the ELF loader,
libc, libdl, libgcc_s, libm, libpthread, libresolv, librt, libstdc++ and libz. These
are **requirements to check against the selected image**, not proof of missing
packages. Candidate matches across wheels do not establish loader resolution:
RPATH/RUNPATH, ABI and symbol versions still require actual isolated qualification.
The scanner does not discover dlopen targets or statically linked components.

Pillow includes AVIF, JPEG, TIFF, OpenJPEG, FreeType, HarfBuzz, WebP, Brotli, X11
and compression libraries beyond its root MIT-CMU declaration. Rtree includes
libspatialindex; PDFium and Docling-parse each contain a native parser binary.
Read root and bundled notices separately: Docling-parse also ships Adobe CMap
terms; lxml's LICENSES.txt lists exceptions; NumPy/SciPy/PDFium have multiple
bundled notices. These observations do not constitute complete native licence or
vulnerability clearance. In particular, one Python package licence is insufficient
for all components statically included in a binary. No integration approval follows.

## Reproduce

```bash
python3 -m pip download --only-binary=:all: --require-hashes -r research/runtime_artifacts/docling-native-cp312.lock --dest .research-cache/docling-locked-cp312
python3 tools/audit_native_wheels.py .research-cache/docling-locked-cp312 --inventory research/runtime_artifacts/docling-native-cp312.json --output .research-cache/native-elf.json --compare-readelf
python3 -m unittest tests.test_native_wheel_audit -v
```

Python 3.12 Linux x86-64 is the acquisition target; the static reader needs Python
3.11+. Six synthetic tests cover declared dependencies, search paths, unsupported
ELF formats, malformed ranges/strings/tables and inventory hash/set mismatches.
The reader has byte/member/expansion limits, accepts only ELF64 little-endian
x86-64 executable/shared objects and fails closed on malformed or unsupported ELF.
It does not extract or execute wheel members. Independent comparison additionally
requires `readelf`; it is bounded by the existing subprocess helper. The separate
research CI workflow reproduces the entire inventory and independently compares
all binaries. Hosted [research run #4](https://github.com/BlackStateGroup/inveos/actions/runs/40737697192) passed at `05c73994234b72fd30d3cb7338c8a88acad152cf`, tree `a10bdf0e9548ea8b08dd11734fec2b009365eff3`: hash-locked reacquisition reproduced the native inventory exactly; GNU readelf 2.42 independently matched all 219 binaries. The exact-source Docling wheel also rebuilt twice to the prior recorded digest and all builder-image isolation probes passed. [Checks run #113](https://github.com/BlackStateGroup/inveos/actions/runs/40737697501) passed at the same revision: 135 Node tests (98 PostgreSQL API/restore, five real Chrome journeys, 32 helpers), zero failures/skips; 68 Python tests, lint/types/build/reference and service-image isolation checks. The receipt follow-up changes documentation only.

Next: map these ten names and native component notices to the exact image, inspect
statically included components and security advisories, then install only the
reviewed closure in an isolated research runtime and test minimal native-pipeline
imports. Actual synthetic PDF/page/region benchmarks, Tika/OCRmyPDF and application
integration remain unrun. Rollback removes the audit tooling/inventory/workflow
extension; no application/schema or evidence records change.
