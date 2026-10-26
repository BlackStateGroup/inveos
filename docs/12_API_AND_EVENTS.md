# 12 — API, events and offline synchronisation contracts

## API design

Version all public endpoints under `/v1`. OIDC bearer/session authentication; server-derived tenant; structured errors with `code`, `message`, `request_id`, optional `retry_after`. Send stable `Idempotency-Key` on mutations susceptible to retries. Use cursor pagination and structured query filters. Preserve independent case and entity revision IDs; use optimistic version checks for edits.

| Endpoint (proposed) | Method | Behaviour |
|---|---|---|
| `/v1/cases` | POST / GET | Case intake or authorised list; creation pending compliance gate |
| `/v1/cases/{id}` | GET / PATCH | Case detail and versioned status/metadata corrections |
| `/v1/cases/{id}/authority` | POST | Record approval/mandate; audit actor, scope and validity |
| `/v1/cases/{id}/tasks` | POST / GET | Assign and view task; no auto-human acknowledgement |
| `/v1/cases/{id}/sources` | POST / GET | Provenance-bearing records / approved connector captures |
| `/v1/cases/{id}/field-sessions` | POST / GET | Session and declared time/device metadata |
| `/v1/cases/{id}/observations` | POST / GET | Submit idempotent observation, revision by superseding event |
| `/v1/evidence/uploads` | POST | Reserve bounded upload slot with permission and class check |
| `/v1/evidence/uploads/{id}/complete` | POST | Verify server-side bytes/digest, create durable receipt |
| `/v1/evidence/{id}` | GET | Metadata, source/parent, custody and authorisation only |
| `/v1/evidence/{id}/download` | POST | Authorised short-lived read grant with audit |
| `/v1/cases/{id}/claims` | GET / POST | Extracted and analyst-authored claims with source spans |
| `/v1/cases/{id}/claims/{claimId}/review` | POST | Accept/reject/supersede with reason, actor, version |
| `/v1/cases/{id}/entities` | GET / POST | Case-scoped entities and checked identifiers |
| `/v1/cases/{id}/relations` | GET / POST | Evidence-backed candidate edges and reviews |
| `/v1/cases/{id}/reports` | POST / GET | Report drafts/revisions and cited sources |
| `/v1/reports/{id}/approve` | POST | Reviewer sign-off if all evidence and scope gates pass |
| `/v1/cases/{id}/releases` | POST / GET | Immutable client release + selected approved exhibits |
| `/v1/releases/{id}/verify` | GET | Manifest digest and verification instructions |
| `/v1/sync/handshake` | POST | Device identity, rev, policy, case permissions and queue limits |
| `/v1/sync/operations` | POST | Idempotent batch operation envelope and per-entry receipts |

## Example event envelope

```json
{
  "event_id": "018d13ab-1111-7000-8000-000000000001",
  "schema_version": "1.0",
  "tenant_id": "tenant-fictional",
  "case_id": "case-fictional-001",
  "type": "evidence.original.verified",
  "aggregate_id": "evidence-fictional-001",
  "aggregate_version": 3,
  "actor_kind": "service",
  "actor_id": "evidence-verifier",
  "source_occurred_at": "2026-10-25T13:12:00+01:00",
  "recorded_at": "2026-10-25T12:15:17Z",
  "time_quality": "device_claimed",
  "idempotency_key": "field-device-01:operation-004",
  "payload": {"sha256": "<64 hexadecimal characters>", "bytes": 1298431},
  "previous_event_hash": "<64 hexadecimal characters>"
}
```

These placeholders are deliberately not real hashes and must be replaced in valid test fixtures. All fields are validated server-side. Event schema changes are additive or versioned; old exports remain verifiable.

## Offline conflict policy

- Operations have UUID, client sequence and immutable payload digest; retry same key+digest returns same receipt, same key+different payload returns `409 idempotency_conflict`.
- Observation revisions are append-only; concurrent edits create `needs_review`, not silent last-write-wins.
- Source and device time do not prove server receipt; display explicit receipt and verified states.
- Token expiry during offline use does not make local data disappear; re-auth is required before upload. No elevated authorisation is cached indefinitely.
- A revoked case assignment prevents new remote reads/uploads; any device-local remnants follow approved incident retention/wipe policy.
- Media transfer supports resumable chunks with object version/checksum binding and explicit deadline; orphaned chunks receive expiry and cleanup audit.

## Cross-module events

`case.created`, `case.authority.approved`, `case.status.changed`, `field.session.started`, `observation.submitted`, `evidence.original.verified`, `evidence.derivative.created`, `analysis.claim.proposed`, `analysis.claim.reviewed`, `relation.confirmed`, `report.review_requested`, `report.approved`, `release.published`, `release.accessed`, `release.revoked`, `retention.hold.placed`, `evidence.disposed`.

## SDK and external integration design

Signed/authorised webhook delivery with replay protection and outbound outbox; no sensitive payloads by default; fetch scoped data with permitted API token. Audit every external integration access. Generate OpenAPI from source annotations after first implementation, keeping machine-readable contract under `specs/`.
