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
`python3 -m unittest discover -s tests -v` for local first-party tests. Local 98 Python tests, lint/types/build and foundation validation pass.

Hosted [research #14](https://github.com/BlackStateGroup/inveos/actions/runs/40772391766) passed at `0f6a057f25d226d0ae4dd2510ec6651841a5466b`, tree `a67789893cd711e9dca9c3f87d2f886ec541c349`: two actual isolated runs produced the same envelope SHA-256 `233aa542a5da81800011274f91a413846aa9e4dc3c6ec0fbff6fd439f328d734`. Selected `#/texts/1` resolves to page 2, derivative bytes [34,67), correct box and unchanged original. Original/raw/context tamper checks passed; previous coverage/input limits, exact builds and isolation probes also passed. [Checks #123](https://github.com/BlackStateGroup/inveos/actions/runs/40772392430) passed: 135 Node tests including PostgreSQL/restore and five Chrome journeys, zero failures/skips; 98 Python tests, lint/types/build/reference and service isolation. Stored actual-output citations also reverified locally without importing Docling. Follow-up changes documentation and receipt only.

See [actual output receipt](native-boundary-receipt.json). Preserve numeric JSON
representations when copying it: Python canonicalisation distinguishes 72.0 from
72, and rewriting through a different JSON number model changes the raw hash.
This research canonicalisation is not a cross-language signing standard. The
receipt was copied without numeric rewriting and reverified locally.

Offline reproduction, without parser imports:

```python
import json
from pathlib import Path
from tools.synthetic_pdf import digital_pdf
from research.document_processing.contract import Context, canonical
from research.document_processing.native_boundary import cite_envelope
receipt = json.loads(Path("research/runtime_artifacts/native-boundary-receipt.json").read_text())
for run in receipt["runs"]:
    boundary = run["citationBoundary"]
    envelope, citation = boundary["envelope"], boundary["citation"]
    selected = {k: citation[k] for k in ("item_ref", "start_byte", "end_byte", "quote")}
    actual = cite_envelope(envelope, digital_pdf(), canonical(run["nativeDocument"]),
        Context(**envelope["extraction"]["context"]), runtime=envelope["runtime"], **selected)
    if actual != citation:
        raise ValueError("Citation mismatch")
```

Trusted context/runtime values must come from the dispatcher, not user input. Hashes
are not authentication or signatures against replacing all inputs. This slice has
no database attachment, durable PDF job, human page viewer or review approval.
Next integrate only after runtime licensing/security gates, with transactional
authority revalidation and existing quarantine/job controls intact. No third-party
source or binaries are redistributed. Closing/reverting this draft removes the
research bridge without a data migration.
