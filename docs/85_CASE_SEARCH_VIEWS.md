# Case search and private saved views

The persistent case brief now searches stored records on the server. Each request authenticates the current session, refuses client roles and checks tenant/case membership before querying. Results never grant access to another case or become a disclosure. Private saved views are scoped to the current user as well as tenant/case; another assigned investigator cannot read or revise them. CSRF/origin checks apply to search POSTs and view changes. Search phrases stay out of query URLs and audit summaries. API responses are not cached.

## Search semantics

Search matches a bounded literal, case-insensitive phrase using PostgreSQL over original filenames/methods, text claims/quotes, document interpretation claims, recorded text/document findings, current work records and latest alleged accounts. `%` and `_` have no wildcard meaning. Record type and exact status narrow results. Type facets count the current phrase/status matches; selecting a type does not hide counts for other types.

Claims, findings and alleged accounts have separate types and recorded statuses. Search does not read/reverify original bytes, recalculate authority, certify a recorded review or establish source truth. Open the record section and original source to use the existing verification/review controls. This is not raw PDF/OCR/full-document indexing or AI search. No embeddings, external service, third-party source or new dependency is introduced.

Results have bounded 260-character excerpts and 50-record pages. Each SQL branch includes tenant and case predicates. A two-second statement deadline bounds execution. Keyset pagination uses record type and UUID, not a relevance score or alleged event time. Each page queries current records; it is not a frozen snapshot. Concurrent changes can alter membership of the result set; rerun the search to see them. A cursor cannot extend case access.

## Saved filters and interface

Open a persistent case's **Brief**, then **Search this case**. Enter a phrase (blank browses records), optional type/status and run **Search case records**. Use **View name → Save private view** to retain a filter. Selecting a saved view loads the filter; running it always searches current records under current access.

Revisions use an expected version and a case transaction lock. Conflicts preserve the caller's input and require refreshing/comparing. Creation uses a stable request identity; replay returns the latest state, including withdrawal. Withdrawal retains the filter and its immutable history; an explicit later revision can reactivate it. There are at most 50 saved identities per user/case and 100 revisions per identity, including withdrawn records. Only the head version is updateable by the application DB role; historical rows cannot be changed or deleted. Audit failure rolls back the whole save. Audit summaries contain the revision number, not private search content.

The interface supports empty/error/loading states, source navigation, pagination, save/revise/withdraw/history and reload. A case/session change remounts and aborts pending requests; access denial clears results and saved-view history. The existing illustrative/global search remains a separate entry point; this increment is case-scoped.

## Reproduction and honest limits

Apply migration 034 using the existing lab migration command, build the web application and run the PostgreSQL API suite described in LOCAL_RUN.md. Focused acceptance:

```sh
node --import tsx --test --test-name-pattern='case search|private saved|search and saved|saved-view audit' apps/api/test/api.test.ts
```

The actual database tests cover mixed record kinds, literal/Unicode phrases, document-claim separation, result bounds, privacy, tenant/case/client denial, membership revocation, CSRF, immutable history, conflicting revisions, idempotent withdrawal replay, audit rollback and pagination. A 5,000-short-note fictional SQL fixture measures bounded retrieval; it is not representative large-document/performance acceptance. The sandboxed browser test drives search, save/revise/reload/withdraw/history and access denial at desktop and narrow widths. Record exact executed results in the handoff; a written test does not count as run.

Remaining: raw-document indexing, richer status/date/source facets, shared policy-controlled views, bulk operations, cross-case authorised search, representative large-case latency/capacity, full-text linguistic quality and independent professional/privacy acceptance. The whole product and production readiness remain incomplete.
