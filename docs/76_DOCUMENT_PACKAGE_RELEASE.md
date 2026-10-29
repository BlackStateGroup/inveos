# Browser-verified document package release

29 October 2026. R3, continuing draft PR #65. Fictional lab material only.

## Release contract

Document-backed frozen revisions are released as the exact verified `inveos_document_report_package_v1` bytes, not as a report JSON that silently omits derivative provenance. The reviewer browser downloads a bounded package, checks its response fingerprint, checks the embedded frozen report against the separately listed report fingerprint and retains a tab-scoped verification receipt. Reload restores only fingerprints and identity, never package or report content. A failed release response retains one stable request identity and exact parameters for explicit recovery.

The disclosure endpoint continues to accept legacy original-byte reports without a package. A document-backed report additionally requires `documentPackageSha256` and `confirmDocumentPackageVerified: true`. The server independently rebuilds the current eligible package inside the release transaction and requires an exact match before storing the immutable delivery bytes. Migration 027 adds the append-only `report_disclosure_packages` record; it does not rewrite existing grants. A disclosure receipt distinguishes the report fingerprint, delivery fingerprint and `report_json` versus `document_package` deliverable.

Client discovery exposes only those two fingerprints, deliverable kind and existing grant timestamps/identity. Client download rechecks the frozen report, stored package digest, canonical embedded report bytes and package-to-report binding before the audited response. The client browser checks exact streamed bytes against the listed delivery fingerprint and the embedded report against the report fingerprint. Acknowledgement binds the actual delivered fingerprint. Existing expiry, revocation, current authority, issuer membership and request-changes gates remain in force.

## Historical semantics

Current accepted correspondence, source bytes, authority and internal acceptance are required when creating a new package release. A later correspondence correction blocks new package exports and new grants. It does not rewrite or silently revoke a package already released; that historical delivery remains available until its existing expiry, explicit revocation or another established access-policy gate fails. Reviewers must revoke when a later correction changes disclosure suitability. This preserves what the client actually received while keeping new-release decisions current.

Package hashing proves byte equality, not source truth, identity, lawful disclosure, semantic PDF rendering, legal delivery or admissibility. The JSON package is still an internal full-content deliverable with original and derived records. R4 canonical PDF/DOCX, redaction leakage checks, signatures and counsel/privacy approval remain separate gates.

## Bounds, failure and privacy

- The browser and API retain the existing 64 MiB package, 32 MiB report and 1,000-finding bounds. Stream readers cancel excess responses instead of trusting `Content-Length`.
- A missing/changed header, package byte, embedded report, package/report fingerprint, stale review, changed authority, corrupt source, audit failure or stored-release mutation fails closed.
- Package bytes are stored only after a scoped reviewer action and remain append-only. Existing encrypted-object-storage, production key-management, retention and legal-hold gates are not satisfied by PostgreSQL byte storage in this lab.
- The portal never gains internal case, revision or evidence routes. Listing does not claim the package bytes were freshly checked; download and acknowledgement do.
- Browser session storage holds UUIDs, report/package digests, verification time and a pending release request. It holds no report, original, derivative, citation or package bytes.

## Reproduction

```bash
npm run lint
npm run typecheck
npm run build
node --import tsx --test apps/api/test/document-package-download.test.ts apps/api/test/recipient-discovery.test.ts
python3 -m unittest discover -s tests -v
INVEOS_TEST_BROWSER=1 npm test --workspace @inveos/api
```

The final command requires the documented disposable PostgreSQL roles and sandboxed Chrome. The new API scenario covers package-required release, wrong/missing fingerprints, stable retry, append-only storage, client listing/download/acknowledgement, independent Python verification, stored-byte corruption, a later correspondence correction and historical release semantics. The browser scenario downloads and verifies the package, reloads its receipt, loses a committed release response, reloads and recovers the same grant, then downloads the identical package through the client portal.

Local lint, type checks, production web build, 76 focused Node helper tests, all 102 Python tests, foundation validation and whitespace checks pass. The local host has no configured test PostgreSQL or browser, so the new database/browser scenarios are not claimed locally.

Draft [PR #66](https://github.com/BlackStateGroup/inveos/pull/66) passed [Checks #179](https://github.com/BlackStateGroup/inveos/actions/runs/40881284280), job 123473157469, at `dc8df89ab9ec18c41b2db715a76af82ef8bd2c41`, tree `e9dd9f12f481f954e4efc1d16575bb17dd87bc5e`: 221 Node tests and 102 Python tests, zero failures/skips, plus lint, types, production build, reference flow, actual PostgreSQL/browser/offline-verifier and host-isolation checks. The API journey required the verified package, rejected wrong/missing fingerprints, preserved one append-only delivery, independently verified downloaded bytes, denied stored tampering and confirmed explicit historical semantics after correspondence replacement. The browser journey verified and downloaded the package, restored its receipt, recovered one committed release after an intentionally lost response, switched to the client session and downloaded identical bytes. Earlier hosted attempts exposed test-only permission, input-value, response-loss and closed-details readiness mistakes; all were corrected without weakening controls or assertions. The evidence follow-up changes documentation only.

## Rollback and remaining work

Rollback removes the new UI/helper and release branches but preserves migration 027 and every stored release record. Do not drop released package bytes during application rollback. Older legacy grants remain unchanged. No new runtime dependency, upstream parser execution, third-party source, merge, deployment or live collection is introduced.

R3 is implemented and hosted-qualified in the draft, but remains unmerged and undeployed. R4 canonical rendered files/redaction, P1 comparative parser benchmarks, production identity/encrypted storage, native field/offline work and the wider milestone/sign-off gates remain open.
