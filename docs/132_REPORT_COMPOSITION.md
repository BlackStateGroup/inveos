# Saved report composition — implementation handoff

Build phase: implementation and compiler feedback only. No product, production,
release, browser, accounting or forensic acceptance is claimed. Root coordinates
combined acceptance and integration; this branch neither merges nor deploys.

## Implemented workflow

The existing Reports → saved revisions surface now includes **Saved report
outlines and templates**. An internal case member can:

- Create a named outline with declared scope, method and limitations. These are
  labelled author context, not findings, in the editor and emitted copies.
- Add named sections with stable UUIDs; reorder sections; select, remove, reorder
  and move already reviewed text/document/transcript/speech findings. A section's
  name/order/selection is versioned by its enclosing outline revision.
- Save an empty section template, then reuse its names/context in a new outline
  with new section IDs and no inherited evidence selections or review approval.
- Save corrections with reasons; inspect immutable revisions and review history;
  terminally withdraw an outline without deleting its historical declarations.
- Inspect current verification receipts for selected originals/citations/reviews,
  including source time separately from receipt time; download the internal
  verification preview (which explicitly is not a frozen report).
- Obtain acceptance or a changes-requested decision from a case reviewer who has
  authored **no revision** of that outline. Every new revision starts unreviewed.
  Review replacement is an append-only decision on the same exact revision.
- Freeze the current accepted composition into the existing immutable internal
  report revision system. Existing source verification, saved PDF/DOCX creation,
  independent exact-copy review, recipient selection and release gates remain.
  There is no automatic release or contact/delivery action in this module.

Only selected reviewed finding records enter a composed report. The existing
verified builder returns whole records rather than reconstructing narrower copies;
source citation, policy, collection receipt and other additive source fields are
preserved. Composition v1 excludes unrelated work items, chronology and reasoning
links. It does not turn scope, method, limitations or section labels into claims,
findings, verified source facts or conclusions.

## API and persistence

Migration **095_report_compositions.sql** adds two append-only tables. No existing
migration is edited. Reserved 096–099 are unused; 094 belongs to root.

`report_composition_revisions` stores a case-scoped composition UUID, sequential
version, exact payload digest, reason, author/name, server recording time and
idempotent operation receipt. `report_composition_reviews` stores the exact
revision/digest, sequential decision, reviewer/name, reason and recording time.
Database triggers serialize the case, enforce sequence and terminal withdrawal,
retain the withdrawn outline verbatim, and enforce an independent current case
reviewer. Neither table grants UPDATE/DELETE to the app role.

Internal endpoints under `/api/cases/:caseId/report-compositions`:

| Route | Purpose |
| --- | --- |
| GET / | Bounded current-outline register; UUID `after` cursor |
| POST / | New named outline/template, `id`, `outline`, `reason` |
| GET /findings | Bounded verified selection identities/text/reviewer receipts |
| GET /:id | Current revision and current review/sequence |
| POST /:id/revisions | Append correction with expected version/digest |
| POST /:id/withdraw | Terminal withdrawal retaining the prior outline |
| GET /:id/history | Bounded revision history; numeric `before` cursor |
| GET /:id/reviews?version=N | Immutable decisions for one revision (max 100) |
| POST /:id/reviews | Independent acceptance/changes requested; exact current review sequence |
| GET /:id/preview?version=N | Reverify exact selection against current sources; internal preview |

All routes use the existing internal authentication/CSRF/case membership controls,
case locks and repeatable-read retry transaction. Server-supplied case identity
binds each payload. Saving selected findings, accepting and freezing reuse the
existing exact source/original/citation verification path. Idempotency receipts
bind actor and normalized inputs; changed inputs with the same operation ID are
rejected. Mutations and previews append audit records. No endpoint is available
to a client-role session.

The existing POST `/api/cases/:caseId/report-revisions` accepts an optional exact
binding alongside its normal idempotency key:

```json
{
  "idempotencyKey": "<operation UUID>",
  "composition": {
    "id": "<outline UUID>",
    "version": 1,
    "sha256": "<outline payload SHA-256>",
    "reviewId": "<accepted review UUID>"
  }
}
```

The current version, active state, digest, latest review and verified selected
identities must agree. A retry cannot silently change between legacy/composed
reports, between outline versions or between review decisions. Frozen report
bytes include author/reviewer receipts and the complete outline under the explicit
optional `composition.format = inveos_report_composition_v1`; its payload uses
`inveos_report_outline_v1`. Whole-report hashing covers that receipt. Frozen
history is retained when an outline is later changed or withdrawn. Withdrawal
stops new freezes; it does not retroactively revoke an existing report/copy/release.
Use the existing report/disclosure withdrawal controls for that separate decision.

## Fingerprints, renderers and verifier

The outline payload has a fixed JSON member order, UTF-8 serialization and SHA-256.
The finding selection identity digest is the SHA-256 of the JSON string array:
`["inveos_composition_finding_v1", kind, findingId, text, reviewer, reviewedAt,
sourceId, sourceSha256]`. This is deliberately an identity profile, **not a new
original/citation verifier**. Full source, derivative, citation, authority and
review integrity remains the existing builder/frozen-source verifier's job.

Selection lists must cover exactly the frozen finding set once, with matching
kind and identity digest. Underlying finding arrays retain the builder's stable
order for existing frozen-source comparisons. The explicit section/selection
order controls human-readable output.

`reportLines` in `report-pdf.ts` now has one guarded callback per finding family.
The legacy branch calls these in the same family order with the same text. The
composition branch adds clearly labelled context and section headers, then calls
the same callbacks in selected order. DOCX already calls this shared function and
therefore consumes the same grouping/context without a second renderer.

Any whole-finding redaction suppresses that finding before its source/receipt
content is emitted. When any finding is redacted, **all newly introduced free-text
composition names, context and section labels are withheld**: those fields could
repeat removed material. Only structural section numbers, outline fingerprint,
version and reviewer receipt remain. The existing case header and existing report
limitations follow existing disclosure controls; independent reviewers must still
inspect the entire exact copy. No full composition payload or finding selection
map is attached inside a redacted PDF/DOCX model.

Existing JSON reports without `composition` remain supported; no stored bytes,
fingerprints, renderer profile constants, redaction format or PDF/DOCX semantic
model shapes are migrated. New composed content has an explicit versioned receipt
and visible composition-v1 header. The PDF/DOCX container/line encoding profiles
remain unchanged: their existing independent verifiers reconstruct arbitrary
bounded semantic lines/paragraphs, including the composition lines. Byte-for-byte
legacy compatibility and rendered output require the deferred acceptance gate;
they have not been empirically verified in this build phase.

`tools/verify_report_composition.py` independently validates the optional receipt,
fixed-order payload digest, exact selected identity set, section bounds/uniqueness,
case, accepted independent author/reviewer identity and no unrelated work context.
Both `verify_report.py` and `verify_document_package.py` invoke it. For a mixed
package, composition is validated against the **complete** report, not the
text-only projection used by the existing text verifier. Offline checks cannot
authenticate reviewer names, current access/policy or all prior outline authors;
retain trusted whole-report/copy fingerprints separately and use server review
and release gates.

## Integration notes for root

Base is the pushed portal implementation a74853d60ecb5e5846adc95d4bb3f52e9e0abdca,
not root's subsequently integrated branch. Central BUILD_HANDOFF, docs/INDEX and
shared CI/test inventory are untouched. No new dependency, parser, third-party
code or catalogue copy was introduced; no additional licence acquisition needed.

Shared edits are additive imports/registration and the optional freeze binding in
`apps/api/src/app.ts`, the optional ReportDraft property and types in contracts,
one component insertion in ReportRevisions, shared finding callback dispatch in
report-pdf, and composition calls in the two Python report verifiers.

Root's Field provenance (docs134) and the research agent's receipt rows should be
retained **inside each finding callback after its whole-finding redaction return**.
Do not rebuild a selected finding from a narrower field list: retain any source
`fieldProvenance` and research receipts. That keeps provenance in frozen JSON and
ensures selected PDF/DOCX output uses the existing finding redaction guard. This
branch has not merged the concurrent root/research changes.

## Limits and deferred acceptance

- Case-local templates only; no tenant-wide publishing, rich text, unrestricted
  narrative conclusions, page designer, automatic findings or client releases.
- Bounds: 200 outlines/case, 100 revisions/outline (100 reserved for withdrawal),
  100 review events/revision, 50 sections, 1000 unique selected findings; existing
  report byte/item and PDF WinAnsi limits still apply.
- Choice discovery verifies the bounded full finding set (without unrelated work
  context). An unavailable/stale finding can block discovery; an existing saved
  outline can still verify/freeze only its own selected subset. No SQL pagination
  or per-choice partial-success catalogue is implemented here.
- UI retries an uncertain decision with the same operation identity while mounted.
  It does not persist pending outline/freeze requests across reloads. After reload,
  inspect revision/outline history before submitting another freeze. Existing
  legacy freeze recovery remains unchanged.
- Historical preview re-verifies current sources; it can fail after source/policy
  changes even though immutable outline/report history remains available.
- Template review acceptance is a composition gate, not a statement that a method
  was performed, a finding is true, evidence is admissible, or release is approved.

Executed during this build: workspace TypeScript compiler checks (web, contracts,
API); Python syntax compilation and `git diff --check` as recorded in the final
receipt. No check not actually run is marked passed.

**Unrun, owned by combined acceptance:** migration execution/privilege/trigger
checks; API success and negative cases (tenant/case/client boundaries, authorship,
version races, replay mismatches, source/authority changes, withdrawals, reviewer
replacement); finding-family mixture and zero/duplicate/oversized selections;
legacy JSON/PDF/DOCX byte parity; selected order/grouping/context rendering;
redaction leak inspection including concurrent Field/research provenance;
independent verifier success/tampering for mixed packages and trusted hashes;
exact-copy review/release/expiry/revocation regression; UI/browser/accessibility,
Office rendering, browser print, lifecycle/retention, privacy, lint and full suites.
No broad tests or browser sessions were run or added during this build phase.


### Executed integration follow-through

Actual PostgreSQL acceptance reproduced and fixed the non-completing validation hook (48cf9fdc). Root reran three composition/portal/collaborator workflows successfully at4216ad12, including frozen selection and copied JSON/PDF/DOCX verification (`/tmp/inveos-platform-composition-accepted.log`). Eight actual old-versus-new PDF/DOCX byte comparisons passed against the PR116 renderer7d9f1540 for full/redacted text-document and speech fixtures; fixed baseline fingerprints are retained in `apps/api/test/report-pdf.test.ts`. This is bounded legacy compatibility evidence, not a claim that every possible report or Office renderer is qualified.
