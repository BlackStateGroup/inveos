# Verified original download from the evidence workspace

28 October 2026. Extends the existing audited original endpoint with a deliberate browser action for internal case members. No change to case permissions, original bytes, evidence status, authority, database schema or dependencies. This is not a client release or parser integration.

In the connected synthetic lab, select an original in Evidence and choose **Verify and download original**. The server rechecks membership and original storage integrity and records access before returning bytes. The browser checks the saved receipt's size (1–262,144 bytes), original kind/status, response state/content type and optional content length. It reads into a fixed-size buffer, cancels an excessive stream, rejects truncated or modified bytes and compares SHA-256 with the selected evidence digest. Only then does it offer a download. Missing or denied responses never create a download.

Binary originals download as `original-<evidence-id>.bin`; text originals use `.txt`. The original supplied filename stays in provenance. The UI neither opens the file nor renders its bytes, and quarantine is unchanged. The download MIME type is always `application/octet-stream`. A generated extension is a precaution, not malware clearance. Access is audited even if subsequent browser verification or saving fails; the prepared-download receipt does not prove the user saved the file or acknowledge delivery. No external recipient is contacted.

The component aborts fetch on unmount and is keyed by case/evidence/digest. A late completion cannot offer a download for a different selection. Reads have a 30-second transport bound and no automatic application retry. SHA-256 binds bytes to the already selected receipt, not factual truth, authenticity or legal admissibility.

## Verification

```bash
npm run lint
npm run typecheck
npm run build
node --import tsx --test apps/api/test/original-download.test.ts
npm run test:foundation
INVEOS_TEST_BROWSER=1 npm test --workspace @inveos/api
```

Use the disposable PostgreSQL URLs and sandboxed Chrome setup from `50_PORTAL_BROWSER_ACCEPTANCE.md`. Three helper tests pass locally: binary/Unicode text equality; corruption/truncation/oversize/state/header rejection; and cancellation without consuming denied/oversized stream tails. Type checks and build pass. The existing binary recovery browser journey now presses the actual download control, reads the saved `.bin`, compares every byte, verifies the database read audit, then withdraws case membership and checks that the stale UI cannot produce another download. Hosted verification is pending at this checkpoint.

Existing real API tests separately cover foreign tenant/case/client access, storage tampering and atomic audit failure. No new parser, live data, identity/MFA, mobile/offline/device, physical outage, restore or production readiness is claimed. Production storage encryption and malware controls remain open. Rollback removes the UI/helper/tests; retain originals and audit history. No schema reversal, automatic merge or deployment.
