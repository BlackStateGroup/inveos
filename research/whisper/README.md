# Fictional speech research

First-party bounded PCM harness over the unchanged, revision-pinned whisper.cpp/GGML CPU library. Upstream source, models, build tools and native binaries stay in ignored cache/private disposable research images. No application integration or distribution approval.

[Protocol, actual licences, provenance, reproduction, measurements and limits](../../docs/118_WHISPER_RESEARCH.md).

`fixtures/` contains generated formant speech of explicitly fictional statements, not human recordings. The receipt records exact reference text and bytes. Verify with `python3 -m tools.speech_fixture`; regeneration requires the separately documented host-only eSpeak NG test tool.
