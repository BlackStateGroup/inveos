# Source family acceptance and hosted Tika worker fixture

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
- The initial checkpoint did not yet include the requested Field supplied-PDF case. It is now passed as recorded below.
- Root independently coordinates the combined platform suite and hosted acceptance. Provider terms/coverage/transport qualification and all live activation remain disabled. Unsupported formats remain rejected; pinned Tika scope remains PDF only.

New standalone verification helpers in this acceptance checkpoint: **none**. `tools/eval_source_family_copies.py` is an acceptance runner using existing copied helpers, LibreOffice and Poppler; offline-kit closure is unchanged.

## Field supplied-PDF acceptance completed

The second focused run passed **18 tests, zero failures/skips**: research API/CLI/report (10), Tika raw/citation contracts (2), and Tika report/source-use/Field (6). Command is the integrated command above; log `/tmp/source146-final-integrated.log`.

The Field scenario uses actual device registration, an actual prepared versioned case grant, current Field context and `supplied_file` capture of the same immutable `digital_pdf()` bytes. A retry returns the same capture receipt. Original download equals the fixture byte-for-byte. This is a supplied PDF, not an opaque Field note coerced into a text finding. Source time, declared capture time, uncertainty, acceptance and server receipt remain distinct.

The separately labelled synthetic Tika contract then passes independent correspondence and interpretation review, explicit selected composition review and report freeze. The v2 package contains the exact original PDF and one frozen Field provenance record with original/capture IDs, historical grant and acceptance. Copied `verify_document_package.py` reports one Tika finding and one Field capture; copied `verify_field_provenance.py` also runs directly with the exact exhibit length. Rehashed expiry tampering is rejected. Later case authority prevents retrieving a newly revalidated package or accepting current source verification.

Actual API PDF/DOCX copy creation/download, copied standalone PDF/DOCX verification and LibreOffice/Poppler rendering pass for both visible and whole-finding-redacted variants. Final render receipt covers **20 rendered copies across five fixture families** and is retained in `docs/146_SOURCE_FAMILY_RENDER_RECEIPT.json`. Visible Field provenance is checked; redaction excludes capture/device/grant IDs and source/manifest/provenance fingerprints. Visual inspection includes the Field provenance page and redacted copies. Logs: `/tmp/source146-tika-field.log`, `/tmp/source146-field-render-final.log`; artifacts: `/tmp/source146-artifacts/tika_field` and `/tmp/source146-artifacts/source-family-render-receipt.json`.

The first Field test attempt had a test-only assumption that an exhibit contains `evidenceId`; the identity is correctly bound through its paired finding. A renderer assertion initially failed because Poppler's default text reflow deletes hyphens at line endings. Inspection of the actual page showed the full grant ID; extraction now uses `pdftotext -layout` to preserve those glyphs. No report renderer or Field implementation changes were necessary. There are no additional application fixes beyond checkpoint `fb4461df8f22bacdb42c9522b957d808bac30488`.

## Actual application-worker fixture for root's existing qualified Ubuntu job — unrun locally

New test: `apps/api/test/tika-worker.integration.ts`. Its `.integration.ts` suffix keeps it out of ordinary `*.test.ts` runs. It never calls `finishTikaJob`, imports synthetic Tika contracts, fabricates qualification receipts, installs/builds dependencies or substitutes parser output. Missing/stale actual qualification or unavailable Docker fails the test rather than skipping it. Local compiler and lint checks pass; **native execution is unrun here**.

After the existing pinned source/runtime acquisition, repeated build and actual research experiment on the approved Ubuntu job, root should configure Node 22 and a disposable PostgreSQL service, then run:

```sh
npm ci --ignore-scripts
python3 tools/qualify_tika_worker.py
INVEOS_DEV_LAB=1 INVEOS_RESEARCH_TIKA=1 \
node --import tsx --test --test-concurrency=1 apps/api/test/tika-worker.integration.ts
```

Both database variables must be present in the step environment:

- `INVEOS_TEST_DATABASE_URL=postgresql://inveos_app:DISPOSABLE_PASSWORD@127.0.0.1:PORT/inveos_test`
- `INVEOS_TEST_ADMIN_DATABASE_URL=postgresql://SCHEMA_ADMIN:DISPOSABLE_PASSWORD@127.0.0.1:PORT/inveos_test`

Use the existing restricted-role bootstrap: application role `inveos_app`, NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOINHERIT; administrator may create/drop these temporary test schemas. Fixture creation migrates a fresh random schema and removes it afterward. Qualification must be generated immediately before the test (worker requires age <=15 minutes). Test code creates a temporary original store and passes schema/storage/database settings to the real CLI subprocess. No `.env`, additional service, runtime download or provider key is required by the test.

Four native test definitions require:

1. Two successful actual parses through `runTikaJob` and the real `run-tika-job.ts` CLI, durable exact raw/profile/derivative bytes, exact unchanged original and quarantine status, live lease exclusion/renewal, two exact pages, typed page-2 citation and independent correspondence review, immutable derivative enforcement, copied standalone context verification and rehashed byte substitution rejection. Rerunning a completed job must not parse again.
2. An actual malformed-PDF parser failure and a deliberately corrupted disposable original rejected before parsing; neither may attach output.
3. Cancellation and authority supersession **after a real application worker has acquired a live lease**, plus deliberately expired-lease recovery, with no stale attachment and no residual worker bundle/container. These assertions cover application lease fencing; they do not claim each cancellation happened after parser startup. Existing host isolation probes remain the distinct daemon/resource qualification.
4. Stale qualification refusal before claim and current-authority fencing before dispatch, with no parser/output attachment.

Success receipts and fictional preserved output are written to `output/evals/tika-application/` (`receipt.json`, per-invocation context/original/raw/derivative/verifier files). Root should upload that directory alongside existing research receipts. The receipt records two completed actual application parses only after both succeed; it is not a representative parser benchmark or production qualification. The independent helper deliberately continues to report `actualParserExecutionVerified: false`: integrity checking alone cannot attest execution.

Suggested root-owned workflow path coverage: `apps/api/src/tika-*.ts`, job/storage/lease/container modules, `apps/api/test/tika-worker.integration.ts`, `apps/api/test/support/source-family.ts`, `packages/contracts/src/tika.ts`, application migrations and lockfiles, plus `tools/prepare_tika_worker.py`, `tools/qualify_tika_worker.py`, `tools/verify_tika_context.py` and the workflow's existing pinned research/build/artifact paths. No CI or shared inventory files are changed by this branch.

Root reported 28 actual research-parser runs passing at `f4b6477c` (job 41079811397 / job 124145595815). This is supplied root evidence, not a local run, and does not qualify the new application-worker fixture. Browser startup remains blocked as described above. Hosted application-worker execution, browser interaction and broader root acceptance remain outstanding.
