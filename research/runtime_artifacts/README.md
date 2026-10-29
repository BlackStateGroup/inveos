# Docling native-PDF artifact acquisition — 28 October 2026

Status: acquired and inventoried for research; **not installed, executed, integrated or approved for redistribution**. The original source decision remains in draft PR #2. This slice preserves the application and its case/evidence/authority architecture.

The source pin `90234a71b16785d08fd2f46ec62668dd2396db76` declares `docling-slim` 2.142.1. Its actual extras are `convert-core` and `format-pdf`; `pdf` is not an extra. An initial wheel-only `docling-slim[pdf]` request warned and acquired only the base closure; it was not used as the selected closure. Both caches stay ignored. No upstream setup hooks, imports or parser code were executed.

The corrected acquisition resolved **47 wheels, 100,781,410 bytes**, for this CPython 3.12 Linux x86-64 environment. `docling-native-cp312.lock` binds exact selected wheel hashes; it is a research acquisition lock, not a product dependency lock or proof that every native pipeline import is satisfied. `docling-native-cp312.json` records declared requirements, Python bounds, extras, licence declarations and SHA-256/size of notices inside each wheel. It is not a complete native-component SBOM, vulnerability clearance or legal approval. No wheel/source/notice text is committed.

## Material findings

- Native pipeline and PDF backend bytes match the pinned checkout. **The converter does not match.** `docling-source-comparison.json` records both hashes for three inspected files; it is not whole-package equivalence. At the pin, conversion rejects a source yielding multiple documents; the wheel returns the first result. Do not use this same-version wheel as proof of testing the pinned source or silently accept incomplete extraction. Build the exact pin in a qualified isolated builder, or explicitly select and audit another revision before benchmarking.
- Root MIT labels are insufficient. The selected closure includes certifi MPL-2.0; tqdm MPL-2.0 AND MIT; pypdfium2 declares BSD/Apache plus dependency terms and includes 18 licence/notice files, including PDFium, FreeType, ICU, JPEG, PNG and other bundled components. NumPy and SciPy wheels also bundle multiple component notices. The inventory hashes nested notices rather than assuming only a root LICENSE exists.
- `latex2mathml` declares MIT but no notice was found by this scanner. Missing notice detection is a review flag, not a conclusion that permission is absent. Rtree and compiled libraries require native dependency inspection beyond Python metadata. All entries retain unreviewed status.
- The existing Docker host probe passed in PR #33. That does not qualify these wheels or a new parser image. Local Docker is absent; no unsandboxed installation/import was attempted. No model weights or OCR language data were acquired in this selection.

## Reproduce without installation

From the repository root on the same Python/platform target:

```bash
python3 -m pip download --only-binary=:all: --dest .research-cache/docling-native-cp312 'docling-slim[convert-core,format-pdf]==2.142.1'
python3 tools/audit_runtime_wheels.py .research-cache/docling-native-cp312 --output research/runtime_artifacts/docling-native-cp312.json --lock research/runtime_artifacts/docling-native-cp312.lock
python3 -m unittest tests.test_runtime_wheel_audit -v
```

The first command resolves current ranges and may change future selections. To reproduce **these artifacts**, use a fresh ignored directory with `pip download --only-binary=:all: --require-hashes -r research/runtime_artifacts/docling-native-cp312.lock --dest .research-cache/docling-locked-cp312` on the same target, then compare inventory hashes. Do not install or execute before runtime review/isolation qualification. A missing wheel or hash mismatch must fail, not fall back to source builds.

The scanner reads ZIP metadata and notices without extracting/importing. It rejects unsafe paths, duplicate entries, ambiguous metadata, duplicate distribution targets and oversized selected metadata. Four synthetic tests exercise these failures and nested-notice discovery. Metadata assertions remain upstream claims; the source comparison must be independently repeated when changing the pin/artifact. This slice has no migrations or application changes; rollback removes the audit tool/tests/inventories. Next: exact-source isolated build, full dependency/native notices and vulnerability review, bounded runtime/output tests, then digital-PDF fixtures and actual source-reference benchmarks. Tika/OCRmyPDF benchmarks, human page/region integration and broader product gates remain open.

## Verification receipt

[Hosted Checks run #87](https://github.com/BlackStateGroup/inveos/actions/runs/40674249770) passed at `541c3a69f449676dd65473ce1aee5d992c13d2ad`, tree `e579c026338461881904780a985c4ffafad9ad12`: 123 Node tests with zero skips/failures, 49 Python tests, lint/types/build/reference and actual host-isolation probes. Locally, a fresh ignored directory was populated with `pip download --no-index --find-links .research-cache/docling-native-cp312 --only-binary=:all: --require-hashes -r research/runtime_artifacts/docling-native-cp312.lock`; re-audit reproduced the inventory and lock byte-for-byte. This proves the acquired closure can replay, not that it imports, parses documents or satisfies the selected pipeline.

## Exact-source follow-up

See [the pinned build experiment](PINNED_BUILD.md) for the isolated packaging path and its separate verification status. It does not install or approve the 47 parser runtime wheels listed here.
