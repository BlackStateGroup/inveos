# 129 — Case batch processing and persisted queue health

Implementation handoff, 30 October 2026. Branch `feat/bulk-processing` starts from completed Field commit `5063d97553ab77159e3b84bb798ac04d12b8631b`. Root owns integration, acceptance, PRs and merging. This increment is first-party API/database/browser implementation, not worker qualification, a parser benchmark or production approval. Fictional inputs only; no new dependencies, runtime installs, outside collection or worker launches.

## Implemented workflow

The Evidence workspace now has a batch console above the existing individual processing panel. Investigators can page/search existing originals, select at most25, choose one enabled existing profile, inspect its limits and fingerprint, check original eligibility, record a reason, and queue the exact selection. Selections persist across source pages. The server repeats current authority, membership, source-use, digest, size and basic format checks at submission. Partial rejection is visible and retained beside successful queue receipts. A PDF signature is not PDF parsing, page-count qualification or evidence of supported content; those checks remain inside the existing isolated worker.

Batch admission and cancellation call the same transaction helpers as individual job endpoints, extracted inside `registerIntegrityJobs`. Existing job identities, events, lease tokens/deadlines, attempt ceilings, permission checks, cancellation fencing, worker isolation, derivative attachment and review rules remain. The batch API never claims/renews a lease, starts a worker, changes original bytes or clears quarantine. The individual UI remains available for attempts, derivative inspection, original-page comparison and later human review.

Migration085 adds immutable batch selections, immutable per-item admission results and immutable cancellation receipts. Every selection has a result; a deferred database constraint rejects incomplete batches. Queued item lineage must match the selected original/digest and parent batch's actor/authority/profile kind. Rejected foreign/unavailable original or previous-job IDs are retained as submitted IDs only; no unscoped foreign lookup occurs. A batch can contain25 items, case history is bounded at1000 batches, and a batch can retain1000 cancellation decisions. Server limits fail visibly; no pruning of originals or prior outcomes occurs.

Item validation errors use savepoints: an ineligible item is recorded as rejected, while eligible items use the existing queue helper. Unexpected storage/database/audit failures roll the entire transaction back. Stable caller request IDs recover the same immutable results after lost responses. Dynamic `currentJob` is separate from the retained queued `job` receipt, so later completion/cancellation does not rewrite what the batch accepted.

Explicit retries create a new batch and new job, linking the parent batch and exact previous failed/cancelled job. They recheck current authority and all source/profile gates. Active or successful jobs cannot be named as retry predecessors. A known unsupported-media/original/text-limit failure for the same immutable original/profile blocks batch resubmission; investigators must inspect another eligible profile explicitly. No automatic fallback, format conversion or silent retry is introduced. An already queued/running job for the same original/profile also prevents duplicate batch queueing, including expired-running records that remain the responsibility of trusted worker recovery.

Cancellation selects exact job status and attempt. If the worker advanced, that item records conflict and requires inspection. Already-terminal jobs return their terminal outcome. Successful cancellation uses the existing lease invalidation path, preserving prior attempts and originals. The cancellation request and every outcome have a stable receipt; later job state does not rewrite that receipt.

Migration086 handles unresolved requests. An explicit **Recover receipt or withdraw unrecorded request** action locks the case, returns an existing exact receipt, or writes an immutable withdrawal marker if the request never committed. Late requests with that identity are then rejected. This prevents a rejected/stale-authority request from permanently blocking the tab, without assuming a timeout or404 proves failure. It never cancels already recorded jobs. Case access remains required, including for recovery/withdrawal.

The browser retains one unresolved operation per case/account in session storage before sending: IDs, source/profile digests, expected versions, explicit reason and selection, never original bytes. Keys use server-returned tenant/user/case identities so same-account re-auth can recover within the same tab. Another account does not adopt the request. The exact receipt hash, actor, profile/authority, ordered items and queued job lineage must match before clearing local pending state. Server history remains available after tab loss. Access denial clears visible case processing data and calls the existing workspace refresh; pending tab metadata is preserved for its original account.

## Queue health

A case-only summary reads actual persisted jobs: state counts, profile/state counts, failed-code totals, oldest creation/queue ages and running records whose lease deadline elapsed. A paged job filter exposes current states, attempts, ages and failure codes, and opens the existing individual job inspector. Neither summary nor an expired lease claims worker-process liveness, host availability, processing accuracy or service-level attainment. No global/cross-tenant dashboard or production operator control was added.

## Existing profiles and limits

The catalogue comes from existing profile constants and existing lab configuration. Lab-enabled means API configuration permits that profile, not that a qualified host is currently running.

| Profile | Existing bounds retained |
| --- | --- |
| `original_sha256_v1` | Original bytes, up to256KiB; digest equality only |
| `utf8_line_index_v1` | Stored UTF-8 original, up to256KiB,4096 lines,1MiB derived output |
| `native_pdf_lab_v1` | Binary PDF,64KiB,at most2 pages; native text only, no table/OCR completeness claim |
| `pdf_raster_lab_v1` / `v2` | Binary PDF,64/256KiB,at most2 pages; existing dimension/pixel/PNG bounds, greyscale; forms/annotations omitted |
| `tesseract_scan_lab_v1` / `v2` | Binary PDF,64/256KiB,at most2 pages,1000 words; English144dpi/PSM6; recognition remains unreviewed |
| `whisper_pcm_lab_v1` | Canonical44-byte-header monoPCM16,16000Hz WAV,up to256KiB/about8.19seconds; existing English tiny.en model and output bounds |

Isolated profile fingerprints reuse their actual frozen profile digests. The integrity/text descriptors fingerprint the existing operation/configuration, not native runtime attestation. Original bytes are rehashed during batch preview/admission. Canonical PCM inspection is reused from contracts; PDF checking reads only the existing `%PDF-` boundary, not a parser. Text line/output and all parser-level structural/page/quality conditions are still checked by existing workers. No catalogue runtime or dependency was acquired/copied; existing notices remain unchanged.

## Routes

All routes begin `/api/cases/:caseId`, enforce current internal case membership and return no-store responses through the existing app policy.

| Suffix | Purpose |
| --- | --- |
| `GET /processing-profiles` | Current authority, collection state, account scope and enabled existing profiles |
| `GET /processing-originals?kind=&q=&before=` | Paged original metadata filtered by filename, size and storage kind; no original bytes |
| `POST /processing-preview` | Exact profile digest/current authority/items; bounded eligibility results, no jobs |
| `POST /processing-batches` | Stable ID, explicit reason, profile digest, authority version, ordered original/digest/retry selections |
| `GET /processing-batches?before=` | Paged retained batch summaries |
| `GET /processing-batches/:batchId` | Retained per-item admission receipts plus separately current jobs |
| `POST /processing-batches/:batchId/cancellations` | Stable ID, reason and selected expected job attempts/states |
| `GET /processing-batches/:batchId/cancellations?before=` | Paged immutable cancellation receipts |
| `POST /processing-requests/resolve` | Recover exact queue/cancel receipt or fence an unrecorded request against late arrival |
| `GET /processing-health` | Current case-only aggregate job counts/failures/ages and expired running leases |
| `GET /processing-queue?status=&kind=&before=` | Filtered paged current case jobs without lease secrets |

## Integration and checks

Files: dedicated contracts, profile catalogue, batch routes, browser request recovery, batch UI/CSS, migration085/086 and `apps/api/test/processing-batches.test.ts`; small helper extraction in `integrity-jobs.ts` and connection inside `ProcessingJobs.tsx`. The app's root registration/case UI and Field implementation are unchanged by this increment. Migrations087–088 are unused. Central `BUILD_HANDOFF.md`, `docs/INDEX.md`, CI and shared test inventory were not edited. Root must reconcile any central migration-count inventory when integrating. Do not alter an applied migration or delete retained batch/audit history to roll back.

All workspace TypeScript checks passed during implementation. Targeted lint and final diff results are recorded with the commit receipt. Initial compiler failures from a cancellation-schema brace and the existing `document` state variable shadowing the browser document were corrected. No failure was labelled a pass.

**Acceptance is UNRUN.** Six focused tests are authored and typechecked: five disposable restricted-PostgreSQL/API scenarios (partial/replayed receipts with real first-party text worker completion; resolution/late-arrival race; attempt-fenced cancellation and linked retries; format/role/case/authority denial; audit rollback), plus a client pending/forged-receipt check. They are executable acceptance definitions, not results. No full test suite, migration execution, browser/render build, outage replay, parser runtime, performance benchmark, native/device test or production action ran in this build phase.

After integration, root can run the dedicated tests with the existing test database configuration:

```bash
node --env-file=.env --import tsx --test --test-concurrency=1 apps/api/test/processing-batches.test.ts
```

Still required: actual fresh/populated migration checks; the focused and combined PostgreSQL/API suite; cross-tenant and lock-wait race coverage; source-use withdrawal while waiting; expired-grant/session/access paths; disabled-profile paths; malformed/truncated/oversized bodies; unknown storage/audit failures; cancelled-worker late completion; repeatable receipt hashes after profile changes; trusted browser checks for paging/partial errors/re-auth/tab loss/lost queue and cancellation responses/explicit resolution/StrictMode/stale responses; keyboard/narrow rendered inspection; actual existing isolated workers on the integrated branch. Use fictional fixtures only. PDF header fixtures are format-gate checks, never parser benchmarks.

Limits/gaps: admission checks are synchronous and bounded to25 originals (at most6.25MiB read per request); no background batch scheduler, automatic retry, worker host discovery, worker-process liveness, prioritisation, user quota/billing changes, new parser support or production operations. Queue age is measured from job creation, not source time or time spent actively processing. Retained batches are not frozen report proofs or independent offline verifier exports. Long-running large-case measurements and browser accessibility/render acceptance remain open.
