# 08 — Evidence handling, chain of custody and integrity

## Non-negotiable principle

**An evidence integrity hash proves equality to the bytes hashed, not that those bytes are true, authentic, lawfully obtained or automatically admissible.** Preserve provenance, handling, context and human decision records. External legal/evidential requirements need jurisdiction-specific review.

## Ingestion protocol

1. Confirm actor, case access, allowed content type, source authority and retention policy.
2. Record acquired/captured time, uploader time, source/agency, method, potential time-zone uncertainty, original filename and claimed origin.
3. Upload bytes to restricted temporary object with size/resource bounds, no public access; virus scan and safe metadata parsing.
4. Compute SHA-256 at client when available, **recompute server-side**, compare with declared hash and actual byte length.
5. Atomically create `EvidenceItem`, immutable object pointer, intake receipt and first custody event. Never return `verified` before durable DB/object acknowledgement.
6. Store/derive previews and transcripts separately with versioned parent digest. Render unsafe files in an isolated viewer.
7. Record access, export and authorised transformations. Corrections amend *metadata narratives*, not original bytes.

## Custody event schema

Each event contains: `event_id`, `tenant_id`, `case_id`, `evidence_id`, `event_type`, `actor_id/service_id`, `occurred_at`, `recorded_at`, `time_quality`, `from_custodian`, `to_custodian`, `reason`, `storage_location`, `source_ref`, `item_sha256`, `previous_event_hash`, `event_hash`, `signature_or_anchor_ref`. Human acknowledgement is a separate fact from system delivery.

## Audit construction

- Persist audit and domain mutation in the same transaction, where possible.
- Canonicalise event input before hash; use stable versioned serialisation. Chain events by previous hash and include primary object hashes.
- Periodically sign/anchor ledger checkpoints outside the mutable application database to make silent DB rewriting detectable. Define key custody, rotation and independent verification.
- Never assert an append-only SQL table alone is tamper-proof. Test privileged-admin threats.
- Physical storage immutability requires independently configured policies (e.g., supported Object Lock), storage retention and backup verification; test administrator abilities to remove/alter records.

## Export package layout

```text
CASE-EXAMPLE-001-export/
  manifest.json                  case/version/UTC/hashes/source mapping
  manifest.sig                   optional verifiable signature
  report/report.pdf              approved report revision
  exhibits/EXH-001.bin            original or approved redacted derivative as labelled
  exhibits/EXH-002.pdf
  custody/events.jsonl           ordered custody history for included exhibits
  provenance/sources.json        URL/record provider/acquired-at/lawful context
  provenance/derivations.json    OCR/transcription/processing lineage
  verifier/README.md             documented independent verification steps
```

Manifest contains package version, digest algorithm, source hashes, exhibit hashes, derivation parents, selected source spans, timestamp provenance, report revision, identities of preparer/reviewer, redactions and excluded-item warnings. Use deterministic ordering. Consider public-key signature when threat model justifies it.

## Exceptional cases

- Original corrupt/short upload: quarantine and require fresh transfer; preserve error/audit, never pretend receipt succeeded.
- Duplicate identical bytes: may reference one stored object but keep independent acquisition and custody claims for each source.
- Device clock offset: preserve device-provided time as evidence of assertion; record trustworthy server time independently.
- Partial or failed upload: explicitly unverifiable and not eligible for release until resolved.
- Source URL disappears: preserve lawfully captured snapshot and manifest; record time and source limitations.
- Redaction: reversible edit in UI is distinct from public redaction; retain original privately and hash resulting derivative.
- Retention expiry: destruction or hold process produces record with authorisation, object-delete verification and legal review. Do not overpromise secure erasure on cloud backups.

## Verification suites

- Single-bit mutation breaks hash verification; replaced manifest detected; removed event breaks chain; tampered timestamp fails signed anchor.
- Full export verifies offline with a documented command and no SaaS credentials.
- Non-authorised role denied by API and object signed URL; revoked grant cannot generate new access.
- Power loss between object upload and receipt results in recoverable pending state, never orphaned verified evidence.
- Failed redaction or missing exhibits block report release.
