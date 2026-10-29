# Document extraction region map

29 October 2026. Continues PR #52 without changing stored evidence, worker profiles or approval semantics.

The document inspector now retains verified page dimensions and displays a page-scaled extraction outline. Select a page and use labelled buttons to highlight a particular passage, including repeated text on different pages. TOPLEFT and BOTTOMLEFT coordinates are converted to top-left unit-square display coordinates without modifying stored native geometry or extracted UTF-8 offsets. Page changes clear selection. Pages without text remain explicit.

This is an extraction map, **not original-page rendering**. No PDF is opened in the browser, no third-party renderer is added and no citation approval is enabled. Original-page comparison, reviewed derivative citations and export lineage remain outstanding. Text uses React text nodes, not HTML injection. The map uses data already authorised and verified by the existing derivative endpoint; it adds no network route or data transmission.

## Reproduce

- `npm run lint && npm run typecheck && npm run build`
- `node --import tsx --test apps/api/test/document-derivative.test.ts`
- The existing real PostgreSQL/browser document inspection test now selects page two, highlights its repeated passage and checks the map's explicit limitation. Run the Checks workflow or the documented API test harness with `INVEOS_TEST_BROWSER=1`.

Unit checks cover both coordinate origins, preserved native values, invalid geometry and retained verified dimensions. Browser acceptance remains unrun until a hosted receipt is recorded below. No new parser, native-device or production assessment is claimed. Fictional fixtures only. Rollback removes the view and helper; there is no migration.
