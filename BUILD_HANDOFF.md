# INVEOS current engineering handoff

Updated 29 October 2026. [Canonical remaining plan](docs/71_REMAINING_DELIVERY_PLAN.md); [historical receipts](docs/history/2026-10-29_DELIVERY_RECEIPTS.md). Source and exact CI evidence take precedence over historic draft labels.

## Delivery authority and baseline

The user's current instruction explicitly authorises routine review, fixes, tests and suitable merges into main. This supersedes the older no-automatic-merge restriction. Do not merge failing, unreviewed or unfinished increments. Production deployment, spending, live collection, external contact/commitments and sandbox bypass remain unauthorised. Continue independent engineering when a particular provider/device/parser task is blocked. Use fictional fixtures and British English.

Main is merged through **PR #74**, commit `21e3e8042b422b0f8451e11500657206af3aad7b`. Post-merge [Checks 40920548389](https://github.com/BlackStateGroup/inveos/actions/runs/40920548389) passed. PRs #68–#74 were reviewed and merged in dependency order; research #2 and cumulative work through #67 are already incorporated. No functionality should be rebuilt because old handoffs still call it draft. No recurring automation was configured in this delivery thread at inspection; do not claim continuous work between runs.

## Verified baseline

- Frozen document-backed report lineage, independent JSON/document-package/PDF verification, correction history, independently reviewed exact PDF releases and restricted scripted recipient acknowledgement/revocation are implemented.
- PR #72: actual supplier native extraction, repeated OCR, raster/page comparison and worker failure/isolation acceptance; parser namespace denial on this local host was not bypassed.
- PR #73 final code `31d93ce9284df6adf62c1aa0d5d09aaff4eef889`: [Checks 40917126014](https://github.com/BlackStateGroup/inveos/actions/runs/40917126014), 244 Node / 111 Python, no failures/skips; [Research 40917125975](https://github.com/BlackStateGroup/inveos/actions/runs/40917125975) passed. Includes two alternative explanations, six typed reasoning links, immutable withdrawal/assessment history and redacted PDF metadata regression.
- PR #74 final code `187ab9e01c25af715438dc2e73c709060f3a8e52`: [Checks 40919585772](https://github.com/BlackStateGroup/inveos/actions/runs/40919585772), **249 Node / 111 Python**, zero failures/skips; [Research 40919585891](https://github.com/BlackStateGroup/inveos/actions/runs/40919585891) passed actual encrypted-original supplier native/OCR/raster/browser/export/delivery and worker checks. Protected-key loading is wired to the scoped dispatcher CLI, with invalid configuration and missing-key/no-derivative regression tests.
- Custody diff source review: all 15 files at `f64542a..708458a`, no reportable findings, managed scan `19d186af-926f-4120-aca8-462abac3e603`; the dispatcher/key-withdrawal follow-ups through `187ab9e` were reviewed separately. This is a scoped agent review, not an independent production security approval. [Custody contract](docs/81_ENCRYPTED_ORIGINAL_CUSTODY.md).

## Active substantive continuation: evidential chronology

Branch `feat/evidential-chronology`, based on main after #74. [Implementation contract and reproduction](docs/82_EVIDENTIAL_CHRONOLOGY.md).

Saved alleged events carry explicit unknown/day/month/instant/range precision, stated timezone/offset and uncertainty; separate competing accounts never become findings automatically. Typed text/document sources use existing reviewed finding chains. Current authority/source verification guards writes and inspection. Corrections preserve append-only revisions and audit history. The case UI supports search, correction history and source inspection. Frozen reports and canonical PDFs retain accounts; independent Python verifiers validate typed joins and date shapes. Redacting a source finding removes the complete linked event from the PDF model/text.

Local verification: build, types and lint pass; **240 Node tests passed against real disposable PostgreSQL, 17 browser tests skipped**, and **116 Python tests passed**. The actual Chromium launch failed with `No usable sandbox`; no weakening flag was used. Hosted sandboxed browser acceptance and isolated-worker regression are pending for this increment. Date API evaluation covers 19 valid/invalid representations; tests include access denial, immutable history, conflicting versions, audit rollback, stale authority/corruption, independent frozen exports and redaction.

Next: obtain exact hosted evidence, inspect the rendered chronology and perform the final code review before merging. Preserve this branch and do not call pending browser checks passed. Then continue the next unmet requirements: full recovery acceptance and identity/storage boundaries, chronology/search/graph/intelligence and native field/team/portal/platform criteria. Avoid documentation-only loops.

## Still unmet

Real identity/invitations/MFA; provider/KMS/WORM and comprehensive database/object/key/session recovery; richer search/saved views/graph/media/intelligence; native encrypted offline iOS/Android device acceptance; team/agency operations and independent professional/security/privacy/legal/licence approval. Original-object encryption excludes database metadata/derivatives/reports, staging, exports and comprehensive backups. Actual package-archive/runtime obligations and representative OCR/Tika/OCRmyPDF comparisons remain open. Scripted reviewer roles and fixture parser successes do not certify general accuracy, lawful authority, professional acceptance or production readiness.
