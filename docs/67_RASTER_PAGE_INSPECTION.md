# Verified raster page inspection

29 October 2026. Continues PR #57. Successful raster jobs now offer an internal page-image inspector. It binds the receipt to the selected case/job/evidence/authority and verifies manifest/profile digests, supported geometry and explicit limitations. Page downloads use same-origin credentials and no-store, are bounded to the declared size, and must hash to the manifest before creating a temporary browser blob URL. Decoded dimensions must agree. Page changes, reload, processing actions and unmount discard old display; effect cleanup aborts downloads and revokes URLs. Failed requests never keep the old image visible.

The interface labels images as unreviewed derivatives with forms/annotations omitted and fidelity unapproved. It preserves quarantine, original/source/processing identities and existing review gates. No browser persistence, external requests, new dependency, automatic queueing, findings or approval controls are added.

## Reproduce

Run `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:foundation` and `node --import tsx --test apps/api/test/raster-inspection.test.ts`. Follow `.github/workflows/checks.yml` for disposable PostgreSQL roles and environment, then `INVEOS_TEST_BROWSER=1 npm test --workspace @inveos/api`. Browser coverage selects both pages, reloads the app, reinspects, corrupts the fictional original and checks that reload refuses delivery and removes the image. API fixtures replay PR #54 PNGs; this is not fresh renderer execution. PR #57 records actual leased rendering evidence.

## Remaining

Extraction overlays, explicit human-reviewed derivative citations, export verification, wider fidelity/accessibility/device acceptance and production identity/storage remain open. A page already seen cannot be recalled from human memory or screenshots; permission and original checks run on each fresh server request. The client does not poll for revocation. Nothing merged, deployed or approved for live data.
