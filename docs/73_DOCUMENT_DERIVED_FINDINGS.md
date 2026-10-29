# Document-derived claims and findings

29 October 2026. Implements C3 of the [remaining delivery plan](71_REMAINING_DELIVERY_PLAN.md) on draft PR #62. It preserves the existing original-text claim path and adds a separate path for interpretations based on document extraction. An accepted correspondence review says that a passage matches the original; it does not make the passage true. A proposed interpretation is not a finding until a different reviewer records an independent decision.

## Stored chain

Migration 026 adds three append-only records. `document_claims` binds proposed text to the immutable citation digest and one accepted correspondence-review digest. `document_claim_decisions` binds a reasoned accept/reject decision to the canonical claim digest. `document_findings` exists only for an accepted decision and links the same claim, decision, reviewer, time and exact text. Originals, raw parser output, canonical derivatives, citations and correspondence-review history remain unchanged.

The server replays and hashes every upstream record on reads and decisions. New claims require the latest correspondence decision to be accepted and the extraction authority version to remain current. Decisions require that same accepted review still be current, a reviewer role, case membership and a reviewer other than the claim author. Rejected or superseded correspondence, changed authority, foreign scope, corrupt bytes and altered originals fail closed. At most 50 claims are returned per citation. Claim identities make retries deterministic; conflicting reuse is rejected.

The internal browser panel labels proposed interpretations and accepted findings separately. It verifies canonical claim/decision hashes and finding linkage before display. Stable in-memory request identities support recovery after an ambiguous committed response without creating a second claim or decision. It does not provide client access, release approval or a source-truth assessment.

## Reproduction and evidence boundary

Use Node 22, Python 3.11, disposable PostgreSQL 15 and sandboxed Chrome as configured in `.github/workflows/checks.yml`. Set `INVEOS_TEST_DATABASE_URL` and `INVEOS_TEST_ADMIN_DATABASE_URL` only to the disposable database, then run:

```sh
npm run lint
npm run typecheck
npm run build
npm run test:foundation
npm run test:api
```

Focused helpers are in `apps/api/test/document-derivative.test.ts`; database/API/browser scenarios are in `apps/api/test/api.test.ts`. They use fictional inputs. Hosted database/browser evidence is pending for this draft and must be recorded in `BUILD_HANDOFF.md` before C3 is marked tested. Local helper, lint and type checks are not a substitute for that run.

Rollback is code rollback plus migration rollback only before any retained records exist. Once used, retain the append-only tables or migrate them forward with an explicit custody-preserving procedure. Do not drop claim, decision, finding or audit records. This slice does not add report snapshots or exhibit export; R1–R3 remain next. It does not run Docling, Tika or OCRmyPDF, incorporate third-party source, merge, deploy or establish production readiness.
