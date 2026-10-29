# Document findings in investigation reasoning

29 October 2026. Continues the actually tested supplier journey in draft #72. This adds original INVEOS domain code, not another graph or case system. The existing PostgreSQL relationships and reviewed document verifier fit this requirement; none of the research catalogue components needs incorporation for a typed source join. No dependency, copied source or licence approval is introduced.

## Behaviour and boundaries

Migration 031 lets the existing append-only `case_work_links` point to exactly one original-text claim or reviewed document finding, with tenant/case composite foreign keys and stable retry identities. Legacy links remain compatible. Document candidates are paginated, explicitly historical and reverified on inspection/save. Current original/raw/normalised/citation/correspondence/interpretation lineage, authority and both reviewers' current case/role assignment must pass. Scope comes from the authenticated session. Clients cannot list, inspect, create or withdraw internal links.

Questions and competing hypotheses can attach supporting, contrary or context-only material. A Supported/Disputed assessment requires the corresponding relation, and every active linked source is rechecked (including contrary/context). Resolving a question rechecks its active links and direct hypothesis links. It still records an investigator's reason; it neither promotes a hypothesis to a finding nor proves an explanation. Closure can record an inconclusive result after stale links are explicitly withdrawn. No AI closure is added.

Each work revision snapshots the active source links behind that decision. Withdrawals are separate immutable records with actor/reason/time and audit; they never erase original links or previous decisions. Withdrawn links do not satisfy a future assessment. A withdrawn finding/relation cannot be silently reactivated by retrying its original identity. Use a new reviewed finding when fresh source review warrants it. Existing saved assessment statuses are historical, not live certification; the interface says so and inspection checks current validity.

The browser lists/inspects current verified document passages, page regions, original fingerprints, separate source/receipt/processing times and independent review reasons. It opens the same original in the existing evidence/page-comparison workspace. Saving, reloading, inspecting and withdrawing share case state. Historical versions expose the exact source links used then.

Frozen reports include active typed document links only for exported working context. All referenced findings must be in the reverified document finding set. The independent package verifier checks source type, tenant-bound exhibit lineage, case/item/finding joins, relation, reason, identity, time and duplicates. Old packages remain supported. Integrity does not authenticate an investigator or prove their inference. PDF working context remains distinct from findings; source-link joins are carried by the JSON/exhibit package, not silently added to the fixed PDF profile.

## Reproduction and evidence

Run `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:foundation`. The existing Checks workflow runs `npm test --workspace @inveos/api` against real disposable PostgreSQL and sandboxed Chrome. New API tests cover typed concurrency/retry, immutable history, independent package verification, scope/current-review/authority denials, withdrawal and audit rollback. The browser test creates a document link, inspects it, reloads, checks the assessment history and withdraws it.

The existing isolated research workflow runs the actual supplier OCR/native/raster journey. It now adds the discrepancy question, two explicitly proposed alternative hypotheses, six supporting/contrary/context document links, an inconclusive investigator closure and an independent export join check before the existing restricted PDF delivery checks. Local helpers/fabricated parser bytes are not actual parser evidence. Hosted acceptance for this changed revision is pending until the current handoff records exact successful runs.

## Privacy and rollback

No external collection, new provider, production deployment, client contact or automatic merge. Reviewer revocation blocks new reasoning/report use. Previously frozen bytes and explicitly released snapshots retain historical semantics; revocation of a released item remains explicit. Existing authority, body/report bounds, CSRF, audit transactions and immutable original handling remain in force.

Keep migrations and historical rows when rolling back. An old API cannot interpret document links safely; disable writes/read surfaces rather than casting a document finding into a legacy text claim. No destructive down migration. Full identity/encryption, representative corpus and legal/professional/device acceptance remain separate open criteria in the canonical plan.
