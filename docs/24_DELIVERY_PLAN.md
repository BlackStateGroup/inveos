# 24 — Investigation workspace delivery plan

Updated 27 October 2026. Product direction: take an assignment, gather material,
establish what it supports, coordinate the work and deliver a defensible report.
The acceptance target is one complete fictional supplier investigation.

This plan reconciles the existing requirements with the expanded scope. It does
not certify the current lab for live investigations. [Work packages](21_ENGINEERING_WORKPACKAGES.md)
retain their identifiers; the [roadmap](13_ROADMAP.md) gives delivery order.

## Verified baseline

- [PR #1](https://github.com/BlackStateGroup/inveos/pull/1) is merged as
  `95b5c3535c72ddfcc09d6028e9137bce4106e7bd`. It implements the React prototype
  and a persistent PostgreSQL/Fastify synthetic workflow: case → versioned
  authority → UTF-8 original → exact-source claim → human review → JSON draft.
- [PR #2](https://github.com/BlackStateGroup/inveos/pull/2) is an open draft,
  checked at `36081f1a05586b2467acf99dd3b7695c931b7212`. It contains research and
  a synthetic derivative-citation contract. It has no running PDF/OCR parser,
  API integration or approved production dependency. Its changes are not part
  of this branch. Its reported 28 Python tests belong to that draft's revision.
- Most broad UI interactions reset on reload. Field and Client Portal are
  illustrative. See [application boundaries and the 26 October verification
  receipt](23_LOCAL_APPLICATION.md) and [local run instructions](../LOCAL_RUN.md).
- [PR #3](https://github.com/BlackStateGroup/inveos/pull/3) implements the CI
  baseline and this scope reconciliation. Hosted checks passed for its
  `f8080132657ed6a890e1b4ba0ffa43b91b40fe16` revision; see the
  [verification receipt](14_TEST_PLAN.md#verification-receipt--27-october-2026).
  This is a draft change, not merged product functionality.
- No capability has evidence here of production deployment or pilot acceptance.
  A local lab test does not establish either state.

## Delivery states and evidence

Record these independently for a **named, bounded slice**, not as an overall
percentage or as a promotion of its entire work package:

| State | Required evidence |
|---|---|
| Planned | Requirement, dependencies, owner/next action and an observable exit test |
| Implemented | Reviewable commit and run instructions; identify prototype-only behaviour |
| Tested | Exact revision, command/manual procedure, runtime, fixtures, results and limitations |
| Deployed | Environment, deployed revision, configuration/migration and rollback receipt |
| Pilot accepted | Approved pilot, named acceptance scenario, observed result and user sign-off |

Track blockers alongside these states. Separate API, real database, browser,
iOS, Android, outage, restore and security results. Never carry old test results
forward as fresh verification of changed code. Partial implementation keeps the
remaining acceptance criteria planned. A draft PR remains separate from main.

## Capability ledger

The delivered column describes only the stated slice. Unless it says otherwise,
the remaining scope is **planned**, with no deployment or pilot acceptance.

| Capability | Work packages | Delivered slice / evidence | Next acceptance target |
|---|---|---|---|
| 1. Case workflow | WP-01, WP-03 | Case/scope intake implemented and lab-tested in PR #1 | Persist objectives, questions, people, tasks, notes, owners, deadlines and blockers; reload shows the same case state |
| 2. Accounts and access | WP-01 | Demo sessions and selected tenant/case/role denial tests in PR #1 | Agency invitations, real identity/MFA, revocation and contractor assignment boundaries across every resource |
| 3. Evidence vault | WP-02 | Bounded UTF-8 originals, server digests, receipts, retry checks and source re-verification in PR #1 | Encrypted object storage; documents/photos/audio/video/email/spreadsheets; bulk/resumable intake, previews and recovery |
| 4. Document/media processing | WP-05 | No operational implementation on main; PR #2 research/contract only | Isolated PDF/OCR experiment, measured results, durable jobs and page/region lineage before application attachment |
| 5. AI assistant | WP-05, WP-06, WP-11 | Manual claim/review gate implemented and lab-tested; no AI service | Permission-scoped summaries, entities, case Q&A, contradictions, follow-up suggestions and drafts with inspectable citations |
| 6. Investigation reasoning | WP-14 | Planned | Questions, competing hypotheses, supporting/contrary evidence, unresolved checks and accountable owners persist with history |
| 7. Chronology | WP-15 | Timeline prototype; source/receipt times preserved in text intake | Searchable events with separate alleged-event, source-recorded and receipt times; uncertainty and disagreement remain explicit |
| 8. Field application | WP-04 | Memory-only Field prototype | Native encrypted queue survives restart; resumable uploads, receipts, conflicts and iPhone/Android outage tests |
| 9. Research workbench | WP-09 | Illustrative source register | Authorised manual captures with provenance, annotations and saved searches; ranked connector backlog and per-source approval |
| 10. Relationship graph | WP-10 | Fictional graph prototype | Cited, reviewed/disputed/suggested edges; possible matches, reversible merges and distinct identifiers |
| 11. Reporting/disclosure | WP-07 | Reviewed internal JSON draft implemented and lab-tested | Editable report, methodology/limits, PDF/DOCX, exhibits, revisions, redaction and independently verifiable package |
| 12. Client portal | WP-08 | Fixed fictional preview only | Separate release dataset and identity; explicit investigator approval, expiry, revocation and acknowledgements |
| 13. Team coordination | WP-17, WP-12 | Illustrative assignments; no operational collaboration | Assignments, comments/mentions, review queues, handovers, workloads and useful notifications with preferences |
| 14. Interface depth | WP-03, WP-16 | Broad prototype and recorded manual inspection in PR #1 | Persistent search/filter/saved views, bulk actions, keyboard use, side-by-side source review and large-case tests |
| 15. Reliability/operations | WP-00, WP-02, WP-13 | Local migration/runbook and API harness; CI implemented and hosted-tested in draft PR #3 | Secret scanning, repeatable environments, monitored jobs, cost/quotas, backups/restores, retention/holds/deletion and audited support access |
| 16. System verification | All, WP-13 | PR #1 database/browser receipt and [PR #3 CI/API receipt](14_TEST_PLAN.md#verification-receipt--27-october-2026) | Representative synthetic corpus, measured citations/extraction/entity errors and full intake-to-verified-delivery test |
| 17. Customer/offer | WP-18, WP-12 | Hypotheses only; no validated demand or pricing | Observe corporate due-diligence/internal-investigation users, recruit pilots, validate value, costs, templates and support |
| 18. Build discipline | WP-00 and every package | Packages and acceptance criteria exist; this ledger reconciles them | Select the next unblocked slice, implement, verify and open a draft PR with evidence and remaining gates |

## First milestone — SYN-SUPPLIER-001

Use only visibly labelled fictional records and identities, for example
**Northstar Demo Supplier (fictional)** with identifier `FICTIONAL-SUP-001`.
Do not contact organisations or query external registries. No real client data,
credentials, addresses or personal information belong in fixtures or screenshots.

1. An authorised investigator creates the case, records the instruction,
   approved purpose/scope/retention, assigns work and opens the question:
   “Do the supplied ownership records agree?”
2. Upload a digital ownership declaration and a scanned register extract.
   Preserve both originals, independent source/receipt times, acquisition
   context, receipt identities and server-verified digests. A retry must not
   manufacture another acquisition; an independently supplied copy has its own
   provenance even if its bytes match.
3. Run bounded extraction/OCR jobs. Preserve each derivative's original parent,
   tool/configuration identity, processing time, page/region and explicit
   partial/failed status. Display the original page beside the cited passage.
4. The declaration states Atlas Demo Holdings owns 100%; the older scan states
   Atlas 60% and Birch Demo Holdings 40%. Record the discrepancy, supporting
   passages, date difference, possible ownership change and outstanding checks.
   The discrepancy alone does not establish deception or actual ownership.
5. A human reviewer inspects both sources, records a reason and accepts a
   carefully qualified finding. Candidate extraction, claims, review decisions
   and accepted findings remain separate records. Unsupported conclusions and
   incomplete citations cannot advance to approval.
6. Produce an editable, branded report with the question, findings, contrary
   material, chronology, method, limits, reviewer and exhibits. Export a PDF
   and manifest/package that a separate verifier can check without INVEOS or
   service credentials. DOCX remains a subsequent WP-07 deliverable.
7. After explicit investigator approval and disclosure/redaction review,
   publish a frozen release version to the restricted client portal. The
   client can retrieve that release and acknowledge it; internal notes,
   draft reports and unrelated evidence remain inaccessible.

M1 is complete only when a fresh browser session can perform this entire flow
against persisted records, a second tenant/unassigned contractor cannot access
it, a client cannot guess internal URLs, altered originals/derivatives/manifests
fail verification, and share expiry/revocation behave as documented. Preserve
the exact test revision, fixtures, exported package and verification receipt.
This is a synthetic acceptance milestone, not live-customer authorisation.

M1 spans stages 1–3: pull forward the minimal WP-14 question record and WP-08
release-only portal after their dependencies pass. Native field capture and the
broader graph/connectors are not prerequisites for this supplied-document case;
they keep their own stage acceptance gates. The five-stage roadmap is not
declared complete when M1 passes.

## Next bounded engineering slices

| Order | Slice | Dependencies / exit |
|---|---|---|
| Implemented/tested in draft PR #3 | WP-00 CI baseline | Lint, every workspace typecheck, web build, Python checks and real PostgreSQL API tests passed on the hosted PR run without private credentials; full WP-00 remains partial |
| Next | WP-01 identity/access design and implementation | Record identity provider, region and invitation/revocation decisions before adopting a service; use synthetic users and cross-tenant/case negative tests |
| Next | WP-02 encrypted storage and binary intake | Identity/policy boundary, approved storage/encryption choice and original-byte receipt/recovery tests |
| Parallel research prerequisite | WP-05 isolated PDF/OCR experiment | Review PR #2 at its exact revision; suitable host plus resolved artifacts/licences/SBOM and proven worker restrictions; no silent merge or application dependency adoption |
| Then | WP-03 persistent case work and WP-14 question records | Case-scoped database/API, meaningful error states and reload/browser evidence |
| Then | WP-05 → WP-06 → WP-07 → minimal WP-08 | Durable processing/citation lineage → human review → verified package → approved release-only delivery |

On 27 October this host's `unshare --user --map-root-user --net true` probe
failed with `Operation not permitted`. No parser execution or benchmark was
performed here. Repeating research documentation is not the exit criterion:
the next processing change must prove isolation, run the synthetic digital/scan
corpus, measure accuracy/resources and make an explicit integration decision.

Agents may progress through unblocked, authorised work and produce draft PRs.
They cannot substitute passing mocks for actual evidence, adopt a major service
or new project dependency without the required decision, change production
data, merge branches or publish a client release without its explicit approval.
