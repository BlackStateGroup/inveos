# GitHub research catalogue

**70 public repository candidates** checked on **26 October 2026**, with **22 pinned reference revisions**. This is an initial landscape, not an exhaustive search of GitHub or security certification. GitHub licence metadata is a discovery aid, not an incorporation decision.

27 October follow-up: the catalogue remains 70 candidates; there are now **23 pins**, including Apache Tika. Three document-processing checkouts were acquired locally. See the [document processing decision](document_processing/DECISION.md) and [source audit](document_processing/source-audit.json). No third-party dependency is approved by this change.

## Top research workstreams

**Core company/document investigation:** OpenAleph, FollowTheMoney, Docling, Tika, OCRmyPDF. Study document import, unique entity identifiers, relationship provenance and exact source spans.

**Capture and evidence:** Bellingcat Auto Archiver, DFIR-IRIS, Timesketch, Plaso and experimental forenix-oss. Study acquisition metadata, review workflows, timelines, exports and integrity verification. Do not assume upstream evidence claims are legally sufficient.

**Field and offline:** ODK Collect, WatermelonDB and Electric. Study on-device persistence, queue receipts, sync state and idempotent operations; independent mobile security design required.

**Speech, graphs and reports:** whisper.cpp, faster-whisper, Cytoscape.js, Graphology, WeasyPrint and Gotenberg. Evaluate benchmark, licences, exports and human review flows.

## Reading the decisions

- `candidate`: worth an isolated integration spike, **not approved to vendor**.
- `study`: architecture/UX research only; do not integrate automatically.
- `review`: licence metadata inconclusive. Manually inspect file-by-file before copying or installing.
- `avoid`: known commercial/licence/maintenance mismatch for the proposed product.
- `NOASSERTION`: GitHub did not supply a usable SPDX ID. **Not** a permissive licence.
- Models, weights, data, API providers, submodules and transitive packages can have different licences.

## Candidates by area

### AI orchestration

| Repository | GitHub SPDX* | Priority | Research stance | Why it matters |
|---|---|---|---|---|
| [deepset-ai/haystack](https://github.com/deepset-ai/haystack) | `Apache-2.0` | P1 | candidate | Retrieval pipelines with source grounding and evaluation |
| [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) | `MIT` | P2 | candidate | Controlled, auditable analyst workflows; no autonomous intrusive tools |

### Case / incident workflow

| Repository | GitHub SPDX* | Priority | Research stance | Why it matters |
|---|---|---|---|---|
| [dfir-iris/iris-web](https://github.com/dfir-iris/iris-web) | `LGPL-3.0` | P1 | study | Case management, tasking and collaboration; specialist incident-response design |
| [OpenCTI-Platform/opencti](https://github.com/OpenCTI-Platform/opencti) | `NOASSERTION` | P1 | review | Structured sources, knowledge graph and traceable threat-intelligence patterns |
| [MISP/MISP](https://github.com/MISP/MISP) | `AGPL-3.0` | P2 | study | Threat information exchange model and intelligence taxonomies |
| [TheHive-Project/TheHive](https://github.com/TheHive-Project/TheHive) | `AGPL-3.0` | P2 | avoid | Historical case workflow reference; archived repository and commercial product |
| [intelowlproject/IntelOwl](https://github.com/intelowlproject/IntelOwl) | `AGPL-3.0` | P2 | study | Asynchronous enrichment workers and source adapters |

### Document processing

| Repository | GitHub SPDX* | Priority | Research stance | Why it matters |
|---|---|---|---|---|
| [apache/tika](https://github.com/apache/tika) | `Apache-2.0` | P0 | candidate | Document type detection, text and metadata extraction |
| [Unstructured-IO/unstructured](https://github.com/Unstructured-IO/unstructured) | `Apache-2.0` | P1 | candidate | Document parsing alternatives and benchmarking |
| [py-pdf/pypdf](https://github.com/py-pdf/pypdf) | `NOASSERTION` | P1 | review | PDF operations; manually inspect actual licence files |
| [ocrmypdf/OCRmyPDF](https://github.com/ocrmypdf/OCRmyPDF) | `MPL-2.0` | P0 | candidate | Searchable scan derivatives; component/worker boundary review |
| [pikepdf/pikepdf](https://github.com/pikepdf/pikepdf) | `MPL-2.0` | P1 | candidate | PDF structure repair and redaction preparation, verify outputs |
| [docling-project/docling](https://github.com/docling-project/docling) | `MIT` | P0 | candidate | PDF and office document extraction with layout preservation |

### Graph / visualisation

| Repository | GitHub SPDX* | Priority | Research stance | Why it matters |
|---|---|---|---|---|
| [cytoscape/cytoscape.js](https://github.com/cytoscape/cytoscape.js) | `MIT` | P0 | candidate | Case-specific evidence-backed entity relationship visualisation |
| [jacomyal/sigma.js](https://github.com/jacomyal/sigma.js) | `MIT` | P1 | candidate | High-density network graph rendering alternative |
| [graphology/graphology](https://github.com/graphology/graphology) | `MIT` | P0 | candidate | Graph traversal/algorithms for relational intelligence views |
| [xyflow/xyflow](https://github.com/xyflow/xyflow) | `MIT` | P1 | candidate | Node/link editing workflows, not primary evidence graph |
| [apache/echarts](https://github.com/apache/echarts) | `Apache-2.0` | P1 | candidate | Operational charts and trends |

### Identity / access

| Repository | GitHub SPDX* | Priority | Research stance | Why it matters |
|---|---|---|---|---|
| [keycloak/keycloak](https://github.com/keycloak/keycloak) | `Apache-2.0` | P1 | candidate | OIDC/SSO, enterprise identity option |
| [ory/kratos](https://github.com/ory/kratos) | `Apache-2.0` | P1 | candidate | Managed headless identity alternative |

### Investigation / documents

| Repository | GitHub SPDX* | Priority | Research stance | Why it matters |
|---|---|---|---|---|
| [alephdata/aleph](https://github.com/alephdata/aleph) | `MIT` | P1 | study | Document-led investigations and entity searches |
| [openaleph/openaleph](https://github.com/openaleph/openaleph) | `MIT` | P1 | candidate | Large-scale investigation document indexing and source-linked search |

### Investigation / entities

| Repository | GitHub SPDX* | Priority | Research stance | Why it matters |
|---|---|---|---|---|
| [alephdata/followthemoney](https://github.com/alephdata/followthemoney) | `MIT` | P0 | candidate | Case-scoped investigative data model for people/companies/relations |

### Mapping / geo

| Repository | GitHub SPDX* | Priority | Research stance | Why it matters |
|---|---|---|---|---|
| [maplibre/maplibre-gl-js](https://github.com/maplibre/maplibre-gl-js) | `NOASSERTION` | P1 | review | Case location visualisation; inspect licence, tile source terms |
| [Leaflet/Leaflet](https://github.com/Leaflet/Leaflet) | `BSD-2-Clause` | P1 | candidate | Lightweight interactive case map with approved geodata |
| [osm-search/Nominatim](https://github.com/osm-search/Nominatim) | `GPL-3.0` | P2 | study | Geocoding/search; service ToS and OSM ODbL obligations |

### Media processing

| Repository | GitHub SPDX* | Priority | Research stance | Why it matters |
|---|---|---|---|---|
| [FFmpeg/FFmpeg](https://github.com/FFmpeg/FFmpeg) | `NOASSERTION` | P1 | review | Media transcode/preview; build-time LGPL/GPL and codec patent review |
| [MediaArea/MediaInfo](https://github.com/MediaArea/MediaInfo) | `BSD-2-Clause` | P1 | candidate | Media format and technical metadata inspection |
| [exiftool/exiftool](https://github.com/exiftool/exiftool) | `GPL-3.0` | P1 | study | Metadata parsing behaviour; copyleft and packaging review |
| [tesseract-ocr/tesseract](https://github.com/tesseract-ocr/tesseract) | `Apache-2.0` | P0 | candidate | OCR baseline for image/scanned document processing |
| [opencv/opencv](https://github.com/opencv/opencv) | `Apache-2.0` | P1 | candidate | Image processing utilities; no surveillance recognition by default |

### Mobile / offline

| Repository | GitHub SPDX* | Priority | Research stance | Why it matters |
|---|---|---|---|---|
| [getodk/collect](https://github.com/getodk/collect) | `NOASSERTION` | P1 | study | Offline field form workflows; native Android patterns, licence review |
| [getodk/central](https://github.com/getodk/central) | `Apache-2.0` | P1 | study | Field submission/receipt and audit API concepts |
| [Nozbe/WatermelonDB](https://github.com/Nozbe/WatermelonDB) | `MIT` | P0 | candidate | Local-first offline database candidate for React Native |
| [electric-sql/electric](https://github.com/electric-sql/electric) | `Apache-2.0` | P1 | candidate | Selective sync concepts; security and data isolation validation |

### OSINT adapters

| Repository | GitHub SPDX* | Priority | Research stance | Why it matters |
|---|---|---|---|---|
| [OpenOSINT/OpenOSINT](https://github.com/OpenOSINT/OpenOSINT) | `MIT` | P1 | study | Modular passive source adapters with tool provenance; privacy/ToS review |
| [thunderstornX/forenix-oss](https://github.com/thunderstornX/forenix-oss) | `MIT` | P2 | study | Experimental source-to-case audit and verifiable custody ideas; low validation base |
| [smicallef/spiderfoot](https://github.com/smicallef/spiderfoot) | `MIT` | P2 | study | Modular OSINT framework; avoid bulk personal reconnaissance |
| [sherlock-project/sherlock](https://github.com/sherlock-project/sherlock) | `MIT` | P2 | study | Username presence checks; privacy and platform ToS restrict application |
| [soxoj/maigret](https://github.com/soxoj/maigret) | `MIT` | P2 | study | Username research workflow; risk of unjustified personal profiling |
| [laramies/theHarvester](https://github.com/laramies/theHarvester) | `GPL-2.0` | P2 | study | OSINT contact/domain discovery; GPL and scope review |
| [owasp-amass/amass](https://github.com/owasp-amass/amass) | `NOASSERTION` | P2 | review | Domain surface discovery; authorised defensive domain operations only |
| [projectdiscovery/subfinder](https://github.com/projectdiscovery/subfinder) | `MIT` | P2 | study | Passive subdomain pattern; not core PI functionality |
| [projectdiscovery/httpx](https://github.com/projectdiscovery/httpx) | `MIT` | P2 | study | Web inspection for authorised domain scopes only |
| [projectdiscovery/katana](https://github.com/projectdiscovery/katana) | `MIT` | P2 | study | Crawling framework; ToS/proportionality/personal data protections |

### Object storage

| Repository | GitHub SPDX* | Priority | Research stance | Why it matters |
|---|---|---|---|---|
| [minio/minio](https://github.com/minio/minio) | `AGPL-3.0` | P2 | avoid | Archived upstream and copyleft constraints; do not adopt by default |

### Operations / workflows

| Repository | GitHub SPDX* | Priority | Research stance | Why it matters |
|---|---|---|---|---|
| [netbox-community/netbox](https://github.com/netbox-community/netbox) | `Apache-2.0` | P2 | study | Asset/role/process patterns rather than direct investigation adoption |

### Reporting

| Repository | GitHub SPDX* | Priority | Research stance | Why it matters |
|---|---|---|---|---|
| [Kozea/WeasyPrint](https://github.com/Kozea/WeasyPrint) | `BSD-3-Clause` | P0 | candidate | HTML/CSS to professional PDF report generation |
| [gotenberg/gotenberg](https://github.com/gotenberg/gotenberg) | `MIT` | P1 | candidate | Isolated document conversion service |
| [python-openxml/python-docx](https://github.com/python-openxml/python-docx) | `MIT` | P1 | candidate | Editable DOCX report/export templates |
| [typst/typst](https://github.com/typst/typst) | `Apache-2.0` | P1 | candidate | High-quality document typesetting alternative |

### Reports / analytics

| Repository | GitHub SPDX* | Priority | Research stance | Why it matters |
|---|---|---|---|---|
| [evidence-dev/evidence](https://github.com/evidence-dev/evidence) | `MIT` | P2 | candidate | Structured data dashboard/report design; not evidence chain of custody |

### Search / database

| Repository | GitHub SPDX* | Priority | Research stance | Why it matters |
|---|---|---|---|---|
| [pgvector/pgvector](https://github.com/pgvector/pgvector) | `NOASSERTION` | P1 | review | Case-scoped vector retrieval; review licence and operational fit |
| [meilisearch/meilisearch](https://github.com/meilisearch/meilisearch) | `NOASSERTION` | P1 | review | Search alternative; deploy/enterprise licence caveats |
| [qdrant/qdrant](https://github.com/qdrant/qdrant) | `Apache-2.0` | P1 | candidate | Vector retrieval alternative if Postgres insufficient |
| [timescale/timescaledb](https://github.com/timescale/timescaledb) | `NOASSERTION` | P2 | review | Time-series storage option; edition/packaging licence audit |

### Speech / transcription

| Repository | GitHub SPDX* | Priority | Research stance | Why it matters |
|---|---|---|---|---|
| [openai/whisper](https://github.com/openai/whisper) | `MIT` | P1 | candidate | ASR reference implementation; model weights reviewed separately |
| [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) | `MIT` | P0 | candidate | Offline/local speech recognition candidate for field use |
| [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) | `MIT` | P0 | candidate | Server transcription candidate, benchmark on realistic audio |

### Supply chain / signing

| Repository | GitHub SPDX* | Priority | Research stance | Why it matters |
|---|---|---|---|---|
| [sigstore/cosign](https://github.com/sigstore/cosign) | `Apache-2.0` | P1 | candidate | Signing provenance/packaging; distinguish evidence signature use cases |
| [anchore/syft](https://github.com/anchore/syft) | `Apache-2.0` | P1 | candidate | Software Bill of Materials to review shipped dependencies |
| [sigstore/rekor](https://github.com/sigstore/rekor) | `Apache-2.0` | P2 | study | Transparency log patterns; avoid exposing confidential case hashes publicly |

### Timeline / forensics

| Repository | GitHub SPDX* | Priority | Research stance | Why it matters |
|---|---|---|---|---|
| [google/timesketch](https://github.com/google/timesketch) | `Apache-2.0` | P1 | study | Investigation timeline, annotations and source filtering |
| [log2timeline/plaso](https://github.com/log2timeline/plaso) | `Apache-2.0` | P1 | candidate | Timestamped events extraction and forensic timeline import |
| [sleuthkit/autopsy](https://github.com/sleuthkit/autopsy) | `NOASSERTION` | P2 | review | Specialist disk forensic UI and evidence workflow; not a core engine |
| [Velocidex/velociraptor](https://github.com/Velocidex/velociraptor) | `NOASSERTION` | P2 | review | Endpoint forensic collection, only for authorised internal investigations |
| [osquery/osquery](https://github.com/osquery/osquery) | `NOASSERTION` | P2 | review | Authorised endpoint telemetry reference; not default investigator tooling |

### Web archiving

| Repository | GitHub SPDX* | Priority | Research stance | Why it matters |
|---|---|---|---|---|
| [webrecorder/browsertrix-crawler](https://github.com/webrecorder/browsertrix-crawler) | `AGPL-3.0` | P1 | study | High-fidelity browser archiving; explicit capture authorisation and copyleft |
| [webrecorder/pywb](https://github.com/webrecorder/pywb) | `GPL-3.0` | P2 | study | WARC playback and archival ideas; copyleft review |
| [bellingcat/auto-archiver](https://github.com/bellingcat/auto-archiver) | `MIT` | P1 | study | Capture and preservation workflows with time/source provenance |

*GitHub metadata checked on research date; not a legal opinion, SPDX may be absent or not capture edition or transitive restrictions. See [acquisition rules](ACQUISITION.md), [licence review](LICENCE_REVIEW.md), [machine-readable catalogue](projects.json) and [pinned commits](locked_revisions.json).
