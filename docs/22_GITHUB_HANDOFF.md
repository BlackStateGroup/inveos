# 22 — GitHub repository handoff and publishing checklist

## Target

- Intended public repository: **https://github.com/BlackStateGroup/inveos**
- Project: INVEOS, investigation operating system.
- Planned state of this foundation: documentation, research catalogue, pinned reference commits, source-acquisition tooling and a synthetic-only demonstration; no shipped application.

## Access diagnosis (26 October 2026)

The repository was verified as existing, empty and public. Connected GitHub app installation list returned only **EmotiveImpact** (personal account), not BlackStateGroup organisation. An attempt to create `README.md` returned **403 Resource not accessible by integration**. Therefore the push has **not** happened. The packaged foundation is ready to commit when organisation access is granted. Do not report a commit SHA or PR that does not exist.

### Preferred fix

A BlackStateGroup organisation administrator can open GitHub organisation settings, then GitHub Apps / installed apps and install/approve the connected ChatGPT GitHub app with **Contents: read and write** access to `BlackStateGroup/inveos`. Select the exact repository or authorise an appropriate set of organisation repos. Ensure organisational security policies allow GitHub app writes. Recheck installation visibility and retry the commit. No credentials or personal access tokens should be pasted into chat.

### Alternate manual publication

From a trusted local development machine with approved GitHub credentials, extract the supplied foundation archive and run:

```bash
git clone https://github.com/BlackStateGroup/inveos.git
cp -R path/to/extracted/inveos/. ./inveos/
cd inveos
python3 tools/validate_foundation.py
git add .
git commit -m 'docs: establish INVEOS product, architecture and open-source research foundation'
git push origin main
```

If repository is still empty and `git clone` does not set a default branch, run `git init -b main`, `git remote add origin https://github.com/BlackStateGroup/inveos.git`, then add/commit/push as above. Never force-push into an existing branch. Public repo warning: review all documents before publishing; no secrets, private customer data or proprietary private-repo source is included in the prepared package.

## Verify after any successful publication

1. `git status` clean and `git rev-parse HEAD` match intended commit; no accidental changes to existing remote data.
2. GitHub file tree includes product docs, research JSON, pinned revisions, specs, tools, examples and unit tests.
3. GitHub Actions optional, lightweight only; avoid large workflow artifact uploads.
4. Review repository visibility and decide whether proprietary app code will live here or in a private development repository.
5. Record explicit branch/commit URL, count of files and validation results in delivery receipt.

## Scope of executable demonstration

The package includes `examples/evidence_flow_demo.py` and `tests/test_evidence_flow_demo.py`. This is deliberately in-memory reference code, not field-ready functionality; it is not a basis for collecting genuine private investigation data. Run the 10 tests locally before publishing.
