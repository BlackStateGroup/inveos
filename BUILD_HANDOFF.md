# INVEOS engineering handoff

## 27 October 2026: versioned internal exhibit package

Baseline checked: main remains `95b5c35`; open draft PRs #2, #3 and #4 have no review comments. This slice is stacked on PR #4 head `464ac9d8ce40735905da3742d72c1d513c694974`, reusing the report verifier and PostgreSQL workflow. Do not merge or overwrite the independent research/planning branches.

Implemented: stdlib offline package builder and verifier, deterministic per-evidence exhibits, exact report/original bytes, versioned canonical manifest with citation/policy/time mapping and explicit omissions, optional trusted manifest digest/case check, bounded non-extracting ZIP validation and private atomic no-overwrite output. Hardened existing report JSON error handling. Added fifteen Python tests and actual API-report package verification/corruption assertions. [Run instructions, format, limits and rollback](docs/26_INTERNAL_EXHIBIT_PACKAGE.md).

Local verification: 37 Python tests, foundation validator, npm lint, all workspace type checks, web build and whitespace checks pass. Hosted PostgreSQL evidence will be recorded after publication; no local PostgreSQL execution is claimed. Package tests are real stdlib CLI/ZIP executions with fictional data, not parser tests. No browser/device/worker-isolation/restore/production security assessment, deployment or pilot acceptance is claimed.

Parser blocker rechecked: `bwrap --ro-bind / / --unshare-net -- /usr/bin/true` fails with `Creating new namespace failed: Operation not permitted`. No upstream parser execution or dependency installation followed. Third-party research copies remain ignored and unapproved; no new runtime dependency/source is incorporated.

Next work: WP-02 binary immutable intake and derivative lineage/durable scoped jobs, or WP-07 a consistent report snapshot with actual scoped audit history and a versioned report model. Do not synthesise custody events from report metadata. PDF/DOCX/redaction/client release, signature anchors, complete source inventory, real identity/encrypted storage, native offline and the remaining work packages are still open. Packaging is an internal local workflow, not a client-release route. Implementation partial; testing partial; deployed no; pilot accepted no. No user decision is required for further independent engineering.

## 27 October 2026: offline report verification slice

Baseline: PR #1 merged; PR #2 contains the isolated document research contract; PR #3 contains expanded delivery planning and PostgreSQL CI. This branch is stacked on PR #3 (`4e4664e8b4b357c1c2b18c162d83a6ca65453f04`) to reuse its workflow and fixture-path fix. Do not merge automatically or duplicate that work.

Implemented: independent stdlib Python verification of existing internal JSON reports, including original bytes/digests, per-finding citation ranges, repeated-source consistency, case selection and optional externally trusted report hash. Includes nine unit/CLI tests and an assertion in the actual API lifecycle test. See [run instructions and trust limits](docs/25_OFFLINE_REPORT_VERIFIER.md).

Verification: 22 Python tests (including nine new verifier tests), foundation validation, npm lint, workspace type checks and web build pass locally. npm ci --ignore-scripts completed using the existing lockfile. Hosted [Checks run #3](https://github.com/BlackStateGroup/inveos/actions/runs/40484444037) passed on implementation commit `610e48a9f63a43b1287e88a3baaecd3bb7c6e61f`: 22 Python tests and all seven real-PostgreSQL API tests passed, including standalone verification of the actual API report and rejection of changed narrative against the retained digest. The complete hosted lint/type/build/reference checks also passed. This receipt-only follow-up does not change implementation. This workspace has no PostgreSQL binaries; local database results are not claimed. Application UI and routes are unchanged. No new browser/device/restore/security assessment, deployment or pilot acceptance.

Next independent work: finish WP-07 packaging and manifests with custody provenance and explicit schema versions; add durable binary intake/derivative jobs without feeding extracted PDF text into original UTF-8 intake. Continue original-page review and isolated parser benchmarks when a capable host is available. PDF rendering, signed custody, client release, production identity/storage, native offline operation and the remaining supplier milestone are not complete. Root report hashes alone do not replace signatures or an external trust anchor.

Status labels: implementation partial; testing partial; deployed no; pilot accepted no. There is no full-product completion claim or user decision required for further independent engineering.
