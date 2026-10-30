# Locked Debian archives for the existing OCR research runtime

The research OCR build previously resolved Debian dependencies against a rolling repository, then checked installed versions and 58 native/model/notice records. This increment acquires the **same 161 installed Debian package revisions**, locks their exact archives and statically audits their identities, declared dependencies and actual copyright records before a networkless build. It does not select a new application dependency or approve redistribution.

The [archive lock](../research/runtime_artifacts/tesseract-archives.lock.json) SHA-256 is `6d834f36b61e7adbb37961403b2b6de0bde2de3c844b7db6be145fa3e0e50197`. It covers **67,896,672 bytes** and binds the unchanged installed-runtime inventory SHA-256 `bfcdba20feb42105845bbce39b243925dd12133e9358630ab1384125c84e1172` and existing base image digest. The two OCR Python wheels and model bytes are unchanged.

## Acquisition and boundaries

[Debian Snapshot](https://snapshot.debian.org/) supplies exact-version metadata and immutable file identities. Initial discovery used official HTTPS metadata and its SHA-1 file identities; this tool computes and retains SHA-256 independently. **Signed Release/index verification is not claimed.** Later builds accept only the committed SHA-256/size/identity lock, never a new repository resolution. The [Debian archive format](https://manpages.debian.org/bookworm/dpkg-dev/deb.5.en.html) and [control-field specification](https://www.debian.org/doc/debian-policy/ch-controlfields.html) inform the restricted static reader.

Acquisition allows only HTTPS on the exact snapshot host, including redirects, with bounded metadata, each download and its wall time. A package archive is at most 64 MiB, an expanded tar at most 128 MiB, the full archive set at most 512 MiB, each selected control/notice at most 2 MiB, and each tar at most 40,000 entries. Xz decoder memory is bounded. The reader accepts only the measured ar/control/data order and uncompressed, gzip or xz tars. Duplicate/traversing paths, malformed/truncated members, control duplicates, identity substitutions and unsupported compression fail closed. No package is installed or extracted during acquisition; maintainer scripts and binaries are not executed.

Each record retains actual package/version/architecture, Source, Depends, Pre-Depends and Built-Using fields where present, archive SHA-1/SHA-256/size, copyright paths/bytes/digests and declared licence labels. Shared copyright-file/directory links resolve only inside the acquired package set, with cycle/depth/path restrictions. All 161 package copyright references resolve. Every notice in the existing 58 runtime artifact records must match its acquired path, bytes and SHA-256. These are measured records, not a licence interpretation or a complete vulnerability audit.

The first-party Dockerfile and verified public archives alone enter a disposable build context. The base remains digest-pinned. `docker build --network=none` remains mandatory. APT receives empty repository sources/indexes and `--no-remove`, and installs only the supplied local archives. Local archive staging into its own cache remains enabled; `--no-download` prevented that staging in the initial failed build. No rolling apt update occurs. The resulting image must still pass existing non-root/read-only/network/resource/cleanup qualification and exact installed/native/model/notice inventory checks before the actual supplier, corpus and leased-worker tests run. No case original, credential, private checkout or host directory is included in build context. The local research image is removed afterwards and never published.

## Reproduction

Run from a clean checkout with the documented locked project setup. Native qualification requires a host that supports the existing isolation policy; do not disable it on an unsupported host.

```sh
# Acquire inert archives using the existing reviewed lock; no installation.
python3 tools/ocr_package_archives.py
# Recheck every archive, identity and notice without network.
python3 tools/ocr_package_archives.py --offline
python3 -m unittest discover -s tests -p test_ocr_package_archives.py -v
```

The existing `Pinned Docling research build` workflow acquires the source/wheels, prepares disposable PostgreSQL and invokes the archive acquisition before `experiment_tesseract_supplier.py --case-acceptance --adverse-corpus`. The experiment requires an already populated verified cache. It records archive-lock identity/count/bytes in its retained output and rebuilds without network before running both complete supplier profiles. Follow [scanned lineage setup](79_SCANNED_DOCUMENT_LINEAGE.md) for an explicit scoped job; this does not add automatic worker dispatch.

Explicit discovery for a future reviewed proposal uses `python3 tools/ocr_package_archives.py --discover .research-cache/proposed-ocr-archives.json`. It refuses an existing destination and does not overwrite the active lock. Review metadata/notice changes and requalify the resulting image before accepting a replacement. Both discovery and normal acquisition retain archives only under ignored `.research-cache/ocr-archives/`; no third-party package, model, source or licence text is committed. Remove that cache to reclaim space when no experiment needs it. A partially downloaded archive is never treated as verified.

## Remaining gates

This closes binary archive identity for the measured installed Debian set only. The digest-pinned base also includes separately built Python and other files outside that set; this is not a complete source rebuild or whole-image SBOM. Required source archives, signed repository/index evidence, upstream build provenance, file-specific licence applicability/source/notice obligations, vulnerabilities and approval remain open. The actual package notices include copyleft, advertising-clause and unclear labels; no shipping or licence clearance is inferred. Representative OCR accuracy, additional parsers, professional review and production approval remain unmet. [Evaluation](evals/2026-10-30-ocr-package-archives.md) distinguishes static acquisition from actual rebuilt-worker evidence.
