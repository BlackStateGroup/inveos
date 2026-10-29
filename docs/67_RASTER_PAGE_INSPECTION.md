# Verified raster page inspection

29 October 2026. Continues PR #57. Successful raster jobs now offer an internal page-image inspector. It binds the receipt to the selected case/job/evidence/authority and verifies manifest/profile digests, supported geometry and explicit limitations. Page downloads use same-origin credentials and no-store, are bounded to the declared size, and must hash to the manifest before creating a temporary browser blob URL. Decoded dimensions must agree. Page changes, reload, processing actions and unmount discard old display; effect cleanup aborts downloads and revokes URLs. Failed requests never keep the old image visible.

The interface labels images as unreviewed derivatives with forms/annotations omitted and fidelity unapproved. It preserves quarantine, original/source/processing identities and existing review gates. No browser persistence, external requests, new dependency, automatic queueing, findings or approval controls are added.

## Reproduce

Run `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:foundation` and `node --import tsx --test apps/api/test/raster-inspection.test.ts`. Follow `.github/workflows/checks.yml` for disposable PostgreSQL roles and environment, then `INVEOS_TEST_BROWSER=1 npm test --workspace @inveos/api`. Browser coverage selects both pages, reloads the app, reinspects, corrupts the fictional original and checks that reload refuses delivery and removes the image. API fixtures replay PR #54 PNGs; this is not fresh renderer execution. PR #57 records actual leased rendering evidence.

## Remaining

Extraction overlays, explicit human-reviewed derivative citations, export verification, wider fidelity/accessibility/device acceptance and production identity/storage remain open. A page already seen cannot be recalled from human memory or screenshots; permission and original checks run on each fresh server request. The client does not poll for revocation. Nothing merged, deployed or approved for live data.

## Executed evidence

Draft PR #58 passed [Checks #150](https://github.com/BlackStateGroup/inveos/actions/runs/40844856814), job 123349742600, at `47ed7c886e75a0a89b90ecceebec462d9b4b5539`, tree `ca84088c513bb2dd12b58cb1d4b08b336b8e713a`: 185 Node tests and 101 Python tests, zero failures/skips, plus lint/types/build/reference, actual PostgreSQL/browser/restore and host-isolation checks. The expanded browser journey displayed both verified pages, reloaded and reinspected, then refused a fresh download after original corruption and removed the image. Three new client verifier tests passed. Local lint/types/build, the three focused tests, foundation and all 101 Python tests passed. This run replays prior raster bytes; no fresh renderer execution or human citation approval is claimed. Evidence follow-up changes documentation only. Resume #58 after fresh main/review checks.
