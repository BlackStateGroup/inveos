# Encrypted immutable originals

## Decision and integrated boundary

WP-02 now has an opt-in local authenticated-encryption adapter shared by intake, original verification, claim/report reads, the durable integrity worker and qualified native/OCR/raster workers. It preserves the original byte identity: database SHA-256, byte length, citations, derivative lineage and independently verified exports refer to the exact supplied plaintext bytes. Stored objects use exclusive creation and directory/file synchronisation as before. Encryption does not replace those integrity controls or provide WORM retention.

The existing Node `crypto` runtime supplies AES-256-GCM; INVEOS owns the small versioned storage envelope and case-path binding. No new package, third-party source, model or binary is incorporated. The catalogue's Keycloak/Kratos candidates address identity, and Docling/Tesseract address extraction; none supplies this local storage boundary. Reusing the already selected runtime avoids introducing a storage service before its region/provider, artifact/notice and operational decisions. This is not a decision to replace the planned private S3-compatible/WORM-capable service with a bespoke production store. That integration and the complete runtime licence/security review remain open.

Each envelope contains the version magic, bounded key ID, random 96-bit nonce, plaintext length, ciphertext and 128-bit authentication tag. The complete header and canonical tenant/case/evidence relative path are authenticated. Copying ciphertext to a different evidence identity fails. Absolute root paths are excluded so a separately restored root can read the same objects. New `.txt.enc`/`.bin.enc` references cannot fall back to plaintext. Reads are bounded before authentication; unauthenticated plaintext is never returned. The current original size limits remain unchanged.

Keys are copied into an immutable store instance's closure, not a process-global registry or serialisable configuration. A protected key file must be regular, at most 8 KiB, private to its owner, outside the object root (including resolved path aliases), and not a final-component symlink. Explicit mode selection, strict format/key lengths and a known active key are required. Application errors do not print keys or ciphertext contents. The key file and its directories must remain under trusted operator control; this is not a hardware key manager or protection from a compromised API process/root administrator.

## Local fictional run

Use a **fresh disposable database and object root** with the existing lab setup. Existing plaintext rows cannot be switched silently into encrypted mode. A separately reviewed migration is required for any retained plaintext dataset.

Create a private key file outside the original root, for example within the ignored `secrets` directory:

```sh
mkdir -p secrets
chmod 700 secrets
node --input-type=module -e 'import {randomBytes} from "node:crypto"; import {writeFileSync} from "node:fs"; writeFileSync("secrets/original-keys.json",JSON.stringify({format:"inveos_original_keys_v1",activeKeyId:"lab-1",keys:{"lab-1":randomBytes(32).toString("hex")}})+"\n",{flag:"wx",mode:0o600});'
```

In the ignored `.env`, retain the existing loopback/development restrictions and set absolute paths:

```dotenv
INVEOS_STORAGE_ROOT=/absolute/path/to/disposable-originals
INVEOS_ORIGINAL_STORAGE_MODE=encrypted-v1
INVEOS_ORIGINAL_KEYS_FILE=/absolute/path/to/inveos/secrets/original-keys.json
```

Start the API with `npm run dev:api`; use the same key file/mode for the existing scoped worker commands. The native research CLI reads these variables as well and still requires its qualified isolated runtime and explicit research-only scope. Keys are never mounted into parser containers. The worker authenticates the original, then stages its exact plaintext bytes into the existing bounded disposable parser workspace; that temporary plaintext and process memory are outside this at-rest guarantee.

For rotation, stop writers, securely add a newly generated 32-byte key under a new ID, change `activeKeyId`, preserve prior keys and start all API/worker processes with the same protected configuration. New objects use the new key; historical ciphertext is never rewritten. Removing an old key denies access to objects using it, so it is not a substitute for account/case revocation. Keep object backups and protected key recovery separately managed. Lost keys mean lost access. Never commit or log a key. This lab file workflow does not claim KMS wrapping, automatic distributed key rotation, secure erasure or production recovery readiness.

## Verification and limits

`node --import tsx --test apps/api/test/original-encryption.test.ts` exercises real file encryption, byte equality, immutable retries, nonce variation, path/header/ciphertext/tag substitution, bounds, key rotation/revocation, process-instance restart, copied-root restore and unsafe key-file denial. No mock cipher.

The existing Checks workflow runs `encrypted-custody.test.ts` against actual disposable PostgreSQL with the restricted application role: text/binary intake, durable SHA verification, reviewed-source report read, rotation/restart, copied-root restore, missing-key and plaintext-substitution denial. The existing isolated supplier acceptance uses encrypted original storage for the digital declaration and scanned record, native extraction/OCR/raster, browser comparison, reviewed reasoning, frozen packages/PDF and restricted delivery. Implementation `187ab9e01c25af715438dc2e73c709060f3a8e52` passed Checks #218 (249 Node/111 Python, zero failures/skips) and Research #45, including this actual encrypted supplier journey. The process-level dispatcher test proves protected-key loading, invalid-key denial before claiming a job and actual derivative completion; key-removal tests deny old-object processing without attaching a derivative while new-key originals remain usable. Exact jobs and diagnostics are in [the acceptance receipt](../research/runtime_artifacts/encrypted-original-acceptance.json). Earlier plaintext runs are not used as evidence for encrypted integration.

This adapter encrypts **original objects only**. PostgreSQL derivatives/metadata/report bytes, upload chunks/staging, exported packages, browser downloads and operational backups are not comprehensively encrypted by this change. Full database/object/key/session recovery, real identity/MFA, provider-specific encryption and permissions, native device/offline acceptance, professional human review and legal/licence/privacy approvals remain open. The production startup refusal remains in force.

Rollback: keep encrypted objects and keys intact; rolling back to a plaintext-only reader cannot read `.enc` originals. Restore the compatible application/key configuration together. Do not rename ciphertext as plaintext or rewrite evidence rows to bypass authentication. There is no schema migration or automatic conversion in this increment.
