# Supplied research workbench browser acceptance definition

## Base, ownership and evidence status

This focused branch starts at exact `origin/feat/platform-build-batch` commit
`e2f1f39df17955d5d8f4dd0980611012fadf01c7`. It adds only this document and two new
first-party test/support files. No application, migration, dependency, `api.test.ts`,
CI, central handoff or index edits are included.

**The browser definition has not been executed locally.** No Chrome launch was
attempted, and no browser, database, download-verifier or render acceptance is
claimed from compilation. Root owns the qualified hosted run and inspection of
retained screenshots. Prior hosted parser/worker results are separate evidence
and do not qualify this browser journey.

Actual local checks on the added files:

- `npm run typecheck -w @inveos/api` — passed, including the new integration/support
  TypeScript files (strict compiler checks).
- `npx --no-install eslint apps/api/test/research-workbench.integration.ts apps/api/test/support/research-browser.ts`
  — passed.

No test body, migration, browser, fixture transport worker, copied verifier or
screenshot capture in this definition has run in this checkout.

## Files and execution contract

- `apps/api/test/research-workbench.integration.ts`: three sequential adapter
  journeys, each with two separately reported source-navigation subtests.
- `apps/api/test/support/research-browser.ts`: disposable real API/PostgreSQL
  fixture, loopback static/proxy server and rendered-control interactions. It
  reuses the existing migration/restricted-pool fixture, sandboxed CDP harness and
  HTTP forwarding helper. It does not intercept or fabricate API responses.

Run from the repository root on the existing authorised sandbox-capable Ubuntu
host with existing dependencies, Node 22 and Python 3:

```sh
npm run build -w @inveos/web
node --import tsx --test --test-concurrency=1 apps/api/test/research-workbench.integration.ts
```

Required environment:

- `INVEOS_TEST_DATABASE_URL`: restricted application role, database `inveos_test`.
- `INVEOS_TEST_ADMIN_DATABASE_URL`: migration/fixture role for that disposable
  database. The helper creates and drops a unique schema for each journey.
- `INVEOS_CHROME_PATH`: optional existing Chrome executable (default
  `/usr/bin/google-chrome`). Browser sandbox stays enabled; no fallback flags.
- `INVEOS_ACCEPTANCE_ARTIFACTS`: optional artifact directory, preferably absolute.
  Default: `output/evals/research-workbench`.

The application role is checked for no superuser, database creation, role creation
or RLS bypass privileges. Only tenant/user/session fixture records use admin SQL;
case creation, authority, collaborator grants and revocation use real HTTP API
handlers. Seeded sessions are not a provider-login acceptance claim. Policies,
independent decisions, request versions, runs and captures are produced through
browser controls and the actual loopback API. There is no test skip on missing
Chrome/PostgreSQL and no browser launch on import of the support module.

Each journey has a 240-second test deadline, 15-second UI polling and fixture HTTP
limits, the existing 10-second CDP limit, and a 10-second copied-verifier process
limit. It closes its own browser, HTTP connections, API, pools, schema and temporary
storage. No production services, external collection, runtime installation or new
application dependencies are involved.

## What the hosted definition exercises

The same journey runs for `rdap_domain_v1`, `supplied_webpage_v1` and
`gleif_lei_v1`, using the existing clearly fictional JSON/HTML fixture bytes:

1. Select the source workflow. Propose bounded versioned endpoint/terms/credential
   policy through the form. A candidate cannot authorise a request; the author
   has no self-approval button, and an actual self-review API request is denied.
   A separate reviewer accepts the fictional policy. GLEIF's endpoint control is
   checked as read-only and exactly the fixed single-record endpoint.
2. Authorise request v1 through the reviewer form. Verify saved policy, authority,
   profile and request identities/digests against the real API. Investigators
   cannot authorise requests. Explicitly choose and queue a supplied capture.
3. Select an actual file through CDP's file input, declare media/capture mode,
   publisher, distinct source/retrieval times and fictional status, and preserve
   it. Assert exact original bytes, immutable digest, zero network requests,
   separate server receipt time, typed extracted fields and queued/running/succeeded
   history. Contact/person/relationship content is not extracted or traversed.
   Metadata acceptance, source use and report inclusion remain separate gates.
4. Download the internal context through the UI. Compare its embedded original
   and receipt with the preserved bytes/real API, then execute a copied standalone
   `tools/verify_research_context.py` outside the checkout with an empty PYTHONPATH.
   This helper has standard-library dependencies only; no new helper or offline
   kit closure is introduced.
5. Open the newly captured original immediately, without refreshing the workspace
   or reloading first. Assert exact evidence ID, filename and inert text bytes.
   The HTML fixture includes an additional fictional script sentinel and loopback
   image trap; no script execution, embedded media, linked resource or external
   browser resource request may result. This is supplied text preservation, not
   a webpage screenshot or transport capture.
6. Explicitly rerun and cancel; supply invalid UTF-8 to another run and inspect
   durable failure after refresh. No failed/cancelled run may acquire an exhibit.
   Correct the request to v2, preserve v1's digest/identity in history, reject a
   stale v1 rerun without creating another job, then explicitly capture under v2.
   Both immutable sources remain distinct. Registry v2 uses `fictional_fixture`,
   visibly separate from v1's `controlled_response` supplied capture.
7. Queue and cancel the labelled fictional RDAP/LEI transport job, checking its
   different execution mode, awaiting-worker notice and absence of supplied-file
   controls. **No transport worker is executed by this browser definition.**
   Provider activation stays disabled; these UI checks do not qualify a provider.
8. Refresh the supplied-source register, verify linked bytes, inspect metadata/use
   and context history, and navigate to the exact selected original identity.
   Both analysis and client release remain blocked pending independent decisions.
9. Propose policy v2 and verify that previous requests become unavailable; retain
   capture/request history and record explicit request withdrawal. While an
   investigator has run, request and verified-source detail loaded, remove current
   case membership through the owner access API and refresh. All case/source
   controls and sensitive loaded text must clear; actual run/original reads deny
   access, while authorised readers retain historical provenance.

The proxy records browser HTTP methods, paths and statuses (no cookies or request
bodies). It asserts actual browser writes to the expected endpoints and the
invalid-capture 422. Existing loopback CLI/transport, broad API, renderer, offline
verifier tampering and native-worker acceptance remain separate suites.

## Inspection finding to resolve on integration

At the inspected base, `App.tsx`'s `inspect(id)` only sets `selectedEvidence` and
navigates to Evidence. `ResearchWorkbench` refreshes its own request/run state
after capture but does not refresh the parent workspace. `EvidenceVault` resolves
selection only from `p.data.evidence`, falling back to its first item if the new ID
is missing. Thus immediate capture navigation appears able to show no original
or the wrong original until a workspace reload. The source register uses the same
callback. This is a **source-inspection finding, not a reproduced browser result**.

The first navigation subtest deliberately contains no reload workaround and is
expected to expose that path on the qualified host. The second checks the exact
identity from the source register, even when the two captured files have identical
bytes and names. Navigation subtest failures are reported independently so later
history/access checks can still run. The later normal page navigations switch
principals for separate checks; they do not turn either failed navigation into a
pass. No application fix is included because this assignment owns new tests and
support files only; root should reconcile the shared navigation callback.

## Artifacts and remaining gates

Each adapter's artifact subdirectory receives desktop (1440x1000) and narrow
(390x844) PNGs for capture, original navigation, failure state, version history,
source details, permission history and access clearing, plus registry queued-job
views. It also retains the UI-downloaded fictional context, copied-verifier stdout
and browser HTTP statuses. On outer failure it saves a failure screenshot and
visible fictional page text. Screenshot creation is not a visual acceptance
claim; root must retain and inspect the renders. Responsive overflow is not
independently asserted by this definition.

Still unrun here: actual schema/application fixture setup; all three sandboxed
browser journeys/subtests; UI download and copied verifier execution; invalid-input
and current-access runtime outcomes; screenshots/visual inspection. Runtime
outcomes and any product/test corrections must be appended after the hosted run.
Live provider terms, transport, coverage, operational policy and legal qualification
remain explicit gates. This work makes no production, provider approval, parser
qualification, evidence-truth or admissibility claim.
