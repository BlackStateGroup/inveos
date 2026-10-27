# Explicit original-source occurrences and stable review citations

27 October 2026. Incremental WP-06/WP-07 hardening, stacked on the immutable text-derivative work. This remains the original UTF-8 claim path; it does not authorise PDF/page/region or arbitrary derivative citations.

## API and interface

Previously, proposing a quote used its first occurrence silently. `POST /api/cases/:caseId/claims` now accepts optional paired integer `sourceStartByte` and `sourceEndByte`, with zero-based inclusive start and exclusive end in the **original UTF-8 bytes**. The server re-verifies the original and requires exact byte equality with a well-formed Unicode quote. Partial pairs, empty/reversed/out-of-bounds spans, split characters and fabricated quotations return 422 without inserting a claim. Bounds remain 256 KiB. Example for an existing original:

```json
{"evidenceId":"<UUID>","text":"The second fictional record repeats this wording.","quote":"repeated passage","sourceStartByte":125,"sourceEndByte":141}
```

Those illustrative offsets must be calculated from the actual original; they are not a fixture. Unique quotes still work without offsets. Repeated/overlapping matches without an explicit range now fail closed with 422 instead of silently choosing the first. Claim and workspace responses expose the saved range/digest.

The claim form adds **Passage occurrence**. Leave it blank for a unique quotation; for repeated text inspect the selected source and enter 1, 2, etc. The form calculates UTF-8 byte offsets and sends the pair; the server remains authoritative. An impossible occurrence displays an error without submitting. This form uses original text, not the worker's derivative JSON. It supports overlapping exact matches and preserves whitespace. It does not yet highlight the chosen passage or provide a page viewer.

## Review integrity

Migration 006 makes claim identity, assertion, quote, original range/digest, acquisition authority and creation provenance immutable. Existing status/reason updates used by review remain possible. Correct a proposal by creating a new claim and explicitly rejecting the old one; there is no silent rewrite API.

A repeated accepted-review request now uses exact byte equality and checks its persisted review range/digest against the claim. Report assembly joins the actual review and checks its claim identity, acceptance, range and digest as well as the current original bytes. Moving a citation to a different occurrence of identical words after review is rejected, even if both passages contain the same valid quote. Replacement decoding of a split UTF-8 character cannot make review replay succeed. Existing original-download, case policy, human acceptance and offline report formats remain in force.

## Verification and limits

Run `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:foundation`, then `npm test --workspace @inveos/api` with the documented disposable PostgreSQL test URLs. Three added PostgreSQL scenarios cover repeated Unicode selection → review/replay → export → actual independent Python verification; invalid/missing/overlapping/Unicode ranges; database immutability and deliberate administrative range corruption after review. The previous corruption tests explicitly suspend only the new trigger as administrative test fixtures; normal application paths cannot do this. Exact executed receipts are in BUILD_HANDOFF.md.

Local lint/types/build and 42 Python tests pass. Hosted PostgreSQL verification is pending publication. No fresh browser acceptance is claimed: the available Playwright package has no installed Chromium executable, and the sandbox-enabled launch probe cannot start it. The UI is compiled; actual browser submission/visual checks remain open. No device/offline/restore, production security or pilot sign-off. All fixtures are fictional. No new dependency, third-party source, external collection, client communication, deployment or merge.

Rollback: retain migration 006 and the immutable provenance fields. Older readers can ignore the added response fields; older writers should not be used for ambiguous quotes because they silently choose the first. Prefer a forward fix rather than removing the guard. A review decision still is not proof of source truth, legal authority or admissibility. Original page review, complete derivative claims, frozen report versions and signed exports remain unfinished.
