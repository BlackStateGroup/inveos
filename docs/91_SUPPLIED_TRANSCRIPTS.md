# Supplied transcript lineage

This is an internal supplied-record workflow, not an audio transcription engine or reviewed finding. Migration 040 and PR #85 add it to Interview in the persistent lab. No external service, model, runtime dependency or copied research source is incorporated.

## Decision and source contract

A raw transcript must be verifiable against an immutable original, rather than accepted as an unrelated form field. Preserve a UTF-8 `.txt` original containing `inveos.supplied_transcript.v1` JSON, then register it. The [fictional example](../examples/fictional-supplied-transcript.txt) is downloadable in the interface. Original bytes, SHA-256, original source time, receipt time and authority version are retained separately from registration/correction times. A BOM and whitespace do not change the preserved bytes. Duplicate JSON keys, malformed UTF-8, unpaired surrogate text, unsupported fields, repeated segment identities and invalid ranges are rejected.

The exact root fields are `format` and `segments`. Each segment has a distinct lowercase UUID `id`, integer `startMs`/`endMs`, `speakerLabel`, explicit boolean `speakerUncertain` and `text`. Intervals satisfy `0 <= startMs < endMs <= 86400000`. Preserve supplied order and overlaps; do not infer a recording start time, audio alignment, speaker identity or chronology. Limits: 100 segments, 120 UTF-16 units per speaker, 10,000 per segment text and the existing 256 KiB original limit. `/segments/N` identifies the segment in the preserved JSON; declared milliseconds are not verified media citations.

One logical transcript is allowed per original. The title is a registration annotation. Raw text/ranges/speakers are immutable. Every correction retains a stable request UUID, expected version, declared range, text, speaker uncertainty, reason (10–3,000 units), authenticated actor attribution and server time. Corrections append; they never replace the source. A version conflict requires comparison. An unchanged lost-response retry returns the original result and current head, without replaying an older correction over newer work. Unsubmitted forms are not persisted across reloads. Refresh explicitly discards unsaved edits.

## Access and bounded operations

All routes recheck the current internal session, tenant and case membership. Client roles are denied. Writes require CSRF; registration requires current source authority and an open collection stage. Closed-case manual corrections remain possible under the pinned current authority, consistent with the case-lifecycle contract. Superseding source authority blocks new corrections. Historical inspection remains accessible to authorised members. Exact write replay never resurrects access.

Detail, registration, correction and export verify the actual preserved source bytes, including the active encrypted-original adapter. They compare stored raw rows with the decoded source and check contiguous correction heads. Case locking serialises correction/version checks with membership and lifecycle writes. Generic audit and mutation commit atomically. Database triggers reject raw/history edits and head rewinds; the restricted application role has no raw update/delete rights. Database administrators remain within the existing trust boundary; this is not a digital-signature system.

Lists contain metadata only, 50 UUID-keyset rows per page, at most 200 transcripts per case. History contains 25 corrections per page and at most 100 per segment. Listing/history explicitly say originals were not rechecked. Queries have 2-second lock and 5-second statement deadlines. Corrected text totals at most 256 KiB. Export preflights history size, then rejects packages over 2 MiB; it does not truncate history. The existing workspace original selector remains subject to the workspace's separate large-case performance limitations.

## Independent export check

`GET /api/cases/:caseId/interviews/:id/export` returns `inveos.transcript_export.v1`: exact original Base64/digest, case/transcript/actor identities and times, raw segments, all ordered corrections, current segments, and `unreviewed_transcript_context_not_findings`. This does not release a document to a client or promote transcript text to a finding. The browser saves this package separately from the original, which remains downloadable through Evidence.

Copy the verifier and package to a directory outside the repository. No server, network, third-party package or repository import is needed:

```sh
python3 verify_transcript.py internal-transcript-UUID.json
```

[tools/verify_transcript.py](../tools/verify_transcript.py) checks the manifest fingerprint, exact source bytes, strict schema, raw/source agreement, contiguous correction history and current/history agreement. It rejects duplicate keys, altered bytes, rehashed fabricated raw/current fields, promoted status and oversized input. It does not authenticate an actor or publisher, prove source truth, establish audio alignment, legal admissibility or client authority. A self-contained fingerprint is not an external trust anchor.

## Reproduction and open acceptance

Use locked dependencies and disposable PostgreSQL with the restricted `inveos_app` role described in the root run instructions. Run `npm run lint`, `npm run build`, `npm run test:foundation` and the API workspace tests. The API suite exercises actual files/PostgreSQL, loopback HTTP roles/tenants/revocation, replay/conflicting corrections/restart, source tamper, database immutability, audit rollback, authority/closure and copied standalone verification. `INVEOS_TEST_BROWSER=1` additionally requires a host on which Chromium runs with its sandbox; do not disable it. The browser journey registers, corrects, loses a committed response, retries, reloads, inspects history, downloads/verifies a package, opens the source and clears revoked context. Exact executed receipts belong in the handoff/evaluation, not inferred from this test description.

Unmet WP11 criteria include actual audio/video originals and playback/alignment, speech runtime/model licence qualification, diarisation/recognition accuracy, annotations/media review, reviewed finding/report citation integration and representative large transcript measurements. This increment does not complete WP11 or production acceptance.
