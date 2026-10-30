# Portal evidence requests and supplied original receipts

Implementation branch: `feat/portal-evidence-requests`, stacked on task templates
`e4d1d36552b00c3e7973ab4c8c725aa4c9508418`. This is a build handoff, not an
acceptance or production-readiness claim. Root owns integration and combined
acceptance. No PR, merge, deployment, real recipient, outside delivery or new
application dependency is included.

## Implemented workflow

An assigned investigator or reviewer drafts a request for an **existing restricted
recipient in the same tenant**. Recipient, case, current authority version and
expiry are fixed on creation. There is no case membership, account provisioning,
email, invitation delivery, arbitrary source attachment or external messaging.
The author writes a separate title and instructions. Internal reasons, case
identity, authority identity, staff identity, sources and task context are not
copied into recipient DTOs.

Drafts are immutable numbered versions with exact SHA-256 fingerprints and
attributed correction reasons. An assigned current reviewer who has authored no
request draft independently publishes the exact current version/digest. The UI
shows both the current draft and the previously published content. A correction
does not silently replace published instructions; publication is a separate
explicit action. Reviewer withdrawal suspends visibility and may be followed by
a fresh publication. Revocation is terminal. Previously published versions,
reasons and actors remain in internal history. The final publication slot is
reserved for permanent revocation.

The portal lists only currently permitted published requests addressed to the
signed-in restricted principal. Responses bind the exact publication ID/digest;
corrections and withdrawals append immutable response records. Withdrawal retains
the preceding body and all original receipts. The last response slot is reserved
for withdrawal. New file staging/finalisation requires the current non-withdrawn
response. A newer response cannot silently relabel an existing original receipt.
A new publication requires a new response and reservation; old publications,
responses and files remain inspectable internally. External detail/receipt
recovery is limited to the currently published version.

File supply uses the existing `upload_reservations` and `upload_chunks` tables,
32 KiB canonical chunks, 256 KiB original bound and shared `receiveEvidence`
intake. The selected file is hashed in the browser, every chunk has an exact
reserved range, and intake recomputes the digest before the existing immutable
`writeOriginal` storage operation. New records are `opaque_binary` /
`Quarantined`, including text-looking files. There is no alternate object store,
upload-to-source shortcut, parser, conversion or client-controlled intake permit.

The filename, exact source-time declaration (including supplied offset), method
and consent/permission declaration are preserved separately from server original
receipt time and receipt-recording time. Permission is a recipient assertion,
not legal clearance. Completed receipts bind original bytes, reservation,
request, exact published instructions and exact response. External receipts expose
only the matching request/publication/response/upload/receipt identifiers and
public declarations; internal evidence, case, authority, storage and staff IDs
are excluded. The server never returns an original download on the recipient
surface.

Stable reservation keys and exact-operation retries cover lost reserve responses,
chunk retries and lost final receipts. The portal keeps **only a reservation UUID**
in session storage under a key scoped by a hash of the current CSRF cookie,
request and publication. No file bytes, declarations or raw session token are
persisted there. A typed retry key can also recover status. Resume requires
reselecting the exact bytes and checking their digest/length. Completed recovery
verifies stored original bytes again under current access. Staging cancellation
removes chunks while retaining reservation identity. Existing internal reviewer
staging cancellation/expiry maintenance remains available.

## Source registration and use remain separate

The internal Evidence panel includes request drafting, publication review,
response and receipt inspection, complete draft/publication history, and verified
quarantined original download through the existing original endpoint. Browser
inspection bounds the download to 256 KiB and compares its bytes to the immutable
receipt before offering a download.

“Register source context separately” opens the existing manual source register,
anchored to the exact original. Only the original selector and an internal
`inveos:portal-receipt:<receipt UUID>` reference are prefilled. Investigator
attribution, method, terms/permission, purpose, lawful-basis note, scope,
retention, minimisation and limitations must be entered separately. The reference
is a non-fetchable receipt identifier, not an invented public URL. The server
accepts it only when that receipt belongs to this exact tenant/case/original.
HTTP(S) source references retain their prior validation. No network retrieval is
added. Existing frozen report formats/fingerprints are unchanged; the existing
source-context string field can carry this reference.

`sourceUseProofs` blocks the legacy “no registered source” path for every portal
original. Registration alone does not enable analysis/release: existing
independent metadata acceptance and the separately versioned source-use decision
remain mandatory, with current reviewer membership, authority, retention and
expiry. A withdrawal of the latest recipient response blocks future source use;
a subsequent response correction requires a new independently reviewed metadata
revision before source use can resume. This applies through existing processing,
claim/finding and report/release call sites using the shared helper. Original
checksum verification and internal byte inspection remain custody operations,
not source-use approval. The immutable original stays marked quarantined; no
malware-clear or truth status is invented.

Request access revocation/expiry prevents future external reads/writes. It does
not erase already supplied originals or replace separate internal retention,
source-use and disclosure decisions. Response withdrawal does not retract bytes
already downloaded or historical reports; fresh uses are blocked as above.

## Mandatory integration hook

This stacked branch does not contain root's case handling module/migration115.
The new module's `Services.assertSharing` callback is **required**, never optional.
`app.ts` currently supplies `options.assertCaseSharing`, with an explicit **503
fail-closed fallback**. No published access should be claimed usable on this
standalone branch without that injection.

At integration, wire the real shared helper directly:

```ts
import {assertCaseSharing} from './case-handling.js';
// registerPortalEvidenceRequests services:
assertSharing: assertCaseSharing,
```

Alternatively the app factory's `assertCaseSharing` option may receive that same
helper. Do not inject a no-op. Preserve root's already mandatory sharing hook on
`registerRestrictedWork` and the shared `assertCurrentSession` helper when
reconciling the additive `app.ts` changes. No permissive fallback or reconstructed
handling policy is introduced here.

Publication (including retry), all external list/detail/response/reserve/by-key/
status/chunk/cancel/complete paths, final original intake and post-intake receipt
recovery invoke the sharing hook. They also check current session/identity,
recipient role, exact publication, current authority, open collection lifecycle,
publication reviewer membership and request expiry. Case locks serialize
publication, response, staging and lifecycle changes. Before transaction return,
session and pertinent access conditions are checked again; original finalisation
performs its own checks in the storage transaction. Explicit internal-only or
stale enabling decisions must therefore deny all external paths after wiring.
Internal case reviewers can still inspect history and revoke access.

## Persistence and minimal shared changes

Owned migrations **125–128**; **129 unused/reserved**:

- 125: request capabilities, immutable drafts/publications/responses and indexes.
- 126: links to existing upload reservations and immutable original receipts.
- 127: sequential histories, independent publication and exact original receipt
  guards. Source-time comparison preserves the original declaration string.
- 128: current response/publication/recipient/authority upload binding guard.

New API/contracts/UI modules implement the actual persisted flows. Shared changes:

- `app.ts`: additive route registration and a server-constructed restricted intake
  permit on the private existing original intake function. Existing internal and
  Field calls retain their prior role and case-membership semantics. No request
  body can provide a permit.
- `uploads.ts`: export/reuse canonical chunk/range and assembly helpers. Existing
  internal routes retain their metadata, authorisation, staging and receipt paths.
- `source-use.ts`: require reviewed registered metadata for portal originals and
  fence source use after response correction/withdrawal.
- `manual-sources.ts` / `ManualSources.tsx`: validate the exact portal receipt
  reference and support an explicit, unapproved original selector in the editor.
- `App.tsx` / `RecipientPortal.tsx`: additive internal Evidence panel and dedicated
  recipient controls; sign-out remounts/clears recipient request state.

Internal API is under `/api/cases/:caseId/evidence-requests` (recipients, list,
create, detail, drafts, publications). External API is under
`/api/portal/evidence-requests` (list, detail, responses, uploads, by-key recovery,
status/chunk/cancel/complete). All mutations require current session CSRF.
Read/mutation DTOs use no-store responses. Existing authenticated original download
and manual-source/review/use APIs are reused.

Bounds: 100 requests/case; 100 drafts/request; 200 publication events/request;
100 responses/request; 100 file reservations/request; ten open reservations/case;
one original per completed reservation; reservation expiry no later than the
request's expiry or 24 hours; request expiry at most 90 days. Lists page at 25.
Recipient discovery scans at most 500 current-authority candidates, failing closed
if filtering cannot establish a bounded complete page; its cursor always belongs
to a request that passed current access. History is bounded, not an unbounded
archive query.

## Acceptance definitions — ALL UNRUN

Use fictional tenants, cases, investigators, independent reviewers and enrolled
restricted principals only. Root should execute these after the combined batch
and real sharing-helper integration; these are definitions, not claimed passes.

| ID | Required acceptance |
|---|---|
| PER-01 | Apply125–128 on the integrated schema and verify FK/append-only privileges, sequential histories, exact receipt trigger and rollback of a rejected insert. |
| PER-02 | Author drafts; self-publication fails; independent exact digest publication succeeds; corrected draft keeps old publication exact; withdrawal hides it; republish requires independent review; terminal revoke cannot reopen. |
| PER-03 | Different tenant, case or restricted recipient cannot enumerate or access detail, response, reserve, by-key, status, chunk, completion or receipts. DTO inspection finds no case/evidence/authority/staff IDs or internal reasons. |
| PER-04 | Missing sharing injection fails closed. Integrated internal_only/stale enabling authority/current reviewer gates publication and every external endpoint, including retries and post-storage recheck. No-declaration behavior matches root's approved helper. |
| PER-05 | Expire/revoke session, identity binding, recipient membership, publisher membership, authority, request or open lifecycle between staging/finalise/receipt recovery; deny without bypass or orphaned trusted original. Exercise concurrent case locks and final rechecks. |
| PER-06 | Supply exact1,32768,32769,262144-byte fictional originals. Reject0/262145 bytes, unsafe names, invalid time, noncanonical chunks, gaps, wrong ordinal/length, digest mismatch and changed retry inputs. Preserve supplied offsets separately from server times. |
| PER-07 | Lose reserve/chunk/complete responses; recover by key; exact repeat yields the same reservation/original/receipt. Race two completions. New declarations/bytes with the same key conflict. Server storage tampering makes recovery fail verification. |
| PER-08 | Cancel or expire staging, confirm chunks removed and immutable identity retained. Existing internal reviewer staging maintenance still works. Complete records cannot be cancelled or rewritten. |
| PER-09 | Correct/withdraw recipient responses; old files retain exact response/publication fingerprints. New uploads/finalisation require the current non-withdrawn response. Superseded publication cannot recover old files externally. Internal history remains readable. |
| PER-10 | A portal original with no source register cannot run analysis or reach finding/report/release. Register metadata, independently accept and separately approve use. Confirm self-review, stale metadata, expired/blocked permissions, stale reviewers and changed authority deny use. Check all integrated processing/source-use call sites. |
| PER-11 | A later response withdrawal blocks future source use. A response correction requires a new independent metadata review and new exact source-use approval. No checksum task clears quarantine or grants trust. |
| PER-12 | Wrong tenant/case/original receipt reference fails registration. The strict internal receipt reference is not fetched. Ordinary HTTP(S) source-registration and report/verifier behavior remain compatible. |
| PER-13 | Browser journeys: internal draft/review/history; recipient response/correction/withdrawal; file upload/reselect/resume/reload/recovery; internal bounded verify/download and separate source review/use. Check focus/expiry/sign-out/session-switch and denied-access clearing, including in-flight operations. |
| PER-14 | Shared internal upload, Field intake/recovery, source verification, report/release, restricted work sharing and task-template session semantics remain intact after integration. |
| PER-15 | Privacy/log/audit review: immutable history and required mutations recorded; no external file reads, messages, unapproved attachments, plaintext persisted file bytes, internal DTO leakage or invented source truth. |

## Validation and remaining gates

Compiler checks and static diff review only during this build. Exact command
results and final commit receipt are recorded at handoff below. No migration,
PostgreSQL/API, race, browser, accessibility, lint, full suite, independent verifier,
restore, native-device, identity-provider or production acceptance has run for
this feature. No test result is inferred from the typechecker.

No scanning, file parser, larger-file flow, real identity provisioning/SSO,
external delivery or production activation is supplied. Independent provider,
native and operations gates remain open. Legacy internal original download
semantics are preserved; this feature does not claim to close unrelated existing
membership-race behavior. No whole portal, contractor, OSINT or product completion
claim is made.

### Build receipt

- `npm run typecheck`: **passed** for web, contracts and API. The initial cursor-index compiler error was corrected; the subsequent combined command passed.
- `npm run typecheck -w @inveos/api`: **passed** again after the final source-use and receipt-validation edits.
- `git diff --check`: **passed** before staging; the staged diff is checked before commit.
- PER-01–PER-15: **unrun**. Mandatory root sharing integration: **open**.
