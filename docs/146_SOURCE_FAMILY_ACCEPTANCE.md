# Source family acceptance — focused checkpoint

Base: `d345524f9835dae7a14df6718bed0579e00db8e5` on isolated branch `feat/source-family-acceptance`. Fictional fixtures only. No provider activation, live collection, new application dependencies, production changes or qualification claims.

## Reproduced defects and narrow fixes

- Tika queueing returned HTTP 500 (`Original size limit`) even for a small valid PDF: Tika asks for a 2 MiB bounded read but the shared reader rejected budgets above 256 KiB. `storage.ts` now accepts a bounded budget up to 2 MiB. Existing callers retain their smaller limits.
- The encrypted store also rejected that budget. `original-encryption.ts` accepts the reader budget while preserving the existing 256 KiB encrypted plaintext/intake cap and caller-supplied smaller limits. Regression checks exercise successful existing-original reads, smaller-budget rejection and oversized intake rejection.
- Saving a report composition hung: its Fastify pre-validation hook neither returned a promise nor called a callback. `report-compositions.ts` makes the hook async. Actual selected Tika composition/save/review/freeze requests now complete.

No shared renderer, application route aggregator or independent verifier changes are needed for this checkpoint. No migrations are added.

## Actual checks completed

Disposable PostgreSQL 15.19, loopback only, database `inveos_test`, temporary random schema per run. Application role is explicitly NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOINHERIT. Migrations execute against the disposable database, with restricted application queries. Existing lockfile dependencies only (`npm ci --ignore-scripts`).

- 16 focused integrated tests passed: 10 research API/CLI/report tests, 2 Tika contract tests, 4 Tika report/API/package tests. One additional later-source-registration/source-use test subsequently passed separately.
- 27 focused transport/encryption/legacy document-package/PDF/DOCX regression tests passed.
- 9 existing Companies House OSINT API tests passed, including the historical company capture and verifier format.
- 47 existing Python report/PDF/DOCX/package/Tika research unit tests passed. These are not actual Tika parser runs.
- Workspace `npm run typecheck`, targeted ESLint, Python syntax compilation and `git diff --check` passed.
- Actual loopback HTTP transport and separate fictional RDAP/GLEIF CLI processes passed. Checks include fixed scope, no redirect, no compressed payload, streaming size cap, premature close, abort and disabled live transport.
- Actual copied standalone helpers verified Tika context/package, source report and PDF/DOCX copies in temporary directories with no repository imports. Offline kit extraction and its copied package verifier passed. Original/raw/derivative substitutions and rehashed citation offsets were rejected.
- Actual application-produced PDF/DOCX copies were checked for visible provenance and whole-finding redaction. LibreOffice 7.4.7.2 rendered the DOCX copies; Poppler extracted text and produced page images. The renderer receipt covers 16 copies (four families × visible/redacted × native PDF/DOCX rendered to PDF). Office resaves failed the original trusted digest checks as intended. First-page images were visually inspected for the Tika and research families; this is not exhaustive pagination or Microsoft Word acceptance.
- Role demotion, later authority/correspondence, terminal interpretation withdrawal, source-use changes, outsider/client access, cancellation, expired-lease recovery, unsupported Office originals and invalid synthetic results were exercised. New release after withdrawal was rejected; exact package confirmation was required for the earlier fictional recipient release.

Tika fixtures enter through `finishTikaJob` below the worker transport. `support/tika-contract.ts` is explicitly **synthetic contract input** with `syntheticContractOnly: true` and `actualHostProbeExecuted: false`. No JVM, parser, container or native host probe was executed. Receipt-shaped fields exercise schema contracts only, and no qualified host/runtime receipt was created. Typed positions are page-text UTF-8 offsets, never PDF geometry or original-PDF byte offsets.

## Reproduction

Set `INVEOS_TEST_DATABASE_URL` to the disposable restricted role and `INVEOS_TEST_ADMIN_DATABASE_URL` to its schema administrator. This run used local port 55468. Do not point these commands at a real database.

```sh
INVEOS_ACCEPTANCE_ARTIFACTS=/tmp/source146-artifacts node --import tsx --test --test-timeout=60000 --test-concurrency=1 apps/api/test/research-api.test.ts apps/api/test/tika-report-acceptance.test.ts apps/api/test/tika-contract.test.ts
node --import tsx --test --test-concurrency=1 apps/api/test/research-adapters.test.ts apps/api/test/collection-transport.test.ts apps/api/test/original-encryption.test.ts apps/api/test/document-package.test.ts apps/api/test/document-package-download.test.ts apps/api/test/report-pdf.test.ts apps/api/test/report-pdf-download.test.ts apps/api/test/report-docx-download.test.ts
node --import tsx --test --test-concurrency=1 --test-name-pattern='^OSINT' apps/api/test/api.test.ts
PYTHONPATH=tests python3 -m unittest test_report_docx test_report_pdf_input test_report_verifier test_report_package test_tika_research
python3 tools/eval_source_family_copies.py /tmp/source146-artifacts
npm run typecheck
```

Local evidence: `/tmp/source146-focused-integrated.log`, `/tmp/source146-tika-sourceuse.log`, `/tmp/source146-unit-regression.log`, `/tmp/source146-company-regression.log`, `/tmp/source146-python.log`, `/tmp/source146-render.log`, `/tmp/source146-typecheck-final.log`; artifacts and renderer receipt under `/tmp/source146-artifacts`. Temporary fixtures and logs are not committed.

## Failed/blocked and remaining gates

- **Actual parser/native isolation blocked:** `python3 tools/qualify_tika_worker.py` failed because `docker` is unavailable. No native runtime acceptance, extraction quality, benchmark or parser qualification is claimed.
- **Actual browser failed before interaction:** browser-harness doctor found no running browser. Stock Chromium with its installed sandbox failed to enter the required namespace (`Operation not permitted`). The existing `real browser inspects OSINT captures` definition was actually run with `INVEOS_TEST_BROWSER=1`, and failed `Timed out: sandboxed Chrome startup`. No sandbox was disabled or bypassed. Meaningful browser acceptance remains required on an approved host. Logs: `/tmp/source146-native-gate.log`, `/tmp/source146-chromium.log`, `/tmp/source146-browser-existing.log`.
- Root-requested actual Field capture/grant → same immutable PDF → reviewed Tika composition/package → copied Field verifier → visible/redacted PDF/DOCX is the next focused case; not yet passed at this checkpoint.
- Root independently coordinates the combined platform suite and hosted acceptance. Provider terms/coverage/transport qualification and all live activation remain disabled. Unsupported formats remain rejected; pinned Tika scope remains PDF only.

New standalone verification helpers in this acceptance checkpoint: **none**. `tools/eval_source_family_copies.py` is an acceptance runner using existing copied helpers, LibreOffice and Poppler; offline-kit closure is unchanged.
