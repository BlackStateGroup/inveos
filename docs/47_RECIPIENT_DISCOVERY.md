# Recipient disclosure discovery

28 October 2026. Synthetic API slice on draft PR #27; no production client identity or portal UI.

`GET /api/portal/disclosures?limit=25&before=<grant UUID>` discovers only the authenticated client's currently eligible grants. Maximum 50 items; default 25. Each item contains grant ID, revision ID, SHA-256, creation and expiry times. It omits case titles/IDs, reviewer identity, reasons, internal context and report bytes. Downloads retain their separate integrity check and audited delivery boundary. Listing is neither a verification receipt nor proof of delivery; availability can change before download.

The shared list/download eligibility predicate checks active unchanged authority, current issuer reviewer assignment, no revision change request and no revocation. Both routes enforce expiry and exact tenant/recipient identity. A list request cannot select another recipient or case. No internal case membership is created. Full-snapshot disclosure semantics in `46_SCOPED_REPORT_DISCLOSURE.md` remain unchanged; no redaction is provided.

Keyset pagination uses database `(created_at,id)` values without rounding through JavaScript timestamps. An owned historical cursor remains usable after its grant expires or is revoked, permitting continuation without returning that grant. Foreign or unknown cursors return 404. Pages are not a frozen inbox snapshot: new grants appear on refresh, withdrawn entries disappear. No total count is exposed. Responses are no-store/nosniff. Listing does not read or hash potentially large report payloads.

Migration 016 adds a recipient/history index only. Apply normal lab migrations; rollback can remove the list route while leaving the harmless index and all disclosure history. No new dependency, copied source, collection, deployment or merge.

Run `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:foundation`, and configured `npm run test:api`. Three new PostgreSQL scenarios exercise real HTTP metadata minimisation, sub-millisecond and tied timestamps, concurrent newer inserts, revoked cursor continuation after restart, recipient/tenant/role/query denial, expiry, stale authority and issuer access removal. Exact hosted results are recorded in BUILD_HANDOFF.md after execution. Existing download tests exercise later dissent and corrupt bytes through the shared predicate.

Remaining: portal UI and browser acceptance, recipient administration/real identity, redaction and final release artifacts, device/offline/restore, isolated parser experiments and production gates. No such acceptance is implied by API tests.
