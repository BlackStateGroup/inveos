# Open-source mining and source acquisition procedure

## Goal

Study the best existing investigation, evidence, OSINT, graph, transcription, reporting, mobile/offline and legal-tech tools; avoid rebuilding well-tested components unnecessarily **without** importing legal, security or privacy obligations blindly.

We have **70 catalogue entries** and **22 revision-pinned references** in this first pass. They are references and evaluations, **not** wholesale copies committed to the repository. The full Git clone may be made into a local, git-ignored research cache after review; incorporation into application source requires a separate decision and PR.

## What has actually been acquired

This package includes original analysis, URLs, GitHub-reported licence metadata and observed full commit IDs for selected projects. **It does not include third-party source trees, downloaded models, proprietary NOIR/Recon source, or operational datasets.** No dependency security audit or production integration is claimed.

### 27 October document-processing follow-up

Docling, Apache Tika and OCRmyPDF were acquired at exact revisions into the ignored local cache and inspected without executing their code. Tika adds a 23rd pin. The public repository contains only original adapter code, tests, analysis and source-file hashes. See [decision and reproduction instructions](document_processing/DECISION.md). Parser benchmarks remain unrun because namespace isolation is unavailable in the execution environment. The preceding acquisition status describes the original 26 October package.

## Responsible research flow

1. Search official GitHub repository metadata and upstream docs; verify the repository exists, is maintained and has relevant functionality.
2. Read `LICENCE`, `LICENSE`, `COPYING`, copyright notices, exceptions, submodules and README; inspect real package-level licences. Record upstream terms for models/datasets/services separately.
3. Record rationale, case feature, alternatives, risk, intended integration style, maintenance/activity and pinned commit in `projects.json` and `locked_revisions.json`.
4. Acquire **local** git-ignored snapshots at exact pinned commit with `python tools/mine_sources.py --fetch owner/repo`. Do not execute third-party code as part of acquisition.
5. Re-run the licence/supply-chain check, scan for secrets/security vulnerabilities, inspect dependencies, and perform a sandboxed technical spike with fictional data only.
6. Decide integration route: conceptual inspiration, bounded library dependency, service boundary, or documented fork. For GPL/AGPL/LGPL/MPL and `NOASSERTION`, obtain expert review of distribution/network/source duties first.
7. Before redistributing source or shipping in proprietary/commercial software, record a licence approval, attribution/NOTICE, SPDX/SBOM, security acceptance and precise original commit.

## Commands

```bash
python3 tools/validate_foundation.py
python3 tools/mine_sources.py --list
python3 tools/mine_sources.py --list --priority P0
python3 tools/mine_sources.py --fetch openaleph/openaleph
python3 tools/mine_sources.py --fetch cytoscape/cytoscape.js
python3 tools/mine_sources.py --fetch-all-permissive --limit 3
python3 tools/mine_sources.py --audit
```

The download tool is opt-in. It fetches into `.research-cache/sources/` (git ignored). It does not commit clones, compile them or execute their scripts. It only fetches **pinned repos**; SHA and local actual HEAD are recorded for reproduction. The `--fetch-all-permissive` selector refers only to GitHub licence metadata and still does **not** assert integration clearance. Be mindful of disk space and GitHub rate limits.

## Integration patterns

| Pattern | Appropriate when | What to do |
|---|---|---|
| **Design/reference only** | Competitor, AGPL/copyright risk, domain mismatch | Original INVEOS implementation, cite architecture reference, do not copy code |
| **Package dependency** | Well-supported permissive package, useful narrow functionality | Pin version, SBOM, licence notices, sandbox/config review |
| **Isolated service** | OCR/ASR/archiving too heavy for main API | Separate internal worker/container, keep original evidence/API permissions |
| **Fork/vendoring** | Modifications necessary and legally allowed | Explicit review, preserve original notices and commits, write upstream delta, maintain security patches |
| **External authorised connector** | Registry, public datasets or commercial API | Contract/terms/data-protection checks, attribution, rate limits and logging |

## Data and scraping boundaries

An open repository can be MIT-licensed while the **data** it processes is copyrighted, subject to privacy rights, access controls or contractual API restrictions. Investigative collection is particularly sensitive. No mass personal dossiers, covert location data, unapproved device scans or social-media credential checks by default. Preserve retrieval-time and source context for authorised data; deletion and retention must be supported.

## Recommended research experiments

- Timesketch/Plaso: export and rebuild a synthetic timeline preserving source timestamps and original provenance.
- OpenAleph/FollowTheMoney: create two suppliers with ambiguous aliases and verified identifiers, assert/reject graph edges with citations.
- ODK/WatermelonDB: offline observation, app force-close, reconnect twice, verify exact receipts and unchanged bytes.
- Docling/Tika/OCRmyPDF: parse three mixed-language/scanned synthetic documents, compare source span stability and CPU use.
- Whisper.cpp/faster-whisper: test field noise/timecodes and correction workflows with consented or synthetic audio.
- WeasyPrint/Gotenberg: emit independently verifiable PDF exhibits with stable link/citation page references.
- Browsertrix/Bellingcat Archiver: study URL preservation and provenance under explicit site terms, not uncontrolled scraping.
