# 126 — Agency billing declarations and internal draft invoicing

Implementation handoff, 30 October 2026. Branch `feat/agency-draft-invoicing`, isolated worktree `/code/inveos-agency`, created from `a81ef2612dfd4c55244f4922627073372de6b976` after fetching `origin/feat/speech-casework`. This preserves main115, draft116 correction `7d9f1540` and the parent speech-casework implementation. Root owns integration, review, acceptance, PR creation and merging. No merge, deployment, production data, real collection, payment, outside contact or new application dependency is part of this increment.

This implements the draft-invoicing portion of WP12 on the existing time ledger (docs/93), time plans (docs/100), accepted expenses and currency-separated spending plans (docs/108). It does not complete WP12, enterprise administration or the product.

## Implemented flow

A case reviewer opens the new **Billing** case tab. They explicitly select an existing tenant client, state why that recipient is linked to this case, declare a fictional bill-to label, currency, hourly minor-unit rate, at-cost expense treatment, tax calculation label/rate, rounding rule and reason. GBP, EUR and USD are separate two-minor-digit profiles; no exchange rate is inferred. No default tax decision or commercial policy is accepted silently. Selecting a recipient records a case-scoped declaration only; it grants no case/portal access and sends nothing.

Declarations have immutable per-currency versions, expected-version checks, reasons, actor/time receipts, authority versions and withdrawal history. A changed/withdrawn declaration or changed case authority blocks new acceptance of drafts compiled against the earlier declaration. Re-declaring after withdrawal creates a new version. The last declaration version is reserved for withdrawal.

The workbench pages through current chargeable time or independently accepted expenses in the selected currency. It excludes sources reserved by another active draft. Users choose up to 100 exact revisions, give an internal reference/reason and compile. The server rechecks current membership after acquiring the case lock, current authority/lifecycle, declaration/recipient, source versions, expense acceptance and original receipt bytes/source-use controls. It freezes canonical JSON bytes, SHA-256, declared offsets/dates, recorder/revision times, full exact source receipts, expense review receipts, rate declaration, planning budget versions and integer line amounts. Compilation and audit are one database transaction.

Time line net = half-up(minutes × hourly minor-unit rate ÷ 60). Expense net is the accepted amount at cost. Declared tax = half-up(line net × declared basis points ÷ 10000). Totals sum rounded line integers. Multiplication/division uses `BigInt`; bounded values are converted to safe JSON integers afterwards. This is an explicit fictional arithmetic profile, not a statutory VAT/tax determination. Zero is explicit. No mixed-currency draft or conversion exists.

A logical time/expense identity can belong to only one current non-withdrawn draft across all recipients/currencies, regardless of source revision. Concurrent API compilation serialises with source corrections through the case lock. A deferred SQL duplicate check and immutable line foreign keys preserve this boundary. Rejection retains reservations. A correction creates a complete replacement revision, releases removed sources and clears review for the new version. Withdrawal is terminal, preserves all former bytes/lines/reviews and releases current reservations. Prior reviews remain historical; source correction/withdrawal does not alter frozen invoices or silently free their reservations.

An independent current case reviewer may accept or reject one exact version/fingerprint. They must have prepared **no revision of that invoice** and recorded **none of its selected sources**. Acceptance additionally rechecks current source/declaration/recipient/authority and verifies expense original bytes. The reviewer explicitly acknowledges inspecting source, recipient, arithmetic and planning-budget context. A subsequent correction requires another independent decision. Acceptance is internal only and does not issue an invoice or approve payment. There is no client endpoint or release grant for invoices.

The workbench displays frozen lines, exact recorder declarations, source correction history, receipt originals through existing Evidence controls, declaration/revision history and present-state issues separately from historical acceptance. Internal downloads contain the exact snapshot as base64, its fingerprint, the review, present version/status/issues and export time. Download rechecks current reviewer access, snapshot/source-receipt correspondence and expense original integrity/authority/source-use permissions; it audits the export. Historical snapshots with changed ledger/declaration versions may be downloaded with their explicit present-state issues, provided receipt access still permits it. A digest is not authenticity or external approval.

## Files and integration surface

- `apps/api/migrations/075_agency_billing_declarations.sql`: versioned case/currency/recipient declarations and immutable history.
- `076_agency_draft_invoices.sql`: heads, frozen revision bytes, exact line FKs, reviews, sequential terminal heads, case locks, deferred line totals/duplicate guards.
- `077_agency_invoice_guards.sql`: versioned authority FKs, frozen line/header correspondence and independent review SQL guards. Reserved numbers 078–079 remain unused.
- `apps/api/src/agency-invoicing.ts`: persisted reviewer-only routes and integrity/eligibility/review/export workflow.
- `apps/api/src/agency-invoice-arithmetic.ts`: bounded integer arithmetic.
- `packages/contracts/src/agency-invoicing.ts`, one export in `index.ts`: feature types, with no dependency change.
- `apps/web/src/AgencyInvoicing.tsx`, `agency-invoicing.css`: working forms, paged selection/register/history, exact retry after lost acknowledgement, source inspection and verified internal download.
- Minimal `App.tsx` patch: import, Billing tab/scoped page and one route branch.
- Minimal `app.ts` patch: reuse the existing expense original verifier unchanged through one shared local callback and register invoicing.
- `tools/verify_internal_invoice.py`: standard-library offline snapshot fingerprint and declared-arithmetic inspection. Requires an independently retained digest. It does not verify current eligibility, original receipt bytes, previous authors, legal/tax approval or external delivery.

Central handoff, docs index, shared CI and migration/test inventories are intentionally untouched for root coordination. No catalogue code was copied or incorporated; this bounded ledger workflow uses first-party code and existing libraries, so no new upstream licence/runtime claim is made.

## Routes

All routes start `/api/cases/:caseId/agency`; every route requires a current case reviewer. Writes require CSRF. Tenant comes only from the server actor.

| Route | Behaviour |
|---|---|
| `GET /recipients?after=` | Bounded tenant-client choices; no implicit access grant |
| `GET /declarations` | Current declaration for each supported currency |
| `POST /declarations`, `POST /declarations/withdraw` | Explicit typed fields, request UUID, expected version, reason |
| `GET /declarations/history?currency=&before=` | Retained declaration versions |
| `GET /eligible?currency=&kind=&after=&invoiceId=` | Current eligible time/accepted expenses; optional own draft for correction |
| `GET /invoices?after=`, `POST /invoices` | Bounded register / freeze selected revisions |
| `GET /invoices/:id`, `GET /invoices/:id/revisions/:version` | Frozen exact receipts plus current issues |
| `POST /invoices/:id/corrections`, `/withdraw`, `/review` | Immutable decisions and explicit expected revision |
| `GET /invoices/:id/history?before=` | Immutable reasons, actors and exact review receipts |
| `GET /invoices/:id/revisions/:version/export` | Audited internal representation with verified original references |

Identities are UUIDs, versions and amounts strictly typed before AJV coercion. Changed-content retries conflict. Limits: 100 lines/draft, 100 revisions/invoice (last reserved for withdrawal), 1000 invoices/case, 1000 declaration versions/currency (last reserved for withdrawal), 2 MiB frozen snapshot, 25-item invoice/history pages and 50-item candidate/recipient pages. Internal references are labels, not statutory invoice numbers.

## Verification receipt and root acceptance handoff

Actually run during this build phase:

- `npm ci`: installed the existing lockfile dependencies, 0 vulnerabilities reported by npm. No new dependency added.
- `npm run typecheck`: web, contracts and API TypeScript passed after UI integration.
- `npm run typecheck -w @inveos/api`: passed after authoring the API acceptance fixtures.
- Narrow ESLint over the new API/arithmetic/contracts/UI/test modules: passed.
- `git diff --check`: passed at the recorded implementation checkpoint.

**Not run / not claimed passed:** migrations on PostgreSQL (empty or populated), the new arithmetic tests, the new API/SQL tests, offline invoice verification, browser/render/accessibility journeys, full regression, accounting/privacy/security review, office/export matrix, production checks. The build-phase instruction defers these to root after integration. No rendered UI acceptance or production completion is claimed.

Authored but unrun acceptance fixtures in `apps/api/test/agency-invoicing.test.ts` use disposable real restricted PostgreSQL and actual Fastify requests. They cover exact integer totals/planning versions, source times, immutable bytes, idempotency, self-review denial, independent review, exports/audit, duplicate prevention, source corrections, rejection/reservation, invoice correction/withdrawal, historical lineage, declaration/currency/recipient invalidation, typed amounts, role/case/tenant denials, concurrent compilation and corrupted original receipt bytes. `agency-invoice-arithmetic.test.ts` covers tie rounding and maximum supported totals. These are neither passing evidence nor browser/device acceptance.

Root acceptance should first apply 075–077 in the combined migration order, reconcile any shared migration inventory assertions and run these focused tests, then broader combined acceptance. Add actual browser coverage for reviewer switching, explicit declaration fields, selection across pages, original receipt navigation/back, correction/history/reload, lost acknowledgement/exact retry, revocation clearing, narrow layout and downloads. Inspect desktop/narrow real renders before any UI acceptance claim. Exercise source-use blocking, authority changes, lifecycle closure, case-lock wait revocation, audit rollback, database negative mutations, populated migration, recipient changes and precise rounding/money review in the combined suite. Existing original controls and source-time preservation must remain intact.

Suggested focused commands once root provides the disposable test environment:

```sh
node --import tsx --test --test-concurrency=1 apps/api/test/agency-invoice-arithmetic.test.ts apps/api/test/agency-invoicing.test.ts
python3 tools/verify_internal_invoice.py internal-invoice.json --expected-sha256 RETAINED_SHA256
```

## Known scope limits and independent gates

No subscriptions, charges, payments, automatic delivery, client invoices, tax reporting, credit notes, receivables/settlement, statutory numbering, FX, discounts, multiple rates within one draft, per-person rate schedules, inclusive/compound tax, proration, retainers or partial billing of a time/expense record. Expenses at cost and one hourly rate per currency declaration are deliberate bounds. A different currency/recipient requires its explicit declaration and fresh review. Time has the existing recorder-marked chargeability field; invoice review is its independent billing decision, not a new approved-time ledger.

Whole-ledger plans are informational snapshots; no budget is invented and exceeding/missing a plan is not treated as automatic approval or hard refusal. Current budget context still needs human assessment. Source rows entered twice under different identities are not deduplicated by semantic meaning. Reviewer roles are reused for access; production accounting/support-role policy remains open. A review snapshot says what was decided then; current stale issues must be considered before further use. Original-source access can block a historical download after authority/source-use changes.

Append-only SQL and SHA-256 are not external anchoring or protection from privileged administrators. No originals are modified by this feature. Internal exports contain source descriptions, recorder identities and recipient details and are not sanitised disclosure packages. Production identity/MFA, native/mobile, tax/accounting/legal/privacy sign-off, secure operations and the wider product remain separate unmet gates.

Rollback: do not drop these tables or rewrite applied migrations after records exist. Disable the additive route/UI registration if necessary and preserve immutable receipts; use a forward corrective migration for defects. All new tables are initially empty on upgrade and existing ledger tables/bytes remain unchanged.
