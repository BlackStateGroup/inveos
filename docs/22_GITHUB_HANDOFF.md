# 22: GitHub publication and engineering handoff

## Published repository

- Public repository: **https://github.com/BlackStateGroup/inveos**
- Project: INVEOS, investigation operating system.
- Branch: `main`.
- Original 51-file foundation: [ac0fa52a1df37549a61abc16c29b465ae0e840d6](https://github.com/BlackStateGroup/inveos/commit/ac0fa52a1df37549a61abc16c29b465ae0e840d6).
- Original foundation tree: `271ed0f73e8467356264c154a4ddad4a779cae7a`.
- Scope: documentation, research catalogue, pinned reference commits, source-acquisition tooling and a synthetic-only demonstration. The full INVEOS application is still to be built.

## Access and publication record, 26 October 2026

At archive preparation, the connected GitHub installation list showed only the EmotiveImpact personal account. A README creation attempt returned `403 Resource not accessible by integration`, so the original package recorded an unpushed state.

After the user enabled organisation access, the BlackStateGroup installation appeared and the repository reported push permission. A successful README commit established actual write access. The full foundation was then committed and `main` advanced with a non-force update tied to its expected previous head. No existing repository history was replaced.

The complete remote tree was retrieved and compared with the recovered archive: all 51 paths, blob hashes and file modes matched. The recovered roadmap and engineering work packages were also compared with their separately saved copies and were identical. The README, delivery receipt and this handoff were subsequently updated to reflect successful publication, and the SHA-256 manifest was regenerated.

See [DELIVERY_STATUS.md](../DELIVERY_STATUS.md) for the archive checksum, verification results and limitations. The original foundation snapshot retains the original packaging notes as historical evidence of the earlier access failure.

## Work from the published foundation

From a trusted development machine with approved GitHub access:

```bash
git clone https://github.com/BlackStateGroup/inveos.git
cd inveos
python3 tools/validate_foundation.py
python3 -m unittest discover -s tests -v
python3 -m examples.evidence_flow_demo
git switch -c feat/wp00-scaffold
```

Read `AGENTS.md` and its required documents before implementation. Follow the work packages in `docs/21_ENGINEERING_WORKPACKAGES.md`. Future changes should use scoped feature branches and draft pull requests, with test evidence and clear limitations. Do not force-push or assume permission to merge or deploy from permission to develop.

`tools/publish_to_github.sh` is retained as the original empty-repository publication helper. It deliberately refuses to overwrite a non-empty remote `main` and is no longer the update workflow for this repository.

## Verification for subsequent changes

1. Run the foundation validator and the tests relevant to the change.
2. Regenerate `MANIFEST.sha256` whenever an included file changes; do not include the manifest itself, Git metadata, bytecode or the ignored research cache.
3. Verify the intended commit and branch on GitHub, retaining an exact commit URL in the delivery report.
4. Keep any future CI lightweight. This foundation contains no GitHub Actions workflow or deployment.
5. Preserve public/private boundaries: no credentials, actual client records, private NOIR/Recon source, model weights or unreviewed third-party source copies.

## Scope of executable demonstration

`examples/evidence_flow_demo.py` and `tests/test_evidence_flow_demo.py` provide an in-memory reference with 10 passing unit tests at publication. Those tests do not verify production identity, access control, durable evidence custody, mobile capture or legal readiness. No live API, mobile application or deployed service is represented as complete.
