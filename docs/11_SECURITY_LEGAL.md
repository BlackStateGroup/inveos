# 11 — Security, privacy and lawful-use gates (UK-first)

> Planning document, not legal advice. Before handling live cases, obtain a UK data protection/privacy lawyer's review of the use cases, controller/processor relationships, data transfers, client contracts and operational safeguards. Jurisdictions and investigative methods differ.

## Current UK starting points (research checked 26 October 2026)

- ICO's approved **Association of British Investigators UK GDPR Code of Conduct for Investigative and Litigation Support Services**, approved 15 October 2024: https://ico.org.uk/for-organisations/advice-and-services/codes-of-conduct/register-of-uk-gdpr-codes-of-conduct/the-association-of-british-investigators-limited-uk-gdpr-code-of-conduct-for-investigative-litigation-support-services/
- ICO's **legitimate interests** guidance, updated 23 March 2026 for Data (Use and Access) Act changes: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/legitimate-interests/
- ICO's DPIA guidance: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/how-do-we-do-a-dpia/
- ICO employment monitoring guidance (particularly relevant to workplace investigations and covert monitoring): https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/employment/monitoring-workers/data-protection-and-monitoring-workers
- UK Government copyright/reuse: https://www.gov.uk/using-somebody-elses-intellectual-property/copyright
- Private investigation regulation must be rechecked before launch; some broader security activities are separately licensable. No feature constitutes legal authorisation on its own.

## Intake compliance fields and mandatory gate

Case commissioner identity, purpose, jurisdiction, instructions, data categories, likely data subjects, lawful basis, LIA status (if used), special category/criminal offence data condition where needed, DPIA decision, source/collection authorisation, proportionality, minimisation, retention/hold, approved recipients, access class, case supervisor approval. An incomplete gate blocks relevant collection and high-risk connectors.

## Threat model

| Threat | Control / testing |
|---|---|
| Tenant A reads Tenant B data | Database/API RLS, scoped jobs, index filters, object key policies and direct-object URL tests |
| Malicious/compromised staff exfiltrate evidence | MFA, least privilege, time-bound roles, access audit, export approval, device controls, anomaly review |
| AI retrieves restricted source or leaks PII | Per-case retrieval filters, controlled inference environment, DPA checks, redaction and adversarial prompt-injection tests |
| Object tampering/replacement | Server hash, immutable provenance, event chain, independent anchor, WORM/hold when required |
| Lost phone/offline exposure | Encrypted local storage, biometric/OS key store, revoke credentials, MDM policy, short-lived tokens, retention and incident playbook |
| Media parser exploit / malware upload | File limits, quarantine, sandboxed decode, no network in parsing workers, allowlists, patched dependencies |
| Fraudulent uploaded timestamps | Preserve claimed/source times separately, server receipt time and clock quality; no synthetic source freshness |
| Overbroad OSINT or covert surveillance | Source allowlists, legal basis, manual approvals, ToS review, queries logged, rate limits and method-specific privacy review |
| Client receives internal/privileged material | Explicit immutable release bundles, independent redaction/privilege checks, release-only API |
| Administrator falsifies custody | External signing/anchoring, backups, append-only DB permissions and audit reviews |

## Engineering control baseline

- TLS, strong MFA/SSO, key and secret management, scoped session lifetimes, rate limiting, CSRF/CORS controls, secure file serving.
- Tenant and role isolation on **every** read/write/process path; platform administrator support access is exceptional, approved and logged.
- Encryption at rest in app database and object store; mobile encrypted local store with key lifecycle policy.
- UK/EU data location where contractual/legal requirements dictate; assess international transfers, external subprocessors and analytics.
- DPA and data inventory, retention and deletion workflow, DSAR/objection handling, breach response, legal hold and immutable export procedures.
- Business continuity: encrypted backups, test restores, disaster recovery and production secret rotation.
- Pen test and DPIA before sensitive pilot; vulnerability disclosure and patch cadence; dependency SBOM and supply-chain scanning.

## Prohibited initial behaviours

No account intrusion, credential abuse, intercepting communications, bypassing access controls, unlawful covert camera/microphone activation, involuntary personal tracking, doxxing or mass social graph harvesting. The platform can securely store *lawfully collected* material without being an engine for collecting it unlawfully.

## Launch blockers

Actual UK legal/privacy review; approved privacy notice and terms; data processing contracts; tenant isolation security tests; independent backup restore; mobile data loss procedures; malware scan/sandbox verification; proven custody verifier; customer-facing claims reviewed by counsel.
