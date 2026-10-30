# Reviewed speech in case reasoning

## Connected implementation

Reviewed speech interpretations now join questions, hypotheses and tasks as separately typed supporting, contrary or contextual sources. A same-case database foreign key binds the finding; an append-only withdrawal preserves the original link. Stable request identities and actor-bound retries follow the existing document/transcript workflow. Supporting or resolved assessments reverify the current speech correction, correspondence and interpretation decisions, original bytes and case authority.

Frozen reports retain only active links whose reviewed speech findings are present. Independent Python verification checks source family, case/work identity, relations, duplicate links and finding membership. PDF/DOCX whole-finding redaction withholds the speech link and relevance reason together with the interpretation. Working explanations remain separate from findings.

Case search distinguishes speech proposals from reviewed speech findings, retains withdrawn history, identifies stale corrected versions and links to the exact processing job. Search snippets are stored accounts, not fresh original-byte verification. Source-use permission and current tenant/case membership gate search and navigation. The reasoning source inspector does reverify the original and displays the selected account's UTF-8 offsets separately from audio times and original identity.

No new application dependency, external collection, model or parser is introduced. This builds on the bounded speech workflow in [120](120_SPEECH_WORKFLOW.md), whose catalogue source/runtime qualification and accuracy limitations still apply. Four new PostgreSQL tests use explicit fictional protocol output, not actual speech-recognition benchmarks. Actual speech inference/failure qualification remains in the separate unchanged research/application-worker CI.

## Run and verification

Install the existing locked workspaces, apply migrations063–064 through the disposable schema administrator and run the API as the restricted application role. Use the existing fictional speech workflow to preserve a WAV, process it, correct/independently review correspondence, propose an interpretation and obtain its separate independent review.

In Brief or Tasks, open the work record's source details and choose a reviewed speech finding. Inspect the selected source, record a supporting/contrary/context reason, and save. Later corrections require fresh review before a supported/resolved assessment. Withdraw superseded links explicitly to preserve history. Search this case offers separate speech interpretation/finding filters and opens the matching processing record.

```sh
INVEOS_TEST_DATABASE_URL=postgres://inveos_app@127.0.0.1:55474/inveos_test \
INVEOS_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:55474/inveos_test \
node --import tsx --test --test-concurrency=1 --test-name-pattern='speech reasoning|speech search' apps/api/test/api.test.ts
```

The first focused run passes4 actual PostgreSQL/API checks,zero skips (`/tmp/inveos-speech-casework-first.log`): concurrent stable retries, retained assessment sources, standalone report/exhibit verification, four invalid typed-link mutations, PDF/DOCX omission, stale correction/closure denial, cross-case/CSRF/membership denial, withdrawal history, search/saved views, atomic audit failure and corrupted original denial. Type checks and lint pass. Initial intermediate type check identified the two new search labels missing from the UI; both are implemented, with the failed checkpoint retained in `...-types1.log` and passing `...-types2.log`/`...-types3.log`.

Broad regression, populated migration acceptance, actual browser recovery/reload/search/narrow renders and exact final-head hosted acceptance remain pending. A browser journey is written; it has not run on this local host. No native mobile-device, large-case performance or new ASR accuracy evidence is claimed.

## Remaining gates

Speech source joins into alleged chronology, graph and review attention are now implemented in the parallel build phase; their acceptance checks remain unrun. This does not complete cited AI, long-recording/codecs, omission editing or native offline/device delivery. Preserve the historical model limitations, current source-use/release controls and full remaining plan in [71](71_REMAINING_DELIVERY_PLAN.md).


## Parallel implementation phase — 30 October 2026

The delivery instruction now prioritises connected feature implementation across parallel agents before combined acceptance. The earlier reasoning-only checkpoint remains separate: 432 Node checks passed with 50 browser skips out of482;203 Python checks passed, and the later populated-migration check passed separately. These results do not verify the following additions.

Migration064 adds same-case speech references to relationship sources while preserving old fingerprints. Speech findings can supply graph edges, sourced entity attributes and uncertain chronology accounts. Source inspection reverifies the original, derivative, correction and review lineage; later corrections/withdrawals mark relationships as needing review. Frozen chronology and the independent report verifier recognise the new source family.

The personal attention queue now includes exact speech interpretations and per-segment audio correspondence. Correspondence keys bind job plus segment; revisions bind derivative digest plus correction version. Requesters/correction authors are excluded; interpretation authors are also excluded from interpretation review. Assignment and acknowledgement history reuse the exact-version reviewer workflow. Navigation opens the exact job/segment or targeted claim, even outside the first list page. No reminder acknowledges or approves evidence. Current original, authority and source-use checks still occur on inspection and decisions.

Compilation passes for web, contracts and API (`/tmp/inveos-speech-build-feedback.log`). PostgreSQL migration, negative access/review states, standalone export, browser navigation and rendered layout checks for these additions are **not yet run**. They belong to the combined acceptance phase. The new API route returns an individual stored claim; it does not certify source bytes on listing. No new dependencies, external collection or model inference were introduced.
