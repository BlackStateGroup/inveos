# Scoped frozen-report disclosure API

28 October 2026. Synthetic lab slice stacked on PR #26. API only: no production identity, client invitation, portal UI or live delivery is configured. Fictional fixtures only.

## Approval and data boundary

An assigned reviewer may grant one existing same-tenant client identity access to one exact frozen report. This deliberately narrow path discloses the **entire snapshot, including embedded original bytes, working context, source policies and internal reviewer metadata**. It performs no redaction. Do not use it when any part requires withholding: create a separately reviewed redacted artifact first (not implemented). The caller must explicitly confirm full disclosure and explain the scope/privilege decision. This is a recorded human assertion, not legal clearance or automated sensitive-data detection.

New grants require active case authority, an independent `accept_internal` review by a currently assigned reviewer under the current authority version, and no `request_changes` decision on the revision. They rerun the bounded frozen-source check within the grant transaction, rather than trusting a previous verification receipt. Case locking serialises authority/review/grant mutations. Grant plus audit commit atomically. Each actor/case idempotency key binds revision, digest, recipient, reason and expiry; exact retries return the original historical grant, even if subsequently expired/revoked. A grant receipt is not a current-access guarantee.

Frozen report bytes remain unchanged, including their historical `draft_not_released` field. The separate disclosure record is the access authority for the exact artifact; this slice does not silently rewrite it into a final report or claim signed release certification. Independent offline verification of those bytes remains available.

## Routes

- POST `/api/cases/:caseId/report-revisions/:revisionId/disclosures`: reviewer and CSRF; body `{sha256,recipientId,idempotencyKey,expiresAt,reason,confirmFullDisclosure:true}`. UTC expiry must be in the future and at most seven days away. Reason is 10–2,000 trimmed characters. Returns a grant ID and exact revision/recipient/digest/authority/expiry receipt.
- POST `/api/cases/:caseId/disclosures/:disclosureId/revoke`: assigned reviewer and CSRF, `{reason}`. Append-only revocation; replay does not change the first reason or duplicate audit.
- GET `/api/portal/disclosures/:disclosureId`: authenticated exact client recipient only. Requires matching tenant, unexpired/unrevoked grant, active unchanged case authority, still-assigned reviewer issuer and no change request. Rehashes the frozen bytes and commits prepared-download audit before attachment delivery. Returns no-store/nosniff and the report SHA-256 header. No case membership is granted; internal evidence/report APIs still deny the client.

Revocation prevents subsequent authorised reads; it cannot retract already downloaded bytes or guarantee cancellation of an in-flight response. Reads use a database statement snapshot, not a network-delivery lock. Acceptance by the recipient is not implied by a prepared-download audit. Recipient identity roles are checked by authentication. Review acceptance is checked when granting; later change requests also block downloads. There is no generic public link or unauthenticated token.

## Verification and operation

Apply additive migration 015 using the synthetic lab setup in `23_LOCAL_APPLICATION.md`. The API harness creates fictional client and separate reviewer sessions; the single demo reviewer UI alone cannot complete this flow. Run `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:foundation`, and `npm run test:api`.

Four PostgreSQL scenarios cover actual TCP exact-byte recipient download, concurrent idempotent grant creation, internal API denial, another recipient, durable revocation, missing approval/attestation, bad expiry, stale authority, corrupt source, audit rollback at grant/download, expiry, later dissent, cross-tenant identifiers, issuer access revocation, frozen-snapshot tampering and append-only enforcement. Hosted run #66 passed all 108 Node and 42 Python tests; exact implementation revision/tree and run link are recorded in BUILD_HANDOFF.md. Browser, actual client-device/outage/restore, legal sign-off and production acceptance remain unrun.

Migration 015 preserves immutable grants and revocations, scoped foreign keys and append-only audit. Roll back routes together; keep historical records and never remove evidence to undo a grant. No dependencies, third-party source, external collection, notifications, deployment or merge. Remaining work: recipient administration, portal list/download UI, explicit release artifact schema, redaction derivatives, formal privilege/scope checklists, signed package and full production identity/storage/restore gates.
