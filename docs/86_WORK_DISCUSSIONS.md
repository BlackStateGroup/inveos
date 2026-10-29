# Internal work discussions and case mentions

## Integrated journey

Open a question, task, objective, note, hypothesis or handover in the persistent case workspace. “Team discussion” loads that work record's internal comments. Add plain text, a change reason and up to eight current investigator/reviewer mentions. A discussion is working coordination, separate from source assertions, claims, human review decisions, findings and client disclosure. Comments do not change evidence, authority, tasks or reports and never enter an approved client package automatically.

The author can correct a comment with an expected version and reason, or withdraw it with a reason entered in the editor. A withdrawal hides text/mentions from the current comment but retains the complete earlier revisions. Corrections and withdrawals append history rather than rewriting earlier text. Other assigned members may read the discussion/history but cannot impersonate its author. The UI retains unsaved editor text on errors and clears fetched discussion/history on failed access or refresh. A withdrawn comment cannot be restored or corrected; a new explicitly identified comment can explain a subsequent change.

The case brief and workspace notification control expose “My unread case mentions”, listing current comment versions mentioning the signed-in member. It contains no other member's inbox and no cross-case aggregation. Opening a work record is not a read receipt: explicitly mark the current version read. Correcting a comment produces a new unread mention for retained/current recipients; removing a mention or withdrawing the comment removes it from that current inbox. The former mention remains in authorised correction history. No email, push, outside contact, external chat or automated delivery is performed.

## Server contract

Migration 035 adds `work_comments`, append-only `work_comment_revisions` and append-only `work_mention_reads`. Root comment identities/authors/work anchors and request hashes cannot be changed by the restricted application role; it can update only the revision pointer. Both history tables reject update/delete even for a migration administrator. Case/account identities are joined explicitly; all endpoints authenticate the current session and case assignment, and client roles are denied. Mention targets must be currently assigned internal members of the same tenant/case. Revocation denies subsequent discussion/history/inbox/read requests; historical authors remain attributed even if their assignment changes.

Endpoints beneath `/api/cases/:caseId`:

- `GET/POST /work/:itemId/comments`: current discussion or stable-ID create.
- `POST /work/:itemId/comments/:commentId/revise`: author-only versioned correction/withdrawal.
- `GET /work/:itemId/comments/:commentId/history`: authorised immutable history.
- `GET /work-mentions`: at most 50 current unread mentions, with `more` when additional records remain.
- `POST /work/:itemId/comments/:commentId/read`: acknowledge only the exact current version that mentions this account.

Mutations require the existing CSRF/origin controls. A case lock serialises competing changes. Comment revision and audit writes share a transaction; audit failure rolls back the pointer/history, and failed read-audit rolls back the receipt. Replaying the original create ID/content returns the current version, including withdrawal, rather than resurrecting old text. A different author/content/work anchor cannot reuse the identity. Duplicate read acknowledgements are idempotent and do not duplicate audit records. Version conflicts fail with 409 and require explicit reload/review.

Each work discussion is capped at 100 comments, each comment at 100 revisions, each body at 4,000 characters, each reason at 1,000 and each mention set at eight. Database operations have a two-second statement timeout after scope checks. These are bounded development controls, not a workload SLA. The original-object encryption adapter does not encrypt discussion metadata. Text renders as ordinary React text, never HTML. Audit summaries contain no comment body or mention names.

## Component choice and outstanding capabilities

The catalogue's `dfir-iris/iris-web` workstream covers case tasking/collaboration as a study candidate; its recorded LGPL metadata is not an incorporation approval. This increment uses original INVEOS relational transactions and existing React components because the required comments must share current case authorisation, immutable correction history and audit rollback with case work. No source, assets, new package, model or external collaboration runtime is incorporated. Broader adoption still requires the acquisition rules, exact revision/runtime/direct/transitive terms and compatibility/security evaluation. Attribution alone does not authorise copying.

This closes only the bounded work-discussion/in-app-mention journey. Contractor-specific work assignment policy, threaded replies/moderation, rich notifications/preferences, deadlines/upload/review queues, workload planning, real provider/member lifecycle, native devices/offline sync and professional/privacy/security/licence/production acceptance remain open. A mention read receipt is not evidence review, agreement, handover acknowledgement or client approval.

## Reproduction and actual evidence

Use the disposable lab setup and migrate with `npm run db:migrate`. Run `npm run lint`, `npm run typecheck`, `npm run build`, `python3 tools/validate_foundation.py`, then `node --import tsx --test --test-concurrency=1 apps/api/test/*.test.ts` with the existing restricted/admin disposable PostgreSQL URLs. On a supported sandboxed Chrome host, set `INVEOS_TEST_BROWSER=1`; no sandbox weakening is permitted.

Tests cover create retry, correction races, immutable history, withdrawal, server restart, author/tenant/case/client denial, current mention-target validation, case revocation, per-version read state, duplicate-read audit, stale read denial and atomic audit rollback. The actual browser test adds/mentions/corrects/reloads, inspects the original text, acknowledges the latest mention and checks narrow-screen overflow. The workflow retains a fictional rendered page. Exact SHA/run status is recorded in BUILD_HANDOFF.md; unrun checks are not acceptance.

Verified implementation `a3ff3ce8893fb7499ff296750727341c48dace9b` passed Checks 40933739089: 273 Node/116 Python, zero failures/skips. [Review, actual browser evidence and retained render](evals/2026-10-29-work-discussions.md). Wider gates above remain open.
