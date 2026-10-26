# Continuous GitHub source-mining playbook

This is a repeatable *manual* research workflow, not a claim that an automated ongoing search or monitoring job has been scheduled. A maintainer can run it when new integration needs arise.

## Repositories to examine by feature

- Case and task workflow: `open source incident case management`, `investigation management incident response`, `chain of custody evidence app`.
- Evidence and verification: `SHA256 digital evidence forensic audit`, `WARC web archive provenance`, `sigstore signed artifact provenance`.
- Mobile: `offline first react native encrypted sqlite`, `field forms resumable sync`, `mobile capture evidence provenance`.
- Documents: `PDF OCR document layout parsing`, `forensics media metadata exif`, `document redaction PDF verification`.
- Analysis: `entity resolution investigative graph`, `source citation LLM`, `forensic timeline extraction`.
- Operations/security: `OIDC multi tenant PostgreSQL RLS`, `transactional outbox idempotency`, `S3 object lock evidence`.

## Review methodology

Search GitHub projects and code, read docs/tests/changelogs and actual licences, inspect current open issues/security advisories, determine version compatibility and maintenance, then pin a **full commit SHA** and write a narrowly scoped test. High stars do not equal security or usefulness. Re-evaluate projects after significant releases or disclosures.

## Decisions to capture

- Why this project over two alternatives?
- Exact upstream revision and available releases.
- SPDX *and actual licence*, third-party dependency/source/model/data terms.
- Scope of code required and whether simpler in-house implementation is better.
- Benchmarks on synthetic representative material.
- External requests/telemetry and permissions required by the tool.
- Source grounding, reversibility of errors, tenant privacy, evidence correctness.
- Owner and patch/exit strategy if upstream becomes unmaintained.

## Milestone-focused sequencing

1. **P0 field/evidence/report:** WatermelonDB, Tika/Docling, Tesseract/OCRmyPDF, whisper.cpp/faster-whisper, WeasyPrint/Gotenberg.
2. **P1 entity/research/analysis:** FollowTheMoney, OpenAleph, Cytoscape.js, Timesketch/Plaso, Bellingcat Auto Archiver.
3. **Later specialist/enterprise:** DFIR-IRIS, OpenCTI, MISP, specialist forensic and network tools, only when justified by validated legal use cases.

Review logs should record changes since the previous inspection, not simply re-state a project's marketing description.
