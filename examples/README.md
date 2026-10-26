# Synthetic evidence flow reference

**Development example only. No production deployment or real personal data.**

This small, self-contained Python example demonstrates the intended semantic distinctions in the INVEOS backbone:

1. Open a fictional case.
2. Register original evidence bytes; record claimed capture time separately from receipt time and hash the bytes.
3. Propose a claim with a specific source span. It is not automatically a finding.
4. A named synthetic reviewer accepts or rejects the claim, recording a reason.
5. Produce a **draft, not client-released** report containing accepted claims and their evidence IDs, spans and hashes.
6. Verify the source bytes and the simple event-chain hash against accidental or unsophisticated local tampering.

Run without installing any libraries:

```bash
python3 -m examples.evidence_flow_demo
python3 -m unittest discover -s tests -v
```

This code deliberately does **not** provide persistent or immutable storage, trusted time, signed audit anchors, regulatory compliance, tenancy, authorisation, malware scanning, encryption, evidence chain of custody accepted by courts, client release, or distributed sync. Its private in-memory members can be changed by an attacker and a whole forged event chain could be recomputed. Implement the controls in [`docs/08_EVIDENCE_INTEGRITY.md`](../docs/08_EVIDENCE_INTEGRITY.md) and [`docs/11_SECURITY_LEGAL.md`](../docs/11_SECURITY_LEGAL.md) before using sensitive material.
