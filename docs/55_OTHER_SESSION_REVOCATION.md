# End other sessions within a tenant

28 October 2026. WP-01 session-lifecycle slice; production identity, MFA and invitations remain absent.

`POST /api/session/end-others` accepts only an empty JSON object and requires the existing authenticated session, trusted Origin and matching CSRF header/cookie. Internal users and client recipients can end their own other sessions. Caller-supplied user, tenant or session identifiers are rejected. The current session remains active. Session tokens, hashes and other users' records are never returned.

Each transaction serialises operations for the authenticated tenant/user, rechecks and locks the current session, selects at most 100 unexpired/unrevoked other sessions and revokes them. It writes one aggregate audit event with the count in the same transaction; audit failure rolls everything back. It returns `revokedCount` and `moreRemaining`. Repeat explicitly when more remain; a retry can legitimately return zero after an earlier committed response was lost. Sessions created after the transaction may remain active. Other tenants and users, expired sessions and the current session are excluded. Migration 019 adds a partial owner index without changing stored session identities.

The internal Workspace details modal and the separate client portal expose **End other sessions**. Both explain the batch limit, retained current session and shared synthetic reviewer account. There is no silent automatic revocation or background retry. This is not an administrator control, account recovery, password reset, retroactive request cancellation or retraction of downloaded files. Already authorised requests may finish. The operation does not change cases, evidence, authority, findings or disclosure grants.

## Verification

Run the standard lint/types/build/foundation commands and `INVEOS_TEST_BROWSER=1 npm test --workspace @inveos/api` with disposable PostgreSQL and sandboxed Chrome as documented in `50_PORTAL_BROWSER_ACCEPTANCE.md`.

Three new PostgreSQL scenarios cover owner/tenant isolation, 101-session batching, retry/restart, client scope, missing authentication, Origin/CSRF/body denial, atomic audit rollback, concurrent calls, opposing-session revocation and exclusion of expired sessions. The actual portal browser journey now creates another client session, invokes the UI action, verifies its revocation, confirms the current browser session still works and signs out normally. Local lint/types passed; hosted verification is pending at this checkpoint.

Rollback removes route/UI and can leave the unused index. Do not reverse applied migration files or reinstate revoked sessions. Backups can still resurrect session state unless an operational restore policy invalidates it; that gate remains open, alongside real identity, parser/runtime/licence review, device/offline and full product acceptance. No live data, new dependency, third-party source redistribution, production deployment or merge.
