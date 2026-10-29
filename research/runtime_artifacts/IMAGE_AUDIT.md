# Pinned image native providers

28 October 2026. Research metadata only. This does not install/import Docling,
perform an explicit candidate loader test, parse a document or approve redistribution.

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
plus the installed Debian package inventory. No `ldd`, wheel import, explicit candidate loading, upstream
script, apt install or network service is used. Missing candidates remain explicit;
ambiguous ownership or invalid provenance fails closed. These records are not
proof of ABI/symbol compatibility, actual loader search order, statically included
components, dlopen dependencies, a complete image SBOM or vulnerability clearance.
The interpreter and metadata utilities use their normal base-image libraries; this is not a claim that no shared library executes in the container.
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
Hosted [research run #6](https://github.com/BlackStateGroup/inveos/actions/runs/40748289670) passed at `f1ee99f8e4ad065b3c470890e0a2aa1ae1918e62`, tree `355b442d5a7861d8105f1b495b918764df0ceff1`: all ten native names have unambiguous x86-64 image candidates, with file hashes, four owning package identities and copyright-file hashes recorded; 105 installed Debian packages inventoried. Exact-source builds, native wheel replay/independent comparison and image isolation probes also passed. [Checks run #115](https://github.com/BlackStateGroup/inveos/actions/runs/40748288448) passed at that revision: all 135 Node tests (98 PostgreSQL API/restore, five real Chrome journeys, 32 helpers), zero failures/skips; 72 Python tests, lint/types/build/reference and service-image isolation. Local Docker remains unavailable; the synthetic
validation tests are not image inspection evidence. The research workflow runs
this alongside exact-source builds and independent wheel inspection.

Next: examine the recorded native terms and security state, qualify actual loader
and minimal-pipeline imports in an appropriately bounded runtime, then benchmark
fictional PDF page/region extraction. Tika/OCRmyPDF and product integration remain
open. No case/evidence/authority, application schema or production change. Rollback
removes the tools/tests and workflow step; no investigation data is touched.


## Observed providers

The [machine-readable receipt](image-provider-receipt.json) binds the image and
native inventory hashes to this run. Provider packages are libc6:amd64
2.36-9+deb12u14 (loader/libc/libdl/libm/libpthread/libresolv/librt), libgcc-s1:amd64
12.2.0-14+deb12u1, libstdc++6:amd64 12.2.0-14+deb12u1 and zlib1g:amd64
1:1.2.13.dfsg-1. No dependency name was missing. These versions are observations,
not vulnerability or licence clearance. The wheel ABI/symbol versions and actual
minimal-pipeline imports still need testing; finding a file does not prove it can
satisfy a particular binary's relocation requirements.

The final follow-up records this receipt and documentation and clarifies a
collector docstring; the linked implementation revision is the one actually tested.
