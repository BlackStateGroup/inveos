# Reduced pinned Tika PDF comparison

This is an isolated research increment for work package WP-03. No Tika code, JAR, font or JDK is added to the application runtime. Actual parser acceptance is pending; static checks and generated output fixtures are not parser benchmarks.

## Inputs and reuse decision

Use the catalogue's Apache Tika revision `f45b9498f35d55445af28737407586362b2e37fc` (source version `4.2.1-SNAPSHOT`), compiling the annotation declarations, core, PDF and XMP modules with Java 17. The first-party wrapper explicitly disables OCR, embedded parsing, page emission, actions, annotations, bookmarks and form extraction. No Maven plugin, annotation processor, upstream test or install script runs. Source copies and built artifacts remain ignored.

The reviewed POM selection resolves **18 JAR/source pairs, 66 files and 29,072,338 bytes** from the official Maven Central HTTPS endpoint. `research/runtime_artifacts/tika-research-artifacts.json` records actual hashes, sizes, POM parents, dependency edges, inherited licence declarations and embedded notice hashes. The verifier can reconstruct the same bounded POM graph offline against the clean pinned checkout. This is a deliberately limited resolver for the selected modules, not a general Maven replacement. Dependency profiles are recorded but not activated; the observed Commons IO benchmark and Secure XML native-Xalan profile dependencies are tests. Optional/provided transitive and test dependencies are excluded; directly declared provided OSGi compilation dependencies remain explicit.

Actual JAR notices were inspected: Apache-2.0 for Commons, PDFBox and OSGi; BSD-2-Clause for CommonMark; MIT terms for SLF4J and Bouncy Castle. The Bouncy Castle BOM version is `1.86.2`, but it selects these four artifacts at `1.86`; do not substitute the BOM number for their versions. Picocli lacks an embedded binary licence: its corresponding source `picocli/CommandLine.java` carries Remko Popma's 2017 Apache-2.0 header. Retain source copies and terms; this is not permission to distribute the binary without satisfying notices.

Tika's complete root licence/notice and core appended licence are retained in the research build. Its aggregate notices include additional components/data terms (including Darwin MIME, ICU, IPTC and PRONOM); root Apache metadata alone is not a complete file-specific approval. The assembly description is retained as an audit input but never executed. Broader-parser jhighlight and other aggregate components are not silently added to this classpath. Formal licence/distribution, vulnerability and security acceptance remain open.

The JDK image is pinned to linux/amd64 manifest `eclipse-temurin@sha256:1d4fdea2c842d8830bfb34fe4f0faf9bdad8432f79c7d1a117f1f3ee4ad46e5b`, expected configuration `sha256:afe7545835fa902a51fb04410ff9834250b314666516dbdef649942dd6ab0034`. Discovery verified registry manifest/configuration hashes. This does not authenticate publisher signatures or provide a full source/licence closure for the JDK/base image. No shipping approval is implied.

## Reproduction on a qualified disposable host

```bash
python3 tools/mine_sources.py --fetch apache/tika
python3 tools/tika_runtime_artifacts.py --fetch --source .research-cache/sources/apache/tika --lock research/runtime_artifacts/tika-research-artifacts.json
python3 tools/tika_runtime_artifacts.py --source .research-cache/sources/apache/tika --lock research/runtime_artifacts/tika-research-artifacts.json
docker pull eclipse-temurin@sha256:1d4fdea2c842d8830bfb34fe4f0faf9bdad8432f79c7d1a117f1f3ee4ad46e5b
python3 tools/build_tika_research.py --source .research-cache/sources/apache/tika
python3 tools/experiment_tika_pdf.py --source .research-cache/sources/apache/tika
```

Both execution tools first run the existing actual isolation/failure probes. Their containers are non-root, networkless, read-only, capability-free, with bounded memory, CPU, processes, no-exec scratch/output, deadlines and output. Input is a single read-only bundle. Each tool inspects enforced configuration and removes its own containers on failure. Builds run twice with fixed archive timestamps and require byte-identical output. The wrapper bounds original bytes, pages, extracted content and metadata, preserves the original hash, and measures actual process CPU, parse time and peak RSS.

The experiment runs each of seven fictional cases twice: repeated digital text, mixed text/blank/checkerboard, raster-only, blank-only, malformed PDF, wrong signature and oversized input. Successful output must account for every expected page and exact known page text; missing text stays explicit. Repeated extracted page references must agree. Offsets refer to normalised derived page text, not original PDF bytes. Raw XHTML hashes, resource measurements and metadata are retained alongside the receipt. No bounding-box or OCR accuracy claim follows from this corpus. The existing Docling corpus provides the separate native-text baseline; representative scans, languages, tables and long documents remain open.

The dedicated workflow uploads only receipts and fictional XHTML, not upstream binaries or source archives. Locally unsupported isolation must not be bypassed.

## Evidence and limitations

Actual cold artifact acquisition and offline POM/source graph replay passed: 18 pairs, 66 files, 29,072,338 bytes. Static source snapshot: 409 files, 2,780,002 bytes. All 173 Python tests and foundation/workflow validation pass. Nine new first-party boundary tests pass, covering tampering, missing sources, inventory/path/symlink/size errors, native or duplicate ZIP entries, unsafe XML, changed notices, page coverage and output identity. These do not execute or benchmark Tika.

Initial acquisition rejected Bouncy Castle's unnamespaced POM, then OSGi's whitespace-padded model version. The parser now accepts those actual valid forms while rejecting mixed namespaces and entities. The first source-bundle attempt rejected core appended licence/assembly files; they are now retained explicitly. No parser or compiler ran during those failures.

Actual isolated compilation, repeated parser runs and resource measurements are pending hosted qualification. Runtime/licence approval, integration, OCR, representative quality and production readiness remain unmet.
