# INVEOS current engineering handoff

Updated 29 October 2026. [Canonical delivery plan](docs/71_REMAINING_DELIVERY_PLAN.md). Prior evidence remains in [the historical handoff](docs/history/2026-10-29_BUILD_HANDOFF.md), [delivery ledger](docs/history/2026-10-29_DELIVERY_RECEIPTS.md) and exact machine receipts. Do not repeat historical draft labels as current state.

## Current source and verified work

Main was freshly observed through externally merged #74 at `21e3e8042b422b0f8451e11500657206af3aad7b`, including #68–#73 and research #2. The merge occurred concurrently at 17:21 UTC; this run did not perform it. Concurrent review fixes at `31d93ce9` are preserved. This run performed no merge; new work remains reviewable.

Merged [PR #74](https://github.com/BlackStateGroup/inveos/pull/74) incorporated the tested implementation below. The final evidence-only follow-up on `feat/encrypted-original-custody` landed after that concurrent merge and is not yet incorporated into main; retain it with the next substantive increment, without opening a documentation-only PR. Verified implementation `187ab9e01c25af715438dc2e73c709060f3a8e52`, tree `dced6b8a7edfd63de59a3fe45c422b71747e25b5`, matches the local source tree with the existing remote verifier executable mode preserved. The post-merge follow-up records evidence only; it does not change application/test behaviour. No inline review threads were present at the final inspection; this is not independent security approval.

[Checks #218](https://github.com/BlackStateGroup/inveos/actions/runs/40919585772), job 123608867790: **249 Node/111 Python, zero failures/skips**, lint/types/build, actual restricted-role PostgreSQL/API/sandboxed Chrome, crypto/filesystem tampering, key rotation/removal, instance restart and copied-root recovery. The actual dispatcher process now loads protected keys: invalid configuration leaves jobs queued, valid configuration produces the derivative. Missing old keys deny reports and derivative jobs without attaching output; new-key originals remain processable.

[Research #45](https://github.com/BlackStateGroup/inveos/actions/runs/40919585891), job 123608872814: actual isolated native extraction/OCR/raster from encrypted originals, repeated supplier OCR, browser original-page comparison/reload, six reasoning links/two proposed alternatives/inconclusive closure, independent exhibit/PDF verification, explicitly approved restricted fictional delivery, acknowledgement/restart/revocation; separate raster and five leased-worker/failure tests passed. Exact diagnostics: [encrypted-original-acceptance.json](research/runtime_artifacts/encrypted-original-acceptance.json). This supersedes the pending custody statements at earlier commits; earlier #72 plaintext and #73 reasoning receipts remain historical.

## Implemented scope and limits

Reviewed document findings are typed sources for existing questions/hypotheses, with current authority/reviewer verification, immutable withdrawal and decision-source history, browser inspection and independently verified frozen report joins. [Reasoning contract](docs/80_DOCUMENT_REASONING.md).

Opt-in AES-256-GCM original objects authenticate versioned headers and tenant/case/evidence paths. API, integrity/dispatcher and qualified native/OCR/raster workers preserve exact original digests/citations/derivatives/exports. Protected separate keys support new-write rotation and fail-closed removal. No new dependency or copied source. [Configuration, threat boundary, reproduction and rollback](docs/81_ENCRYPTED_ORIGINAL_CUSTODY.md).

Encryption covers original objects only. Database metadata/derivatives/reports, upload staging, downloads and full backup/key/session recovery are still unmet. No silent conversion of retained plaintext originals. Scripted fictional reviews do not establish professional human acceptance, general OCR accuracy or pixel fidelity. Real identity/MFA, KMS/WORM/provider, native devices/offline and independent security/privacy/legal/licence gates remain open. Local Docker/PostgreSQL are absent and namespace restrictions remain; actual isolated evidence came from supported hosted workflows.

## Current identity increment (pending hosted acceptance)

Feature branch `feat/provider-identity-sessions` carries the post-merge custody receipts plus substantive opt-in provider sign-in. Migration 033 maps a verified issuer/subject to an existing membership; no token role or email enrolment. One-use browser-bound state, S256 PKCE, pinned RS256 validation, required assurance claims, profile/epoch/session revocation, administrative binding history and actual web sign-in are implemented. No upstream dependency/artifact incorporated. See docs/83 for configuration, limited-profile decision, licence-file observations and explicit remaining acceptance.

Local HTTP/RSA protocol and protected-configuration tests passed (2 tests covering adverse variants). Hosted PostgreSQL/API/browser tests are written but pending. Do not mark real provider or MFA acceptance complete from the fictional protocol fixture.

## Next substantive execution

Inspect fresh main/PR feedback and preserve overlapping work; do not rerun unchanged implementation merely to re-report these receipts. Finish the identity branch hosted acceptance and review, retaining these post-merge receipts; then actual provider/invitation/MFA qualification and remaining encrypted platform custody/restore. Use the catalogue's pinned candidates and selected-artifact checks for identity integration rather than another case model or duplicate scheduler. Follow with chronology/search/reviewed graph/cited intelligence/interviews/native field/team/agency criteria in the canonical plan. Full product is incomplete. No production, live collection, spending, outside contact or future automatic merge is authorised by this task.
