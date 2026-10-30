# WatermelonDB acknowledgement adaptation

Repository: https://github.com/Nozbe/WatermelonDB
Pinned revision: `5c463222ecd79928861385bac94b486fcc7623d4` (existing INVEOS catalogue pin).

The actual root MIT licence was inspected and is retained in [LICENSE](LICENSE). Source copies remain in ignored `.research-cache/sources/Nozbe/WatermelonDB`; upstream build/install scripts were not executed. Its package manifest includes Babel runtime, Nozbe SQLite/simdjson/LokiJS, RxJS and other dependencies. None of those packages or native backends is incorporated by this adaptation, and no licence/security clearance for the entire library is claimed.

[INVEOS acknowledgement code](../../apps/web/src/fieldAcknowledgement.ts) adapts the record-selection pattern in `src/sync/impl/markAsSynced.js` (`recordsToMarkAsSynced`) and the equality rule in `src/utils/fp/areRecordsEqual/index.js`. It retains Nozbe copyright and the MIT notice. INVEOS replaces database-model/table coupling with a bounded capture identity/revision/fingerprint, accepts only explicitly matching server fingerprints, omits deletion and applies an atomic encrypted-store compare-and-swap. This prevents a late response from acknowledging a different local capture state. It does not reproduce WatermelonDB's database engine, imply native SQLite encryption or transfer its tests' results to INVEOS.

Review scope: pure iteration/equality/Map/Set logic; no dependencies, network, filesystem, dynamic evaluation or privileged execution. Actual INVEOS queue/delivery/device validation is tracked separately in the Field evaluation.
