# Versioned internal exhibit packages

27 October 2026. Incremental WP-07 implementation stacked on PR #4. The authenticated report endpoint, case/evidence/authority model and human review gate are unchanged. The CLI consumes an already authorised JSON download; it grants no additional application permissions.

`tools/report_package.py` creates a bounded ZIP containing the exact JSON draft and the exact cited originals, with a versioned manifest and independent offline verification. It uses Python 3.11+ standard library only. There are no new packages, upstream source, binaries, model artefacts or licence decisions.

## Run from a trusted checkout

Download an internal draft through the existing authenticated application. Use fictional cases only while the synthetic-lab limitations apply. Protect the download and its package as originals: they contain the complete cited source files, not just quoted passages, and are not encrypted or approved for client disclosure.

```bash
python3 tools/report_package.py build downloaded-report.json internal-exhibits.zip \
  --expected-report-sha256 TRUSTED_REPORT_SHA256 --expected-case-id CASE_ID
python3 tools/report_package.py verify internal-exhibits.zip \
  --expected-manifest-sha256 TRUSTED_MANIFEST_SHA256 --expected-case-id CASE_ID
```

Replace uppercase placeholders with trusted values. The build command prints a JSON receipt containing the package and manifest SHA-256. Retain `manifestSha256` in a separate trusted record before transferring the package. Do not compute a digest from a suspect archive and then call it a trust anchor. Input digest and case checks are optional but recommended. The verifier never extracts files, executes archive contents, calls the service or writes originals. Run trusted copies of **both** `report_package.py` and `verify_report.py` in the same directory, not scripts supplied by a suspect package. They run from any working directory.

Build defaults `exportedAt` to current UTC. Supply `--exported-at 2026-10-27T10:00:00Z` to reproduce an archive exactly from the same downloaded bytes and export time. This is a declared packaging time, not source time, database snapshot time or a trusted timestamp. ZIP entry timestamps are fixed to 1980 for reproducibility and have no evidential meaning. Original source and received timestamps are preserved separately and unchanged in the manifest.

Exit 0 means the declared operation/checks succeeded. Exit 1 emits a bounded JSON error excluding filesystem paths and report content. The output must be a new path. A private mode-0600 temporary file is flushed, then installed by atomic no-clobber hard link; an existing file or symlink is never replaced. Temporary files are cleaned after ordinary failures. Abrupt host failure may leave a private temporary file; this is not an fsync/restore guarantee for the containing directory. Filesystems without hard links fail closed. Do not use a publicly shared output directory.

## Version 1 format and checks

| Member | Meaning |
|---|---|
| `manifest.json` | Canonical JSON, schema `inveos.internal-exhibit-package.v1`, case ID, internal-draft status, export time, file SHA-256/lengths, exhibit mapping, exact citations and explicit omissions |
| `report/draft.json` | Exact downloaded bytes, including reviewed finding text, reviewer labels, authority version and quoted source bytes |
| `exhibits/EXH-0001.bin` and subsequent entries | Exact original UTF-8 bytes, one member per distinct evidence ID, ordered by ID |

Original names and evidence IDs are metadata only and cannot select filesystem paths. Multiple quotes from one evidence record share an exhibit. Separate acquisitions with identical bytes retain separate evidence IDs and exhibits. `original_utf8` marks the currently supported citation/representation type. No original is relabelled as a PDF or derived document.

The manifest hashes every payload, while its own hash is the external receipt. It is UTF-8 ASCII-subset JSON with sorted keys, two-space indentation, ASCII escapes and a final LF. Verification requires this exact canonical representation. Original and report bytes are never canonicalised. Unknown schema versions, missing/extra members, duplicate names or JSON keys, inconsistent mappings/lengths/hashes/quotes, non-regular entries, traversal names and corrupt CRCs fail closed. The existing report verifier additionally checks source encoding, authority field shapes and exact citation bytes. Original SHA-256s do not authenticate case narratives or dates; the externally retained manifest digest binds all manifest and payload bytes when supplied.

V1 deliberately accepts only single-volume, uncompressed ZIP with no ZIP64, comments, encryption, extra fields, data descriptors or hidden local bytes. Local and central directory headers must agree. It bounds the input to 64 MiB, central directory to 256 KiB before allocating its entry list, members to 1,002, manifest to 4 MiB, report to 32 MiB, originals to 2 MiB each and findings to 1,000. These are offline limits, not enlarged API upload limits. Use a new reviewed schema for compression, larger cases or other formats rather than weakening these checks silently.

## Trust and remaining work

Unanchored verification establishes internal consistency only. An attacker can replace a complete package and recompute its manifest; the external digest detects that replacement only if retained independently. ZIP container bytes have a separate receipt hash, while the manifest digest binds the logical payload and metadata. No hash proves source truth, authenticated reviewer identity, lawful authority, custody or admissibility.

Every manifest explicitly omits uncited evidence/full inventory, custody/access history, derivatives/PDF/DOCX/redactions, signatures/external ledger anchors and client-release approval. This is an **internal draft package**, not the complete WP-07 product. Do not invent a custody chain from a report snapshot or treat successful packaging as release approval. Existing original and review permissions remain server responsibilities.

Next dependent slices: consistent report snapshots with scoped real audit/custody history, a versioned report model, safe report rendition, redaction and explicit investigator-approved release. Binary originals, parser lineage, jobs and page/region review remain separate work. The isolation probe still fails with `Creating new namespace failed: Operation not permitted`; no upstream parser was executed to obtain these package results.

## Verification and rollback

```bash
python3 -m unittest discover -s tests -v
npm run test:foundation
npm run lint
npm run typecheck
npm run build
# With the documented disposable PostgreSQL environment:
npm test --workspace @inveos/api
```

Fifteen new Python tests cover exact bytes and reproducibility, Unicode quotes, duplicate acquisitions, metadata-only hostile filenames, manifest/exhibit/report tampering, complete-rewrite trust limits, missing/extra/duplicate members, compression, symlinks, directory/member size limits, CRC corruption, hidden bytes and local-header mismatch, timestamp/JSON rejection, atomic failures, permissions and standalone CLI round-trip. The existing report verifier also now handles oversized JSON integer decoding failures without an uncaught traceback.

The real-PostgreSQL lifecycle test builds a package from the actual API response, verifies it against its retained manifest digest and case ID, and corrupts an original byte in the archive to confirm failure. Adding that test is not an execution receipt: `BUILD_HANDOFF.md` records the actual local/hosted results. No new browser, device, restore or parser test is implied. No database migration, routes or UI changes. Rollback removes this CLI/tests/docs, its API-test assertions and the small verifier error-handling hardening; no persisted records change.
