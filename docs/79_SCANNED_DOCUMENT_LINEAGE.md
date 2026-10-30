# Scanned document lineage and supplier case acceptance

This research-only integration adds `tesseract_scan_lab_v1` to the existing durable scoped job system, with migration 030 and append-only document derivatives. Production/lab-off queueing denies the job. The trusted single-job worker requires a recent actual isolation qualification, verifies the selected runtime artifacts before parser imports, runs with the established daemon deadline/lease/cleanup controls and rechecks original bytes and authority at attachment.

## Preserved lineage

The immutable raw envelope contains the source SHA-256, actual immutable runtime image ID, frozen artifact-lock identity, and the exact base64 RGB PNG and TSV bytes for each page. No TSV is reconstructed from parsed words. The separate `inveos_ocr_document_v1` normalisation retains confidence, TSV row, pixel region, PDF-unit TOPLEFT region, exact UTF-8 offsets and render/TSV hashes. It never labels OCR offsets as original bytes or native Docling output. Every page stays unreviewed; missing text remains explicit and confidence is not acceptance.

Existing citations, independent correspondence review, proposed interpretations, finding decisions, report freeze, PDF review and disclosure controls are reused. The browser distinguishes OCR from native passages. The independent standard-library package verifier replays PNG/TSV/word geometry and all existing review/claim/decision links without an OCR or PDF parser. This proves byte consistency, not image equivalence, OCR accuracy, reviewer authentication or legal approval. Trust fingerprints through a separate channel.

## Selected artifacts and limits

`research/runtime_artifacts/ocr-wheels.json` selects exactly Pillow 13.0.0 and pypdfium2 5.14.0 from the prior audited hash-locked inventory. Their selected dependency metadata/notices are retained; no unconditional Python dependencies are declared. Native transitive/library and model terms still require the prior component-level review. The OCR bundle no longer copies Docling source or the other 45 wheels. The shared native experiment continues to use its own frozen profile.

`tesseract-baseline.lock.json` freezes the prior measured 161 installed versions and 58 native/model/provider-notice hashes. Each OCR job inventories inside isolation and fails on drift before extraction. Exact installed content is checked; Debian archive SHA/source closure and all provider-specific obligations are not thereby approved. The image is an isolated packaged-release research baseline, not catalogue source-head Tesseract or a shipping runtime. No third-party source/binary/model is committed or published.

The profile supports at most two integral, unrotated, uncropped PDF pages; 65,536 original bytes; scale-2 RGB; 2,000,000 pixels/page; 262,144 PNG bytes/page; 131,072 TSV bytes/page; 1,000 words total; English/PSM 6/144 DPI/single thread. Forms and annotations are omitted. Unsupported geometry/metadata, malformed/deep/duplicate-key output, unbounded pixels, substituted context/runtime and stale leases fail closed.

## Reproduce

Local first-party checks (do not execute parsers without qualified isolation):

```sh
npm ci --ignore-scripts
npm run lint
npm run build
python3 -m unittest discover -s tests -q
node --import tsx --test apps/api/test/ocr-derivative.test.ts apps/api/test/document-derivative.test.ts apps/api/test/raster-derivative.test.ts apps/api/test/document-package.test.ts
```

The existing `docling-build-research.yml` acquires pinned artifacts as ignored data, proves isolation, runs native extraction and qualifies the selected native image. Its OCR step builds the first-party Dockerfile and verified public Debian archives in a private context without network, narrows the wheel bundle, measures actual scan OCR and runs:

```sh
python3 tools/ocr_package_archives.py
timeout 600s python3 tools/experiment_tesseract_supplier.py --case-acceptance
```

The explicit case test requires the workflow's disposable PostgreSQL database, sandboxed host Chrome, built web assets, pinned caches and Docker qualification. It runs a separate one-page digital declaration and one-page scanned register, digital/native extraction and actual OCR twice; preserves quarantine/originals; exercises browser reload/inspection, independent scripted reviews, both alternative explanations, frozen two-source exhibits, separate Python verifiers, denied premature disclosure, exact PDF review/restricted fictional delivery/acknowledgement/revocation/restart and malformed-input rejection. Its role attestations are fictional automated tests, not actual professional human review.

For an explicit single scoped research job, the existing CLI accepts `INVEOS_DEV_LAB=1 INVEOS_RESEARCH_OCR=1` plus the documented local database/storage variables and exactly three tenant/case/job UUIDs. It reads `.research-cache/tesseract-worker-qualification.json`; there is no request-supplied image, command, background collector or new scheduler. The disposable controller removes its image tag afterwards, so requalify a retained research image before a separate manual run.

## Verification and rollback

Verified implementation `f57a05a082c35a89e6d3d29a55944bed4e0c6a8b`, tree `d41ea33e870f2cc5cf9cfd303c1938260d33cc45`, passed Research #35 (run 40910846123, job 123578071521) and Checks #202 (run 40910846195, job 123578072525). All 239 Node and 108 Python tests passed with zero failures/skips, alongside actual PostgreSQL/API/browser/host isolation, the actual OCR supplier journey, raster acceptance and five leased-worker tests. [Machine receipt](../research/runtime_artifacts/supplier-case-acceptance.json) includes exact original/runtime/raw/derivative identities and measured clean-fixture timings. The freshly reloaded browser decoded the same-original raster and selected its OCR region. Both reviewed findings retained differing record dates and alternative explanations; independent verifiers, exact restricted PDF delivery, acknowledgement, restart, revocation, negative scope and cancelled attachment passed.

Initial failures exposed an oversized combined fixture, stale expected migration names and a redaction reason on an unredacted PDF. Split the actual declaration/register records and corrected the tests while retaining the existing bounds and approval rules. No professional human, legal/licence/privacy, general OCR/pixel, device/offline or full-product acceptance is inferred. Structured question/hypothesis links to document findings remain the next supplier gap; legacy work links currently require original-UTF-8 claims.
Disable lab queueing and the explicit worker to stop new work. Preserve migration 030, immutable rows and raw artifacts. Older servers/verifiers do not understand the new kind/profile and must fail closed, rather than relabelling it native text. No destructive rollback or historical derivative rewrite.
