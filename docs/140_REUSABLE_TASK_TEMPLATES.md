# Reusable case task/checklist templates — implementation handoff

Build phase only: connected persisted implementation and compiler feedback, not
combined acceptance. Root owns integration, review, migration/runtime/access/race/
browser acceptance and any later merge. Central INDEX, BUILD_HANDOFF and shared
CI/test inventory are unchanged. No new dependency, source acquisition, parser,
provider activation, external contact or production action is included.

## Implemented workflow

The existing persisted Tasks/Assignments view now contains **Reusable case task
and checklist templates**. An internal case member authors a named template from
blank fields: description and ordered task/objective/question/note entries. Entry
IDs remain stable through corrections. Each entry has a title, body and optional
investigator timing guidance. The editor does not import existing work, case body,
source, finding, report, person, parent record or evidence links. No structured
reference fields or automatic case-field substitutions exist in this format.

Saving records an immutable version with a reason and fingerprint. Corrections
append versions; terminal withdrawal retains the complete prior boilerplate.
Current case reviewers who authored no version of that template can accept an
exact version or request changes. Review decisions are also immutable and
sequential. Each new template version requires its own independent acceptance.
The UI exposes version history and exact review history, including historical
versions that may be deliberately pinned for reuse.

To apply a version, the investigator must select an owner and a calendar deadline
for **every** entry. The selectors start undecided; explicit unassigned/no-deadline
choices are supported. Owners must be existing internal members of this case.
There are no inferred owners, default dates, tenant-wide defaults or copied case
assignments. Timing guidance is a versioned investigator declaration only. It does
not calculate a deadline or assert a service level, contract or SLA commitment.

The API saves an immutable application preview containing the template ID/version/
digest, exact acceptance event, ordered boilerplate, new work IDs, explicit owner/
deadline choices, owner display labels and application reason. The preview has a
30-minute lifetime for creating work. Saving it creates no case work. The UI shows
all of these choices and requires a separate affirmative apply action.

Application rechecks the preview fingerprint/author/expiry, template status,
latest acceptance for the pinned version, current accepting reviewer's case role,
all owners, calendar dates and new work identities. It creates all entries in one
transaction through the **same guarded creator used by ordinary case work**.
Initial statuses remain task `To do`, objective/question `Open`, note `Recorded`.
Every initial record has `parentId: null` and empty frozen source links. No
hypothesis, handover, claim, finding, completion decision or access grant is
created by applying a template.

If any entry fails, the entire transaction, per-work audits, initial revisions and
application receipt roll back. Reusing an existing work ID is rejected rather
than silently adopting an old record. The application ID is the saved preview ID;
retrying that exact preview/digest returns its original receipt without creating
another work set. The receipt retains immutable version-1 work snapshots even
when normal case work later changes their body, owner, deadline or status.

## Pinning, withdrawal and review semantics

A newer draft or accepted version does not silently replace an explicitly pinned
older accepted version. The older version remains usable while the template's
head is active and that version's latest review is still accepted by a current
case reviewer. A changes-requested decision suspends future applications of that
version. A new acceptance event invalidates pending previews bound to the prior
review ID, requiring a fresh explicit preview even when the boilerplate digest
has not changed. Revoked reviewer access also blocks new application until a
current independent reviewer records another decision.

Template withdrawal blocks all **new** applications of all its versions. Already
committed application receipts remain available and retryable under current
internal case access. Withdrawal never deletes or edits created work, rolls back
later case decisions or rewrites historical reviews. Use existing case work
revision controls for subsequent work changes.

Boilerplate fields remain authored declarations. A reviewer must inspect them:
the software cannot establish that manually typed prose contains no real case
content, nor that it is evidentially or legally correct. Template text is never
promoted to a finding. All examples, if added for acceptance, must be fictional.

## Persistence and API

Owned migrations **120–122**; **123–124 remain unused**.

| Migration | Scope |
| --- | --- |
| 120_case_task_templates.sql | Append-only template revisions and independent per-version review decisions; sequence and withdrawal guards |
| 121_task_template_applications.sql | Immutable previews, application headers and exact version-1 work associations; expiry/acceptance/complete-set guard |
| 122_task_template_receipt_guards.sql | Each application line must match its ordered preview entry and source-free initial revision; completed receipts cannot gain lines |

All identities and joins carry tenant and case keys. App privileges grant only
SELECT/INSERT on the new tables. Append-only triggers reject UPDATE/DELETE.
Creation/application serializes on the existing case lock. Application item rows
reference immutable case work revision 1; the application-header FK is deferred
so all items are validated before the complete application receipt is inserted.

Payload formats are explicitly versioned:

- `inveos_case_task_template_v1`: case, template identity/version/state, separately
  authored fields and revision reason.
- `inveos_task_template_preview_v1`: application identity, exact template and
  review receipt, ordered boilerplate and explicit work/owner/deadline choices.

Digests use UTF-8 JSON with recursively sorted object keys and preserved array
order. Strings are normalized NFC at entry; no rendering/ingest time substitutes
for an evidential source time. This feature creates work-planning records, not
original evidence. Preview creation/expiry and work/review recording times are
server-recorded events. Receipt reads recheck the saved preview hash and verify
that initial work snapshots still match it, including empty original source links.

API base `/api/cases/:caseId/task-templates`:

| Route | Purpose |
| --- | --- |
| GET /?after=UUID | Current template summaries, 25/page |
| POST / | New separately authored template; affirmative boilerplate confirmation |
| GET /owners | Current internal case-owner choices (bounded at 501) |
| GET /:id?version=N | Exact version, current head state and review capability |
| POST /:id/revisions | Correction with expected head version/digest and reason |
| POST /:id/withdraw | Terminal withdrawal preserving fields |
| GET /:id/history?before=N | Immutable version summaries, 25/page |
| GET /:id/reviews?version=N | Immutable review decisions for one pinned version |
| POST /:id/reviews | Exact version/digest, expected review sequence, decision/reason |
| POST /:id/previews | Exact acceptance plus explicit complete entry choices; saves preview only |

Preview API `/api/cases/:caseId/task-template-previews/:previewId`:
GET returns the saved preview; POST `/apply` accepts only its exact SHA-256 and
`confirmCreateWork: true`. Only the preview author may apply it. Application reads
use `/api/cases/:caseId/task-template-applications` (paged receipt register) and
`/:applicationId` (original immutable application receipt).

All routes reject the restricted client role; external collaborator grants do
not expose templates, previews or application history. Internal current-case
membership and session/provider/role validity are checked at transaction start
and end. Existing CSRF/origin controls apply to every write. Operation IDs bind
actor and normalized input hashes; reused IDs with altered decisions are rejected.

Limits: 200 templates/case; 100 versions/template (100 reserved for withdrawal);
100 review events/version; 50 entries/template; 4,000 body characters and 500
optional timing-guidance characters per entry; 2,000 previews/case. Owner choices
are bounded at 501 and not paginated in this first implementation. Histories and
receipts remain internal retained data; no automatic deletion job is introduced.

## UI recovery and integration notes

Only a preview UUID is persisted in tab/session storage, under the existing
one-way CSRF/session-and-case recovery scope with a template-specific suffix.
No template body, preview content, session token or case work is stored there.
The pointer is reserved before requesting a preview and retained through an
uncertain apply response. On reload the UI refetches the same server preview;
applying an already committed preview recovers its original receipt. A manual
clear removes only the local pointer, not server history. Draft/review mutation
bodies are retryable while mounted but are not persisted across reloads; inspect
history before starting another such decision after interruption.

Base is contractor-work commit 30c84d19254ef44e5bef8a0ea47bdb23c4cba98e. Root's
subsequent integrated platform/handling work is not merged here. Shared changes:

1. `casework.ts`: extract the original create path into `createCaseWorkItem`, keeping
   ordinary work's request hash, owner/parent/status validation, snapshot and audit
   behaviour. Templates require fresh IDs and add application receipt metadata.
2. `app.ts`: register task templates and extract the existing restricted-work
   session check into shared `assertCurrentSession`. **Preserve root's integrated
   `assertSharing: assertCaseSharing` on `registerRestrictedWork` when reconciling
   this registration change.** Templates are internal planning, not external sharing.
3. `App.tsx`: additive Tasks/Assignments component insertion, plus contracts export.
4. docs137: correct ADR009 attribution to **root's implementation direction under
   user-delegated authority**. It is not a personal user quotation or explicit
   personal ADR sign-off. No authority or product acceptance is inferred from it.

Independent native-device, external-provider, identity/SSO/MFA and production
acceptance gates remain open. No new application dependency or copied catalogue
code was used, and no additional licence acquisition was required.

## Focused acceptance definitions — all UNRUN

These are definitions for root's combined acceptance, not execution receipts or
claims that tests passed. No API/browser/runtime tests were executed here.

| ID | Setup/action | Required result |
| --- | --- | --- |
| TT-01 | Fictional investigator creates mixed task/objective/question/note boilerplate; same author attempts acceptance; separate reviewer accepts | Self-review denied; independent exact digest/sequence retained; no case work before apply |
| TT-02 | Preview every entry with explicit owners/dates or explicit nulls; apply and repeat exact request | One atomic work set, typed initial statuses, null parents/empty source links, identical immutable receipt on retry |
| TT-03 | Omit a choice; duplicate entry/work IDs; reference foreign-case/client owner; invalid calendar date or extra source/parent/status fields | Reject before creation; no partial work/audit/application rows |
| TT-04 | After preview, revoke an owner or accepting reviewer; change latest review; withdraw template; expire preview | Reject apply with zero newly created work; retained previews/history readable internally |
| TT-05 | Make a middle/last preview work ID collide with an existing record; force an insertion/audit failure | Transaction rolls back all earlier inserted entries, links, snapshots and audit records; old record untouched |
| TT-06 | Correct template to a new version; deliberately pin the old accepted version, then suspend its acceptance | New version does not silently substitute; exact old version applies only while its latest acceptance remains valid |
| TT-07 | Apply, revise resulting work normally, then read/retry original application | Receipt still shows source-free initial version 1; later work remains unchanged; retry creates nothing |
| TT-08 | Concurrent identical apply, different actor apply, altered digest retry, same operation ID with changed input | One receipt/work set for the authorised exact request; changed actor/payload denied |
| TT-09 | Attempt cross-tenant/case reads/writes and client/collaborator access; revoke session/provider binding during operation | Denied; final checks roll back writes; no template or case work leakage |
| TT-10 | Direct app-role UPDATE/DELETE of new rows or append an item after an application receipt | Append-only/complete-receipt guards deny mutation |
| TT-11 | Browser reload after preview/apply response loss; new sign-in or case change | Same preview/receipt recovered within its scoped session; no cross-session/case cached content; explicit owner/date choices and apply confirmation remain visible |
| TT-12 | Existing ordinary work creation and internal single/bulk task revision flows | Shared creator preserves prior behaviour; contractor completion and existing source/casework guards remain intact |

Executed checks are reported with the final commit receipt: workspace TypeScript
compiler and `git diff --check`. SQL execution/privileges/triggers, all definitions
above, broad API/race/privacy/browser/accessibility checks, lint, production build,
full suites and platform integration acceptance remain **unrun**. No template,
WP17, agency, native, OSINT or whole-product completion claim is made.
