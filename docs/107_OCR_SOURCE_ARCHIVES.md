# Corresponding source archives for the OCR research runtime

The existing research runtime has 161 exact Debian binary archives locked. This increment retains their **116 corresponding source-package revisions**, including every descriptor-listed component, so the build can no longer proceed with only binary archive evidence. It does not add or install any dependency, execute acquired sources or approve distribution.

## Exact correspondence and bounded acquisition

The [source lock](../research/runtime_artifacts/tesseract-sources.lock.json), SHA-256 `3626ab89c4f33e2b4100b84a5739bc8959b8ae1a78d3a98294d411245539c8d0`, binds the unchanged binary archive lock `6d834f36b61e7adbb37961403b2b6de0bde2de3c844b7db6be145fa3e0e50197`. It records **116 source revisions, 377 distinct files and 862,444,206 declared bytes**. All 161 installed binary names have a source mapping. The largest file is the existing Tesseract language source archive, 352,215,003 bytes. All 116 acquired descriptors have cleartext signature envelopes; **those signatures have not been authenticated**.

The reader derives source names and exact versions from each binary's Source field, preserving epochs and explicit source versions. It also handles exact Built-Using references and rejects unsupported relations. It does not guess source versions by removing binary suffixes. The unchanged binary lock must still match the complete installed inventory. Source package identity, binary correspondence, source format, declared build dependencies and every SHA-256/SHA-1/MD5 component identity are retained. MD5 and SHA-1 are additional descriptor consistency checks; the committed SHA-256 lock provides later content pinning.

[Debian source descriptor/control definitions](https://www.debian.org/doc/debian-policy/ch-controlfields.html) and [Debian Snapshot](https://snapshot.debian.org/) provide the primary format and acquisition references. Discovery uses exact-version official HTTPS metadata. Later acquisition uses only the committed file identities. It allows only the exact HTTPS snapshot host, including redirects. A source component is bounded at 384 MiB, a descriptor at 256 KiB, a source package at 64 components and the declared closure at 2 GiB. Streaming uses at most 64 KiB chunks; timeouts and an elapsed download deadline reject slow or oversized responses. Temporary downloads are removed on failure and never become accepted cache entries.

No source archive is extracted or interpreted as a program. Descriptor parsing accepts the measured 1.0, 3.0 native and 3.0 quilt formats, checks identity and all three checksum tables, and rejects duplicate fields/components, path-bearing names, inconsistent sizes, malformed signature envelopes and missing components. Source and binary inventories are compared again on every replay. Cached symlinks, missing files and changed hashes fail closed. Actual notices from the binary archive audit remain separately verified; source acquisition does not reinterpret them as permission.

## Integrated build and reproduction

The existing OCR research workflow acquires the inert source files, rechecks them offline and retains a small source receipt. The supplier experiment requires another offline recheck **before** constructing its networkless binary-archive build, and includes the receipt in the measured result. Only the existing verified binary archives and first-party Dockerfile enter that build context. Source archives, credentials and case data do not enter it. The same exact runtime/native/model/notice checks and real supplier/corpus/worker qualification still follow.

From the repository root after the documented locked setup:

```sh
# Acquire only the committed source identities, without extraction/execution.
python3 tools/ocr_source_archives.py
# Reverify every byte and source/binary correspondence without network.
python3 tools/ocr_source_archives.py --offline
python3 -m unittest discover -s tests -p test_ocr_source_archives.py -v
```

Explicit new discovery writes a proposal and refuses an existing destination:

```sh
python3 tools/ocr_source_archives.py --discover .research-cache/proposed-ocr-sources.json
```

All descriptor/source bytes remain in ignored `.research-cache/ocr-sources/`. Only first-party reader/tests and the measured metadata lock are committed. The cache is about 0.86 GB and may be removed once no experiment needs it; future runs reacquire only locked content. No new project dependency or upstream application code is introduced.

## Executed evidence and remaining gates

Actual local discovery acquired all 116 source revisions and 377 files. The complete offline replay passed against the active lock with the exact count/bytes above. **157 Python tests pass**, including six new checks covering source/Built-Using identity, signed/unsigned descriptor parsing without authentication claims, corrupt/duplicate/traversing/oversized components, partial offline closure, altered binary/source mappings, hash/metadata drift, symlinks and actual slow/corrupt HTTP acquisition with partial-file cleanup and recovery. Workflow validation and foundation validation pass. Reviewed head `85c0ba74247e890388e66e52a88b732f464a5051` passed **Checks 41002646408 / job 123890361834**: **403 Node/157 Python, zero failures/skips, 38 actual production browsers plus two development journeys**, lint/types/build and worker-host probes. **Research 41002646435 / job 123890362777** passed cold acquisition of all 377 exact source files, complete offline replay, networkless rebuild/runtime qualification, actual native/OCR suppliers/corpora, raster and five daemon/failure/isolation checks. Source/security review completed with no outstanding feedback. PR #101 merged as `91752cdcf6be83837367c8aeeb306934e493b63e`; resulting-main verification is in the handoff. Local isolation restrictions are unchanged.

This is corresponding Debian source retention, **not** a source rebuild, proof that these exact sources produced the binaries, authenticated maintainer signatures/signed indexes, full image SBOM or licence clearance. The digest-pinned base contains separately built Python and other non-Debian files; those still need source/build provenance. File-specific licences, source/notice/offer obligations, vulnerability review and independent approval remain open. Tika/OCRmyPDF comparisons and representative language/table/long-document accuracy remain separate tasks. No product, production, professional or legal acceptance is inferred.

Subsequent signed-index work is tracked in [115_AUTHENTICATED_ARCHIVE_INDEXES.md](115_AUTHENTICATED_ARCHIVE_INDEXES.md). It binds the retained descriptor/component hashes through Debian publication signatures; individual maintainer signatures and source-to-binary build provenance remain separate. Preserve the historical #101 receipt above.
