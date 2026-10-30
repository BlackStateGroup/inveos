# Frozen Field capture and recovery lineage

Implementation phase, 30 October 2026. This connects the Field device/recovery batch to reports and independent verification; it is not native-device qualification or proof of lawful authority.

## Implemented

Every newly built report discovers Field captures for its cited text/document/transcript/speech originals. It retains the immutable original manifest, its original hashing order and fingerprint, captured device/authority/grant, declared source/device/clock-uncertainty values, original receipt time, later capture receipt, and separate acceptance authority/grant. Recoveries retain exact capture/manifest/target identity and the independent approval identity/time. Internal recovery reasons and unrelated device history are not copied into the report.

The server joins all records through tenant, case, original and capture identity. It compares metadata/digest/length with the already-verified cited original; rechecks historical grants and device versions, manifest hash, receipt/recovery identity, independent reviewer, target authority and time ordering. No current device status is substituted for historical capture status. Later device revocation cannot rewrite an earlier manifest. Existing current source-use/release checks remain separate. A historical grant is not permission to collect more data.

New frozen revisions retain the optional fieldProvenance collection. Source verification compares retained proofs with the historical records. Older frozen reports remain unchanged and are not silently augmented; their old fingerprints keep their meaning. Independently trusted report/copy fingerprints are still necessary to distinguish an authentic historical report from a replaced self-consistent input.

Shared PDF/DOCX lines show provenance inside each visible finding's whole-finding redaction boundary. The full draft print view shows separate original versus acceptance authority and source/device/server times. Internal JSON retains the full proof. Redacted visible copies omit the whole finding's proof and do not acquire an independent release approval automatically.

The first-party `verify_field_provenance.py` helper checks the same typed declarations offline. `verify_report.py` loads it only for reports carrying Field proofs; older reports keep their existing dependencies. Mixed document packages supply verified original lengths through `verify_document_package.py`. Original SHA-256, manifest byte length, source time, grant/recovery target, review independence, receipt ordering and proof fingerprints are checked. These are consistency checks, not hardware/actor/clock attestation or legal certification.

## Run and current evidence

No new migration or dependency is needed beyond Field070–072. Place the new verifier helper beside the other trusted verifier scripts when copying an offline verification kit. Use the existing independent report or document-package CLI with a separately trusted expected fingerprint.

Web/contracts/API compilation passed at the first backend checkpoint (`/tmp/inveos-field-provenance-first-compile.log`) and at the connected print/renderer checkpoint (`/tmp/inveos-field-provenance-final-compile.log`). No database/API/browser/PDF/DOCX rendering, standalone verifier execution or rehashed mutation checks have run for this addition. They remain in the combined acceptance phase.

Required acceptance: direct versioned capture, historical unversioned capture, changed-authority/lost-device recovery, current-source-use/revocation denial, wrong target/case/user/original, omitted/changed grant or review, self-review, changed source/clock/receipt times, original corruption, manifest-length mismatch, rehashed proofs, populated historical records, all four source families, mixed document packages, exact original preservation and whole-finding redaction in visible text/embedded copy models. Actually inspect desktop/narrow print and rendered office/PDF copies. Preserve separate model/parser/device and external-approval gates.
