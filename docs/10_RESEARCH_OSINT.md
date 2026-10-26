# 10 — Research workbench, lawful sources and intelligence graph

## Why a workbench rather than a bulk scraper

Professional investigation requires a defensible record of where a fact came from, the authority to collect it, its retrieval time and context, and whether a human verified it. A huge opaque OSINT score or mass profile creates legal, accuracy and safety risk.

## Source classes

1. **Client-supplied documents:** invoices, contracts, statements, images, lawful exports; scope and provenance recorded.
2. **Public corporate records:** Companies House where authorised, published registers, official company sites, licensed LEI data.
3. **Open geospatial data:** Overture/OSM as applicable, subject to attribution, licence and accuracy constraints.
4. **User-supplied web pages:** single URL/article capture with timestamps and technical source information; respect rights, access and terms.
5. **Licensed specialist APIs:** explicit terms, costs, quotas, processing purpose and region checks.
6. **Operational/internal records:** only when commissioning organisation has authority to disclose and process them.

Each connector must define `source_class`, `legal_scope`, `authentication_class`, `terms_reference`, `rate_limits`, `cache_policy`, `retention`, `PII categories`, `data_quality`, `error_states` and `audit_trace`.

## Entity resolution

- Normalise company numbers/registered IDs as strong identifiers; fuzzy name/address/email similarity only proposes matches.
- Store aliases and names separately from unique identifiers; conflicting identifiers block automatic merge.
- Create relationship objects with predicate, supporting evidence IDs, valid/observed time, origin and reviewer status.
- Support an **explicit reject edge** action, reversible only as a new audit event.
- Graph may contain contradictions and hypotheses; colour/line style marks review state. Never promote graph proximity into criminal suspicion.

## Capture and provenance

Every source capture stores original URL/identifier, publisher, retrieval method and timestamp, content digest, redirect chain where lawfully recorded, summary and limitations. Original response or page snapshot only when permitted by law/terms; avoid archiving unrelated private personal data. Handle removal requests and retention policies.

## External research integrations

Potential reusable architecture and components are catalogued in `research/projects.json`. Focus on OpenAleph/FollowTheMoney for investigative document/entity models, Bellingcat Auto Archiver for capture workflow study, OpenOSINT/SpiderFoot for *source adapter patterns*, Timesketch for timeline UX. None is a default authority to bulk query private individuals. Avoid importing active network scanners or username-targeting tools as core investigator features.

## Licensing and data terms

An MIT-licensed codebase does **not** grant rights to the datasets or upstream services it queries. Legal authority, source terms, API quotas, redistribution permissions, data subject rights and evidence preservation need separate approval for each source. Maintain individual adapter policies with tests and owner.

## Minimum valuable research flow

User supplies a lawful source URL or a company registration number → connector checks terms/scope → fetches permitted record → stores acquisition timestamp and digest → extracts candidates → analyst confirms company/person/relationship → source-backed graph edge and report citation. Add automated harvesting only after the manual path is secure and accurate.
