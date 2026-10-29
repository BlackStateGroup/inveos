# Preservation and retention-review evaluation

This is a bounded WP-02/WP-13 development increment, not production or legal acceptance. All fixtures are fictional. The current commit/run/merge checkpoint is in [BUILD_HANDOFF.md](../../BUILD_HANDOFF.md); the [contract](../94_PRESERVATION_HOLDS.md) describes limits and reproduction.

## Actual local evidence

Six focused restricted-role PostgreSQL tests pass. The combined suite passes **291 Node tests with 27 browser tests skipped** (318 total), **120 Python tests**, lint, workspace type checks and web build. Hosted acceptance below supersedes the local browser limitation for the exact committed revision.

- Actual originals and immutable database history: create/retry, changed replay rejection, concurrent edits, process reconstruction, amendment, terminal release and historical retry without resurrection. Target alteration and history deletion fail. Original download still succeeds after release.
- Overlapping case/original holds: later originals inherit case-wide preservation; independently releasing one hold leaves the other effective. Later case authority does not replace the original’s retention interval. Case closure does not release holds; a reviewer can explicitly release after closure.
- Integrity and atomicity: an actually changed stored original fails download while its metadata can still be placed under preservation. Failed audit inserts roll back declaration, amendment and release. The hold explicitly claims no byte verification.
- Actual loopback HTTP: four read routes across unauthenticated, foreign tenant, unassigned reviewer, client, internal investigator and assigned reviewer sessions; write denial for foreign/unassigned/client/investigator accounts, missing CSRF, changed roles and revoked membership; foreign-case sources and malformed/oversized control inputs fail. No real investigative data or external request was used.
- Bounds: 100 immutable versions with the last reserved for release, 200 hold identities with the next rejected, 51-original/51-hold keyset traversal and history pages. These small fixtures prove traversal/limits, not production performance.
- Timestamp semantics: actual PostgreSQL in `Europe/London` demonstrated that `interval '1 day'` means only 23 elapsed hours across the spring transition. The implemented interval is exactly 24 elapsed hours per recorded day. Both spring and autumn cases pass through the actual API against that timezone. Source time remains distinct from server receipt and calculated review date.

The first historical-date fixture attempted an evidence UPDATE and correctly hit the immutable-record trigger. It was replaced with an explicitly fictional separate historical receipt, without disabling or changing immutability. Two new metadata fixture queries initially mixed UUID/text parameter inference; explicit casts fixed them. A lint-only mutable declaration was also corrected. These failures are not passing receipts.

## Source and privacy review

The additive migration, server handlers, contracts and interface are reviewed against current case/role/CSRF boundaries. The shared post-lock membership check is reused. Source anchors are immutable; requests are bounded and hashed in canonical field order; reads and writes set lock/query deadlines; audit writes share the transaction. All targets remain within the actor’s case and tenant. Internal preservation is separate from authority, findings and client grants. Lists/history are paged; UI access denial clears loaded decisions and unsent editors and refreshes the parent workspace. No new dependency, upstream source copy, collector, external message or client disclosure is added.

Legal validity, professional approval, provider Object Lock, authorised destruction and verified erasure of objects/derived copies/backups remain open. No destruction endpoint exists. The review date is a visible review prompt, never permission to delete.

## Hosted acceptance and rendered review

Implementation `28576aa86fa0590018bfeea3e177a59365d6c197` passed [Checks 40961098012](https://github.com/BlackStateGroup/inveos/actions/runs/40961098012), job `123753772022`: **318 Node/120 Python tests, zero failures/skips**, lint/types/build/foundation, all **27 actual sandboxed browser journeys** and worker isolation probes. The new browser journey declares an original hold, loses and retries an actual committed response, amends, reloads, inspects retained wording and the exact original, releases, checks the review queue, checks 390px overflow and clears revoked records plus an unsent editor. The retained desktop render was inspected: the current declaration, source digest, reasons and prior wording are readable. [Retained render](assets/preservation-desktop.png).

The same revision passed [Research 40961134619](https://github.com/BlackStateGroup/inveos/actions/runs/40961134619), job `123753890216`: actual encrypted native/OCR supplier intake, two document findings/six typed links, independent package/PDF verification, original-page browser comparison, restricted delivery/acknowledgement/revocation, repeated isolated raster and five actual leased-worker/daemon-failure tests. [Machine receipt extracted from actual TAP](preservation-supplier-receipt.json). `realProfessionalReview` remains false; representative OCR fidelity, licence obligations and independent approvals remain open.

No application changes follow this tested revision in the evidence update. PR #88 remains unmerged at this checkpoint; its final-head checks and resulting main must be recorded after execution.
