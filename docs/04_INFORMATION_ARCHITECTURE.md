# 04 — Information architecture and screen inventory

## Primary desktop shell

Left rail: **Overview · Cases · Assignments · Research · Intelligence · Evidence · Reports · Clients · Administration**. Case pages have secondary tabs: **Brief · Timeline · Tasks · People/Organisations · Field · Sources · Graph · Evidence · Findings · Report · Audit**. Avoid overcrowding the top-level navigation: only six principal case views and contextual panels.

### Case workspace (main screen)

- **Header:** case ID, short title, state, owner, classification, lawful-scope status, review blockers, last confirmed update.
- **Left within case:** sections and scoped search.
- **Central canvas:** selected activity (timeline / research / graph / evidence / report).
- **Right inspector:** source provenance, chain of custody, relationships, review state and actions. Selecting an assertion always shows the exact supporting original/document passage.
- **Bottom utility:** activity/status strip, upload queue counts, audit/export readiness.

### Desktop screens

1. Workspace and caseload overview: assigned cases, ageing tasks, approaching deadlines, compliance blockers.
2. Case intake: authority, jurisdiction, scope, lawful basis, conflicts, parties and opening decision.
3. Case brief: questions, instructions, involved entities, team, attachments, recent events.
4. Chronology: original time vs ingestion time, uncertainty, source filter, annotations.
5. Taskboard: assignment, due date, approval/check-in, expense or billing connection.
6. Research workbench: source queue, public records, connector status and capture provenance.
7. Intelligence graph: entities and evidence-backed edges, comparison, hypothesis mode.
8. Evidence vault: immutable source library, previews, derivations, custody, search, export.
9. Interview desk: audio, timecoded transcript, speaker review, corrected transcript, quote links.
10. AI review queue: unsupported claim markers, source snippets, accept/reject/rewrite.
11. Report studio: structure, citation drawer, reviewer checklist, release preview.
12. Client release desk: permissions, redactions, package, expiry, delivery and read events.
13. Agency admin: users, tenancy, MFA, roles, retention, billing and policy templates.

## Mobile field shell

**My Assignments · Active Session · Capture · Queue · Case Brief**. Big controls suitable for gloves/one hand; high contrast, low distraction. Text/voice note, photograph, short video and task status; observation preview before submission. Queue displays `Saved locally` / `Awaiting network` / `Sending` / `Received` / `Verified` / `Action required`. Location is captured only for explicitly approved case operations and visible in UI. Provide battery/storage warning, local encryption state and last successful sync.

## Client portal shell

**My Cases · Updates · Requests · Released Documents · Messages · Billing**. No internal graph, draft analysis, unrestricted searches or whole evidence vault access. Each release is a reviewed, immutable snapshot with a revocable access grant.

## Global design behaviours

- Zero-state copy names exactly what is missing and the correct next action.
- All claims display status: `extracted` / `suggested` / `under review` / `accepted` / `rejected` / `published`.
- Unsynchronised data and incomplete or expired shares use explicit language.
- Never show simulated real-time data as live operations.
- Provide keyboard support, accessible focus states, reduced-motion settings and clear typography at 200% zoom.
