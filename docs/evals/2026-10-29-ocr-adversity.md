# Actual controlled OCR adversity evaluation — 29 October 2026

Implementation `a05e5c9f362c8552916349e8e0a737f34dc9a5a4` passed [Checks 40968344381](https://github.com/BlackStateGroup/inveos/actions/runs/40968344381), job 123778463949: **325 Node and 124 Python tests, zero failures/skips, 28 actual sandboxed browser journeys**. [Research 40968344362](https://github.com/BlackStateGroup/inveos/actions/runs/40968344362), job 123778463599, passed the actual isolated corpus, encrypted supplier/native/OCR/report/package/PDF/browser delivery, repeated raster and five daemon failure/isolation tests. Source/privacy changes and complete retained results were inspected. No new dependency, source copy or application processing-profile change.

[Machine receipt with exact TSV inputs](ocr-adversity-receipt.json) retains runtime/generator/extractor/runner fingerprints, original identities, repeated outputs, timing, metrics and supplier acceptance. The workflow retains the complete JSON artifact for 14 days; the repository receipt remains available afterwards. All successful raw-output digests match the preceding native run. The retained TSV digests and metrics were replayed without executing a parser.

## Measured results

Twelve controlled conditions were attempted twice: **14 attempts produced OCR output; 10 were rejected by the unchanged 65,536-byte original limit**. Every repeat had the same outcome and raw output (or rejection reason). No rejected input has an accuracy score.

| Condition | Original bytes | Outcome (each repeat) | Normalised word errors | Normalised character errors |
|---|---:|---|---:|---:|
| clean | 40,501 | Actual OCR | 0 (0.00%) | 0 (0.00%) |
| small_type | 24,479 | Actual OCR | 0 (0.00%) | 0 (0.00%) |
| low_resolution | 21,372 | Actual OCR | 0 (0.00%) | 0 (0.00%) |
| skew_plus_2 | 68,334 | Input-size rejection | Not measured | Not measured |
| skew_minus_2 | 68,039 | Input-size rejection | Not measured | Not measured |
| skew_plus_7 | 73,062 | Input-size rejection | Not measured | Not measured |
| low_contrast | 29,692 | Actual OCR | 0 (0.00%) | 0 (0.00%) |
| blur | 73,213 | Input-size rejection | Not measured | Not measured |
| jpeg_compression | 75,544 | Input-size rejection | Not measured | Not measured |
| speckles | 43,667 | Actual OCR | 7 (31.82%) | 21 (15.00%) |
| three_columns | 25,458 | Actual OCR | 0 (0.00%) | 0 (0.00%) |
| blank | 6,355 | Actual OCR | 0 (0.00%) | 0 (0.00%) |

The fixed speckle pattern produced seven inserted normalised words (29 observed against 22 reference words), with 31.82% word error and 15% character error. No numeric tokens were missing or unexpected under the declared normalisation. This does not validate punctuation, table meaning or all numerical interpretations. Other accepted nonblank conditions matched their normalised reference; the blank page emitted no words. These are small generated English fixtures, not representative client accuracy.

## Failures found and honest limits

Research 40965628205 completed but console truncation hid the new measurements. Artifact retention corrected that reporting defect. The first retained run 40967439173 exposed a reader error: a literal OCR quote was interpreted as CSV syntax and swallowed later TSV fields. A deterministic test failed before correcting both research readers to literal TSV quote handling. The application OCR validator already used literal fields and is unchanged. **Earlier speckle scores are invalid**, not a measured OCR regression. Exact TSV inputs now allow this boundary to be inspected.

Checks 40965628365 timed out in the unchanged lifecycle browser test and then reached the aggregate deadline. No passing receipt is claimed for that run. Step diagnostics were added without extending deadlines; subsequent Checks 40967439153 and 40968344381 passed every lifecycle step. The intermittent timeout is not root-caused or labelled fixed.

The measurement harness deliberately accepts measured adverse errors and reports profile rejections; its green status does not mean all conditions are accurate or supported. Skew, blur and compression conditions need a separately versioned larger profile or different controlled inputs before their recognition quality can be measured. Runtime package-archive closure, pinned-source comparisons, Tika/OCRmyPDF, multilingual/handwriting, representative performance and independent professional/security/privacy/legal/licence approvals remain open. The product and production readiness remain incomplete.
