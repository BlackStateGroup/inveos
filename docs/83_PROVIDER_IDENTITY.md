# Provider identity sessions (restricted integration profile)

This increment replaces the demo session entry point when explicitly configured. It does **not** certify a deployed identity provider, real MFA, account recovery, invitations, production authentication or privacy approval. The development-only startup gate remains. Use fictional accounts only.

## Decision and catalogue use

The catalogue's Keycloak and Ory Kratos candidates remain external identity-system options. Keycloak's OIDC interface fits the existing server application boundary; adopting Kratos would require a separate identity/session integration and an OIDC authorisation-server decision. This increment selects an original, deliberately narrow OIDC relying-party profile using the existing Node crypto/HTTP runtime. It does not implement passwords, OTP enrolment or an identity server. The first-party HTTP/RSA test fixture checks this protocol boundary; it is not Keycloak, Kratos or a real authenticator.

The existing `research/locked_revisions.json` contains no Keycloak/Kratos entries. Do not invent revision pins from catalogue labels. Read-only licence inspection on 29 October 2026 found Apache-2.0 text in Keycloak `LICENSE.txt` (Git blob `d645695673349e3947e8e5ae42332d0ac3164cd7`) and Kratos `LICENSE` (`261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64`). These identify inspected licence files, **not** approved runtime artifacts. No upstream source, binary, container, SDK, model or dataset is incorporated. The application lockfile/dependency inventory is unchanged. Before a provider is selected for distribution or deployment, pin its release/source/container digest and review the entire selected artifact's dependencies, notices, terms, provenance, vulnerabilities and restore behaviour. No comparative performance or maintainability benchmark has run; do not infer superiority from interface fit.

Protocol references: [OIDC Core §3.1](https://openid.net/specs/openid-connect-core-1_0.html#CodeFlowAuth), [ID token validation](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation), [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636.html). No implementation code was copied. The limited profile trades automatic discovery/key refresh and broad interoperability for explicit endpoint/key configuration and a small reviewable surface. A mature client library should be compared before broad production interoperability, including its actual selected dependency artifacts.

## Configuration and enrolment

Apply migration 033 with the existing admin migration command. The API still requires `INVEOS_DEV_LAB=1` and refuses production. Set:

```
INVEOS_IDENTITY_MODE=oidc-pinned
INVEOS_IDENTITY_CONFIG=/absolute/protected/fictional-oidc.json
```

The file must be a regular non-symlink private file (0600), at most 32 KiB. Its format is:

```json
{
  "format": "inveos_oidc_pinned_v1",
  "issuer": "https://identity.example.invalid/realms/fictional",
  "authorizationEndpoint": "https://identity.example.invalid/realms/fictional/protocol/openid-connect/auth",
  "tokenEndpoint": "https://identity.example.invalid/realms/fictional/protocol/openid-connect/token",
  "clientId": "inveos-fictional",
  "redirectUri": "https://workspace.example.invalid/api/auth/callback",
  "returnUri": "https://workspace.example.invalid/",
  "requiredAcr": "operator-defined-required-assurance",
  "requiredAmr": ["pwd", "otp"],
  "keys": [{"kty":"RSA","kid":"replace-from-verified-provider","alg":"RS256","use":"sig","n":"REPLACE_WITH_VERIFIED_PUBLIC_MODULUS","e":"AQAB"}]
}
```

The illustrative modulus is intentionally unusable. Verify public keys through the provider operator's trusted channel; do not fetch a token-supplied URL. Register the **exact** redirect URI and public-client code flow with required S256 PKCE; prohibit implicit/password grants. The API/UI share an origin. Put that exact origin in `INVEOS_ALLOWED_ORIGINS`. URLs must be canonical, without credentials, queries or fragments; provider endpoints share the issuer origin. HTTPS is mandatory except explicitly labelled loopback tests (`INVEOS_IDENTITY_LOOPBACK_TEST=1` with the development gate). Never use that exception for an external host. No public identity infrastructure is created by these instructions.

An operator with the disposable database-admin connection must enrol a verified issuer/subject to an **existing** membership. Email, display name, tenant and role claims never enrol accounts or grant access. Example, using fictional IDs and a provider-verified fictional subject only:

```sql
INSERT INTO identity_bindings(id,issuer,subject,tenant_id,user_id)
VALUES ('00000000-0000-4000-8000-000000000082',
        'https://identity.example.invalid/realms/fictional',
        'verified-fictional-subject',
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002');
```

This admin-only bootstrap is not a completed invitation or agency-management workflow. Issuer/subject maps to one tenant/user; it cannot be reassigned. Existing case memberships still control each case. The application DB role can only read bindings. Database triggers retain enrolment/revocation history with the executing database role. Revoke with an admin update of `revoked_at=now()`; revocation is irreversible for that subject. This intentionally requires an explicit new subject to re-enrol, rather than resurrecting old sessions.

## Sign-in, session and failure behaviour

Open the persistent workspace; the connect dialog discovers `/api/auth/mode` and offers provider sign-in. If the mode cannot be read, it does not silently request a demo session. `/api/session/start` is disabled in provider mode. The browser leaves for the configured provider and returns to the fixed workspace URI (or the same-origin `/portal` for a server-side client membership). The separate recipient surface also offers provider sign-in, never starts a demo reviewer session, and still lists only explicitly granted disclosures. The workspace profile displays the authenticated server name and role. No return URL is accepted from a request.

A five-minute browser-bound, hashed PostgreSQL state record permits one callback, including across API restarts. A private SameSite=Lax cookie supplies the nonce/PKCE derivation secret; neither authorisation code, ID token, access token nor PKCE secret is retained in PostgreSQL. Callback consumes state before exchanging the code. Cross-browser, expired, replayed, epoch/profile-mismatched and errored callbacks fail closed. Outstanding attempts are capped at 10,000; expired entries are removed in bounded batches on start. Route rate limits apply. Token fetch uses a fixed endpoint, five-second deadline, no redirects, a 16 KiB response bound and strict duplicate-key JSON parsing.

Only pinned RS256 keys (2048–4096 bits, exponent 65537, explicit unique key IDs) are supported. Issuer, single audience, optional authorised party, nonce, issue/expiry/not-before/authentication times and required ACR/AMR must match. Unsupported JWT headers, algorithms and multiple-audience profiles are rejected. Required assurance strings must be aligned with the selected provider's actual authentication policy. Merely returning `otp` does not prove a real second factor was exercised.

Local session and CSRF cookies preserve the existing authenticated API and CSRF/origin checks. The opaque session cookie is HttpOnly/Lax (to permit the top-level provider return), CSRF Strict; HTTPS configurations set Secure. Current membership and identity revocation are checked on every request. A concurrent revocation may leave an unusable newly issued session row; it cannot authenticate after revocation. Provider claims cannot turn a client into a reviewer. Configuration changes invalidate prior provider sessions and pending attempts through an exact profile fingerprint. Session epoch rotation still invalidates all old sessions. Demo/provider modes cannot use each other's sessions. Existing logout and other-session revocation remain applicable; provider logout/refresh/back-channel logout are not implemented.

## Reproduction and remaining acceptance

Local protocol/configuration checks: `node --import tsx --test apps/api/test/oidc.test.ts`. They run actual local HTTP and RSA, including tampering, replay, incorrect claims, insufficient assurance, oversized responses, redirect refusal, unsafe keys/files and wrong PKCE.

Run `npm run build`, then the existing disposable PostgreSQL setup and `npm test --workspace @inveos/api`. With `INVEOS_TEST_BROWSER=1` and sandboxed Chrome installed, `identity.test.ts` drives the actual built web app through the fictional provider redirect, creates a case, reloads it and observes immediate revocation. The same suite covers durable state, concurrent callback consumption, current role restrictions, unbound subjects, restart, epoch/profile invalidation and restricted DB grants. Hosted Checks is the supported execution environment where local PostgreSQL/Chrome isolation are unavailable. Record exact run/commit receipts in BUILD_HANDOFF; a written test is not a passing receipt.

Remaining: actual pinned-provider artifact qualification, real MFA and recovery, expiry/refresh/logout interoperability, operator invitation/contractor/client lifecycle, external TLS/proxy review and logs (strip callback query strings), independent security/privacy review, complete encrypted database/derivative/backup recovery and native devices. This profile remains development-only and is not production readiness.
