# Durable native-document results and inspection

29 October 2026. Synthetic development only; continues PR #49. This slice stores
and inspects unreviewed PDF extraction results through the existing case/job
architecture. It does not install, enable or approve an upstream parser runtime.

## Implemented boundary

Migration 022 adds `native_pdf_lab_v1` and append-only `document_derivatives`.
The result has a composite foreign key to the exact tenant, case, job, evidence,
source digest, authority version and kind. Its attempt must match a successful
job. A deferred constraint prevents successful document jobs without a result.
The result, success event and terminal transition commit or roll back together.
Original evidence remains quarantined and unchanged; no claim/finding is created.

`finishDocumentJob(pool, storageRoot, scope, token, result)` is a trusted internal
entry point, not an HTTP upload or completion endpoint. It locks the live job,
rechecks Active case/current authority/requester membership, reads the bounded
original and verifies its length/digest, then validates result context and the
frozen runtime profile. The final transition repeats the lease/membership check.
Expired, replaced and cancelled workers cannot attach. Competing completions
produce one result. Database waits are bounded. Bad output produces the fixed
`document_result_invalid` failure; unreadable/changed originals produce
`original_unavailable`, without leaking parser diagnostics.

The profile names the exact research source/wheel, image and wheel inventory
already examined in PRs #42–47. It allows two pages, 65,536 original bytes, one
parser thread, 20-second conversion, no OCR/page rendering/bitmap inclusion.
This is a **frozen versioned profile**, not shipping approval. Change its kind and
normalisation format when changing configuration or semantics; never reinterpret
historical `native_pdf_lab_v1` records with a different profile.

The first-party TypeScript adapter validates bounded native JSON (1 MiB), UTF-8,
duplicate keys including escaped aliases, nesting, contiguous page identities,
finite dimensions/boxes, original coordinate origins, full single-page native
charspans and sequential item references. Tables/key-value content are rejected
rather than silently omitted. Text offsets use UTF-8 bytes; native charspans use
Unicode codepoints. Repeated passages keep distinct page/item identities.
Empty text and pages without text remain explicit `needs_page_review` results.
Text on every page still never establishes completeness. No PDF content is parsed
inside Fastify; the `%PDF-` prefix check is only a format precondition.

Raw bytes/digest, normalised bytes/digest, profile/digest, attempt and processed-at
are retained. Source and received times remain on the original and are returned
separately. This application format is `inveos_native_document_v1`, distinct from
the Python research envelope: its serialisation/hashes are not interchangeable.
The Python research contract remains unchanged.

## Queue, retrieval and investigator inspection

`INVEOS_DOCUMENT_LAB=1` enables *queueing* this kind in the existing local-only
API; default is disabled. The ordinary text/integrity dispatcher deliberately
ignores document jobs, and the named text runner refuses them. There is no
qualified parser/container adapter yet, so do not enable this flag expecting
queued work to run automatically. The UI has no document queue option yet.

The existing authenticated/CSRF-protected queue accepts:

```json
{"evidenceId":"<existing binary evidence UUID>","idempotencyKey":"<new UUID>","kind":"native_pdf_lab_v1"}
```

Only a bounded opaque binary original in an Active case is eligible. Existing
idempotency, history and cancellation apply. No browser-supplied runtime, scope
or processor configuration is accepted.

`GET /api/cases/:caseId/integrity-jobs/:jobId/document-derivative` requires current
internal case membership. It re-reads/re-hashes the original, verifies raw/profile
hashes, re-normalises stored raw output and compares exact normalised bytes before
an atomic audited response. No-store/nosniff headers apply; clients and foreign or
withdrawn scope are denied. Historical authority is labelled, not silently
replaced by the current authority.

The Evidence processing history identifies native PDF lab jobs correctly and
provides **Inspect unreviewed pages** for successful results. The browser checks
selected job/evidence/authority/source identity, normalised/profile hashes,
geometry, byte ranges and coverage counts before rendering text through React.
It displays original page numbers, region coordinates/origin, exact extracted
byte ranges and missing-page warnings, with bounded passage pagination. Starting
another action clears the previous inspection; failed verification cannot leave
stale passages displayed. This is text/region inspection, **not original-page
rendering, citation approval, a reviewed finding or a report inclusion path**.

## Reproduction and evidence

Use the existing local lab/migration instructions in `23_LOCAL_APPLICATION.md`.
With Python 3, locked npm dependencies, disposable PostgreSQL and sandboxed Chrome:

```bash
npm ci --no-audit --no-fund
npm run lint
npm run typecheck
npm run build
node --import tsx --test apps/api/test/document-derivative.test.ts
npm run test:foundation
# Set INVEOS_TEST_DATABASE_URL / INVEOS_TEST_ADMIN_DATABASE_URL to disposable roles.
INVEOS_TEST_BROWSER=1 npm test --workspace @inveos/api
```

The new API fixture generates our fictional PDF with `tools.synthetic_pdf` and
replays `nativeDocument` from the stored actual PR #47 parser receipt. It
serialises that recorded object as JavaScript JSON for this new adapter, so its
raw digest differs from the Python research envelope; it does not invent a fresh
parser run or claim identical raw bytes. Tests cover durable restart/retrieval,
concurrent completion, retry after expiry, scope/context/profile rejection,
authority/membership/cancellation, SQL immutability, forced storage rollback,
original/raw/normalised tampering, opt-in/CSRF/queue gates, Unicode and geometry.
A real Chrome journey checks page-two inspection, reload and corruption denial.
Hosted [Checks #131](https://github.com/BlackStateGroup/inveos/actions/runs/40797926451)
passed at implementation `db7e5e0178aa560c44cfaa6b4ad563f2df03549f`, tree
`2cd866131a0b52fb0dd01b9fe334631079eff8e2`, job `123198792011`:
**164 Node tests passed, zero failures/skips**, including seven new PostgreSQL/API
scenarios, one new actual Chrome journey and nine adapter/client checks. Existing
browser/restore tests and actual host isolation/resource probes passed; all 98
Python tests, lint/types/build and reference checks passed. Chrome was
156.0.8078.47 (revision 1d17a2e2ee147bb7d6ae2ab6abdb3a2510c17775), sandbox enabled,
on Ubuntu 24.04 with Node 22, Python 3.11 and disposable PostgreSQL 15. Local
lint/types/build, nine adapter/client tests, all Python tests and foundation/
reference checks also passed. This evidence follow-up changes documentation only;
it is not a new parser run, device test or production-readiness assessment.

## Trust, remaining work and rollback

Hash/context checks bind records and detect inconsistency; they do not prove that
a trusted worker really used the declared runtime or that text matches visible
PDF content. Raw output cannot be regenerated from PDF bytes without executing
a qualified parser. A privileged actor replacing every input/hash is outside
these consistency checks. Worker attestation remains trusted application code;
no worker credential separation/RLS or cryptographic signature is added here.
The existing filesystem is still an unencrypted synthetic lab store.

Next: connect the qualified no-egress container runner to these leased jobs with
explicit daemon/container cleanup and recorded runtime identity; then original
page/region display, human-reviewed derivative citations and export verification.
Native licence/security approval, broader document/OCR benchmarks and Tika/
OCRmyPDF comparison remain open. The upstream native runtime is not redistributed
or imported. All new code is first-party and no dependency lock changes.

Rollback: disable document queueing and return to previous application code;
preserve existing result/history tables. Do not delete evidence/history or edit
applied migrations. A later reviewed forward migration can retire this lab kind.
No deployment, merge, client release or product completion is claimed.
