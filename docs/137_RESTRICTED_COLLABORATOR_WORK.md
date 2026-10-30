# Restricted collaborator work — WP17 build handoff

Implementation phase only. Runtime database/API/access/race/browser acceptance is
reserved for root's combined build. No production identity, contractor platform,
forensic intake, external delivery or full WP17 completion is claimed.

## ADR-009 — Explicit task grants to restricted principals

Status: implementation direction (root, under user-delegated authority, 2026-10-30)

Root directed separate explicit task grants to the existing restricted external
principal.
Do not add a broad internal Actor role or implicit case membership. Require
independent approval before task instructions become externally visible. Keep
contractor-role and SSO gaps explicit.

This ADR is recorded here to keep this build's ownership confined to docs137;
central handoff, INDEX, CI/test inventory and existing ADR text are unchanged.

## Implemented user journey

The persisted Tasks/Assignments surface now includes **Restricted collaborator
work**. An internal case member chooses a saved open task and existing restricted
recipient, supplies an explicit expiry (at most 90 days), writes a separate
recipient-visible title/instructions/due date and records an internal reason.
The internal task title/body/history are not copied into the public content.
The task's exact saved revision and snapshot digest are retained privately.

An independent case reviewer who authored no draft version of the grant inspects
and publishes the exact current draft. Publication has its own immutable event
and public-content fingerprint. New drafts do not silently replace the published
version. Explicit publication withdrawal and terminal grant revocation retain
history. A replacement published version requires fresh recipient acknowledgement.
No invitation email, push message, SMS, outside contact or enrolment is sent.

The new `/collaborator` page is a separate restricted surface. It loads no internal
workspace or case API. It lists only that session principal's currently eligible
published grants. The recipient may accept or decline an invitation to the exact
published instruction version; only acceptance enables progress/submission writes.
Progress, corrections, submitted work and withdrawals append immutable records
with the exact publication ID and instruction digest. Withdrawal retains the
prior body. These are plain-text work declarations, not evidence originals,
reviewed findings or statements that internal tasks are complete.

A current internal reviewer accepts the exact latest submitted record or requests
changes, recording a private reason and separately confirmed recipient-visible
feedback. The recipient sees only that public feedback. Acceptance does not update
the task. Staff complete it through the existing task controls. A database trigger
covers both individual and batch task edits: every nonrevoked grant with currently
published instructions must have its latest submission accepted for the exact
current task version. Completing cannot simultaneously change task title/body,
owner, parent or deadline. Expiry alone does not waive this internal review gate;
explicit publication withdrawal/revocation is the alternative when the work is no
longer required. Draft-only grants do not block task completion.

A task revision change invalidates external access until instructions are rebound
to that new task revision and independently published. After an accepted task is
completed in a single version increment, the existing grant may remain readable
until expiry/revocation so the recipient can see its acceptance. Further work
writes are blocked. A subsequent task change removes that eligibility again.

## Boundaries and implementation

- `Actor` remains reviewer/investigator/client. Existing `client` membership is
  the restricted principal; no new memberships, case memberships or owner
  assignments are created. Case invitation APIs for internal colleagues are not
  reused to grant contractor workspace access.
- Every internal request uses current tenant/case membership. External ownership
  is matched before acquiring the case lock. Detail/mutations serialize with
  case authority, task updates and revocation. Session epoch, provider binding,
  expiry/revocation and current role are checked again before transaction return.
- External eligibility requires current restricted-recipient membership, grant
  expiry, no revocation, current approved case authority, allowed case lifecycle,
  a published version and its bound task version. Final transaction checks repeat
  grant eligibility. List access omits ineligible grants; a policy change during
  the response fails closed.
- External DTOs are explicit field allowlists: public content, grant/publication
  identity, expiry, recipient-authored submissions and explicitly public review
  feedback. They contain no case ID/ref/title, internal task ID/version/body,
  source/link history, draft text, internal reasons, internal author/reviewer IDs
  or private task fingerprint. Internal/recipient views are not spread from a
  shared raw database object.
- Versioned publication history exposed externally contains only published event
  receipts (version/action/digest/time), not old withdrawn instruction bodies or
  unapproved drafts. Submission history contains the recipient's own declarations.
- All grant/draft/publication/invitation/submission/review/revocation rows are
  append-only. Current states derive from latest sequenced events; there is no
  mutable external task mirror. Mutations append internal audit records.
- Every mutation has an explicit operation UUID and request hash. Expected
  draft/publication/submission/review versions reject stale decisions. Retries
  bind the same actor and inputs. The UI retains uncertain request identities
  while mounted and provides exact retry and history inspection controls.
- Public instruction digests cover a fixed-order
  `inveos_restricted_work_v1` payload: grant ID, version, title, instructions and
  due date. Submission digests use a versioned string-array profile binding grant,
  record ID/sequence, publication, kind, body and reason. The internal task digest
  covers the immutable stored task snapshot as read from PostgreSQL JSONB.
- Due date is a separately reviewed calendar-date declaration, not a mutation of
  the internal task deadline; it must not fall after grant expiry. Publication,
  invitation and submission recording times come from the server and are not
  represented as source-recorded/evidential event times.

No upload, attachment, URL retrieval, arbitrary evidence reference or automatic
finding/task promotion endpoint was added. The collaborator page links to the
existing `/portal` for **separately approved** report/exhibit disclosures. That
link grants no release access; existing recipient, copy review, expiry/revocation
and source controls continue to govern every portal read. Free-text instructions
and public feedback require human inspection: this implementation cannot prove
that manually entered text contains no confidential material.

## API and migrations

Migrations **110–112** are owned here. **113–114 are unused**. **115 belongs to root**.
No existing migration was changed.

| Migration | Persistence/guard |
| --- | --- |
| 110_restricted_work_grants.sql | Explicit task grants, private draft revisions, publication/withdrawal events, revocations and per-publication invitation decisions |
| 111_restricted_work_submissions.sql | Recipient progress/submission revisions and internal acceptance/change decisions |
| 112_restricted_work_guards.sql | Case-serialized sequence/identity/reviewer guards and shared task-completion trigger |

Internal API base: `/api/cases/:caseId/restricted-work`.

- GET base / `?after=UUID`: current grant register (25 records/page).
- GET `/recipients?after=UUID`: existing restricted recipients only.
- POST base: draft a grant bound to `taskId`, `taskVersion`, `recipientId`,
  `expiresAt`, explicit title/instructions/dueDate/reason.
- GET `/:grantId`: internal detail, current publication/receipt and capabilities.
- POST `/:grantId/drafts`: append a reasoned draft and exact task-version binding.
- POST `/:grantId/publish` or `/withdraw`: independent current publication
  decision with draft/publication version, digest and expected event sequence.
- POST `/:grantId/revoke`: terminal grant revocation.
- POST `/:grantId/reviews`: exact submitted record/digest/publication, current
  task version and review sequence; accepted/changes_requested, separate public
  feedback/private reason and affirmative public-content confirmation.
- GET `/:grantId/history?before=N`: immutable internal draft, publication,
  invitation, revocation, review and paged submission history.

External API base: `/api/portal/work`.

- GET base / `?after=UUID`: eligible grants for the authenticated recipient.
- GET `/:grantId`: only current approved public content and own work receipts.
- POST `/:grantId/invitation`: accept/decline exact publication ID/digest.
- POST `/:grantId/submissions`: progress/submitted/withdrawn against exact
  publication and expected submission sequence, with reason and explicit
  non-evidence-upload acknowledgement.
- GET `/:grantId/history?before=N`: allowlisted public receipt and own work history.

Bounds: 500 grants/case, 100 draft versions/grant, 200 publication/submission/review
records per grant (final publication/submission slot reserved for withdrawal),
6,000 instruction characters, 8,000 submission characters, 25 submissions/page.
Private full draft/review histories are bounded by those caps. Grant expiry and
recipient are immutable; issue a new explicitly approved grant to change them.

## Root integration: case handling migration115/docs138

Base: report-composition commit cfe1d8f67ffb719a7aeae90a9264ee917c9a1a0c. Concurrent
root changes, including handling commit 80b69649 on feat/platform-build-batch,
have not been merged into this child branch.

`registerRestrictedWork` in **apps/api/src/restricted-work.ts** accepts this exact
optional service callback for root's new handling module:

```ts
assertSharing?: (client: PoolClient, tenantId: string, caseId: string) => Promise<void>
```

After integration, import `assertCaseSharing` from root's `case-handling.ts` in
`apps/api/src/app.ts` and add **`assertSharing: assertCaseSharing`** to the existing
`registerRestrictedWork(app, {...})` registration. This is the exact wire-up point.
The callback is already invoked before publication/review retries, on
recipient-visible acceptance feedback, and external list/detail,
invitation, submission and history access, plus the final transaction fence. It calls the helper directly and therefore
does not depend on the `caseSharingEligibility` SQL alias. Root's no-declaration
behaviour preserves the existing grant controls.
Denied list entries are omitted; denied direct reads return a generic not-found.
API 403/404/409 policy denials are treated as unavailable sharing; unexpected
errors propagate. The shared helper, not sensitivity labels, decides eligibility.

**Mandatory integration gate:** the callback is not wired on this older parent,
which has no handling module/migration115. Do not claim handling-policy coverage
until root supplies it and runs combined policy/access/race acceptance. Internal
drafts and retained internal history remain readable under internal case access;
publication withdrawal and grant revocation do not require enabling sharing.

Shared edits besides new modules: one app registration and task-completion error
mapping; one Tasks UI insertion; `/collaborator` route and portal navigation link;
contracts re-export. No central handoff/INDEX/CI changes. No new dependency,
third-party copied source, licence acquisition, parser or production activation.

## Remaining gaps and unrun gates

This uses existing authenticated restricted accounts. It does **not** implement a
true contractor role, contractor organisations/teams, employer boundary, workload
policy, new-account invitation/enrolment, provider/SSO/MFA qualification, SCIM,
contract terms, billing or external notifications. Existing development identity
and explicit OIDC binding constraints still apply. No real fixture/user data was
introduced.

UI pending mutation identities are not persisted across reload; inspect history
before a new decision after interruption. Readable content is rechecked on focus
and every 30 seconds; grant expiry clears selected content locally. Already seen
or copied text cannot be recalled by revocation. There is no offline external
workspace. An accepted submission cannot be edited/withdrawn by its recipient;
new published instructions or an internal changes-requested decision are required.
The same internal reviewer may author instructions and accept delivered work, but
cannot publish any grant on which they authored instructions.

Build checks recorded in the commit receipt: workspace TypeScript compiler and
`git diff --check` only. No broad tests were added or run. All of the following are
**unrun**, not passed:

- Real migration execution, restricted PostgreSQL grants, immutable triggers,
  exact task snapshot/revision references and single/bulk completion guard.
- API flows including multiple grants per task, corrected publications, repeated
  acknowledgement, accepted/completed task readability, expiry and stale task
  versions, authority/lifecycle/handling changes, grant withdrawal/revocation.
- Negative tenant/case/recipient/client access, task/private-history leak checks,
  stale/changed idempotency payloads, final session/provider/recipient revocation,
  concurrent submit/review/publish/revoke/complete races and transaction rollback.
- Browser journeys, focus/revocation/expiry clearing, reload/retry behaviour,
  accessibility, responsive layout, production web build, lint and full suites.
- Combined regressions with root's migration115 handling helper and independently
  approved disclosure/exhibit access. No acceptance, deployment or contractor/
  WP17/product completion claim is made by this implementation handoff.
