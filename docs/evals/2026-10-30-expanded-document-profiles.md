# Expanded OCR/raster profile verification — 30 October 2026

Fictional fixtures only. Branch `feat/ocr-expanded-profile` includes verified main #91, merge `c86fa6d353d05a673da038357aaab2e90f8d03c8`. Its resulting-main Checks 40976004669 passed 340 Node/124 Python, zero failures/skips and 30 actual browsers. The retained attention render and final merge receipt are carried here alongside substantive profile engineering.

V2 implementation adds separate OCR/raster job kinds, matching original bounds, strict attachment/read reconstruction, independent package replay and browser/source comparison recognition. Legacy profile digests are asserted explicitly. A golden OCR boundary derivative digest was read from the unchanged #91 worktree to detect historical output drift. No dependency or model was added.

Local focused evidence so far: migration upgrade/idempotency and legacy document/raster integration pass (3 tests); expanded OCR/raster database attachment, profile substitution denial, quarantine, restart, current access, search labels and corrupt-source denial/recovery pass (with migration, 2 tests). Legacy/new boundary checks and independent Python replay pass; lint/build/type checks and 125 Python tests pass. The full local suite passed: 313 Node tests, 30 explicit browser skips (343 total), zero failures. Implementation `052a6401a1e3dcbae0340a28092783ca40a79b72` passed [Checks 40977462888](https://github.com/BlackStateGroup/inveos/actions/runs/40977462888), job 123808934666: **343 Node/125 Python, zero failures/skips, 30 sandboxed browser journeys**. [Research 40977462609](https://github.com/BlackStateGroup/inveos/actions/runs/40977462609), job 123808933541, passed both complete supplier profiles, both actual OCR corpora, repeated raster (1 test) and daemon failure/isolation (5 tests), with zero failures/skips.

Actual native acceptance now runs the complete supplier workflow for both versions, with v2's genuine PDF enlarged through labelled comment padding and corrected xref location. The actual adversity experiment measures both profiles independently; input size rejections must remain explicit. Unrun mobile/provider/recovery checks and independent professional/security/privacy/licence approvals remain open.

## Actual measurements

[Machine receipt](expanded-document-profiles-receipt.json) retains exact TSV bytes and digests, all outcomes/metrics, supplier TAP and runtime/generator/extractor fingerprints. Every retained TSV digest and metric was replayed independently of native parser execution. Each of the 12 conditions was attempted twice per profile, with stable repeats. V1 produced 14 OCR outputs and 10 size rejections; **v2 produced 24 OCR outputs and no size rejections**.

| Condition | Original bytes | V1 | V2 normalised word / character errors |
|---|---:|---|---|
| clean | 40,501 | Actual OCR | 0 (0.00%) / 0 (0.00%) |
| small_type | 24,479 | Actual OCR | 0 (0.00%) / 0 (0.00%) |
| low_resolution | 21,372 | Actual OCR | 0 (0.00%) / 0 (0.00%) |
| skew_plus_2 | 68,334 | Size rejection | 0 (0.00%) / 0 (0.00%) |
| skew_minus_2 | 68,039 | Size rejection | 0 (0.00%) / 0 (0.00%) |
| skew_plus_7 | 73,062 | Size rejection | 3 (13.64%) / 4 (2.86%) |
| low_contrast | 29,692 | Actual OCR | 0 (0.00%) / 0 (0.00%) |
| blur | 73,213 | Size rejection | 0 (0.00%) / 0 (0.00%) |
| jpeg_compression | 75,544 | Size rejection | 0 (0.00%) / 0 (0.00%) |
| speckles | 43,667 | Actual OCR | 7 (31.82%) / 21 (15.00%) |
| three_columns | 25,458 | Actual OCR | 0 (0.00%) / 0 (0.00%) |
| blank | 6,355 | Actual OCR | 0 (0.00%) / 0 (0.00%) |

Seven-degree skew lost numeric token `001` and introduced `00` (one each). Speckles remained at seven word errors and 21 character errors. Other measured conditions matched under the declared uppercase ASCII alphanumeric, punctuation-excluding metric; blank output contained no words. Green experiment status means the measurement completed, not that OCR is accurate. Three columns measure recognised words, not semantic table reconstruction. This remains a small controlled English corpus, not representative client, language or handwriting acceptance.

The actual supplier test passed twice, including the 126,518-byte v2 scan, immutable encrypted originals, verified raster/passages, independent correspondence and interpretation review, six document work links, two findings, retained alternatives, frozen report/package/PDF, approved restricted recipient delivery, acknowledgement, revocation and cancelled attachment denial. Scripted reviewer roles do not replace independent professional approval.

The initial render captured the top of the vault rather than the verified comparison. Review also found that manual extraction inspection could leave another original selected above. The final change aligns the vault with the successfully verified job's original without changing focus behaviour, asserts this in both actual supplier browsers and captures the selected passage/page region. Final hosted reruns and render review are required before merge.


Final reviewed head `87532366e59e3da877927aae53d3b6b257cfcf4f` passed [Checks 40978969413](https://github.com/BlackStateGroup/inveos/actions/runs/40978969413), job 123813925044: **343 Node/125 Python, zero failures/skips, 30 actual browsers**. [Research 40978969403](https://github.com/BlackStateGroup/inveos/actions/runs/40978969403), job 123813924844, passed both complete supplier profiles, both actual corpora, raster and five daemon-failure/isolation tests. Final corpus TSV bytes and metrics match the earlier retained run and independently replay. Source/privacy diff and the [actual comparison render](assets/ocr-expanded-comparison.png) were inspected. No unresolved feedback remained. PR #92 merged as `aab6f3b37a907421ae56e8f06936dbb4ac972dc7`; resulting-main [Checks 40979701117](https://github.com/BlackStateGroup/inveos/actions/runs/40979701117), job 123816384619, passed 343 Node/125 Python, zero failures/skips and 30 browsers. Final evidence is retained alongside substantive archive-lock work, avoiding a recursive evidence-only PR.
