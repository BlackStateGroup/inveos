# Case search time bounds and word matching

Implementation phase, 30 October 2026. Existing scoped search and private saved views now support separate source-recorded and received-time ranges, exact original identity and literal phrase/all-words/any-words modes.

The server keeps current tenant/case membership and source-use checks. Original metadata is joined through the same tenant/case/original identity. Both time bounds are inclusive explicit instants with known offsets; invalid dates, unknown offsets and reversed ranges are rejected. Time filters exclude records without a direct original link instead of inventing event times from work/chronology dates. Source-recorded time retains its original text; receipt time is distinct. No alleged date inference or current-byte verification is implied by a search hit.

Word modes use at most twelve whitespace-separated literal fragments, without stemming, entity inference or semantic ranking. Empty queries browse scoped records. Search type and status counts reflect the same active filters; keyset pagination and fixed record-type/identity order remain. Parameterised SQL, the existing two-second statement bound and explicit source inspection are retained.

Saved filters preserve optional modes/ranges/source identities in versioned snapshots. Old filters still mean phrase matching with no time/source restriction, and their original idempotency hash shape remains unchanged. The UI exposes the optional controls, per-hit source/receipt metadata and filter history.

Web, contracts and API compilation passed (`/tmp/inveos-search-facets-compile.log`). Database/API/browser/performance checks are **unrun**. Acceptance must cover offsets/date boundaries, source versus receipt differences, null-linked records, exact-source cross-case guessing, word/phrase distinctions, literal punctuation, invalid ranges/offsets, inherited older filters, altered retries, saved-history changes, permission/source-use revocation, pagination/facet consistency, query limits, desktop/narrow renders and representative large-case timing. This increment does not establish production search performance or full semantic retrieval.
