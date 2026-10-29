# Durable raster results and verified page delivery

29 October 2026. Continues PR #55. No renderer runs inside HTTP requests.

Migration 023 adds a separate pdf_raster_lab_v1 job kind and append-only raster_derivatives storage. Composite lineage keys bind tenant/case/job/evidence/source/authority/kind. Attempt checks and a deferred constraint require immutable output for every successful raster job. The existing document lab flag gates queueing; the text dispatcher and named original/text runner exclude raster jobs.

Trusted finishRasterJob locks case before job, checks the live lease, authority/membership and original bytes, validates the PNG result, then commits success, event and canonical bounded raster bytes/manifest atomically. Stale workers cannot attach. Invalid images fail the job; storage errors roll the transaction back. Originals remain quarantined and no findings are created.

Authenticated internal GET routes:
- /api/cases/:caseId/integrity-jobs/:jobId/raster-derivative returns the unreviewed manifest and provenance.
- /api/cases/:caseId/integrity-jobs/:jobId/raster-pages/:page serves a verified PNG for page 1 or 2.

Both routes rehash the original, validate stored profile/raw bytes, rebuild the manifest and check its exact bytes/digest. They enforce case membership, deny clients, audit before delivery and set no-store/nosniff. Image delivery additionally sets restrictive CSP and same-origin resource policy. A past successful read does not grant a continuing download capability.

## Reproduction and limits

Use Node 22, Python 3.11 and disposable PostgreSQL 15. Follow `.github/workflows/checks.yml` to create the restricted `inveos_app` role and set `INVEOS_TEST_DATABASE_URL` plus `INVEOS_TEST_ADMIN_DATABASE_URL` to that disposable database. The tests create isolated schemas and run all ordered migrations; never point them at casework data. With Chrome available to the existing browser harness, run:

```sh
npm ci --no-audit --no-fund
npm run lint
npm run typecheck
npm run build
npm run test:foundation
INVEOS_TEST_BROWSER=1 npm test --workspace @inveos/api
```

New tests replay the hash-checked fictional PNG from PR #54, not a fresh renderer. They cover atomic attachment and rollback/retry, append-only constraints, stale/cancelled attachment, authority change, malformed PNG/context, application restart, original/stored-byte corruption, tenant/case/membership restrictions and actual browser image decoding. Each raster fixture uses a fresh HTTP app with production rate limits unchanged; durable database state is retained.

This slice does not yet connect an isolated raster worker to queue execution or add a page-review interface. Trusted result attachment is an internal function, not a browser-supplied write route. Render acquisition/qualification evidence remains in PRs #54–55; broader fidelity, licence/security approval, overlays and human-reviewed citations/export remain open. No new dependency or third-party source redistribution.

Rollback: disable research raster queueing/dispatch, retain the append-only table/history and use reviewed forward migrations; do not delete applied migrations or results. Application rollback cannot make new raster jobs executable by the old worker. Fictional fixtures only; no merge, production deployment or approval.

## Executed evidence

Draft PR #56 passed [Checks #146](https://github.com/BlackStateGroup/inveos/actions/runs/40828229474), job 123296113421, at implementation commit `140fd68ed0d9296b0e823bd1b0538af35c0c76d1`, tree `46f6af011b29bdaf485eb52a941528ae87e36236`: 182 Node tests and 101 Python tests, zero failures/skips, plus lint/types/build/reference, existing browser/restore checks and host isolation/resource probes. All six new raster database/browser scenarios passed, including actual 612×792 PNG decoding and refusal after original corruption. Initial Checks #145 failed because the expected migration list omitted 023, invalid-page validation expected 400 instead of 422, and shared fixture HTTP rate limits were exhausted; corrected tests use fresh app instances without changing production limits. Local lint/types, foundation and 101 Python tests passed. The follow-up changes documentation only. No fresh parser/renderer execution is claimed by this API run. Resume #56 after fresh main/review checks.
