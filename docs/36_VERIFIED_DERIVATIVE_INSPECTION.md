# Recoverable processing requests and verified unreviewed inspection

27 October 2026. Incremental WP-03/WP-05 slice on PR #16. This inspects the existing first-party UTF-8 line index; it is not PDF/OCR, a page viewer or claim approval.

The evidence workspace queues either an original SHA-256 check or an unreviewed UTF-8 line index through the existing scoped enqueue API. The line-index choice is disabled for opaque originals; the server remains authoritative. Queueing does not execute the worker: use the trusted CLI until a verified dispatcher exists.

Before POST, a case/sign-in-scoped `sessionStorage` record retains the idempotency UUID, original UUID and processor kind. An existing unconfirmed request overrides new form choices and must be recovered first. Storage failure prevents a new send; transport/30-second timeout/invalid receipt failures retain recovery. A valid matching job receipt clears the pending record; delayed responses cannot clear newer requests. Recovery can return a terminal job if processing has already completed. No raw session/CSRF token, original text or derivative is stored: the storage key uses a SHA-256 sign-in discriminator. Tab closure/storage loss/new sign-in can lose recovery; inspect history before requeueing then. This is not cross-device/offline durable storage, and timeouts do not cancel server execution.

Completed `utf8_line_index_v1` jobs in the evidence workspace offer **Inspect unreviewed lines**. The existing scoped endpoint rehashes the current original and reconstructs stored output before returning it. Responses now carry `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`, including route-level integrity errors. Access still requires current case membership and an internal role, and successful reads retain their audit event.

The client independently checks job/case/evidence identity, processing authority version, succeeded job and unreviewed output state. It re-encodes the exact text (including BOM), checks the original digest against the selected job, rebuilds CRLF/CR/LF byte ranges and compares the canonical derivative digest and exact supported output shape. It verifies the known configuration and its digest. Rehashing fabricated offsets does not pass. Unsupported processors/formats, invalid Unicode, changed sources and foreign lineage fail before display. Input remains bounded to 256 KiB original bytes and 4,096 lines. This duplicate implementation is a first-party verification boundary, covered against the actual existing processor; it imports no third-party parser.

The viewer shows job/evidence identifiers, processing authority version, runtime/processor identity and source/output/processor-source fingerprints. It displays 100 numbered lines at a time with half-open original-byte ranges and next-byte offsets. Empty lines are labelled; source text is rendered through React text children, never HTML. The final next-byte offset can be end-of-file. Inspection is cleared on a new asynchronous action; unmounted responses cannot update the case panel. No original, claim, review, finding or binary quarantine state is changed. Use the existing original-text claim and independent human-review workflow for assertions.

Hashes are consistency checks, not authenticity signatures or proof of truth. The processor digest is recorded source-module provenance, not an independently approved runtime image or SBOM. A privileged rewrite of both selected job and all associated data is outside this check. No source/derivative content is put in browser storage by this feature. Browser cache headers are not a guarantee against screenshots, downloads or host compromise.

## Reproduction and evidence

```bash
npm run lint
npm run typecheck
npm run build
npm run test:foundation
node --import tsx --test apps/api/test/derivative-inspection.test.ts
# Disposable PostgreSQL credentials from the existing test plan:
npm test --workspace @inveos/api
```

Three derivative client-helper tests run under Node Web Crypto against actual first-party processor output, covering BOM/Unicode/repeated and empty lines, markup preservation, foreign scope, wrong states/configuration/hashes, invented rehashed offsets, changed text and bounds. These are not browser rendering/security tests. A new API scenario runs the actual worker, fetches its output over loopback HTTP, executes this same client validator, checks no-store/nosniff, rejects a wrong selected case and rejects subsequent original corruption without creating findings. Existing tenant/revocation/output-corruption tests remain required. Three additional queue-helper tests cover request retention, scope separation, failed storage, malformed receipts and delayed completion. A second actual HTTP/database scenario discards a committed queue acknowledgement, reconstructs client state, recovers one job despite changed form choices, runs its worker and verifies its output with the inspector. Deliberate response discard/storage doubles are not real browser restart or network-outage evidence. Exact executed receipts are in BUILD_HANDOFF.md.

Actual browser click/pagination/case-switch/accessibility/markup rendering tests remain unrun. The earlier sandbox-enabled Chromium launch was unavailable; no browser acceptance is inferred from compilation. Parser isolation and runtime/licence/SBOM gates remain open. No new dependency, migration or third-party source; no live collection, deployment or merge. Rollback application/client code only, retaining immutable derivative/job history. Browser queue/inspection acceptance, dispatch, page/region review, resumable uploads, release and native/offline/restore remain outstanding.
