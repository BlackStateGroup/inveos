# Authenticated publication indexes for the OCR research runtime

The retained binary/source locks now have a reproducible publication chain: five pinned Debian archive public keys → three signed InRelease files → six compressed Packages/Sources indexes → all **161 binary package identities and 116 source-package revisions**. This is research build evidence. It changes neither application dependencies nor evidence/report formats and approves no production trust or software distribution.

## Exact scope and trust

The new `research/runtime_artifacts/tesseract-authentication.lock.json` binds the unchanged binary lock `6d834f36b61e7adbb37961403b2b6de0bde2de3c844b7db6be145fa3e0e50197` and source lock `3626ab89c4f33e2b4100b84a5739bc8959b8ae1a78d3a98294d411245539c8d0`. Metadata is retained for the `20261028T000000Z` snapshot: bookworm, bookworm-updates and bookworm-security, main/amd64 binaries and corresponding sources. SHA-256 and length pin every key, signed release and index. Snapshot SHA-1 values are locators and additional consistency checks; they do not replace SHA-256 authentication.

Public key bytes and fingerprints were obtained from [Debian FTP's published keys](https://ftp-master.debian.org/keys.html) over official HTTPS. This is an explicitly recorded bootstrap, **not independently approved operational root trust**. Bookworm requires its three recorded signers; updates and security require both recorded signers. An initial discovery lacking the older security signer returned `NO_PUBKEY` and nonzero GPGv status. That error was retained as a failed check, not ignored: the exact official older security key was added and all signatures then verified. Fingerprints, file hashes and signer sets remain reviewable in the lock. No remote keyserver lookup or user's keyring is used.

Verification checks signed Origin/Codename, publication/signature times and any Valid-Until against the retained snapshot. A missing expiry in the measured stable/update releases is recorded; no expiry is invented. This verifies publication correspondence at that historical snapshot. It does not disable current APT freshness checks or represent the historical release as current. Individual maintainer signatures inside `.dsc` files are still unauthenticated; their exact bytes are instead bound through the signed Sources index. No assertion is made that these sources produced the retained binaries.

## Implementation and integration

`tools/ocr_archive_authentication.py` defaults to offline. Only explicit `--fetch` acquires the pinned official metadata/public keys. It rejects missing/changed artifacts, symlinked caches, an unexpected key fingerprint/signer/suite, failed GPGv status, changed signed content, wrong compressed-index hashes and mismatched package bytes/architecture/source versions. Source checks require the complete descriptor/component set, including every component's exact size and SHA-256, against the existing source lock.

Network origins/redirects, download lengths/deadlines and process output/time are bounded. Signed text is limited to 2 MiB; compressed indexes to 32 MiB, decoded content to 128 MiB, decoder memory to 64 MiB and each control paragraph to 1 MiB. Truncated, concatenated or trailing compressed data and duplicate/unsafe checksum entries fail. Temporary keyrings are private and removed after verification. Acquired metadata is inert: no package/source extraction, installation or maintainer script runs. Public research copies stay in ignored `.research-cache/ocr-authentication/` (about 19 MB); only first-party code, tests and the measured lock are committed.

The hosted OCR workflow fetches and authenticates metadata, replays offline and compares the receipts before acquiring/auditing actual locked archives. `experiment_tesseract_supplier.py` repeats authentication offline before its existing full source/archive byte checks and networkless rebuild. The result embeds the authentication receipt. Thus index authentication does not substitute for rereading the actual archive bytes, runtime inventory, supplier/browser acceptance or worker failure/isolation tests. The native Docling path remains unchanged.

## Runtime, licence and privacy review

This uses the test host's existing GPG/GPGv executables, not a new application library or copied upstream implementation. Local actual tools were GnuPG/GPGv2.2.40 (`2.2.40-1.1+deb12u2`) and libgcrypt1.10.1. Executable SHA-256 values were `c3f988abfbf4a51ec36e90437045c1ea45464aadc691a2f78f81c41a31587075` (GPG) and `26999f2766739b3df31c6c355856440bbd7377a5a19ebcf3f6cfe4cfb3c42f69` (GPGv), on this arm64 host. Their actual linked libraries were inspected: zlib, bzip2, libgcrypt, libgpg-error, libc; GPG additionally uses sqlite3, readline, libassuan, libm and libtinfo. Hosted receipts record their own actual GPG/GPGv versions. Host tooling is not a fully locked/rebuilt runtime closure.

The installed Debian GnuPG copyright metadata was read (SHA-256 `84dab06b5c1baf3a7a45c3cdc5f98fb121234e98fdd6266c3f773d54fcdc4f54`): its general grant is GPL-3+, with file-specific LGPL, Expat, BSD/permissive and other terms. No blanket licence grant is inferred for all tools/dependencies; no upstream executable, keyring or source is redistributed by this increment. Existing binary/source notice audits and distribution/source-offer obligations remain separate. Catalogue adaptations already incorporated elsewhere retain their original provenance/notices; rewriting does not remove those obligations.

Tests generate a temporary, clearly fictional signing identity, verify actual signatures and remove only that temporary GPG agent/home. No real client data, credentials, external recipients, case metadata or network collector is introduced. Source/privacy review covers fixed origins, bounded content/processes, temporary homes, cache paths, failure propagation and the distinction between authenticated publication and licence/security approval.

## Reproduction and executed evidence

On a non-production test host with Python3, GPG/GPGv and the repository's documented locked setup:

```sh
# Fetch exact pinned publication metadata/public keys, then verify.
python3 tools/ocr_archive_authentication.py --fetch > .research-cache/ocr-authentication-receipt.json
# Default replay uses no network and must produce the same receipt on this host.
python3 tools/ocr_archive_authentication.py > .research-cache/ocr-authentication-offline.json
cmp .research-cache/ocr-authentication-receipt.json .research-cache/ocr-authentication-offline.json
python3 -m unittest tests.test_archive_authentication -v
npm run test:foundation
```

Actual local cold acquisition authenticated all161 binaries/all116 source revisions; offline replay passed. All **187 Python tests passed**, including eight new checks for real fictional OpenPGP verification, unsigned/changed/wrong-key rejection, historical scope/date validity, offline cache drift and no-network misses, parent/dangling symlinks, exact binary/source components, compressed-data limits and malformed checksums. Workflow validation passed. The new full hosted worker/rebuild/parser/browser/failure/isolation run is **pending**; these authentication checks are not a parser benchmark. Existing #101 measured full source acquisition and rebuilt suppliers remain historical evidence, not a substitute for executing the changed pipeline.

Operational trust approval, individual source signatures, upstream build attestations, full base/non-Debian source closure, file-specific distribution/licence/security approval, representative OCR accuracy and professional/product/production acceptance remain open. No sandbox restriction is relaxed.
