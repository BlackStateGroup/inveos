# Binary intake browser recovery

28 October 2026. Bounded synthetic lab acceptance, stacked on PR #35. Reuses the existing reservation/chunk API, quarantine, authority and immutable original records. No migration, new dependency, parser or third-party source.

The binary inspector now says that the original is quarantined and has no text/page preview. It disables the inspector's text-claim action rather than presenting an empty text page. Server claim restrictions remain authoritative. Pausing a transfer displays an explicit recovery instruction instead of the browser's generic AbortError.

Two actual Chrome scenarios drive the built React application through loopback HTTP and Fastify/PostgreSQL. Fixtures are arbitrary fictional bytes, not real PDF documents. The test proxy forwards requests unchanged; for selected successful responses it consumes the real API response after commit and either holds the downstream connection until Chrome aborts or disconnects it. API mutations, browser fetches and tab storage are not mocked. Existing authentication fixtures seed a synthetic reviewer session: these tests do not certify production sign-in.

1. Select a 65,537-byte file with a non-UTC source timestamp. Hold the first committed chunk acknowledgement, pause in the UI, assert only ordinal zero is stored, and reload into a new browser document. Check that the native file selection is empty and the same retry key/fingerprint remain. A different file with the same name/size must fail locally without another upload request. Reselect the exact file, send only the two missing chunks, then discard the committed completion response. Reload and recover the same original without retransmitting chunks. Assert one reservation, original and intake audit event, exact original download bytes and digest, preserved source offset, quarantine, disabled text-claim action and completed reservation history.
2. Pause after a committed chunk. Refuse to clear a retry while its reservation is open. Cancel through the UI, verify staging removal and retained cancelled history, then clear the key only after server confirmation. Register a replacement with a new reservation and exactly one resulting quarantined original.

## Reproduce and limits

Use the existing restricted disposable PostgreSQL setup and browser requirements in `50_PORTAL_BROWSER_ACCEPTANCE.md`, then:

```bash
npm ci --no-audit --no-fund
npm run lint
npm run typecheck
npm run build
npm run test:foundation
INVEOS_TEST_BROWSER=1 npm test --workspace @inveos/api
```

Set the documented test database URLs first; the runner creates an isolated test schema. Chrome must run with its sandbox enabled. Missing browser/database capability is not a passing browser check. CI requires the browser flag and bounds the entire Node test process at 180 seconds. Each new browser scenario has a 90-second limit; the proxy and browser are closed in nested cleanup.

Hosted [Checks run #92](https://github.com/BlackStateGroup/inveos/actions/runs/40693541795) passed at `89ad57eece9e44207036839f71ee0c9705e0d89d`, tree `1e7f3c6972704828385bbf8770021eb46b053bb8`: all 125 Node tests (93 PostgreSQL API, four real Chrome/HTTP/PostgreSQL journeys and 28 helpers), zero failures/skips; 52 Python tests, lint/types/build/reference and actual host-isolation probes passed. Chrome 155.0.8059.39, revision `3ff7ac5a9224be9156d7f8703a06e22890aafd34`, sandbox enabled. The response-loss fault stays active through Chrome transport retries until explicit recovery; an initial one-response fault was insufficient. Draft PR #36 contains this slice. This follow-up changes documentation only.

This establishes only the tested synthetic desktop browser path. It does not prove physical network outage, power loss, tab loss/new-sign-in recovery, offline/native device persistence, restore, malware scanning, PDF/OCR extraction, encrypted production storage or complete accessibility. Retry state contains only a key and request fingerprint, not file contents or provenance metadata. Users must keep the original and exact metadata. No automatic cancellation, parser execution, report approval, deployment or merge.

Rollback removes the display changes and additional test scenarios; keep immutable originals, reservation history and pending retry keys. No database reversal is required.
