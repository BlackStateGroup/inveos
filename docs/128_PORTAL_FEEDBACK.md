# 128 — Release-scoped client feedback and reviewed responses

Implementation handoff, 30 October 2026. Branch `feat/portal-feedback`, based on committed agency implementation `4cf5a391329584e72b0e02d4d45e6e7ef83c2c5a`. The agency branch is independently handed to root for integration. This branch adds only the portal-feedback increment after that commit. Root owns integration, acceptance, review and merge. No PR, deployment, email/outside contact, new dependency or real client data is part of this work.

## Existing functionality preserved

The actual requirements in docs/02, docs/03 and docs/04 call for released-document requests, messaging and client activity audit with no access to internal case material. The implementation inspected and reused the existing separate `/portal` client identity surface, recipient-only disclosure discovery, exact JSON/package/PDF/DOCX downloads, acknowledgements, expiry/revocation, immutable report/copy reviews and reviewer disclosure oversight (docs/47–49, 78 and 113). Feedback does not create an alternative download route, grant case membership, duplicate acknowledgements or alter release semantics.

## Implemented workflow

In the client portal, each currently listed disclosure now offers **Open release requests**. Its recipient can create a clarification or change request, inspect/paginate requests, filter unresolved/resolved/withdrawn states, correct their text, withdraw a request, inspect immutable request/state history and read published response history. Every request binds the disclosure ID, original recipient, case/tenant, frozen report revision and digest, selected delivery digest/type and exact PDF/DOCX rendition identity when applicable. The API obtains these identities from the authenticated grant; it never accepts case/recipient identities from the client body. All mutation bodies name the exact report and delivery fingerprints.

The internal Reports surface includes **Client release requests**, available to current case investigators and reviewers. It locates currently eligible releases that have requests. Opening a release rechecks its exact bytes, source-use permission and current access before returning feedback. Investigators/reviewers can draft a plain-text response or a corrected response version. Drafts are internal and are never included in the client DTO, response count, published history or portal UI. No findings, original bytes, internal evidence links, attachments or automatic source context are copied into response text.

A separate current reviewer who authored **none of the response revisions** must inspect the exact draft body, visible correction reason, request text version and release fingerprints before explicit portal publication. Publication stores a fingerprint-bound immutable event. The review reason remains internal; only approved response text/correction reason is published. Responses are not emails, and publication does not revise the released document or its review/disclosure approval. A change to the report still requires the existing freeze/review/release workflow.

Request version and request **text version** are distinct. Resolution/reopening preserves the text version; a recipient correction sets a new text version and returns the request to unresolved. A response names the exact request text version it addresses. An older published reply remains visibly historical when the request changes. Resolution requires the current published response to the current request text. A recipient or current case reviewer records an explicit reasoned resolution; either can reopen it. No reply, publication, acknowledgement or download silently resolves a request. Publishing another response to a resolved request requires explicit reopening. Withdrawing the response used for resolution retains the historical decision and displays a warning rather than silently rewriting its state.

An unpublished draft can be withdrawn by its author or a case reviewer, retaining its internal history. A reviewer separately withdraws a published response by its exact current version/digest; this does not publish any pending draft. Previously published text and visible withdrawal reasons remain in recipient-visible history while the underlying disclosure is accessible. A fresh corrected draft and independent publication are required to replace a withdrawn response. Request withdrawal is terminal and recipient-only; prior text/state/response history remains immutable. Already viewed text cannot be retracted.

## Access and disclosure boundaries

All request/detail/history/draft/publication routes authenticate on every call. Writes use the existing session CSRF/origin/JSON controls for clients and internal users. Clients must match the grant's tenant and recipient before acquiring the case lock. Internal actors must hold current case membership, rechecked after lock acquisition. The release loader reuses the existing `disclosureEligibility`, rendition joins and `disclosureDelivery` verifier: authority, expiry, issuer/reviewer membership, dissent, revocation, selected copy integrity and source-use permission remain applicable. Current recipient client membership is checked for internal access as well.

Feedback operations lock the case and recheck current disclosure expiry/policy, recipient role, actor role/membership and session/provider binding immediately before transaction completion. This also fences an unchanged idempotent retry; a previously saved request does not restore revoked access. Policy failures return no feedback text. A blocked/corrupt release produces a generic portal error rather than exposing internal source errors. Internal release discovery is a locator of grant metadata only, like the existing disclosure list; it does not imply a verified open and exposes no request/response text. Opening the locator applies the full verifier.

Portal DTOs explicitly select fields. They expose no internal case ID, recipient directory, actor IDs, investigator names, unpublished draft bodies/reasons/versions, independent review reasons, audit metadata or internal findings. Agency request-state decisions are labelled “agency”; only their deliberately recipient-visible reasons appear. The portal still loads no internal workspace data. Plain text renders as text, without HTML execution or automatic internal links.

The UI holds feedback only in component memory. Refresh/navigation/sign-out closes its child panel and aborts pending work. Access denial clears loaded text/forms/history. A disclosure-expiry timer removes the panel; server checks remain authoritative. No background posting, email, websocket delivery, browser storage or offline queue was added. Interrupted submissions offer an exact frozen retry or refresh/history comparison. Changed-content request-ID reuse conflicts rather than silently creating another decision.

Human publication review remains essential: the service cannot determine whether arbitrary authored prose is privileged or approved for the recipient. Reviewers must disclose only permitted material. The application does not retrieve or attach unreleased content on their behalf. This is a bounded reviewed portal response channel, not a general case chat or a guarantee of legal/privacy clearance.

## Persistence and files

- Migration **081**: exact disclosure-bound request identities, immutable request/correction/state revisions, terminal withdrawal, head and sequence guards.
- Migration **082**: internal response revisions, separate published/withdrawn response events, independent current reviewer guard and exact resolution publication FK.
- Migration **083**: selected release/copy fingerprint correspondence and deferred request-head/current-response resolution checks.
- Reserved **084** remains unused. Migrations 075–079 and root's 080 are untouched by this increment.
- `apps/api/src/portal-feedback.ts`: bounded persisted routes, separate portal/internal serializers, versioned source binding, idempotency, state and response workflow, atomic audit.
- Additive `app.ts` registration: shared release eligibility/delivery verification and current session/member gates. Existing release routes are unchanged.
- `packages/contracts/src/portal-feedback.ts` and one index export: request, release, draft, publication and history contracts.
- `apps/web/src/PortalFeedback.tsx`, `portal-feedback.css`: usable shared client/internal workflow and internal release locator.
- Minimal `RecipientPortal.tsx` and `ReportRevisions.tsx` additions connect the two real surfaces. Root's `App.tsx` is untouched by this increment.

Limits are 1000 requests per disclosure, 100 request revisions (last reserved for withdrawal), 100 response draft revisions (last reserved for draft withdrawal), 200 publication events (last reserved for published withdrawal), 25-item request/history pages and 10-item internal release-locator pages. Request/response bodies are at most 4000 characters, subjects 150 and reasons 2000. All operation IDs are UUIDs and numeric fields are strictly typed before AJV coercion. Audit summaries/metadata contain identities, versions, decisions and fingerprints, not message bodies. Database append-only permissions and hashes do not provide external anchoring against privileged administrators.

## API surface

Client base: `/api/portal/disclosures/:disclosureId/feedback`.
Internal base: `/api/cases/:caseId/disclosures/:disclosureId/feedback`.

| Route | Capability |
|---|---|
| `GET base?state=&after=` | Current release-scoped requests, bounded pagination |
| `POST client-base` | Recipient-only clarification/change request |
| `GET base/:requestId` | Current request, published response and role-appropriate controls |
| `POST client-base/:requestId/corrections`, `/withdraw` | Recipient-only immutable correction/terminal withdrawal |
| `POST base/:requestId/resolve`, `/reopen` | Explicit recipient/reviewer state decision; resolution names exact current publication |
| `GET base/:requestId/history` | Retained request/correction/state versions |
| `GET base/:requestId/responses` | Published/withdrawn response history only |
| `POST internal-base/:requestId/response`, `/response/withdraw` | Save/correct/withdraw an internal response draft |
| `GET internal-base/:requestId/response-history` | Internal-only draft history |
| `POST internal-base/:requestId/publish-response`, `/withdraw-response` | Independent reviewed publication / explicit published withdrawal |
| `GET /api/cases/:caseId/feedback-releases?after=` | Current internal case release locator with existing feedback |

## Build-phase receipt and remaining acceptance

Actually run: repository/source inspection and `npm run typecheck` across web, contracts and API passed after connecting both UIs. A prior API-only typecheck passed during implementation. Final `git diff --check` passed; the final typecheck is recorded in the commit handoff. Existing locked dependencies were already installed for the agency increment. No new package or upstream source was incorporated.

**Unrun and not claimed passed:** PostgreSQL migrations (fresh/populated), API/SQL/concurrency tests, browser/render/accessibility checks, full regression, independent privacy/security review, production/provider checks. This increment follows the instruction to use compiler feedback only during the implementation phase. No broad tests or additional acceptance scaffolding were written/run. Real rendered UI acceptance is still required before a UI-completion claim.

Root should run combined acceptance after integration and author focused fixtures covering: all four released deliverables; wrong recipient/case/tenant/digest; internal role/CSRF denial; request and response correction/withdrawal; exact lost-ack retries; concurrent states/publications; independent-review denial; unpublished/private reason/identity exclusion from every client DTO and error; terminal request behaviour; stale request text blocking publication/resolution; visible historical published corrections; untouched report/copy bytes and fingerprints; expiry/revocation/authority/source-use/current provider or member denial before and after lock wait; atomic audit rollback; restricted SQL immutability and receipt guards; fresh/populated migration; bounded pages/version limits.

Browser acceptance must use actual authenticated client and internal identities to exercise create/read/correct/withdraw, investigator draft → independent reviewer publication → client resolution/reopen, original release download before/after unchanged fingerprints, reload, lost acknowledgement, narrow layout, plain-text rendering, draft isolation, expiry timers and access-denial clearing. Inspect real desktop/narrow renders. No browser, device, native app or production acceptance is implied by TypeScript compilation.

Unimplemented: file/evidence submission from clients, attachments, new-account onboarding, email/external notifications, general case messaging, cross-release request transfer, automatic creation of revised reports, automatic resolution, billing/payment and production legal/privacy/provider sign-off. Release revocation/expiry prevents all feedback access, including historical body reads; internal audit retention is separate and does not bypass the endpoint fence. Keep data and migrations on rollback; disable the additive UI/routes or use a forward corrective migration rather than deleting immutable history.
