# Reviewed entity relationships

## Integrated journey

Internal case members can record a person, organisation, place or other entity as a separate candidate identity. Names and aliases are descriptive working context, never a resolution or merge. Similar names must remain separate records until an authorised investigation process produces a separate, auditable decision.

A relationship proposal connects two different case entities and cites one current reviewed text or document finding. The source is reverified when the candidate is saved, when a reviewer decides it and when an investigator opens the source inspector. A proposal starts as `candidate`; only a reviewer may confirm or reject it with a reason. Confirming a relationship does not create a finding, alter evidence, change a report, or make either entity the same identity.

The Intelligence screen lists candidate identities and relationships, offers bounded entity/relationship forms, and opens the reverified cited finding. It uses original INVEOS relational storage and React components: no graph library, source tree, model or external service has been incorporated.

## Server controls

Migration 036 stores entity roots, append-only identity snapshots and relationship rows under tenant and case keys. Current case membership and internal-role checks apply to every endpoint; client roles are denied. Roots are bounded to 500 entities and 1,000 relationships per case. Graph reads use a two-second statement timeout and never cross case or tenant boundaries. Entity snapshots cannot be changed or deleted. Relationship rows cannot be deleted; their only state change is the one-time independent reviewer decision.

Endpoints beneath `/api/cases/:caseId/entities`:

- `GET /entities`: bounded candidate identities and all source-linked relationship states.
- `POST /entities`: idempotent separate candidate identity.
- `POST /entities/relationships`: source-reverified candidate edge.
- `POST /entities/relationships/:relationshipId/review`: reviewer-only confirmation or rejection.
- `GET /entities/relationships/:relationshipId/source`: reverified cited finding for the edge inspector.

This implementation does not auto-merge identities, infer relationships, run a graph algorithm, expose data to clients, or make intelligence records reportable findings. General graph layouts, representative 100–2,000 node performance, entity corrections/merges, cited AI candidates and professional intelligence review remain open.

## Component and licence decision

The catalogue lists Cytoscape.js and Graphology as MIT candidates, while FollowTheMoney/OpenAleph are ontology and investigation-pattern references. Their pinned research metadata is not incorporation approval. This slice uses original relational records because it must reuse current case authorisation, cited-finding revalidation and audit controls. Before any third-party runtime is selected, verify the exact artifact, direct/transitive terms, notices, support/security fit and relevant performance evidence. Attribution alone is not permission.

## Verification status

`npm run typecheck`, `npm run lint` and `npm run build` pass for this revision. The API test adds the required fictional path for separate ambiguous names, source-linked candidate edge, investigator self-review denial, reviewer confirmation, client denial and append-only snapshot enforcement. It requires the existing disposable restricted PostgreSQL test URLs; those URLs were not configured in this execution, so the database/browser acceptance has not run and is not claimed.
