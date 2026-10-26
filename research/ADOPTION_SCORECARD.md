# Research adoption scorecard

Score each candidate 0–5 and keep factual test notes. Do not rank by GitHub stars alone.

| Criterion | Weight | Meaning |
|---|---:|---|
| Domain/function fit | 25% | Does it solve a concrete INVEOS use case? |
| Licence / commercial clarity | 20% | Can it be used in the intended deployment and product model? |
| Security / maintenance | 20% | Updates, vulnerability response, code quality and dependency burden |
| Evidence/provenance features | 15% | Reliable source attribution, correction and export behaviour |
| Integration and performance | 10% | Interfaces, test harness, memory/cost/runtime fit |
| User experience and accessibility | 10% | Investigator/field usability and source transparency |

A candidate cannot be integrated despite a high numeric score if its licence, legal-source permission or security gate fails. Default experiments should favour **FollowTheMoney, Cytoscape.js, Docling/Tika, whisper.cpp, WatermelonDB and WeasyPrint**, but these remain unapproved candidates until technical/licence review.

## Research record template

```yaml
repository: owner/name
checked_utc: YYYY-MM-DD
pinned_sha: 40-hex-characters
licence_metadata: SPDX-or-NOASSERTION
licence_full_review: pending|approved|blocked
security_review: pending|approved|blocked
integration_mode: study|package|worker|fork|connector
score:
  fit: 0
  licence: 0
  maintenance: 0
  provenance: 0
  integration: 0
  ux: 0
experiment: "Synthetic data and reproducible steps"
result: "Not run"
reviewer: "Unassigned"
```
