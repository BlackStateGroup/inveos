# Retained review assignment register

The notification workspace now offers a reviewer-only assignment register even when there are no pending reminders. Completed, superseded and withdrawn versions retain their assignment history. Every entry refers to an exact record key and revision; opening it uses the existing versioned ownership endpoint. No review decision, access grant or replacement record is created by listing or reading history.

## Behaviour and access

`GET /api/review-assignments` returns up to50 latest assignments for distinct case/record/revision identities. Current case membership and current reviewer role are joined inside the query, independently of notification preferences or acknowledgement. Tenant and unassigned-case records are excluded; investigator/client reads are denied. Responses are `no-store`. Historical reads remain available for closed cases only to current case reviewers.

The optional `ownership=mine` filter applies after selecting the latest assignment, so reassigned work does not appear under its previous owner. A stable three-part cursor (`afterCaseId`, `afterKey`, `afterRevision`) orders case/record/revision, independently of assignment timestamps and versions. Supply all three parts or none. Queries retain the shared two-second statement/lock bounds. This is current-state keyset pagination, not a frozen snapshot of changes between pages.

The current pending eligibility query is reused. “Not currently pending for you” does not assert completion or approval: withdrawal, changed authority, correction or ineligible authorship can also remove a reminder. Since old record titles were not stored with assignments, inactive entries show their review type and short record identity, rather than borrowing a later title. The exact revision remains visible. This register is coordination history, not a complete review-decision ledger; records never assigned are absent.

The browser clears loaded list and selected details when refreshing, filtering, changing page, or encountering denial/failure. Selected historical versions have no assignment form unless the existing endpoint confirms they are currently pending for this reviewer. Leaving the register aborts its pending request. Reload reopens the server-backed register from notifications. Existing current-role controls remain authoritative if the displayed account role becomes stale.

## Privacy and source review

No new dependency, source copy, schema, role, retention rule, external notification or permission grant. Reuses the existing first-party attention/assignment query, UI and immutable history. Names/reasons are internal case coordination data; server current-membership checks govern each read. The list does not expose originals, excerpt bytes, recipient files or titles from inaccessible cases. Fictional fixtures only. This work does not establish professional/legal/privacy approval.

## Verification and retained failures

Three new actual PostgreSQL/API tests exercise completed/rejected/corrected/closed-version discovery, stable51-record pagination, latest-owner filtering, real HTTP no-store/authentication/role/case/tenant boundaries and revoked membership. The first focused run passed two tests and failed one because its query-validation expectation was400 instead of the existing API's422; the assertion was corrected. A fixture type check also required an explicit shape for native `fetch().json()` (unknown). The corrected11 focused ownership/register tests pass.

A new actual-browser journey covers discovery from an empty reminder queue, both saved assignment versions, absence of an edit form for a completed review, actual reload,390px layout and revoked-access clearing. Hosted production/development browser execution and render inspection are pending. Full local acceptance passed410Node/46explicit browser skips/456total,188Python,lint,type checks,build and workflow validation. Local browser execution remains unavailable; the skips are not browser acceptance. Hosted production/development checks and render inspection remain pending.

## Reproduce

Run the standard disposable restricted-role PostgreSQL setup from README, then `npm ci`, `npm run typecheck`, `npm run lint` and the API/foundation suite. For focused actual database checks use `node --import tsx --test --test-concurrency=1 --test-name-pattern='review assignment register|review ownership' apps/api/test/api.test.ts` with `INVEOS_TEST_DATABASE_URL` and `INVEOS_TEST_ADMIN_DATABASE_URL` pointing to the disposable database. Qualified browser hosts use the existing `INVEOS_TEST_BROWSER=1` path; CI retains both fictional register screenshots. Never relax browser isolation when the local host cannot support it.

PR113 initial head326085b5f6e508fad4906e866ef80c4cd55f747c: Checks41041544331 / job124015299783 failed455/456Node,zero skips,188Python passed. Completed history/reload worked, but the new history-entry button overflowed at390px. Its existing wrapping action container is now applied; the browser retains its narrow screenshot before asserting widths and reports overflow geometry on failure. Development/office stages were not reached. Main112 was integrated without rewriting published history; conflicting documentation additions were both preserved. Combined Python197 passed locally. Corrected hosted acceptance is pending.

#113 resulting-main41043710293 / job124022477413 passed456Node/197Python,zero failures/skips,46production+9development browsers,both office profiles,unchanged host/lint/types/build, at merge bbef17122056fa574bf9288963d3d70e815a3e4a.
