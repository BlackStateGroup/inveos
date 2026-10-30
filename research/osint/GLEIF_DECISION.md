# GLEIF single-record candidate — inspection decision

Inspected 30 October 2026 for the fictional legal-entity research slice. This is an implementation decision, **not** provider, legal, transport or production qualification. No live LEI lookup or other investigative collection was performed. Only published documentation and licence pages were fetched.

## Primary evidence

The [GLEIF API page](https://www.gleif.org/en/lei-data/gleif-api) links the [official API documentation](https://api.gleif.org/docs), which redirects to GLEIF's published Postman documentation. Its linked collection documents a single-record `GET https://api.gleif.org/api/v1/lei-records/:id`, JSON:API response data, and a stated limit of 60 requests per minute per user at inspection. The single-record request declares no authentication. These observations support a bounded first-party implementation; they do not establish current availability, service entitlement, coverage or a guaranteed quota. We did not execute its example requests.

The inspected record has `data.type`, `data.id`, `data.attributes.lei`, an entity legal name and registration metadata. The implementation permits only those identity fields plus legal-name language, jurisdiction, category, status, registered identifier and registration dates. Relationships, mapped identifiers, namesearch, pagination, fuzzy matching, addresses and linked-person resources are excluded from extraction/traversal. Extra response fields remain preserved in original bytes and still require minimisation review.

[GLEIF data terms](https://www.gleif.org/en/meta/lei-data-terms-of-use) section II.3 identifies CC0 for LEI data; the [open-data page](https://www.gleif.org/en/about/open-data) also describes that dedication. Access/use terms remain relevant: published restrictions include technical-limit circumvention and misleading affiliation/endorsement; marks/logos are separate. Accuracy and uninterrupted availability are not assured. Data licensing does not authorise case-specific use or establish accuracy. Neither API documentation nor arbitrary provider code is assumed to be CC0. No GLEIF data, source code or SDK is incorporated in the fixture or runtime.

The [official CC0 legal code](https://creativecommons.org/publicdomain/zero/1.0/legalcode.en) was actually read and retained as legal text in `third_party/osint/CC0-1.0.txt`. It includes the waiver/fallback and limitations: trademark/patent rights, warranties and third-party permissions are not supplied by that instrument. GLEIF names are used descriptively; no logo or endorsement is claimed.

The [ISO LEI explanation](https://committee.iso.org/sites/tc68/home/articles/content-left-area/articles/what-is-lei.html) supports the 18-character alphanumeric body plus two numeric MOD97-10 check digits. The format page was inspected through the web source, but a direct archive attempt returned HTTP 403; there is no claimed local ISO document hash. Syntax/check-digit acceptance does not prove registration or identity.

## Retained provenance and runtime inspection

`gleif-inspected-sources.json` records six actual documentation/licence retrieval URLs, resolved URLs, timestamps, exact byte lengths and SHA-256 digests. Ignored `.research-cache/gleif/` holds the complete downloaded documentation, including the official-linked collection with its real examples; those examples are not application fixtures or redistributed here. The manifest also records the extracted CC0 legal-text digest and unsuccessful ISO archive attempt. Existing pinned OpenOSINT/SpiderFoot MIT notices and decisions are unchanged.

Runtime inspection was of our first-party implementation and the documented response contract. Existing Node `http`, `https`, DNS, URL, Buffer and AbortSignal APIs suffice; there is no new dependency or upstream runtime installation/execution. `gleifProviderTransport` rejects before DNS because its code qualification gate is false. The future HTTPS path is pinned to the exact provider host/path and a public resolved address with normal TLS validation. The fictional transport uses the same bounded exchange but only a fixed `127.0.0.1` route for a locally invented identifier. Its invocation and HTTP behaviour are **unrun** in this build phase.

The stricter local limit is at most 30 attempts per 300 seconds per tenant/adapter credential scope, further reduced by versioned policy. Attempts and 429 backoff persist in the existing job framework; 256 KiB and ten-second limits apply. No automatic retry, credentials, redirects, bootstrap or linked traversal. Real provider qualification, approved use/coverage, revised terms review, TLS/DNS/error behaviour and independent acceptance remain gates; changing a policy or environment variable cannot enable live collection.

Implementation and root acceptance handoff: `docs/130_LEGAL_ENTITY_RESEARCH.md`.
