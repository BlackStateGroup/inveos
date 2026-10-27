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

## Persistent casework — 27 October 2026

The local lab now saves objectives, investigation questions, competing hypotheses,
tasks, case notes and handovers. Records have owners drawn from case membership,
optional calendar deadlines, typed status and immutable revision snapshots. Every
edit requires the version being edited and a reason; a stale edit returns `409`
and leaves the user's draft available for comparison. Case progress is calculated
from saved findings, open questions, blockers and the next task. Casework also
appears in workspace search. An existing, valid lab session restores the selected
case/view on reload; this does not introduce production identity.

Questions, objectives and hypotheses can link exact-source claims as supporting,
contrary or contextual material. The server rechecks the original bytes and quote
range before attaching a link. A hypothesis cannot be assessed as supported or
disputed without matching, reverified source links. This never creates a reviewed
finding. Only the assigned handover recipient can acknowledge a handover.
Revoking case membership denies further casework/history access, while historical
ownership remains recorded. API responses carry `Cache-Control: no-store`.

The report studio includes a complete branded print view, reviewed passages,
unresolved questions, limitations and cited exhibit digests/times. Printing through
the action rechecks the server report first. JSON exports keep working questions
and hypotheses in a separate context section; internal notes and handovers are
excluded. The exported JSON fingerprint can be copied explicitly. The standalone
`tools/verify_report.py` checks embedded original bytes, exact UTF-8 citation ranges
and recorded policy snapshots without accessing the API. A separately trusted
fingerprint is needed to authenticate the complete file; an accompanying hash
alone does not establish authenticity. The verifier does not certify PDF content,
reviewer identity, truth, lawful collection or client release.

Ordered, checksummed SQL migrations now upgrade existing foundation databases and
refuse changed applied migration files. The migration runner takes a transaction
lock to prevent concurrent application of the same migration.

See the [verification receipt and reproduction commands](evals/2026-10-27-casework.md).
These are local synthetic application capabilities. Real identity/MFA, encrypted
production object storage, PDF/OCR ingestion, native offline capture, signed export
packages and operational client releases remain outside this change.

See [the local runbook](../LOCAL_RUN.md) for setup and verification commands.

The [complete workspace delivery plan](24_DELIVERY_PLAN.md) records the expanded scope, reconciled implementation states and fictional supplier milestone. The lab below is its starting point; the 26 October verification receipt remains historical evidence for this slice.

## Local verification — 26 October 2026

- Real PostgreSQL integration tests passed for the case/authority/evidence/claim/review/report lifecycle, persistence across API instances, access restrictions, retry/concurrency handling and mutated-source rejection. Focused regression tests subsequently passed for Unicode/calendar validation, blank quotes, malformed JSON and rate-limit responses.
- Lint, workspace type checks, web build, 13 Python foundation tests and dependency audit passed (zero reported npm vulnerabilities). Lint and type checks were repeated after API review fixes.
- Manual browser validation created a fictional case, approved scope, uploaded the supplied fictional text fixture, proposed an exact quote, recorded a review reason, accepted the claim and downloaded an internal JSON draft. The draft's original bytes, digest and quote span were independently checked against the fixture. Reloading and re-entering the lab preserved the case and reviewed report.
- The visual prototype was inspected in the rendered browser, including compact navigation at 200% zoom. This is not a native-device, comprehensive accessibility, penetration, outage or backup/restore assessment.
- No production deployment, real authentication, encrypted production object storage, client release or evidentiary certification was tested or delivered. The maintainer subsequently approved uploading and merging the application source without changing its licence.
