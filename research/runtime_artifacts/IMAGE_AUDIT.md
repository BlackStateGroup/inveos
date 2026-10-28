# Pinned image native providers

28 October 2026. Research metadata only. This does not install/import Docling,
load an inspected shared library, parse a document or approve redistribution.

The previous static wheel audit identified ten native dependency names with no
bundled provider candidate. `tools/audit_runtime_image.py` examines those exact
names inside the digest-pinned Python image already used for source builds.
It first repeats actual isolation/resource qualification for the image. A fresh
non-root, networkless, read-only container receives only first-party collector
code and the name list. It inherits the existing CPU/RAM/PID/tmpfs limits and
bounded subprocess output/deadline; daemon logs are disabled. The container is
removed on success or failure, with absence checked afterwards.

The collector reads the image's ldconfig cache, selects unambiguous x86-64
candidates, verifies ELF architecture and hashes actual library files. It records
resolved paths, Debian package ownership/version and copyright-file hashes,
plus the installed Debian package inventory. No `ldd`, library import, upstream
script, apt install or network service is used. Missing candidates remain explicit;
ambiguous ownership or invalid provenance fails closed. These records are not
proof of ABI/symbol compatibility, actual loader search order, statically included
components, dlopen dependencies, a complete image SBOM or vulnerability clearance.
Copyright files are fingerprinted, not represented as fully reviewed legal terms.
The Debian package inventory excludes manually installed CPython/pip components;
the image provenance and CPython terms remain documented in PINNED_BUILD.md.

Reproduce on the qualified disposable Docker host after acquiring the existing
pinned image:

```bash
python3 -m unittest tests.test_runtime_image_audit -v
timeout 120s python3 tools/audit_runtime_image.py --output .research-cache/image-inspection.json
```

Four synthetic validation tests cover coverage, duplicate/missing/invented entries,
package ownership, digests, paths, size, architecture and false execution claims.
Hosted inspection is pending. Local Docker remains unavailable; the synthetic
validation tests are not image inspection evidence. The research workflow runs
this alongside exact-source builds and independent wheel inspection.

Next: examine the recorded native terms and security state, qualify actual loader
and minimal-pipeline imports in an appropriately bounded runtime, then benchmark
fictional PDF page/region extraction. Tika/OCRmyPDF and product integration remain
open. No case/evidence/authority, application schema or production change. Rollback
removes the tools/tests and workflow step; no investigation data is touched.
