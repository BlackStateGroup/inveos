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

Retain this renderer as an isolated research prototype until actual output and geometry are verified. The application extraction profile remains unchanged. A future raster job needs its own versioned profile, immutable output bytes/lineage, authorisation and lease fencing, safe image delivery and overlay tests. Original PDF bytes must never be rendered directly in the API. Forms/annotations, rotated/cropped/encrypted/malformed/hostile documents, font fidelity and multilingual cases need separate qualification. Human-reviewed citations, exports and runtime licence/security approval remain open.

Rollback removes these first-party scripts/tests/workflow step and licence hash inventory; no schema migration, merge or deployment. Fictional fixtures only.
