# Local application: visual prototype and synthetic foundation

## Scope decision

Build the full interface first, then a narrow persistent case → original text → claim → human review → draft report loop. All material must be fictional. The maintainer approved publication in the existing repository without changing the all-rights-reserved position; no open-source licence is granted by these changes.

The Command surface includes overview, case intake/brief, chronology, taskboard, research register, graph inspector, evidence viewer, interview desk, findings review, report studio, client release desk and administration. The Field and Client Portal surfaces illustrate their distinct workflows. They are not native mobile apps or operational client access services.

## ADR-007 — Synthetic lab, not production infrastructure

Use React/TypeScript/Vite for the web surface and a Fastify TypeScript modular API with PostgreSQL. Shared TypeScript contracts describe the workspace. A server-assigned, expiring demo session exercises tenant/case authorisation; it is explicitly **not real identity, OIDC, MFA or a production login**. Only the explicitly enabled local lab may issue these sessions. Never expose its API directly to the public internet.

The lab accepts bounded UTF-8 `.txt` originals only, preserving exact bytes and independent claimed source/receipt times. A private local filesystem store with exclusive creation is a development substitute for encrypted S3-compatible storage. PostgreSQL transactions bind original receipts, claims, review decisions, separate finding records and audit events. Originals have no update/delete API. These controls do not prevent a privileged local administrator from rewriting storage or history.

The initial export is an internal JSON draft, not PDF, not a client release and not a signed custody package. It includes source-linked accepted findings and original digests; the server must recheck supporting source bytes before export. AI extraction, media processing, native encrypted offline queues, real identity, external collection, signed custody anchoring, S3 encryption/object lock and client releases remain outside this slice. Production work must implement the original roadmap gates, not silently promote this lab.

## Interaction boundaries

- Visual prototype changes are memory-only and reset on page reload.
- Persistent lab records are separate from the visual fixtures. There is no automatic copying between modes.
- Field notes and receipts are explicitly simulated; there is no microphone/camera/location access.
- The Client Portal displays fixed fictional released-content examples only, never internal workspace records.
- Production integrations and release buttons are disabled with reasons, not simulated as successful operations.

See [the local runbook](../LOCAL_RUN.md) for setup and verification commands.

## Local verification — 26 October 2026

- Real PostgreSQL integration tests passed for the case/authority/evidence/claim/review/report lifecycle, persistence across API instances, access restrictions, retry/concurrency handling and mutated-source rejection. Focused regression tests subsequently passed for Unicode/calendar validation, blank quotes, malformed JSON and rate-limit responses.
- Lint, workspace type checks, web build, 13 Python foundation tests and dependency audit passed (zero reported npm vulnerabilities). Lint and type checks were repeated after API review fixes.
- Manual browser validation created a fictional case, approved scope, uploaded the supplied fictional text fixture, proposed an exact quote, recorded a review reason, accepted the claim and downloaded an internal JSON draft. The draft's original bytes, digest and quote span were independently checked against the fixture. Reloading and re-entering the lab preserved the case and reviewed report.
- The visual prototype was inspected in the rendered browser, including compact navigation at 200% zoom. This is not a native-device, comprehensive accessibility, penetration, outage or backup/restore assessment.
- No production deployment, real authentication, encrypted production object storage, client release or evidentiary certification was tested or delivered. The maintainer subsequently approved uploading and merging the application source without changing its licence.
