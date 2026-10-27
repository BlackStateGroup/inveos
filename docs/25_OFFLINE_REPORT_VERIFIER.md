# Offline verification of internal JSON drafts

27 October 2026. Incremental WP-07 delivery, based on PR #3's verified build baseline. No application schema, intake, original bytes, review permissions or release state changes.

The existing report endpoint exports original UTF-8 bytes and exact citation offsets. `tools/verify_report.py` now independently checks those exports without running INVEOS, installing packages or connecting to a database. Python 3.10+ is sufficient. Copy the script alongside the downloaded JSON draft; it has no imports from the application.

```bash
python3 tools/verify_report.py downloaded-report.json
python3 tools/verify_report.py downloaded-report.json --expected-sha256 TRUSTED_SHA256 --expected-case-id CASE_ID
```

Replace the capitalised placeholders with the case ID and lowercase SHA-256 retained at trusted export time. Obtain that digest through a separately trusted record/channel. Hashing a suspect file and immediately supplying its hash does not authenticate it. Exact file bytes are bound, so even harmless JSON reformatting changes the trusted digest.

Exit 0 means the declared checks passed; exit 1 means verification failed. Output is structured JSON. Verification does not write originals or unpack attachments. Filenames in the report are treated as metadata, never filesystem paths. Error output excludes report bodies and filesystem paths.

## Checks and meaning

- Internal-draft status, required case/finding/source/policy fields and unique finding IDs.
- Strict UTF-8 JSON, duplicate-key rejection, non-finite-number rejection, bounded report/original sizes and finding count.
- Canonical base64, decoded UTF-8 original bytes, original SHA-256, integer byte offsets and exact UTF-8 quoted bytes.
- Multiple findings can quote different ranges of the same original; repeated evidence IDs cannot silently change original identity, acquisition metadata or authority metadata.
- Optional externally retained report digest binds all bytes, including narratives, policy, reviewer labels and timestamps. Optional expected case ID guards against accidentally selecting the wrong case.

Without an external digest the result establishes **internal consistency only**. Even with one it does not prove factual truth, reviewer identity, actual approval, lawful authority, custody history or admissibility. Policy fields and dates are preserved declarations, not independently authenticated facts. The current export has no signatures, audit chain or source-tenant identity; this utility does not invent them. It cannot enforce tenant permissions after an authorised user downloads a file. Protect exported originals with the same care as the application originals.

The supported format is the current `ReportDraft` contract in `packages/contracts/src/index.ts`, not future PDF/derived-document citations or client releases. Empty drafts and unknown release states fail closed. Limits are 32 MiB report, 2 MiB per original and 1,000 findings. These are offline verifier limits, not changes to API intake limits.

## Verification

Run `python3 -m unittest discover -s tests -v`. Nine new tests cover valid exports, external digest binding, same-original/different-quote findings, conflicting metadata, corrupt bytes/offsets, malformed/duplicate JSON, policy shape, case mismatch and real subprocess CLI invocation from outside the repository. Fixtures are explicitly fictional and are not claimed as API captures.

The existing PostgreSQL API lifecycle test additionally invokes the standalone script against its actual report response, then alters the narrative and checks rejection against the retained report digest. See `BUILD_HANDOFF.md` for which checks actually ran and hosted CI evidence; adding an integration assertion alone is not evidence of execution.

No new runtime dependency, copied third-party source, live collection, external transmission, production deployment or migration. Rollback removes the standalone utility, tests and documentation only. Existing report limitations remain conservative.
