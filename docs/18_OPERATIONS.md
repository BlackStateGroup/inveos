# 18 — Hosting, reliability and service operations

## Environments

`dev` uses synthetic data. `staging` uses non-production fixtures and security review data only. `production` requires formal privacy and readiness approvals. Separate accounts/projects, network boundaries, secrets, object buckets, service identities and retention policies. Disable external collectors until enabled for reviewed jurisdictions/tenants.

## Deployment posture

- Infrastructure-as-code; region pinned, storage lifecycle/retention tested, DB migrations versioned and reversible where possible.
- Private buckets, short-lived scoped object access, application and edge rate limits.
- SSO/MFA on staff accounts; privileged production actions require additional approval/audit.
- Security headers, origin controls, CSRF, secure cookies and token rotation.
- Routine SBOM, dependency and container/image scans; sign provenance for builds and releases.

## Observability

Track case API latency, sync success/failure and pending upload count, job backlogs, object digest verification time, worker quarantines, licence-restricted connector access, withheld report blockers and audit-chain checkpoints. Logging excludes original documents, interview text, auth headers, personal identifiers where avoidable and LLM prompts containing sensitive data.

## Recovery and incident management

Define backup schedule, retention, encryption, storage versioning, keys, separate-region restore tests and recovery objectives (RPO/RTO to be negotiated). Run a restore drill before pilot. Maintain incident response for privacy breach, lost devices, malicious user, compromised API key, missing media, model output leak and unauthorised client release. Escalate appropriate regulator/affected party obligations via counsel.

## Release stages

- Feature flag and staged pilot. Human sign-off for migration, object store changes, retention and public API changes.
- CI with unit/integration/browser tests and synthetic fixtures; mobile build testing on actual devices; periodic security and recovery tests.
- Production evidence release requires independent validation of manifest and citations.

## Support operations

Customer onboarding, source rights checklist, retention policy selection, subprocessor notice, training, incident contact, export support, legal hold support, transparent status notices. No staff access to client evidence for troubleshooting unless separately authorised and logged.
