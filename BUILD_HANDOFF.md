# INVEOS current engineering handoff

Updated 29 October 2026. [Canonical plan](docs/71_REMAINING_DELIVERY_PLAN.md); historical evidence remains in [the dated handoff](docs/history/2026-10-29_BUILD_HANDOFF.md) and [delivery ledger](docs/history/2026-10-29_DELIVERY_RECEIPTS.md). Source and exact receipts take precedence over old draft labels.

## Baseline and concurrent work

Fresh GitHub inspection: main includes merged #72 at `779276a4ab351648f724ca6cee0cc771d16a6e5f` (earlier #68–#71 incorporated). #73, document-finding reasoning, is open against main. Another active repository execution updated its review fixes to `31d93ce9284df6adf62c1aa0d5d09aaff4eef889`; those changes are preserved here. Do not compete with that review/merge work or overwrite it. No merge was performed by this run, and no blanket future merge authorisation exists.

## Verified supplier and reasoning

#72 receipt at `f57a05a` remains in [supplier-case-acceptance.json](research/runtime_artifacts/supplier-case-acceptance.json). #73 implementation `fc75a3314685826545dcc09d4c807d1cf006fced`, tree `2f569f387197e0cf3c083e2834021f31d815bf4c`, passed [Checks #213](https://github.com/BlackStateGroup/inveos/actions/runs/40916264640), job 123597187853: 243 Node/111 Python, zero failures/skips, actual PostgreSQL/API/sandboxed Chrome and host isolation. [Research #41](https://github.com/BlackStateGroup/inveos/actions/runs/40916264157), job 123597185156, passed actual native extraction, repeated OCR, page raster/comparison, leased failure tests and complete fictional supplier delivery.

The supplier now retains two proposed alternative explanations, six typed reviewed-document links and an explicit inconclusive question closure with historical sources. Browser source inspection/reload/withdrawal, current authority/reviewer checks, frozen report joins and independent verification passed. Scripted reviewer roles do not certify professional acceptance, general OCR accuracy or pixel fidelity. Contract: [docs/80](docs/80_DOCUMENT_REASONING.md).

Concurrent follow-up `31d93ce9` fixes delayed duplicate link saves losing the withdrawal marker and adds a PDF regression proving separate redacted renditions omit document-link metadata. Its changed checks are pending; do not extend the `fc75a331` receipt to that changed code without its own result.

## Active independent continuation: encrypted original custody

Branch `feat/encrypted-original-custody` builds on #73 without competing with its review fixes. Opt-in AES-256-GCM originals authenticate the versioned header and tenant/case/evidence path. Exact original digests/citations/derivatives/exports remain plaintext-byte identities. API, durable integrity and qualified native/OCR/raster worker reads share the adapter. Protected separate keys support new-write rotation and fail-closed missing-key access. No new dependency or copied source. [Run, threat boundary, rollback and remaining criteria](docs/81_ENCRYPTED_ORIGINAL_CUSTODY.md).

Four actual local crypto/filesystem tests pass: immutable write, nonce/path/header/cipher/tag tampering, byte bounds, instance restart, key rotation/revocation, copied-root recovery and unsafe configuration. Types/lint/build pass. New restricted-role PostgreSQL/API/worker/restore test and the existing actual supplier journey configured with encrypted originals await hosted verification. Do not claim these pending checks passed. Local Docker/PostgreSQL are unavailable; prior namespace denial is not bypassed.

Next: publish the cohesive custody branch/draft PR, inspect and fix its exact hosted results and feedback, record final implementation/receipt and continue priority 3 identity plus the next dependency-ready workspace criteria. Reuse unchanged passing receipts; do not create a documentation-only loop. Original encryption does not cover database metadata/derivatives/reports, upload staging, downloaded exports or whole backup recovery. No silent migration of retained plaintext originals.

Full product remains incomplete: real identity/invitations/MFA, provider/KMS/WORM and full restore, chronology/search/graph/intelligence/interviews, native device/offline/team/agency requirements and independent human/security/privacy/legal/licence gates. Runtime archive/source-obligation closure and representative OCR/Tika/OCRmyPDF comparison remain open. No production, live collection, spending or external contact.
