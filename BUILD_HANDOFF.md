# INVEOS engineering handoff

## 27 October 2026: offline report verification slice

Baseline: PR #1 merged; PR #2 contains the isolated document research contract; PR #3 contains expanded delivery planning and PostgreSQL CI. This branch is stacked on PR #3 (`4e4664e8b4b357c1c2b18c162d83a6ca65453f04`) to reuse its workflow and fixture-path fix. Do not merge automatically or duplicate that work.

Implemented: independent stdlib Python verification of existing internal JSON reports, including original bytes/digests, per-finding citation ranges, repeated-source consistency, case selection and optional externally trusted report hash. Includes nine unit/CLI tests and an assertion in the actual API lifecycle test. See [run instructions and trust limits](docs/25_OFFLINE_REPORT_VERIFIER.md).

Verification: 22 Python tests (including nine new verifier tests), foundation validation, npm lint, workspace type checks and web build pass locally. npm ci --ignore-scripts completed using the existing lockfile. API/database execution and hosted CI result to be recorded below. This workspace has no PostgreSQL binaries; local database results are not claimed. Application UI and routes are unchanged. No new browser/device/restore/security assessment, deployment or pilot acceptance.

Next independent work: finish WP-07 packaging and manifests with custody provenance and explicit schema versions; add durable binary intake/derivative jobs without feeding extracted PDF text into original UTF-8 intake. Continue original-page review and isolated parser benchmarks when a capable host is available. PDF rendering, signed custody, client release, production identity/storage, native offline operation and the remaining supplier milestone are not complete. Root report hashes alone do not replace signatures or an external trust anchor.

Status labels: implementation partial; testing partial; deployed no; pilot accepted no. There is no full-product completion claim or user decision required for further independent engineering.
