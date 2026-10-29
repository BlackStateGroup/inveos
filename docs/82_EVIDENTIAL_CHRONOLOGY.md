# Evidential chronology

## Delivered boundary

WP-15's basic alleged-event chronology uses the existing case, reviewed finding and report boundaries. Each recorded account has an alleged date with explicit precision (`instant`, `day`, `month`, `range`, `unknown`), original offset/timezone statement and an uncertainty note. Calendar days and months remain strings; the application never turns them into midnight UTC. An instant or range endpoint needs an explicit known offset; `-00:00`, invalid dates, rollover times and reversed instant ranges fail closed. A range can overlap another account. Unknown dates remain null.

The view uses **recorded order, not asserted event order**. Contradictory accounts remain separate records, with `alleged`, `disputed` or `withdrawn` status. An event is explicitly `recorded_account_not_finding`; linking an accepted source passage does not approve an account or establish its truth. Source-recorded time, receipt time, extraction processing time, source review time and event revision time remain separately labelled. Searches cover the current case's loaded accounts without external collection.

Every account references exactly one existing text finding or document finding. Creation and active correction reverify the cited original and finding, including the document's independently reviewed citation/interpretation chain. The source authority must match the active case authority. Historical source candidates are labelled by type; a stale candidate cannot save successfully. Full original/page inspection continues through the evidence workspace.

## Persistence, access and corrections

Migration `032_chronology.sql` adds scoped identities and append-only revision snapshots. Existing migrations are unchanged. Case locks serialise creations/corrections, expected versions prevent lost edits, and repeated creation requests return the current saved revision (including later withdrawal). Audit failure rolls back the event and its revision together. No delete endpoint exists. A withdrawal can retain the same unavailable historical source so a broken source does not prevent recording its withdrawal; changing the source still requires verification. Limits are explicit: 1,000 accounts per case and 1,000 revisions per account; overflow is rejected rather than silently truncated.

All API operations authenticate, deny client roles and resolve tenant plus current case membership on the server. Writes require the existing origin/CSRF controls. A source link to another case or tenant cannot resolve. History retains the original source identity and correction reason. Listing history is not a claim that a historical source still passes today's checks; source inspection performs those checks again.

## Frozen report and independent verification

Current event versions are included in the existing immutable report snapshot, including disputed/withdrawn accounts, precise date representations and typed source references. The referenced findings and their original timestamps/citations remain in that same report. Later event corrections never rewrite a frozen revision. A missing report source blocks a new freeze. API correction history remains internal; the report freezes the selected version, not every earlier draft account.

`tools/verify_report.py` validates chronology independently for text reports. `tools/verify_document_package.py` does the same for document/mixed packages, in addition to existing byte/derivative/citation/review checks. Both reject missing or mistyped sources, cross-case/duplicate events, malformed dates, invented unknown-date precision and invalid revision declarations. Retain the exported SHA-256 separately to authenticate the complete snapshot; an internally consistent package alone proves neither provenance authenticity nor event truth.

The canonical PDF includes alleged dates, uncertainty, status, source reference, separate original/receipt times and the account's revision time. Redacting a finding withholds the **entire linked chronology entry**, including its title, detail and date note, from visible text and the embedded semantic model. The separately approved full JSON/package still contains its original context, following the existing release boundary. Earlier frozen reports without chronology reproduce unchanged. The old illustrative/browser-print presentation is not the canonical approved PDF workflow.

## Reproduce and remaining criteria

Use the disposable PostgreSQL setup in [LOCAL_RUN.md](../LOCAL_RUN.md), migrate, build and enter the persistent synthetic lab. Review a fictional text or document passage, open **Timeline**, record an alleged event, correct it, inspect its history/source, then freeze a report through the existing report revisions interface. PDF rendition/review/release still requires its existing explicit human decisions.

Verification commands:

```sh
npm run lint
npm run typecheck
npm run build
npm run test:foundation
# Set both INVEOS_TEST_*_DATABASE_URL variables to the disposable inveos_test database.
npm test --workspace @inveos/api
# On a host with a working Chromium sandbox:
INVEOS_TEST_BROWSER=1 npm test --workspace @inveos/api
```

Tests exercise real PostgreSQL/API persistence, concurrent version rejection, immutable revisions, audit rollback, unavailable originals, revoked case access, client denial, stale authority, typed document lineage, frozen independent exports and full-entry redaction. Nineteen date shapes run against the actual API; separate date tests exercise offset/calendar edge cases. The browser journey creates/corrects/reloads an event, inspects history and source times and checks narrow-screen overflow. Exact passing commit/run receipts belong in the handoff; unrun browser/worker checks are not local passes.

Remaining WP-15/P1 criteria include faceted server search, saved views, interval visualisation, direct observation/interview/media capture before source review, explicit multi-source competing-account relationships, large-case performance and native device acceptance. This increment deliberately requires an already reviewed source passage. Real identity, production storage/operations and professional/security/privacy/licence/legal acceptance remain separate open product gates.
