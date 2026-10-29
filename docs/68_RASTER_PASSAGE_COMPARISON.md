# Explicit raster and extraction comparison

29 October 2026. Continues PR #58. Processing history offers an explicit comparison for loaded successful document/raster jobs with matching case, evidence, original digest and authority version. Each click freshly retrieves and verifies both receipts; no implicit latest-result pairing. Loading older job history exposes older candidates. The original document inspector remains available.

The comparison rejects changed lineage, page counts or unequal page dimensions. Fractional dimensions requiring rounding are intentionally rejected until a transform is qualified. The existing top-left/bottom-left conversion maps unmodified extraction coordinates onto a unit-square SVG covering the verified image exactly. Accessible passage buttons select a page-specific reference and display its exact extracted UTF-8 range and text. Blank extraction pages are not described as empty originals. Source and derivative IDs/digests remain visible; no approval or finding is created.

The previous bounded PNG verification, no-store reads, abort/revoke lifecycle and failure cleanup remain in force. Re-running comparison clears both stale displays before fresh verification. No schema, dependency, runtime policy or export format changes. Prior rendering limitations remain prominent; geometric alignment does not establish extraction truth or visual fidelity. No persistent review, citation approval or automated queueing is implied.

## Reproduction

Run `npm run lint`, `npm run typecheck`, `node --import tsx --test apps/api/test/raster-overlay.test.ts` and `npm run test:foundation`. Follow `.github/workflows/checks.yml` for disposable PostgreSQL/Chrome setup and run `INVEOS_TEST_BROWSER=1 npm test --workspace @inveos/api`. The browser scenario completes both stored fixture jobs, selects page-two passage one, checks overlay/image dimensions and refuses a new comparison after original corruption. Fixtures replay actual prior parser/renderer bytes; no fresh parser execution is claimed.

## Remaining

Human-reviewed derived-document citations, immutable approval records and independent export verification remain next. Wider document transforms, fidelity, accessibility/device acceptance, identity/storage, orphan reconciliation and runtime/legal/security approval remain open. Nothing merged or deployed.

## Executed evidence

Draft PR #59 passed [Checks #152](https://github.com/BlackStateGroup/inveos/actions/runs/40846026166), job 123353609262, at `417d6f3c6e206b4c6c801c03506f7a0e70c6e347`, tree `fe42cae5f8e5924b41d9ba4eb901ca39388f399b`: 188 Node tests and 101 Python tests, zero failures/skips, plus lint/types/build/reference, real PostgreSQL/browser/restore and host isolation. The new browser scenario paired stored extraction/raster results, selected page-two passage one, checked matching overlay/image display dimensions, and cleared comparison after original corruption. Two new pairing/geometry helper tests passed. Local lint/types, two focused tests and foundation/101 Python tests passed. Fixtures replay prior actual output; no fresh renderer/parser execution, human approval or visual-fidelity certification is claimed. Evidence follow-up changes documentation only; resume #59 after fresh main/review checks.
