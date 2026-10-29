# Document search and exact extraction inspection — 29 October 2026

Application `4c9b60e25030a58bcd8e3a9b925e799715b51964`, integrating merged OCR #89, passed [Checks 40970498736](https://github.com/BlackStateGroup/inveos/actions/runs/40970498736), job 123785749133: **329 Node/124 Python, zero failures/skips, 29 sandboxed browser journeys**, lint/types/build/foundation and worker-host probes. [Research 40970498729](https://github.com/BlackStateGroup/inveos/actions/runs/40970498729), job 123785748703, passed actual encrypted native/OCR supplier search and browser reinspection, retained source review, frozen export/package/PDF delivery, the OCR adversity corpus, repeated raster and five daemon-failure tests. [Machine supplier receipt](document-search-supplier-receipt.json).

The test-proxy shutdown fix at `8bb762b57144a98676bf81a25c27b78bda03bafd` passed [Checks 40971070659](https://github.com/BlackStateGroup/inveos/actions/runs/40971070659), job 123787650359: **331 Node/124 Python, zero failures/skips, 29 browsers**. All lifecycle cleanup stages completed. [Research 40971070725](https://github.com/BlackStateGroup/inveos/actions/runs/40971070725), job 123787650625, passed actual supplier search, adversity corpus, repeated raster and all five daemon tests. The machine receipt records this revision. The final review limits automatic focus to search-selected inspection so ordinary history/image comparison retains its prior behaviour; that small change requires final hosted checks before merge.

## Verified behaviour

- Published native/OCR text is a distinct unreviewed record kind. Queries use current server case membership and literal phrases, bounded excerpts and keyset pages. No source claim or finding is created by search.
- Actual PostgreSQL and HTTP checks deny cross-tenant/case, client, revoked-member and missing-CSRF access. Repeated extraction identities remain distinct across 51-result pagination. Restart retains results.
- Stored search remains available after original corruption; opening the extraction rejects changed bytes. This distinction is explicit in the interface.
- The sandboxed browser opens an extraction hidden behind 26 newer jobs using Enter, moves focus to verified passages, reloads its exact job, rejects a corrupted original, retries after restoration and clears revoked context. A 390-pixel viewport remains within the page width.
- The separate actual worker journey searches newly generated native and OCR output over encrypted originals and reopens the exact OCR job. Retained-fixture tests are not substituted for this execution.

Source/privacy diff and the actual search/inspection renders were inspected. The new kind remains clearly labelled unreviewed; source inspection retains page references, offset basis and the existing review controls. No new dependency, external index, third-party source or real investigative data is introduced. Search text stays out of URL fragments; only the case/job identity is retained. Excerpts are not citations or integrity attestations.

[Search render](assets/document-search-desktop.png) · [Focused inspection render](assets/document-search-inspection.png). Both are from Checks 40970498736 at the application revision above; the later proxy-only test change does not alter their application source.

## Failures and corrections

Initial `1f1fe6b` passed Checks 40968963986 (329 Node/120 Python), including the new search browser, but Research 40968964033 failed the new browser POST: its separate test server allowed the localhost fixture origin, not the browser proxy's exact 127.0.0.1 origin. The fixture now registers that origin without weakening application checks. Research 40969660127 at `57ba08f` passed the corrected actual supplier search and all five daemon tests.

Checks 40969660138 at `57ba08f` failed the added keyboard step before extraction inspection (328/329 passed). The CDP Enter event sequence now includes its character text and separately asserts selected-job navigation. Checks 40970498736 confirms keyboard activation, focus, reload, corruption denial and retry.

Main #89 Checks 40969884003 timed out after all lifecycle browser assertions completed. The diagnostic milestones reached revoked-context clearing but not completed shutdown. A separate actual HTTP/Fastify reproduction demonstrated that the old browser proxy stranded an incomplete upload after client disconnection; explicitly destroying its upstream allowed API shutdown. The test proxy now propagates disconnects and tears down its own outstanding requests before closing the API, with two real HTTP regressions and detailed lifecycle cleanup diagnostics. The actual HTTP regression and full Checks 40971070659 pass, with all Chrome/API/proxy cleanup milestones complete. The failure history is retained rather than relabelling the failed main run. No production lifecycle defect is claimed from that timeout.

Representative long-document/capacity measurements, richer facets, shared views and bulk actions remain open. The declared SQL deadline bounds work; it does not certify production-scale performance. Main and merge state are recorded in BUILD_HANDOFF.md. Product completion and independent professional/security/privacy/legal/licence approvals remain outstanding.


Review head `a1b2a1f` passed Research 40971770591; Checks 40971770600 passed 330/331 tests and failed an existing supplied-source selection race. The test waited only for the panel heading before clicking a row that had not loaded. Its selector now waits for the enabled record and loaded selected context. Lifecycle cleanup, search focus/keyboard/retry and the other tests passed. The corrected full run is required before merge; no failed run is relabelled successful.
