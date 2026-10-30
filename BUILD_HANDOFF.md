# INVEOS current engineering handoff

Updated 30 October 2026. **The product is not complete.** [Remaining plan](docs/71_REMAINING_DELIVERY_PLAN.md), [requirements](docs/02_PRODUCT_REQUIREMENTS.md), [work packages](docs/21_ENGINEERING_WORKPACKAGES.md). Historical receipts: [29 October](docs/history/2026-10-29_DELIVERY_RECEIPTS.md), [30 October](docs/history/2026-10-30_DELIVERY_RECEIPTS.md). Preserve their failed and superseded evidence.

## Authority

The user authorises review, fixes, tests and suitable merges into main without routine approval. Do not merge failing, unreviewed or unfinished increments merely to clear a backlog. No production deployment/database change, spending, live investigative data, outside contact/commitment or sandbox bypass. Fictional fixtures and British English. No recurring automation was configured at inspection; do not claim continuous work between runs. Do not inspect or contact other threads.

## Latest merge and verification

PR **#94** merged as `476c883bff82ac172393554631512d4778624882`. Final reviewed head `7ed0ad9245aa9b38fdb323b184c383fd0581b456` passed **Checks 40984269475**, job 123831617712: **351 Node/136 Python, zero failures/skips and 31 actual sandboxed browser journeys**. It includes the strict null/boolean/string/array budget-input fix and validated #93. Actual reviewer planning, whole-ledger totals, lost-response retry, conflicts, history, outage/recovery, withdrawal and revoked data clearing pass. The render and exact receipt are retained; no unresolved review feedback remained. Resulting-main **Checks 40984928414 is pending**.

PR #93 merged as `eff69b0bdc7a92d258a9310b21b1e17dfbb9dd3e`; resulting-main **Checks 40984158675**, job 123831098923, passed **343 Node/136 Python, zero failures/skips, 30 browsers**. Its final head `d8c4915` passed Checks 40983304386 and Research 40983304312: all 161 exact archive acquisitions, networkless build/qualification, unchanged runtime inventory, both complete supplier profiles/corpora, raster and five daemon failure/isolation tests. Final v1/v2 measurements independently replay and match earlier passing exact TSV bytes (14/24 outputs). Archive locking does not imply signed-index/source closure, licence approval or representative OCR accuracy. Earlier failures remain in evaluations/history.

## Preserve completed functionality

- Actual isolated native/OCR/raster supplier workflow: immutable encrypted originals, precise citations, independently recorded correspondence/interpretation reviews, alternatives, frozen reports/exhibits/PDFs and independent offline verification; approved restricted fictional recipient delivery, acknowledgement and revocation. Scripted roles are not professional/legal acceptance.
- Search/private views (#78), work discussion/mentions (#79), reviewed source-backed graph (#80), supplied-source register (#82), assigned-work queue (#83), lifecycle/closure/reopening (#84), supplied transcript corrections/export (#85), owner-managed internal membership/ownership (#86), case time ledger (#87), preservation declarations/retention review (#88), OCR adversity corpus (#89), exact stored-document search/inspection (#90), attention (#91) and expanded profiles (#92).
- Development pinned OIDC (#76), encrypted original key rotation/withdrawal (#74), and tiny quiesced database/object/separate-key restore with audited stale-lease retirement (#77). These are not real provider/MFA, KMS/WORM, all-data encryption, off-site/PITR or production recovery qualification.
- Keep fresh post-case-lock membership/role enforcement from #86. Preserve #90's actual proxy disconnect/shutdown cleanup fix; #89 main Checks 40969884003 failed and must not be relabelled passed. Retain exact searched-job keyboard focus without altering ordinary inspection focus.

## Active substantive work

`feat/bulk-task-status`, `/code/inveos-bulk-tasks`, implements atomic status changes for 1–50 selected tasks with version conflicts, current case/role checks, per-task immutable history/audit, stable same-actor retries and an append-only batch receipt (migration 047). It preserves question/hypothesis/finding/handover review gates. A failed audit or any invalid/stale/unrelated selection rolls back the whole batch. The UI freezes failed submissions for unchanged retry, lists all selected versions, hides stale work during refresh/outage and clears revoked selections.

Seven actual PostgreSQL/API tests plus migration upgrade/idempotency pass (8/8), including 50-item transactions, races/restart/retries, raw type bounds, actual HTTP session/CSRF/scope denials, post-lock revocation and the 1,000-batch limit. Full local API suite passes **327 Node, 32 explicit browser skips (359 total), zero failures**. Lint/types/build/foundation/workflow checks pass. The branch now integrates merged #94/#93; combined Python/hosted checks and actual browser/render acceptance are required before merge. See docs/101 and its dated evaluation. No new dependency or production activation.

## Remaining and local blockers

Continue the unmet criteria in docs/71. Next relevant document work includes source-archive/signed-index/build provenance, file-specific licence obligations and security acceptance, representative scan/language/table/long-document evidence, and pinned Tika/OCRmyPDF comparisons. The digest-pinned base includes components beyond Debian package archives; archive locking alone is not a full image rebuild or source closure.

Still open: actual identity provider/MFA/invitations; KMS/provider/WORM and database/derivative/report/backup encryption; authorised destruction/copy inventory; off-site/PITR/live recovery and credentials/offline coordination; native encrypted iOS/Android capture with actual device/airplane-mode/restart/conflict/lost-device checks; enforceable source-use policy and authorised collectors; richer bulk/performance/graph/media/cited AI; contractor/workload, financial budgets/billing/support; independent professional/security/privacy/legal/licence approvals.

Local Chrome/worker isolation remains unavailable and must not be bypassed; qualified hosted CI supplies actual browser/native evidence. Blockers affect only their step; continue independent authorised engineering. The old `/code/inveos` preview remains on PR #6, not current main; do not present it as the delivered build or stop its processes. No production activation is authorised. Check current main, all open PRs and feedback before further merges; preserve other worktrees and uncommitted work.