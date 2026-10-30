# Actual Keycloak MFA qualification

This increment connects the existing strict pinned OIDC relying party to actual Keycloak with a mandatory password/OTP flow and fictional enrolled users. It adds no application package or production deployment. Actual execution remains pending at this checkpoint; source acquisition, inventory, type/lint checks are not MFA acceptance.

## Source and runtime provenance

Catalogue source `keycloak/keycloak`, release 26.8.1, pinned `24ed1dadf3f246a555adb6d3d4a99e9b3003fb3b`, acquired with `tools/mine_sources.py` into ignored `.research-cache/sources/keycloak/keycloak`. Actual root LICENSE.txt is Apache-2.0. Inspected pinned flow documentation, `AmrProtocolMapper`, `AmrUtils`, conditional LoA authenticator, `TimeBasedOTP` and container Dockerfile. The first-party fixture uses documented flow/configuration fields. No upstream Java, UI or authenticator implementation is copied or rewritten into the application.

Exact linux/amd64 provider image: `quay.io/keycloak/keycloak@sha256:3e1ac632e743660017b1e6bb4c3ffc800fd02c82cdd0db858cd03456a98a8dfc`; image configuration `sha256:b55801be6ce15109868bd056dc18d62d47106bfaad7ffbd1a5d804192ec98257`. Published index at observation: `sha256:a78d6b79572168cb25886b80a8b5b8d4ed4390743e3eecb810538683e209dd6b`. The image labels identify the separate official release-build repository `keycloak-rel/keycloak-rel` revision `26018f2a4c6155cfe2c28f078996390bf5191946`. This is a published binary qualification, **not** proof that the application source pin reproducibly builds that image.

`tools/qualify_keycloak.py` verifies exact manifest/configuration, the 173,795,291-byte provider layer and published 7,523,238-byte third-party notice (`14c17647c43f27315d148812a0be6b97b3cc9585463588ebbe67f7282cfe661d`). It inventories **486 actual JARs**, whole-file hashes and embedded notice hashes without extracting or executing them. The published notice includes Apache/BSD/MIT/ISC/EPL/UPL and GPL/LGPL entries; for example MySQL connector and Nashorn GPL entries and MariaDB LGPL. The root Apache label does not cover all bundled components. The UBI/JDK base, file-specific redistribution obligations, source closure, release signature authentication, vulnerability review and operator licence approvals remain open. No runtime binary or downloaded notice is committed or redistributed in the app. Test-only execution is separate from incorporation or production approval.

## Behaviour and boundaries

The realm disables registration, password reset, email login, direct password grants, service accounts and implicit flow. Four clearly fictional users have fixture-only passwords and TOTP seeds. Their identities never determine application roles: explicit immutable issuer/subject bindings join existing PostgreSQL memberships. An unbound provider identity remains denied.

Password and OTP executions carry `pwd`/`otp` references with bounded age. The second factor sets actual LoA 2; the client requests/requires 2. The built-in AMR mapper includes successful executions, and the ACR mapper includes attained assurance. No hard-coded claim mapper fabricates assurance. INVEOS still validates RS256, exact pinned public keys, issuer, audience, nonce, PKCE, times and required ACR/AMR. Public JWK normalisation discards unused provider certificate metadata at the test provisioning boundary; application validation is unchanged.

A disposable container runs non-root, capabilities dropped, no-new-privileges, read-only root/fixture, bounded memory/CPU/PIDs and ephemeral noexec scratch. An internal Docker network and a loopback-only published port allow the test browser/API to reach the provider without public egress. Startup copies the published provider into ephemeral scratch for Keycloak's augmentation; upstream application code executes only on the qualified host. Existing destructive host probes use the already-present PostgreSQL service image; the provider gets separate actual read-only, resource and egress probes. Own container/network/browser/schema/storage are removed after the run. No host sandbox flags are disabled.

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
