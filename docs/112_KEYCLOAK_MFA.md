# Actual Keycloak MFA qualification

This increment connects the existing strict pinned OIDC relying party to actual Keycloak with a mandatory password/OTP flow and fictional enrolled users. It adds no application package or production deployment. Actual execution passed at reviewed head `eaab214cacbe824d48b9613843cd3ca3f99ef995`: all19 named provider/browser checks, actual provider boundaries and destructive host probes passed. PR #106 is merged; exact receipts are below. This is disposable integration qualification, not production approval.

## Source and runtime provenance

Catalogue source `keycloak/keycloak`, release 26.8.1, pinned `24ed1dadf3f246a555adb6d3d4a99e9b3003fb3b`, acquired with `tools/mine_sources.py` into ignored `.research-cache/sources/keycloak/keycloak`. Actual root LICENSE.txt is Apache-2.0. Inspected pinned flow documentation, `AmrProtocolMapper`, `AmrUtils`, conditional LoA authenticator, `TimeBasedOTP` and container Dockerfile. The first-party fixture uses documented flow/configuration fields. No upstream Java, UI or authenticator implementation is copied or rewritten into the application.

Exact linux/amd64 provider image: `quay.io/keycloak/keycloak@sha256:3e1ac632e743660017b1e6bb4c3ffc800fd02c82cdd0db858cd03456a98a8dfc`; image configuration `sha256:b55801be6ce15109868bd056dc18d62d47106bfaad7ffbd1a5d804192ec98257`. Published index at observation: `sha256:a78d6b79572168cb25886b80a8b5b8d4ed4390743e3eecb810538683e209dd6b`. The image labels identify the separate official release-build repository `keycloak-rel/keycloak-rel` revision `26018f2a4c6155cfe2c28f078996390bf5191946`. This is a published binary qualification, **not** proof that the application source pin reproducibly builds that image.

`tools/qualify_keycloak.py` verifies exact manifest/configuration, the 173,795,291-byte provider layer and published 7,523,238-byte third-party notice (`14c17647c43f27315d148812a0be6b97b3cc9585463588ebbe67f7282cfe661d`). It inventories **486 actual JARs**, whole-file hashes and embedded notice hashes without extracting or executing them. The published notice includes Apache/BSD/MIT/ISC/EPL/UPL and GPL/LGPL entries; for example MySQL connector and Nashorn GPL entries and MariaDB LGPL. The root Apache label does not cover all bundled components. The UBI/JDK base, file-specific redistribution obligations, source closure, release signature authentication, vulnerability review and operator licence approvals remain open. No runtime binary or downloaded notice is committed or redistributed in the app. Test-only execution is separate from incorporation or production approval.

## Behaviour and boundaries

The realm disables registration, password reset, email login, direct password grants, service accounts and implicit flow. Four clearly fictional users have fixture-only passwords and TOTP seeds. Their identities never determine application roles: explicit immutable issuer/subject bindings join existing PostgreSQL memberships. An unbound provider identity remains denied.

Password and OTP executions carry `pwd`/`otp` references with bounded age. The second factor sets actual LoA 2; the client requests/requires 2. The built-in AMR mapper includes successful executions, and the ACR mapper includes attained assurance. No hard-coded claim mapper fabricates assurance. INVEOS still validates RS256, exact pinned public keys, issuer, audience, nonce, PKCE, times and required ACR/AMR. Public JWK normalisation discards unused provider certificate metadata at the test provisioning boundary; application validation is unchanged.

A disposable container runs non-root, capabilities dropped, no-new-privileges, read-only root/fixture, bounded memory/CPU/PIDs and ephemeral noexec scratch. An internal Docker network and a bounded loopback-only ingress proxy allow the test browser/API to reach the provider without public egress. The provider container publishes no ports. The proxy targets only its captured private address and allows the fictional realm/resources paths; it never logs request/query/cookie contents. Startup copies the published provider into ephemeral scratch for Keycloak's augmentation; upstream application code executes only on the qualified host. Existing destructive host probes use the already-present PostgreSQL service image; the provider gets separate actual read-only, resource and egress probes. Own container/network/browser/schema/storage are removed after the run. No host sandbox flags are disabled.

The integration journey exercises actual wrong password, password alone, expired/malformed OTP, valid OTP, HttpOnly cookies, consumed callback replay, case creation/reload, API restart, binding withdrawal, denied re-login, unbound identity, unassigned case, restricted client, no implicit disclosures, logout and rejection of a real token missing a required hardware method. It records named outcomes and a fictional workspace render. No tokens, browser profiles, passwords or OTP seeds are exported as receipts.

## Reproduction and evidence

Use a disposable Linux Docker/Chrome host and the documented restricted PostgreSQL `inveos_test` setup. Never point the test at production. Ports 58991/58992 must be free. Source acquisition and artifact verification can run without execution:

```sh
npm ci
python3 tools/mine_sources.py --fetch keycloak/keycloak
python3 tools/qualify_keycloak.py --fetch
python3 tools/qualify_keycloak.py
npm run build --workspace @inveos/web
docker pull quay.io/keycloak/keycloak@sha256:3e1ac632e743660017b1e6bb4c3ffc800fd02c82cdd0db858cd03456a98a8dfc
# The disposable postgres:15 service image is already present for host probes.
python3 tools/qualify_keycloak.py --run
```

Export `INVEOS_TEST_DATABASE_URL` and `INVEOS_TEST_ADMIN_DATABASE_URL` for that disposable database. `.github/workflows/keycloak-research.yml` performs the complete sequence. `output/evals/keycloak/` holds inventory, host and browser receipts and the fictional render. Keep failed attempts and actual counts here after execution.

This does not establish production identity approval, self-service enrolment/new-account invitations, provider recovery/availability, live key rotation, hardware-factor enrolment, native-device MFA, credential revocation propagation from the provider, professional/security acceptance or production readiness. Application binding withdrawal and logout are local controls; a provider-disabled account's already-issued INVEOS session is not automatically invalidated by this test.

Initial head `05bfdf06746f316174f3b6215cedef3d438322ee`, actual-provider run **41016566567 / job 123934124385 failed**: pinned acquisition/offline inventory/image pull and destructive host probes completed, but Keycloak did not become reachable within the 100-second startup deadline. **No provider browser/OTP acceptance ran.** The process had no retained diagnostic output; a follow-up keeps its bounded ephemeral startup log available after process exit for diagnosis. Do not relabel this run passed.

Diagnostic head `6abecc8c1544cc52e8331858038b5ae260dab93e`, actual-provider **41017078396 / job 123935738761 failed before browser execution**. The bounded log identified a fixture error: Keycloak requires `inveos-fictional-realm.json`, matching realm `inveos-fictional`. The corrected filename preserves all isolation settings. The runner now detects an exited provider promptly while keeping its bounded ephemeral diagnostic readable. Three new first-party acquisition checks pass for exact offline bytes, missing/changed artifacts and broken/parent symlinks; these are not MFA tests. Initial Checks41016566602/job123934124994 was cancelled during the API suite after 175 Python tests; it is not a complete passing run.

At `f77b7332f6476bb30bf7af3b60a9b6363da91e8c`, **41017467044 / job 123936938725 failed readiness** after the real provider imported the realm and started successfully. On this host the published port on the internal Docker network was unreachable. The follow-up retains the internal network and adds a bounded host loopback ingress proxy to the container’s private address; no external egress or sandbox exception is enabled. No browser/OTP acceptance ran in that failed attempt.

At `7a6b800a61a21541ec1614555d3b527739256e25`, **41017973375 / job 123938513285** successfully started the provider, reached it through bounded ingress and passed the actual provider boundary probes. Its browser journey **failed** when an assertion read `document.body.innerText` during full-page navigation while the body was absent. The follow-up waits with a nullable body check and records completed named checks on failure. This is partial live-provider evidence, not a passing OTP journey.

At `369ee2daf82ba1cdd6c84b0f4431d50bd880b063`, **41018315244 / job 123939585740 failed the complete journey** after four actual negative checks passed: wrong password, password alone, expired OTP and malformed OTP. Valid OTP advanced to Keycloak’s required profile-update page because the fictional imported users lacked required names/email. The fixture now supplies explicit fictional names and `example.test` addresses; no email is sent. Provider policy is not weakened or fabricated.

At `6683f2997c9dc05a66b576f3e131cbb17cefdf86`, **41018638990 / job 123940604006** passed fourteen named checks, including actual password+OTP, signed ACR/AMR validation, case creation/reload, API restart, immediate binding withdrawal, denied re-login/unmapped subject and unassigned-case denial. The complete journey still **failed** because its client-case assertion expected 403 while the existing case boundary correctly returned 404. The expectation is corrected to the observed non-disclosing denial; server access policy is unchanged.

At `b990785369a293f9bf80370482b809d5e3ee4c55`, **41018961445 / job 123941627781** failed during the reviewer’s second OTP sign-in: the test reused a previously accepted code in the same time step, and actual Keycloak rejected it. Eleven named checks had passed. The fixture now waits for the next real TOTP step when reusing an account; replay protection remains enabled and no future/stale code is substituted.

## Completed qualification

PR **#106** merged as `5b9a9cdccf44004c1496a6ec1ca078d2d4bc4fb8`. Reviewed head `eaab214cacbe824d48b9613843cd3ca3f99ef995` passed **Checks41019350483 / job123943045424: 423 Node/178 Python, zero failures/skips, 41 production plus four development browsers**, actual office/host acceptance, lint/types/build. **Actual Keycloak41019350489 / job123942878250 passed all19 named checks in one complete real provider/browser journey**, plus actual provider boundaries and destructive host probes. Actual OTP/workspace renders inspected; source/privacy review complete, no outstanding feedback. Pinned binary/runtime/notice inventory is research qualification, not production/licence/security approval. Failures and limits remain in docs/112. Resulting-main **Checks41020517564 is pending**.

