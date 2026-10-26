# 03 — End-to-end journeys

## Journey 1 — Corporate procurement investigation (launch demo)

Fictional case: an employer commissions a review of potential duplicate invoicing by two suppliers.

1. **Intake:** case officer verifies commissioning authority, purpose, scope and lawful basis; receives two invoice packs and a registry reference.
2. **Prepare:** records questions to answer, assigns a reviewer, creates tasks and sets disclosure sensitivity.
3. **Collect:** uploads invoices, preserving originals; records Companies House sources with retrieval time, URL and provenance. Any outside access is source-authorised.
4. **Analyse:** parser extracts vendor names, dates, invoice amounts and registered directors as **candidate facts**. Entity matches are suggestions, not confirmed identities.
5. **Graph:** an analyst confirms a shared director using recorded source records; an invoicing similarity is flagged for further work, not proof of fraud.
6. **Field:** investigator dictates a scoped interview note, stores the original audio and separately reviews the transcription.
7. **Synthesis:** timeline and reviewed facts support a report that clearly labels limitations and unanswered questions.
8. **Review:** approving investigator inspects each exhibit link and redaction before client delivery.
9. **Release:** client only accesses release-version-1 and explicitly selected exhibits, with an access log.
10. **Close:** retention clock/hold policy is recorded; export verifier can independently verify hash manifests.

## Journey 2 — Insurance incident review

An authorised investigator receives photos and witness accounts after an incident. They capture field notes on an offline device, reconnect later, resolve a duplicate submission, and produce a chronology with cited observations. Uncertain times remain uncertain. No automatic identification of people or surveillance escalation.

## Journey 3 — Litigation support

A legal team provides mixed PDFs, email exports and recordings; the system preserves originals, parses pages/timecodes, creates source-linked timeline candidates and prepares an exhibit index. Material is tagged for client privilege review and withheld from the portal until explicitly released.

## Journey 4 — Agency dispatch

A coordinator assigns a time-limited task. The mobile user acknowledges assignment, works offline, records observations, submits a draft, and receives a server receipt. Supervisor reviews it. Failed uploads and unsynchronised media remain conspicuous. A supervisor cannot pretend a device saw an acknowledgement before it did.

## Negative and exception states

- **No legal authority:** intake fails closed; research/field acquisition disabled pending review.
- **Lost mobile device:** revoke session and keys; assess unuploaded local data and remote wipe feasibility; log incident. Never falsely imply unsynced files were preserved.
- **Duplicate or stale media:** deduplicate only by digest with distinct custody records and actor/times; explain repeated upload.
- **Conflicting witness times:** preserve raw accounts, source time zone and uncertainty; note analyst resolution separately.
- **Sensitive document:** exclude from AI/model processing unless explicitly authorised and correctly routed.
- **Mistaken identity:** graph edge is rejected with history; prior reports require amendment review.
- **Data subject request/legal hold:** freeze automated destruction as applicable, run appropriate review and preserve audit.
- **Client link revoked:** access stops, prior downloads remain separately reported as disclosure events, not magically recalled.
