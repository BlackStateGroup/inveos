# Pinned CPU speech research

This increment builds and measures the catalogue's exact whisper.cpp candidate. It does not add an application dependency, ingest live audio, create a reviewed transcript or approve model/runtime distribution. The existing supplied-transcript/correction/review workflows remain unchanged.

## Source reuse and execution boundary

Source revision `231638a0717b7822784297e5980965ffcec05810` is acquired into ignored research cache. The library and GGML CPU sources are reused without rewriting their implementation or claiming ownership. A first-party C++ harness calls the public Whisper API. It accepts only canonical mono PCM16 little-endian WAV at16000Hz, up to30seconds, and emits reported segments as unreviewed output. No upstream CLI/audio codecs, server, downloader, GPU, vendor BLAS, OpenMP or extra backend is included. Original waveform bytes are not resampled inside inference; the separately documented fictional-fixture generator performs its own explicit conversion.

The first-party CMake harness selects the pinned libraries as a subproject and disables optional network/backend features. Source snapshots come from pinned Git objects with strict regular-file/name/size limits and SHA-256 manifests. The actual158-file selected snapshot is6,548,476bytes at the initial checkpoint. Source files retain their own notices. Root MIT, Mozilla/llamafile MIT and the embedded YaRN attribution are preserved in the private research runtime image; compiling or adapting code does not remove those obligations.

Builder and runtime images use a fixed linux/amd64 Python/buildpack base manifest/configuration. Image assembly has COPY only; no upstream build or installer runs in Docker build. Compilation runs twice in separately inspected containers: non-root65534, read-only root/originals, no network/capabilities/privilege escalation/daemon logging,0.5CPU,1GiBmemory with no extra swap,32PIDs and bounded no-exec tmpfs. The CMake executable lives in the read-only image. Compiled scratch artifacts are exported as bounded bytes; they become executable only after COPY into a separate read-only runtime image, which must pass the existing destructive host probes. No isolation flag is relaxed to accommodate native compilation.

Actual compiler versions, all base package versions, ELF dynamic dependencies and runtime library/copyright-file hashes are retained. These inventories do not prove complete base source closure, reproducibility of GCC/CMake, a clean security audit or licence approval. Native builds must match byte-for-byte across two runs. Runtime images and third-party binaries/models remain private to the disposable research host/cache; CI uploads receipts and fictional outputs only.

## Exact model and tool inputs

`research/runtime_artifacts/whisper-research-inputs.json` locks8 artifacts by exact size/SHA-256 and records the source/model/terms/base revisions. Explicit `--fetch` uses bounded HTTPS with restricted redirect domains; ordinary execution is offline and refuses missing/tampered/symlinked cache entries. It records all158 selected source hashes and12 CMake notice-file hashes, including file-specific third-party notices. The compiler archive contains8,035regular files/157,939,397expanded bytes and is parsed with expansion/path/type limits before use.

- Converted `ggml-tiny.en.bin`: model repository revision `5359861c739e955e79d9a303bcbc70fb988958b1`,77,704,715bytes, SHA-256 `921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f`. Actual model card declares MIT. Its conversion/source-to-weight chain has not been independently reproduced.
- Original Whisper terms/README/model card: revision `86098128c0b4f24f0e2aa2994de830614b474227`. Actual MIT licence and the README's coverage of code/model weights were read. The model card identifies possible hallucination, uneven recognition and evaluation limits; this experiment is not evidence of individual identity, intent, truth or reliable exact timings. See [upstream terms](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/LICENSE) and [model card](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/model-card.md).
- CMake3.31.8 linux-x86_64:55,012,213bytes, SHA-256 `630615d8e98ac33eba7fbe472626dff5c899c85af3c024585ae109166a6909d0`. Actual release checksum and bundled root copyright agree. Root BSD3 and bundled third-party notices were inspected, including MIT/curl/0BSD/libarchive/file-specific XZ terms; the archive also contains an LGPLv3 licence file. This is not a blanket BSD-only assertion.
- Compiler/runtime base: `python@sha256:77c90594edb5d6a43ed73de1c73b5f9d795bc94fa76d438fba4cc00036100014`, configuration `sha256:a09cf88e765a0752a769b1eaf5b3d47034ff846e32da48258646f80c63e120fb`. Resolved from the official linux/amd64 manifest. The first successful actual inventory is recorded below.

## Fictional speech and measurement

Two committed fixtures contain generated formant speech: a fictional supplier-carton statement and an explicitly uncertain fictional ownership statement. No person was recorded or cloned. `tools/speech_fixture.py --generate` used host-only Debian arm64 eSpeak NG1.51 (`1.51+dfsg-10+deb12u2`) with en-gb/150words per minute, then deterministic integer linear interpolation to16000Hz. The byte receipt preserves generator binary SHA, exact text, sample counts, duration basis and output hashes. CI verifies these committed bytes; it does not install or regenerate speech.

Actual eSpeak package copyright files were inspected before use: GPL3+ with Apple/NetBSD file exceptions. The linked Sonic package declares Apache2.0. The pcaudio Debian copyright has inconsistent GPL/LGPL wording and a named BSD clause whose text differs; retain that uncertainty for any future redistribution. The generator is a test-host tool only; its binaries, dictionaries and code are not copied into the app or committed fixtures. Wider host dependencies are not asserted cleared.

Actual recognition is designed to run twice for each of five conditions: two clean generated utterances, silence, attenuation and deterministic added white noise. The receipts preserve raw segments, reported offsets, original/model/binary identities, wall time, word edit counts and normalised word-error rate. Silence separately counts invented words. Out-of-range/overlapping offsets are flagged, never silently corrected. Repeated greedy output is compared. These five artificial conditions cannot establish representative human/field/accent/language/noise accuracy or speaker attribution.

The real runner must reject truncated, wrong-rate and oversized PCM before model inference. A forced short deadline must remove its specific container; it may cancel before model initialisation. Existing actual host probes separately exercise failure/isolation. Durable API jobs/leases, audio derivative provenance, original playback/time-linked review, correction/export integration and representative professional acceptance remain to build after candidate evaluation.

## Current verification and failures

Initial acquisition downloaded the locked artifacts, then the source-snapshot command exceeded the shared subprocess tool's16MiB output setting. It was corrected to enumerate/read bounded pinned blobs, excluding unused backends; no shared bound was raised. A fresh cold acquisition and independent offline replay then produced identical receipts. Nine first-party protocol/boundary tests pass, and the full foundation suite passes197Python tests. Workflow syntax and Python compilation pass. These are not ASR benchmarks.

At the initial checkpoint actual native compilation, recognition, runtime inventory and malformed/cancellation acceptance were unrun; subsequent evidence is recorded below. The new `Pinned Whisper speech research` workflow supplies the qualified amd64 host. The local host's isolation/profile limitations are not bypassed. Preserve any subsequent failed build, model or runtime results alongside successful receipts.

PR111 resulting-main41034879256 / job123993156129 passed452Node/188Python,zero failures/skips,45production+8development browsers,both office profiles,unchanged host/lint/types/build at merge `5b65794d3df8f355565e1576d4d5dca216669cc3`.

## Reproduce

```sh
python3 tools/mine_sources.py --fetch ggml-org/whisper.cpp
python3 -m tools.whisper_research_inputs --fetch --output .research-cache/whisper-inputs/cold-receipt.json
python3 -m tools.whisper_research_inputs --output .research-cache/whisper-inputs/offline-receipt.json
cmp .research-cache/whisper-inputs/cold-receipt.json .research-cache/whisper-inputs/offline-receipt.json
python3 -m tools.speech_fixture
python3 -m unittest tests.test_whisper_research -v
# Qualified disposable amd64 Docker host only:
docker pull python@sha256:77c90594edb5d6a43ed73de1c73b5f9d795bc94fa76d438fba4cc00036100014
python3 -m tools.build_whisper_research
python3 -m tools.experiment_whisper
```

No production activation, external collection, communication, purchase or source/model distribution approval is implied. Application incorporation needs its own typed derivative/authority/lease/review integration and actual acceptance; production/legal/security/model-data/distribution gates remain open.

Speech research draft #112 initial head860ed77010f72c04743b8587c90f95d853f52763: Research41038015783 / job124003574412 failed when the build caller requested600seconds, exceeding the shared300second process bound. Native compilation/inference did not run. The caller now uses300seconds without changing any shared isolation/resource limit. Transcript stdout/stderr decode strictly as UTF-8 and retain original byte digests; invalid bytes are not silently replaced. Builder/runtime probe receipts are retained independently if a later stage fails. Corrected hosted acceptance remains pending.

At head `87cfa204f5188583352edfe6c392052ff94d8dae`, **Research41038486859 / job124005118712 passed** actual two isolated native builds, both destructive host profiles,10 CPU inference runs (five conditions twice),three native malformed-input rejections and short-deadline container cleanup. Artifact12968853335 was inspected. The two2,111,080byte executables match SHA-256 `e372f264c6fda90c64c88f858f023a31fd1bcc00af77b20ae1d4da94bbcb66fe`. GCC/G++ report Debian12.2.0-14+deb12u1; runtime inventory identifies/hashes libc6,libgcc-s1,libstdc++6 and the loader with actual copyright-file hashes. Full base source/licence closure is not established.

Repeated outputs agree, including limitations: clean supplier3/9 word edits (33.3%), uncertainty0/9, attenuated supplier4/9 (44.4%), noisy supplier5/9 (55.6%). The simple tokeniser counts `twelve` versus `12` as an edit. Silence emits `[BLANK_AUDIO]`, counted as two tokens by that tokeniser, with a0–10000ms range on a3000ms clip; the range check correctly flags it false. This marker is not evidence of two spoken or hallucinated lexical words. Speech ranges fall within the clip but alignment accuracy was not independently established. These artificial English cases do not qualify human speech accuracy or application incorporation.

**Checks41038486863 / job124005508263 passed452Node/197Python,zero failures/skips,45production+8development browsers**,office/host/lint/types/build. Initial Checks41038014831 was automatically cancelled on the correction push, not passed. Output review additionally changed the128KiB JSON bound to count strict UTF-8 bytes and added duplicate/nonfinite/type/Unicode/path rejection assertions; all9 focused protocol tests pass. Final changed-head hosted acceptance remains pending.
