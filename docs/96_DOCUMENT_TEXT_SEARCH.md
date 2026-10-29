# Stored document text search and exact extraction inspection

This increment is in progress. Actual browser and isolated worker acceptance must be recorded before merge.

The case brief searches text from published native PDF and OCR derivatives alongside existing stored records. Choose **Extracted document text** to narrow results. Each completed processing job is a separate identity, even when repeated runs extracted identical text. Failed, pending or cancelled jobs without a published derivative do not become search results. Text remains labelled **Unreviewed extracted text** or **Unreviewed OCR text**, regardless of whether a later finding was reviewed. This does not promote a raw extraction into a claim or finding.

The existing literal, case-insensitive phrase semantics, exact-status filter, type counts, 50-record keyset pages and two-second database deadline apply. Each query checks current server membership and tenant/case scope; clients are excluded. Phrases stay in the POST body rather than query URLs or audit summaries. The server searches stored UTF-8 derivative text; it does not load PDF/image parsers, download originals or use an external index. Excerpts are bounded to 260 characters. A match does not certify source integrity, current authority, reading order, completeness or truth. This is bounded SQL search of published extraction records, not representative large-case performance qualification.

**Verify and inspect extraction** opens the exact processing job, including an older job absent from the first history page. The existing inspection API rechecks original bytes, raw output, frozen profile and derivative identity before display. The browser also validates its receipt and shows original-page references, extracted offsets and OCR limitations. Search excerpts are not citations. Select and review the actual occurrence through the existing page/citation workflow. A stored match can remain searchable after bytes become unavailable or disputed; inspection then fails visibly. Existing report and release gates remain unchanged.

The searched job is kept in the case URL fragment for reload, without search text or source contents. Each reload re-authenticates and checks membership; an ID is not an access grant. Case navigation clears the previous target. Denied processing access clears loaded passages, images, jobs and history and refreshes the surrounding workspace. The ordinary original source button remains available. **Retry searched extraction** rechecks that specific target after an error. The fragment retains the searched job; manually inspecting another processing-history entry does not change that saved target.

## Verification and reproduction

Use the disposable PostgreSQL setup in LOCAL_RUN.md, then run:

```sh
npm run lint
npm run build
node --import tsx --test --test-name-pattern='document text search|document search and exact|document search traverses' apps/api/test/api.test.ts
```

Focused tests exercise actual PostgreSQL and HTTP scope/role/revocation/CSRF controls, immutable repeated extraction identities, 51-result pagination, restart and source corruption followed by denied inspection. These reuse retained native output; they are not new parser executions. The hosted browser test searches, opens a job behind 26 newer jobs, reloads the exact inspected job, checks a narrow viewport and clears revoked data. The separate Research workflow extends actual encrypted supplier processing to search newly produced native and OCR text and reopen the OCR passage in its browser. Exact execution and render evidence belongs in the evaluation receipt and handoff.

No new dependency, research source, runtime, model, third-party data set or source-collection access is added. Queries reveal only current case records to assigned internal roles. Punctuation, errors and extraction gaps remain source limitations. Linguistic ranking, richer facets, cross-case policy, bulk work and representative long-document/capacity measurements remain open. No complete product or production-readiness claim is made.
