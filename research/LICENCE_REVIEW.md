# Licence, provenance and commercial incorporation register

**Important:** Public visibility is not permission to copy and distribute software. A GitHub metadata licence tag is **not a complete legal opinion**. The full project licence, copyright notices, dependencies, binaries, generated content, models and underlying data licences require review. This matters even more because `BlackStateGroup/inveos` is a **public repository** and INVEOS is intended for commercial use.

## Quick screening

| GitHub-reported licence | Screening approach for INVEOS |
|---|---|
| MIT / BSD-2-Clause / BSD-3-Clause / Apache-2.0 | Generally plausible commercial dependency candidates; retain copyright/notice requirements, patent considerations and verify each component |
| MPL-2.0 | File-level copyleft and redistribution of modified covered files require attention; consult counsel for vendoring/worker packaging |
| LGPL-3.0 | Library linking, replacement and notices require specific review; do not copy files into proprietary core by default |
| GPL-2.0 / GPL-3.0 | Strong copyleft distribution obligations; study-only until architecture and legal review |
| AGPL-3.0 | Network interaction obligations may be material for SaaS; study-only until counsel signs off |
| `NOASSERTION` or none | No licence conclusion; **do not copy** into application without manual evidence |
| Archived / commercial transition | Prefer active alternatives; do not assume historic repository licence covers current products or offerings |

## High-value immediate decisions

- **Investigative schema/graph**: FollowTheMoney `MIT`, Cytoscape.js `MIT`, Graphology `MIT` are promising; review attribution and dependency tree.
- **Documents**: Apache Tika `Apache-2.0`, Docling `MIT`, Tesseract `Apache-2.0`, OCRmyPDF `MPL-2.0` are candidates subject to packaged binaries/dependency review.
- **ASR**: whisper.cpp and faster-whisper code `MIT` per GitHub metadata; associated models, audio and inference provider terms are **separate**.
- **Evidence export**: WeasyPrint `BSD-3-Clause`, Gotenberg `MIT`, python-docx `MIT` candidates; safe rendering and quality requirements remain.
- **Case inspiration**: DFIR-IRIS `LGPL-3.0`, TheHive historic `AGPL-3.0`, MISP and IntelOwl `AGPL-3.0`: do **not** blindly vendor.
- **Web capture**: browsertrix-crawler `AGPL-3.0`; Bellingcat Auto Archiver `MIT`. Terms of targeted websites and personal data rights remain separate.
- **Object storage**: `minio/minio` appeared archived with AGPL metadata on check; no default recommendation. Use provider/service options only after retention and legal analysis.
- **FFmpeg**: repository reports `NOASSERTION`; actual build configuration/codec licensing may vary. No unreviewed binaries.

## Required approval record per imported dependency

`source_owner`, `repository`, `pinned_commit_or_release`, `package_identifier`, `licence_full_text_reviewed`, `copyright_notices`, `upstream_security_status`, `dependencies_and_SBoM`, `model_or_dataset_terms`, `patents_and_codecs`, `distribution_mode`, `modifications`, `export/attribution_requirements`, `legal_reviewer`, `engineering_owner`, `decision_date`, `renewal_date`.

## Missing terms are a BLOCKER

Repositories with `NOASSERTION` are not marked cleared. The Python research tool will not automatically mirror unknown-licence projects under its permissive selector. A separately authorised read/inspection may help establish the correct licence, but no incorporation is approved until a written decision.

## Official baseline sources

- UK IPO copyright and reuse guidance: https://www.gov.uk/using-somebody-elses-intellectual-property/copyright
- UK Government software licensing standard: https://engineering.hmrc.gov.uk/standards/software-licensing/
- GitHub licences documentation: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository
- Project licence texts take precedence over discovery summaries.
