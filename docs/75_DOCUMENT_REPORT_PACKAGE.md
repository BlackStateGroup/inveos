# Independent document report package verification

29 October 2026. R2, continuing draft PR #64. Fictional lab material only.

## Export and trust boundary

`GET /api/cases/:caseId/report-revisions/:revisionId/document-package` exports an internal frozen revision after current scope, authority, original and complete finding lineage revalidation. The operation shares the existing report transaction and records an atomic `report.document_package_exported` audit event before returning bytes. Client roles, foreign/unassigned cases, stale correspondence/authority, corrupt sources and audit failures are denied. Repeated exports of the same eligible revision produce identical package bytes; the audit timestamp is not inserted into the package.

The versioned JSON envelope `inveos_document_report_package_v1` contains exact frozen report bytes and, for each selected document finding, exact original PDF, raw parser JSON, canonical derivative, citation, ordered review records, proposal and independent decision bytes. Base64 preserves each byte sequence. Candidate author identity is included as package metadata. The package has a 64 MiB bound; the frozen report retains its existing 32 MiB/1,000-finding limits. Individual records retain the native two-page/64 KiB original and 1 MiB extraction limits.

This is a bounded JSON companion to the existing legacy ZIP format, not a change to that ZIP format. It intentionally has no member paths, archive extraction, compression, executable payload or supplied verifier code. Unknown envelope/exhibit fields, duplicate JSON keys, missing/duplicate findings and path-bearing entries fail verification. Original filenames remain display metadata and are never used as filesystem paths. A ZIP presentation can wrap a verified JSON package later; it must not loosen these bounds.

## Offline verification

Use an independently trusted copy of the first-party Python standard-library verifier:

```bash
python3 tools/verify_document_package.py document-report.json \
  --expected-report-sha256 RETAINED_FROZEN_REPORT_SHA256 \
  --expected-package-sha256 RETAINED_PACKAGE_SHA256
```

Retain both fingerprints separately through a trusted channel. The report fingerprint binds its narrative, reviewer metadata and provenance references. The whole-package fingerprint additionally binds supplemental package metadata, including the candidate author assertion. A digest supplied beside an untrusted replacement is not an authenticity anchor. The verifier reports which independent fingerprint checks were requested. No human identity, lawful basis, source truth, PDF visual fidelity, signed custody or current server-policy status is certified.

The verifier replays the narrowly supported native text normalisation independently from raw JSON: contiguous pages, dimensions, supported content, full native charspans, geometry/origin, Unicode UTF-8 ranges, repeated occurrence selection and coverage limitations. It verifies every stored digest, exact candidate occurrence, complete predecessor review chain, selected accepted correspondence, claim binding and independent accepted interpretation. The processing-profile hash is allowlisted to the currently qualified research profile. Changing the runtime requires a new verifier/profile decision, not blind trust in package configuration. Mixed reports also run the existing original-byte verifier over their legacy finding array.

The verifier does not execute a PDF parser, renderer, network request or package-supplied code. It checks recorded processing output; it does not independently prove that the parser originally produced those bytes. Historical R1 snapshot limitation text is preserved byte-for-byte. R2 verifies the additional companion records; it never rewrites an already frozen report to advertise a later capability.

## Tests and reproduction

```bash
npm run lint
npm run typecheck
npm run build
node --import tsx --test apps/api/test/document-package.test.ts
python3 -m unittest discover -s tests -v
INVEOS_TEST_BROWSER=1 npm test --workspace @inveos/api
```

The existing disposable PostgreSQL environment variables and sandboxed Chrome are required for the final command. Three new local tests invoke the independent Python CLI in separate processes against first-party records with recorded fictional parser output, including changed/missing bytes, duplicate/path-bearing input, rehashed narrative replacement and false completeness metadata. The actual API test exports document-only and mixed reports, checks both external fingerprints offline, restarts, checks deterministic bytes/access denial, forces audit failure and withdraws correspondence before another export. Offline verification of an already downloaded package deliberately remains possible after withdrawal; it is not a fresh release-authority check.

Draft [PR #65](https://github.com/BlackStateGroup/inveos/pull/65) passed [Checks #170](https://github.com/BlackStateGroup/inveos/actions/runs/40874451063), job 123449554420, at `6755cc6ed11fc7d76d1386ac71e465f30e3728e4`, tree `0ffe07e3ff8f27f458322aeb8b533a3b0ac80aa9`: 218 Node tests and 102 Python tests, zero failures/skips, plus lint/types/build/reference, actual PostgreSQL/browser/restore and host-isolation checks. The new actual API scenario exported document-only and mixed snapshots, verified both in separate Python processes, preserved exact package bytes across restart and passed access, audit rollback and stale-correspondence denial. All three new independent CLI/adversarial scenarios passed. Local lint/types/build, all 102 Python tests and the three CLI tests also pass. The evidence follow-up changes documentation only. No new parser execution, device or production-readiness result is claimed.

## Remaining gates and rollback

No migration, application dependency, third-party source, new parser run, merge or deployment. These are unencrypted internal packages containing complete original and extracted content; existing internal access and explicit handling responsibilities apply. Browser package download/recovery, document-backed client release, PDF/DOCX/redaction, signed custody and full supplier milestone remain R3/R4/Q1 work. Client disclosure stays blocked for document-backed revisions even when the package verifies. Remove the new route/tool to roll back; preserve all originals, reviews and frozen report bytes. Older tools continue to reject the document-backed format.
