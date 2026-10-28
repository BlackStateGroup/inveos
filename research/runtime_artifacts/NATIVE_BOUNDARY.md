# Actual parser-to-citation boundary

28 October 2026. Research-only first-party bridge; no application dependency or
licence approval. Reuses verbatim INVEOS PR #2 contract and its 15 tests from
36081f1a05586b2467acf99dd3b7695c931b7212; does not rebuild that work or merge its PR.

The isolated parser now returns its actual native document JSON. Outside the
container, the standard-library adapter binds the original digest, raw JSON digest,
UTF-8 derivative digest, tool pin, runtime image ID, wheel inventory digest and
configuration to an explicitly scoped extraction envelope. The selected second
occurrence is rebuilt and verified by the existing citation contract. Original PDF
bytes are never treated as text offsets. Source and receipt times stay separate.

The wrapper checks contiguous original page identities, finite positive page
dimensions, page/box bounds, duplicate JSON keys, raw size and successful parser
status. Missing text pages remain visible. Even all-page text is unreviewed and
never asserts complete extraction. Empty text is still rejected by the existing
contract; raster-only results have coverage receipts but no citations. Unsupported
partial/multiple-item provenance remains rejected. Pictures, tables and other
non-text content are not claimed to be represented by text citations.

Two fresh actual runs must yield identical citation envelopes. Original mutation,
raw-output mutation and foreign case context must fail re-verification. Unit tests
also cover changed runtime digests, authority/tenant/evidence mismatch, off-page
boxes, partial conversion, fabricated review state and Unicode byte offsets.

Reproduce with the acquisition/build steps in PINNED_BUILD.md and the existing
`timeout 240s python3 tools/experiment_native_pdf.py` on a qualified host. Run
`python3 -m unittest discover -s tests -v` for local first-party tests. Local 98
Python tests and foundation validation pass; hosted parser/full checks pending.

Trusted context/runtime values must come from the dispatcher, not user input. Hashes
are not authentication or signatures against replacing all inputs. This slice has
no database attachment, durable PDF job, human page viewer or review approval.
Next integrate only after runtime licensing/security gates, with transactional
authority revalidation and existing quarantine/job controls intact. No third-party
source or binaries are redistributed. Closing/reverting this draft removes the
research bridge without a data migration.
