# Preserved audio, recognition and reviewed interpretations

Status: connected implementation in progress on `feat/media-transcripts`, based on main `bbef17122056fa574bf9288963d3d70e815a3e4a`. It is not merged or accepted. This is a bounded fictional research workflow, not production transcription or representative accuracy qualification.

## Connected behaviour

A quarantined original retains its bytes, source time, ingest time and versioned authority. An explicitly enabled speech job runs only on a freshly qualified isolated worker. The locked whisper.cpp/model/runtime profile is the candidate qualified in [118](118_WHISPER_RESEARCH.md). No model executes in the API or browser. No new application dependency is added. Raw recognition and reported ranges are immutable; invalid ranges are retained and flagged, not silently repaired.

The investigator can play the preserved PCM, retain attributed corrections (including explicit no-speech), inspect old versions and obtain a separately recorded independent audio-correspondence decision. A proposal quotes precise UTF-8 bytes of one accepted account. A second, separate interpretation decision creates a finding. The requester, proposal author and correction authors cannot independently accept that interpretation. Correspondence and interpretation may be assessed by the same otherwise independent reviewer, as two separate records; this is not a claim of two distinct human reviewers.

Migration059 adds immutable derivatives/corrections/correspondence decisions. Migration060 adds immutable proposals, interpretation decisions, findings and withdrawals, with compound tenant/case/job/version/correspondence references. Current case membership is checked after acquiring the case lock. New corrections, proposals and accepted decisions require an open active/review stage and current authority. Withdrawals preserve all preceding records.

Frozen reports embed original audio, exact raw recognition, the fixed profile, correction history, correspondence context, proposal and interpretation review. Later correction or withdrawal prevents re-verifying/releasing the old finding as current; retained report bytes remain unchanged. Source-use checks include speech in analysis and release. PDF/DOCX composition and whole-finding redaction include the new source family. The offline exhibit format is v3 for speech, retaining the audio original separately and recording the meaning of text offsets. Existing v1/v2 behaviour remains supported.

The interface connects completed processing jobs to the exact transcript, explicit playback, correction/history/review, proposals, source inspection, withdrawal and report composition. Playback rechecks original access/hash each time. Browser playback progress is approximate; it does not establish hearing, microphone fidelity, physical device performance or speaker identity.

## Reproducible checks and run instructions

Use the existing locked Node dependencies and disposable PostgreSQL setup from README. Migrate with the schema administrator; run the API and worker using the restricted application role. Enable `INVEOS_DEV_LAB=1` and `INVEOS_SPEECH_LAB=1` only for fictional development. The environment switch is disabled in production mode. Queue `whisper_pcm_lab_v1` for an authorised binary original.

On a qualified amd64 Docker host, use the existing pinned speech research acquisition/build steps in `.github/workflows/whisper-research.yml`, then:

```sh
python3 -m tools.qualify_speech_worker
node --import tsx apps/api/src/run-speech-job.ts TENANT_UUID CASE_UUID JOB_UUID
```

Set `INVEOS_DATABASE_URL` and an absolute `INVEOS_STORAGE_ROOT`, plus the existing original-store encryption configuration where applicable. Qualification actually repeats destructive host probes and checks the measured runtime inventory against the lock; it expires after fifteen minutes. The worker never downloads a model or builds an image. Do not substitute a timestamped historical receipt or weaken isolation.

For internal context:

```sh
python3 tools/verify_speech_context.py internal-speech-JOB_UUID.json
```

For speech report/export verification outside the repository, copy trusted versions of `verify_report.py`, `verify_transcript.py`, `verify_speech_context.py`, `verify_speech_findings.py` and `report_package.py` together. Run the existing report/package commands and compare separately retained trusted fingerprints. Mixed document reports still require the document-package verifier and its existing dependencies. No verifier authenticates actors, validates legal authority, proves spoken truth or approves disclosure.

## Verification receipts

The first focused real-PostgreSQL run passed4/5; offline report verification failed. PostgreSQL JSONB reordered a context object whose insertion order had incorrectly been reused to reconstruct derivative bytes. The verifier now reconstructs the profile's exact field order independently. The corrected five-check run passed5/5,zero skips. Retain `/tmp/inveos-media-api-first.log` and `/tmp/inveos-media-api-second.log` locally.

A sixth negative-state test initially attempted to set a case stage directly and was rejected by the existing immutable lifecycle trigger. The test now uses the real versioned lifecycle API. That failure is retained in `/tmp/inveos-media-api-six.log`; do not label it a passed six-check run.

Six Python protocol/verifier tests pass, including20 rehashed semantic mutations, duplicate keys, nonfinite numbers, false acceptance and reordered JSON. Actual API exports verify outside the repository, including original-audio exhibits and redacted/unredacted PDF generation. These protocol fixtures are explicitly synthetic; they are not actual ASR benchmarks. Full local checks now pass416Node with47explicit browser skips/463total,203Python,lint,type checks,web build,foundation validation and actionlint. The six speech API checks are included in that passing run. Local logs: `/tmp/inveos-media-full-{api,python,lint,types,build}.log`. Initial type checking caught a missing `unsupported_media` failure-union member; corrected without changing failure bounds. Actual-worker, production/development browser and render acceptance are pending; update this section with exact committed-head CI receipts before merging.

## Runtime provenance and actual notices inspected

The runtime file lock was measured in #112 artifact12970965579. For actual notice-content inspection, the following official Debian package bytes were downloaded as ignored research data, parsed without installation or execution and matched to the runtime's exact copyright hashes:

- `https://deb.debian.org/debian/pool/main/g/glibc/libc6_2.36-9+deb12u14_amd64.deb`:2,759,320bytes,SHA256 `ba4f88f73dbc3ae9055f3c20f4523bfdbaf1ad13ff95e258924f77d20b4fbedf`. Copyright25,467bytes,SHA256 `40c7e1f2118531f038ca22999bd976901254e1bc5cd1b0f0211bdd064c599987`.
- `https://deb.debian.org/debian/pool/main/g/gcc-12/gcc-12-base_12.2.0-14+deb12u1_amd64.deb`:37,596bytes,SHA256 `1896a2aacf4ad681ff5eacc24a5b0ca4d5d9c9b9c9e4b6de5197bc1e116ea619`. Copyright68,194bytes,SHA256 `da8191658b3452ce9caf31638ba61dab31a38c619fa39df119812e050f592fd3` matches measured libgcc/libstdc++ notices.

Read the libc component-specific notice and GCC runtime assignment/exception text. libc's package notice describes LGPL2.1-or-later library terms, GPL2-or-later utilities and component-specific BSD/DEC/ISC/Oracle/CMU/Intel/Inner Net/Libidn/Internet Society/WIDE/Sun/Moshier and test-file terms. Its opening stale2.23 version label is preserved as an observed packaging limitation; the package/runtime version is2.36. GCC identifies libgcc and libstdc++-v3 under GPL3-or-later with Runtime Library Exception3.1. The exception is conditional, not blanket removal of GCC copyleft or other component obligations. No full base-image, corresponding-source, distribution, model-data, legal or security approval is claimed. The source/model/build/notice provenance in docs/118 remains applicable; rewriting integration code does not erase upstream obligations.

## Remaining limits

Canonical44-byte mono PCM16LE WAV at16000Hz only, within the existing256KiB intake limit (about8.19seconds). No codec decoder, long-recording ingestion, resampling of user audio, speaker identification, live recording, native-device capture or representative human-speech accuracy. Raw segment coverage and alignment remain uncertain; manual new segments for recognition omissions are not implemented. Bounded exports fail explicitly when full history exceeds two MiB. Speech-to-casework/chronology/graph/search/attention joins beyond reports remain to integrate. Real-worker failure/isolation, browser and office render evidence must actually pass. OSINTWP09 follows this media batch; the manual source register does not satisfy that work package.
