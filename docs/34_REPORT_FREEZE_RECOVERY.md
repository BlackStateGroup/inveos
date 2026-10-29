# Recovering an unconfirmed report freeze

27 October 2026. Synthetic internal-draft workflow, stacked on PR #14. No new server endpoint, schema, dependency or third-party source.

The report panel previously retained its idempotency key only while mounted. A committed request whose response was lost could therefore create a second revision after navigation/reload. The panel now writes a pending request UUID to `sessionStorage` before sending the POST and confirms that the write can be read back. It reuses that UUID until a structurally valid receipt for the selected case is received. Transport errors, a 30-second client timeout and invalid/wrong-case receipts retain the key. A timeout does not promise to cancel server execution.

Storage is scoped by case UUID and a SHA-256 fingerprint of the current CSRF token. The raw token, session cookie, report text, original bytes, receipt digest and findings are never persisted by this feature. The fingerprint is an opaque sign-in discriminator, not authentication. All requests still require server session/case/role/CSRF checks and use the existing actor/case idempotency constraint. Changing case or sign-in remounts the panel.

On return to a case with a pending key, the panel labels its action **Recover pending freeze** and explains that a previous receipt is unconfirmed. Recovery either retrieves the already committed receipt or completes the original request. The user can start a fresh revision after confirmation. The client validates receipt identity, case, internal-draft state, digest syntax and timestamp before clearing its retry record. A delayed old response cannot clear a newer request. A failed removal leaves the existing key safe to replay. Unavailable, invalid or non-persistent storage prevents a new POST rather than silently sending a non-recoverable request.

Recovery lasts only while this tab's storage and sign-in are retained. It is not cross-device or durable offline storage. Signing out/receiving a new token changes scope; closing a tab or clearing site data can lose the key. Inspect saved revisions before creating a new one after those events. Browser restore policies vary. Old opaque entries can remain until tab storage is cleared. The feature does not store an encrypted field queue or prove mobile outage recovery.

## Verification and limitations

Run the existing lint/types/build/foundation checks and:

```bash
node --import tsx --test apps/api/test/report-recovery.test.ts
# Disposable PostgreSQL credentials as documented in the test plan:
npm test --workspace @inveos/api
```

Four tests execute the actual client helper under Node Web Crypto with a storage double: scope separation, simulated lost response and fresh wrapper recovery, storage read/write failures and corruption, wrong-case/invalid receipts, stale response interleaving and failed removal. These are protocol tests, not browser reload/storage acceptance.

The added PostgreSQL test starts real loopback HTTP, sends a freeze through this helper, discards its successful acknowledgement deliberately, edits the case through a second database connection, reconstructs client state from the retained UUID and retries. It requires the same old receipt, unchanged downloaded bytes/digest, exactly one freeze audit, then a distinct fresh revision. It tests simulated acknowledgement loss after an actual commit, not a real network outage or browser restart. Hosted [Checks run #30](https://github.com/BlackStateGroup/inveos/actions/runs/40545421774) passed at `41e6b7a4593cd7636f40fd140765d5e05bf48802`: 46 PostgreSQL API tests, eleven helper tests and 42 Python tests, plus lint/types/build/reference checks. Exact tree and remaining gates are in BUILD_HANDOFF.md.

Actual browser navigation/reload, sessionStorage restrictions, two-tab behaviour, accessibility and visual acceptance remain unrun because a sandbox-enabled Chromium runtime is unavailable. Existing server tenant/role/revocation tests remain required. Parser/worker isolation, device/offline/restore and product acceptance are separate open gates.

## Privacy and rollback

Only opaque request/session-scope/case identifiers are placed in tab storage. Scripts on the same origin can read them; XSS and production authentication remain broader security work. No live data or external collection. The server's receipt is still an internal draft, never a release authorisation. No automatic merge or deployment.

Rollback the client only if necessary; retain all immutable server revisions. An older client will ignore these recovery keys, so inspect history before freezing after rollback. Do not remove valid pending keys automatically on transport failure. No database migration or data rewrite is needed.
