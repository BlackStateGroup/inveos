# Durable raster results and verified page delivery

29 October 2026. Continues PR #55. No renderer runs inside HTTP requests.

Migration 023 adds a separate pdf_raster_lab_v1 job kind and append-only raster_derivatives storage. Composite lineage keys bind tenant/case/job/evidence/source/authority/kind. Attempt checks and a deferred constraint require immutable output for every successful raster job. The existing document lab flag gates queueing; the text dispatcher and named original/text runner exclude raster jobs.

Trusted finishRasterJob locks case before job, checks the live lease, authority/membership and original bytes, validates the PNG result, then commits success, event and canonical bounded raster bytes/manifest atomically. Stale workers cannot attach. Invalid images fail the job; storage errors roll the transaction back. Originals remain quarantined and no findings are created.

Authenticated internal GET routes:
- /api/cases/:caseId/integrity-jobs/:jobId/raster-derivative returns the unreviewed manifest and provenance.
- /api/cases/:caseId/integrity-jobs/:jobId/raster-pages/:page serves a verified PNG for page 1 or 2.

Both routes rehash the original, validate stored profile/raw bytes, rebuild the manifest and check its exact bytes/digest. They enforce case membership, deny clients, audit before delivery and set no-store/nosniff. Image delivery additionally sets restrictive CSP and same-origin resource policy. A past successful read does not grant a continuing download capability.

## Reproduction and limits

Run npm run lint, npm run typecheck and the existing PostgreSQL test harness; INVEOS_TEST_BROWSER=1 enables actual browser image decoding. New tests replay the hash-checked fictional PNG from PR #54, not a fresh renderer. Hosted evidence is recorded below when completed.

This slice does not yet connect an isolated raster worker to queue execution or add a page-review interface. Trusted result attachment is an internal function, not a browser-supplied write route. Render acquisition/qualification evidence remains in PRs #54–55; broader fidelity, licence/security approval, overlays and human-reviewed citations/export remain open. No new dependency or third-party source redistribution.

Rollback: disable research raster queueing/dispatch, retain the append-only table/history and use reviewed forward migrations; do not delete applied migrations or results. Application rollback cannot make new raster jobs executable by the old worker. Fictional fixtures only; no merge, production deployment or approval.
