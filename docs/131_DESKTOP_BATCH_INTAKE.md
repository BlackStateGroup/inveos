# Desktop batch original intake

Build-first implementation, 30 October 2026. This extends the existing browser investigator workspace; it is not a native desktop package or a larger parser acceptance claim.

## Implemented

Evidence now provides a saved multi-file intake workflow. An investigator chooses up to20 fictional files, declares each source timestamp with timezone and acquisition method, and saves a manifest of names, lengths and SHA-256 values. File modification dates are not silently substituted for source times. Files remain local until transfer starts.

Migration094 stores an immutable, actor/case-scoped manifest and separate per-file request keys under the current authority version. Replayed manifest requests require identical inputs and actor. Listing, opening, re-authentication and reload recover saved metadata and keys from the server; the browser does not store unencrypted original contents or filenames in local/session storage for this workflow. A manifest is metadata, not an evidence receipt.

Transfer uses the existing32KiB chunk protocol and256KiB per-original bound, one file at a time. Reselection matches filename, size and computed digest; upload receipt verification reuses the single-original receipt validator. Missing chunks resume from server ranges. Errors remain per file, while access/session failure stops the batch and clears loaded case context. Pausing aborts requests without deleting originals, staging or receipts. Existing server reservation quotas, expiry, cancellation, authority locks and quarantine still apply. No batch can widen a profile or silently bypass current source scope.

The server binds batch keys to exact metadata and creation authority on first reservation. Manifest fingerprints are rechecked. Later authority changes prevent new transfers under the old batch. Existing completed receipts remain retained; their listing explicitly does not freshly verify source bytes. Cancelled/expired entries are retained, and replacement intake requires an explicit new batch. No completed original is deleted or replaced by cancellation.

The shared upload module registers the new routes and performs the batch-key guard. Existing single-original clients continue using their unchanged protocol. New dependencies, outside collection, malware scanning, native packaging and parser activation are not introduced.

## Routes and run

Apply migration094 with the existing administrator migration runner and run the API with its restricted application role. `/api/cases/:caseId/intake-batches` supports own-account case-scoped GET/list and POST/create; `/:id` opens a saved manifest with current reservation states. Existing upload reservation/chunk/complete/cancel endpoints perform transfers.

Open Evidence → Desktop batch intake. Choose original files and record each file's declared metadata. Save the batch, then transfer. To recover after reload/re-authentication, open the saved batch and reselect unchanged originals. Do not infer original-byte verification from the batch listing.

## Current verification

Web, contracts and API TypeScript compilation passes (`/tmp/inveos-desktop-intake-compile.log`). This is implementation feedback only. Final compilation with the manifest-fingerprint guard also passes (`/tmp/inveos-desktop-intake-final-compile.log`); integrated acceptance remains pending. Migration/API/browser/offline, corruption, cancellation/race and rendered-layout checks are unrun, as requested for the build-first phase.

Acceptance must cover mixed completed/pending/expired/cancelled entries; lost manifest and completion responses; stable retries across re-authentication; file reselection with same name but different bytes; duplicate acquisitions; manifest tamper; source-time preservation; revoked membership and authority mid-transfer; other-user/client/cross-case/tenant guessing; CSRF; chunk quotas/expiry; failure after individual commits; audit rollback; interrupted browser navigation; exact receipt validation; and desktop/narrow rendering. These checks must be run before merging this feature.
