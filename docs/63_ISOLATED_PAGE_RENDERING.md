# Isolated original-page rendering research

29 October 2026. Continues PR #53. No application renderer or new shipping dependency.

A separate first-party experiment uses pypdfium2 5.14.0 and Pillow 13.0.0 already present in the hash-locked native runtime. The existing wheel, ELF and image-provider audits still apply; no runtime pin changes or source redistribution. Actual wheel licence files were inspected and their hashes recorded in research/runtime_artifacts/render-licence-files.json. PDFium includes component-specific terms beyond wrapper BSD/Apache labels; Pillow declares MIT-CMU and bundled component notices. This inventory is not legal/security approval or a complete resolved SBOM.

The qualified non-root, no-network, read-only container receives fictional originals. It renders at scale one in greyscale, without forms or annotations, to bounded PNG derivatives. Original bytes/hashes are checked separately. Maximum original 65,536 bytes, two pages, 2,048 pixels per dimension, two million pixels per page and 262,144 PNG bytes per page. A 30-second in-container deadline, host bounds and confirmed cleanup apply. Nonzero rotation, non-origin media boxes and different crop boxes are rejected rather than inventing overlay transforms. The native allocation follows geometry checks; these bounds do not prove hostile-parser exploit resistance.

The experiment runs twice, comparing exact PNG hashes, original identity, page numbering and dimensions. Known fictional raster placement checks top-left pixel mapping; blank and digital-text bounds are checked separately. Malformed, oversized and excessive-page inputs must fail. Generated PNGs are included as base64 in bounded research stdout for visual inspection, not installed in application storage.

## Reproduce

After the existing source, locked-wheel and pinned-image build/qualification steps:

```sh
python3 -m unittest tests.test_pdf_render_limits -v
timeout 180s python3 tools/experiment_pdf_render.py
```

The research workflow runs this alongside existing native parser/worker acceptance. Local Docker is absent, so unit tests alone are not rendering evidence. Actual hosted result is recorded in the follow-up receipt.

## Integration decision and remaining work

The observed results support this renderer as a candidate for the narrowly bounded, origin-zero research page profile. Keep it isolated; broader fidelity and security remain unqualified. The application extraction profile remains unchanged. A future raster job needs its own versioned profile, immutable output bytes/lineage, authorisation and lease fencing, safe image delivery and overlay tests. Original PDF bytes must never be rendered directly in the API. Forms/annotations, rotated/cropped/encrypted/malformed/hostile documents, font fidelity and multilingual cases need separate qualification. Human-reviewed citations, exports and runtime licence/security approval remain open.

Rollback removes these first-party scripts/tests/workflow step and licence hash inventory; no schema migration, merge or deployment. Fictional fixtures only.

## Verification and concurrency repair

Hosted [research #21](https://github.com/BlackStateGroup/inveos/actions/runs/40818453460), job 123265007029, passed at `840cb55d119d55b09a644b1ef5e83e3e1974342b`, tree `30052dab77b4c2fe3ca5c38278c9075770395298`: two identical isolated rendering runs covering digital, mixed, blank and raster pages; malformed, oversized and excessive-page inputs rejected; originals unchanged; cleanup confirmed. Digital PNG 612×792, 3,567 bytes, SHA-256 50e3726dbc53662c02291c03b3800b2d22d4f75d35f8bacfb7b0d48181de94ce. Text and checkerboard PNGs visually inspected. Existing native parser experiments and four actual Docker/PostgreSQL worker tests also passed. [Checks #140](https://github.com/BlackStateGroup/inveos/actions/runs/40818453450), job 123265007335, passed 170 Node tests and 101 Python tests, zero failures/skips, lint/types/build/reference, browser/restore and isolation checks. Local lint/types, Python compilation and all 101 Python tests passed; local Docker absent. See research/runtime_artifacts/render-receipt.json. Follow-up changes evidence documentation/receipt only.

Initial research run #20 exposed unsupported context-manager use on native page/bitmap objects; explicit closing now releases both handles. Initial Checks #139 exposed a real PostgreSQL cancellation/renewal deadlock: HTTP took the case then job lock while workers took job then case. Worker claim, dispatch, renewal and attachment now take the case share lock first. A regression test observes the database lock wait and confirms a case-owning cancellation transaction can still acquire the job with NOWAIT. The original cancellation/subprocess test and the new regression both pass. These failures are recorded rather than treated as transient retries. No migration or authority-check removal. Rollback of the lock-order change would reintroduce the deadlock risk.
