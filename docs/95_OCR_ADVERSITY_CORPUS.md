# Controlled fictional OCR adversity corpus

This increment is in progress. Definition/metric tests are not parser benchmarks. Research 40965628205 at `ef069b6` completed native execution, but the oversized stdout log truncated before its new measurements. The workflow now retains full JSON artifacts plus a compact summary; an inspectable rerun is required before quality claims. Exact commit/run/results belong in the evaluation receipt.

The existing pinned English OCR worker profile is exercised against twelve first-party fictional conditions, each repeated twice: the known clean supplier scan, small type, lower raster resolution, +2°/−2°/+7° skew, low contrast, blur, JPEG compression, fixed-seed speckles, a simple three-column work record and a blank page. No new parser, language model, third-party data set, font file or runtime package is added. The existing audited/hash-locked Pillow and PDFium wheels and Tesseract image content lock still gate execution.

The harness uses the unchanged `run_ocr_document.extract` function inside the qualified read-only, networkless, unprivileged container. Input/page/pixel/PNG/output bounds and individual subprocess deadlines remain unchanged. The container has its own 165-second kill deadline, and its configuration and cleanup are checked. Host-side tests import only first-party definitions and metrics, never native runtimes. No isolation restriction is bypassed.

Each case records fictional source identity, original byte count, generator/runner/extractor fingerprints, render identity and two attempts. Successful attempts retain the actual raw-output digest, elapsed time, normalised text, edit counts/rates, missing and unexpected numeric tokens. Rejected attempts have **no confirmed OCR output and no accuracy score**. Only the extractor’s explicit input/page/dimension/PNG limit errors are recorded as profile rejections. Process failures and malformed output fail the experiment. Profile rejection, repeat stability and measured quality are separate results. Clean-baseline regression or differing repeated fixed output fails the harness; adverse conditions receive measurements, not invented accuracy thresholds.

The declared metric uppercases ASCII letters/digits and excludes punctuation; it therefore cannot measure punctuation fidelity or multilingual accuracy. Edit rates may exceed one because insertions count. Missing/extra numeric tokens expose mistakes in the declared dates, durations or ownership values. They do not validate document meaning or reconstruct a table’s semantics. Blank-page output is measured against an empty reference, so invented words remain errors rather than receiving a vacuous pass.

Run only on a qualified worker host, after preparing the existing pinned artifacts as described in the research workflow:

```sh
python3 -m unittest discover -s tests -p test_ocr_corpus.py -v
python3 tools/experiment_tesseract_supplier.py --case-acceptance --adverse-corpus
```

The latter is an actual parser/worker experiment; it requires the existing disposable PostgreSQL/browser acceptance setup and intact worker isolation. The repository Research workflow performs this execution and the existing supplier/worker-failure checks. Unit metrics alone never satisfy it. Source copies/artifacts stay in ignored `.research-cache`.

Controlled English generator transforms are not representative real client scans. Multilingual, handwriting, realistic scan distributions, semantic table reconstruction, Tika/OCRmyPDF and pinned-source comparisons, complete package-archive/direct/transitive/model/data obligations and independent professional/security/privacy/legal/licence approvals remain open. No production suitability or admissibility is implied.


Measurement review found that the first retained run's speckle score included later TSV columns after a quoted OCR token. A failing regression demonstrated CSV quote interpretation; the research readers now treat quote characters literally, matching Tesseract's [tab-separated output](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html#tsv-output). Application lineage parsing already handles literal fields and is unchanged. Retained successful attempts now include exact TSV bytes and digests so metrics can be replayed without running a parser. Do not cite the superseded speckle scores from Research 40967439173. The corrected native run is still required.
