# Raster derivative validation boundary

29 October 2026. Continues PR #54. First-party Node validation; no PDF/native image parser imported into the API.

The narrow research profile freezes the already qualified image/wheel inventory, PDFium/Pillow versions, scale-one greyscale rendering and omitted forms/annotations. A result must match caller-supplied tenant, case, job, evidence, source hash and authority version. Original bytes are rehashed; numbered pages bind exact PNG bytes, dimensions and digests into a deterministic unreviewed manifest. Profile and manifest hashes are separate. Caller context remains trusted input, not authentication.

PNG validation permits only non-interlaced 8-bit greyscale IHDR, contiguous IDAT and terminal IEND. It checks lengths, CRCs, page dimensions and byte limits before bounded zlib inflation, then exact scanline length, filter values and full compressed-stream consumption. Metadata, animation, alternate colour formats, trailing content and additional streams are rejected. This is a restricted format validator, not proof that pixels faithfully represent the original. It does not reconstruct filters or render images. Pixel fidelity still depends on the qualified renderer and human review.

Limits remain 65,536 original bytes, two pages, 2,048 pixels per dimension, two million pixels per page and 262,144 PNG bytes per page. Canonical base64 and input length are required before decoding. No new dependency, storage migration, HTTP route or approval action is introduced. Rendering remains isolated; raster persistence, lease-fenced attachment, safe serving and page overlays are the next integration steps. This manifest is not the text-extraction derivative format and does not change existing citations.

## Reproduce

```sh
npm run lint
npm run typecheck
node --import tsx --test apps/api/test/raster-derivative.test.ts
# Following the existing qualified runtime acquisition/build steps:
timeout 180s python3 tools/experiment_pdf_render.py > .research-cache/render-output.json
node --import tsx --test apps/api/test/raster-native.integration.ts
```

The separate research workflow consumes actual PNGs from two isolated runs across digital, mixed, blank and raster fixtures, validates original identity and rejects altered image/source/case inputs. Ordinary unit tests generate tiny first-party PNGs; they are not parser or fidelity evidence. Hosted results are recorded in the follow-up receipt.

Privacy/licensing: fictional fixtures only; reuse existing research runtime inventory, no added upstream source or binary redistribution and no licence/security approval. Rollback removes validator/tests/workflow additions; no data migration. Durable raster storage/serving, human review, exports, broader rendering qualification and product gates remain open.

## Verification receipt

Draft PR #55 passed hosted [Checks #143](https://github.com/BlackStateGroup/inveos/actions/runs/40823812854), job 123282135535, at `a0166c066ba438c5c78a2c9fd76e787dd585315f`, tree `237e1c070b7c7c6a298337dca5a4161065d94eda`: 176 Node tests and 101 Python tests, zero failures/skips, plus lint/types/build/reference, existing browser/restore and isolation checks. [Research #24](https://github.com/BlackStateGroup/inveos/actions/runs/40823812851), job 123282135382, passed the separate actual raster boundary test across two isolated rendering runs and four fictional document types, including source/case/image tamper rejection and identical manifests. Existing exact builds, native parser experiments and all four actual Docker/PostgreSQL worker tests also passed. Local lint/types, six adversarial/manifest tests and all 101 Python tests passed. Follow-up records documentation/receipt only. No fresh application image-delivery, citation approval, device or production qualification is claimed.

Context fields are explicitly selected in a fixed order; equivalent property orderings produce identical manifests, and unrelated caller metadata is excluded. Machine receipt: research/runtime_artifacts/raster-boundary-receipt.json.
