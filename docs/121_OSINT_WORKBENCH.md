# Controlled OSINT collection workbench

WP09 is required and remains incomplete. This connected increment is in development on `feat/osint-workbench`, based on main113 `bbef17122056fa574bf9288963d3d70e815a3e4a`. Draft PR115 is open and incorporates validated media/main114. OSINT has not been merged, browser accepted or approved for live provider collection. Do not present the old PR6 preview as this implementation.

## Implemented behaviour

Tenant source-policy proposals bind an exact adapter/profile, inspected-terms reference and digest, declared lawful basis, minimisation, retention, expiry and request allowance. Another current reviewer records a distinct approval/rejection. New policy versions immediately supersede prior versions; withdrawals are retained. Proposals and decisions produce tenant audit events. These are recorded declarations, not automatic legal certification.

An assigned case reviewer authorises one exact company identifier under current case authority and the approved source-policy version. Permission expires within24 hours and cannot exceed source-policy expiry or case/source retention. Investigator-queued jobs retain their requester and scope. No automatic fan-out or retry occurs. Case/policy/actor membership are rechecked before execution, during the request and before committing results. Cancellation aborts in-flight HTTP work and fences late responses. Abandoned leases fail with an unknown-outcome code; they never silently repeat a request.

A PostgreSQL sliding-window reservation is shared across workers/tenants using the same credential fingerprint. Failed attempts consume their reservation. Provider429 responses create durable shared back-off records. The fixed-host HTTPS transport denies redirects, special-use destinations, compressed/oversized/truncated responses, credentials in URLs and ambient proxy configuration. DNS is checked and the selected public address pinned for the TLS request. No provider credentials have been obtained or exercised.

Successful bounded JSON responses retain original bytes using the existing original store, including encryption when configured. The capture receipt retains the original digest, exact profile/authority/policy, response timestamp meaning, receive time, ETag and selected company fields with JSON-pointer references. HTTP response Date is explicitly not company-record creation time. Missing response time fails explicitly. Unknown provider fields remain in the original but are not automatically interpreted; linked officer/person/ownership URLs are never followed. Registered-address data can still occur in the original, so minimisation is a recorded decision, not a claim that a profile is free of personal information.

A source record is created in the same transaction. Metadata and source-use reviews remain outstanding, so analysis/release are denied by existing source controls. Source claims/findings use the existing separate human review workflow. Historical collection context exports contain original bytes, receipt, policy approval and scoped authorisation. The standalone verifier rederives selected JSON-pointer values and checks hashes, scope, independence, expiry and approval chronology; it does not authenticate actors, certify truth or approve current use/disclosure.

The Research page connects source policy, history/withdrawal, case authorisation, queue/cancel, capture inspection, original opening and internal context download. Captures explicitly distinguish `fictional_fixture` from `provider`. Current UI states live collection is disabled.

## Run the fictional workflow

Install locked dependencies with `npm ci`; migrate disposable PostgreSQL through the schema-administrator setup in README, then run the API/worker as `inveos_app`. Existing `INVEOS_DEV_LAB=1`, database/original-storage and encryption settings apply. The local runtime rejects production mode. No new application dependency is required.

In Research, propose a clearly labelled fictional source policy, have another reviewer accept that fixture declaration, and authorise company `FIC00001` under current fictional case authority. Queue its profile. Run one explicitly scoped local fixture job:

```sh
node --env-file=.env --import tsx apps/api/src/run-collection-fixture.ts TENANT_UUID CASE_UUID JOB_UUID
```

This command serves the tracked fictional JSON over loopback HTTP and cannot call Companies House. It labels the capture fictional. The separate fixed-host provider transport is implemented but not activated through the app or this command. No live investigative request is authorised by these instructions.

Refresh the workbench, inspect the capture and source context, and download the internal package. Copy the trusted standalone verifier out of the repository and run:

```sh
python3 verify_collection_context.py collection-context-JOB_UUID.json --expected-sha256 TRUSTED_CONTEXT_DIGEST
```

The digest is of the canonical payload, not the JSON download's formatting. Retain a trusted fingerprint separately; a self-contained hash does not establish authenticity.

## Actual verification and retained failures

Five focused real restricted-PostgreSQL checks pass, including actual loopback HTTP response/cancellation, preserved originals, independent policy decisions, case boundaries, withdrawal/access changes during work, durable quota/back-off across pool instances, malformed/duplicate JSON, mismatched company identity, missing response time and abandoned-lease behaviour. The API export verifies using a copied standalone Python verifier outside the repository and rejects a rehashed JSON-pointer value substitution. Latest log `/tmp/inveos-osint-api-fourth.log`:5/5,zero skips. Type checks/lint pass (`...-export-types.log`, `...-export-lint.log`).

First focused run passed3/5: the test incorrectly treated the original-download endpoint as JSON, and cancellation was returned as a generic failure. The original assertion now compares downloaded raw bytes; the worker preserves an explicit cancelled result when transport aborts. Second run passed4/5 because the test used an incorrect source-use route. Corrected third/fourth runs pass5/5. Preserve `...-api-first.log`, `...-api-second.log`, `...-api-third.log`.

The first broad local Node run passed410,failed5,skipped47browser checks (462total). The newly appended tests exhausted the shared Fastify instance's per-IP request limit. The new fixture now starts a fresh API instance, following existing suite patterns; application rate limits are unchanged. Preserve `/tmp/inveos-osint-full-api.log`. Broad revalidation, actual browser renders, fixture CLI execution, transport failure qualification, independent verifier negative corpus and full review are still pending. Do not mark these complete from focused tests.

## Open gates and limits

The provider method/schema were checked against official documentation; exact service/data terms and source-specific legal approval remain open. The initial bounded profile accepts eight uppercase alphanumeric company identifiers only; the official endpoint describes a string, not a universal eight-character contract. It is not yet qualified across the provider's full identifier population. No live provider acceptance, representative coverage, production source approval or data licence clearance is claimed.

One company-profile adapter is not complete OSINT. Broader approved corporate/domain/web connectors, saved research workflows, receipt lineage in frozen findings/report exports, extracted-field review ergonomics, organisation credential administration, capacity/cleanup of append-only quota records and independent security/privacy review remain. Native on-site device capture, wider media/cited intelligence and platform delivery also remain open.

Pinned catalogue reuse and actual licence/runtime inspection are recorded in [research/osint/DECISION.md](../research/osint/DECISION.md). No research checkout/runtime dependency tree is incorporated. The attributed MIT policy-shape adaptation is local typed code with INVEOS authority, durable quotas and immutable provenance added.

Further focused acceptance passes7 checks (6 PostgreSQL/HTTP plus fixed-destination classification),with1browser check explicitly skipped locally. Captured-original verification, audit rollback/original cleanup, client denial, superseded-policy denial, full case-authority export and16 rehashed semantic mutations are covered. The new actual fixture command initially failed because reusing API configuration unnecessarily demanded an administrator database URL. The worker now reads only its restricted application database and original-store settings, preserving development/production guards. Its actual separate-process loopback test passes (`/tmp/inveos-osint-cli2.log`); first failure retained in `...-cli.log`.

The second broad run passed414,failed1,skipped47 (462total),but was invalidated by an agent workflow error: the verifier was extended with case-authority context while that run was still using the previous in-memory API implementation. The mismatched export/verifier correctly failed closed. Preserve `/tmp/inveos-osint-full-api2.log`; do not count it as a final acceptance run. Freeze the source and rerun the complete suite. No application integrity rule was weakened.

Frozen-source local regression now passes418Node,zero failures,47explicit browser skips/465total (`/tmp/inveos-osint-full-api3.log`);197Python passed; types/lint/build/foundation/actionlint pass. The seven collection API tests include actual separately spawned fixture CLI/loopback HTTP, and the additional transport classification test is a unit check only. No live-provider or native-device result is claimed. The new browser journey and development-effect replay are written but await hosted execution and render inspection.

Media PR114 currenthead `e8cc130bdbbd7981f2363e4e8552c92ad588bf94`: first Checks41052551875/job124051932410 failed one sandboxed Chrome startup before its assignment-test page opened (464/465Node); unmodified attempt2 is running with the same sandbox flags/deadlines. Its Docling research41052551835 passed; speech research41052561561 remains pending at this checkpoint. Earlier8c85917 passed all465Node/203Python and actual speech research41051211230,including3 real worker tests. Do not relabel the failed first attempt.

Initial hosted headc04e1e1 failed463/465Node,zero skips: an existing upload helper timing race and actual revoked-case data retained in the adjacent source panel. The helper now waits and clicks when enabled within the same deadline; OSINT denial refreshes the parent workspace so all revoked-case panels unmount. The browser assertion now identifies the revoked case and job, since another permitted case may legitimately have the same fictional company number. First desktop/mobile renders12976686384 inspected. No passed browser acceptance is claimed for that run. See `/tmp/inveos-osint-host-first.log`.

Combined main114 integration passes426Node,zero failures,48explicit browser skips/474total (`/tmp/inveos-osint-combined-api.log`),type/lint/build. Both branches' features, migrations059–062, test inventories and verification history are preserved. Independent collection verification now covers19 rehashed semantic mutations, including provider quota bounds and malformed terms digests. Corrected hosted/browser acceptance remains pending.


Combined headf965b3a Checks41055818183/job124062957692 passed473/474Node,zero skips. The new OSINT browser journey passed, including revoked-case removal. The existing provider sign-in browser failed immediately after Page.reload because its readiness predicate dereferenced document.body before navigation created it. The predicate and related navigation diagnostics now tolerate an absent body while retaining the existing deadline and final assertions. No sandbox or application control changed. Preserve /tmp/inveos-osint-host-second.log. Development replay/office stages were not reached; corrected-head full acceptance remains pending.


PR115 merged as14f058469cd41d2aa02117b38eb75b8a40aa19ac after source/access/privacy review and no feedback at fresh inspection. Exact head89f8ab50d2357db751f354672a3b67f7aa15a61e passed Checks41057540548/job124068749042:474Node/203Python,zero failures/skips,48production+11development browser journeys,actual office/host/lint/types/build. Desktop/narrow artifact12977497815 inspected. Whisper41057540425/job124068748115 passed actual native build/inference/failure repetitions and3 actual application-worker PostgreSQL checks,zero skips. Logs /tmp/inveos-osint-final-checks.log and /tmp/inveos-osint-final-whisper.log. Resulting-main acceptance is pending. Prior failed runs remain recorded. Live provider collection remains disabled; provider terms/TLS/coverage/approval gates remain open.
