#!/usr/bin/env python3
"""INVEOS reference: synthetic, in-memory case -> evidence -> reviewed claim -> report.

Teaching/demo code ONLY. Not production evidence management, chain-of-custody,
cryptographic signing, legal compliance or a secure multi-user service. No access
control, durable storage, multi-tenant isolation, or trusted clock is implemented.

Run: python -m examples.evidence_flow_demo
Test: python -m unittest discover -s tests -v
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

ZERO_HASH = "0" * 64


def canonical_json(payload: object) -> bytes:
    return json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def digest_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass(frozen=True)
class EvidenceReceipt:
    evidence_id: str
    case_id: str
    filename: str
    original_sha256: str
    original_bytes: int
    received_at: str
    claimed_captured_at: str | None


class SyntheticCase:
    """Deliberately small original design-reference implementation."""

    def __init__(self, title: str, *, case_id: str | None = None):
        self.title = title
        self.case_id = case_id or str(uuid4())
        self._originals: dict[str, bytes] = {}
        self.receipts: dict[str, EvidenceReceipt] = {}
        self.claims: dict[str, dict[str, Any]] = {}
        self.events: list[dict[str, Any]] = []
        self._event("case.created", {"title": title})

    def _event(self, event_type: str, details: dict[str, Any]) -> None:
        previous_hash = self.events[-1]["digest"] if self.events else ZERO_HASH
        envelope = {
            "sequence": len(self.events) + 1,
            "case_id": self.case_id,
            "event_type": event_type,
            "occurred_at": iso_now(),
            "details": details,
            "previous_digest": previous_hash,
        }
        self.events.append({**envelope, "digest": digest_bytes(canonical_json(envelope))})

    def intake(self, filename: str, original_bytes: bytes, *, claimed_captured_at: str | None = None) -> EvidenceReceipt:
        if not filename.strip() or not isinstance(original_bytes, bytes):
            raise ValueError("A filename and original byte sequence are required")
        evidence_id = str(uuid4())
        receipt = EvidenceReceipt(
            evidence_id=evidence_id,
            case_id=self.case_id,
            filename=filename,
            original_sha256=digest_bytes(original_bytes),
            original_bytes=len(original_bytes),
            received_at=iso_now(),
            claimed_captured_at=claimed_captured_at,
        )
        self._originals[evidence_id] = original_bytes
        self.receipts[evidence_id] = receipt
        self._event("evidence.received", {
            "evidence_id": evidence_id,
            "filename": filename,
            "sha256": receipt.original_sha256,
            "bytes": receipt.original_bytes,
            "received_at": receipt.received_at,
            "captured_at_claimed": claimed_captured_at,
        })
        return receipt

    def propose_claim(self, evidence_id: str, text: str, source_span: str) -> str:
        if evidence_id not in self.receipts:
            raise ValueError("Claim must reference evidence in this case")
        if not text.strip() or not source_span.strip():
            raise ValueError("Claim requires a statement and a specific source span")
        claim_id = str(uuid4())
        self.claims[claim_id] = {
            "claim_id": claim_id,
            "text": text,
            "source_evidence_id": evidence_id,
            "source_span": source_span,
            "status": "proposed",
            "reviewer": None,
            "review_reason": None,
        }
        self._event("claim.proposed", {"claim_id": claim_id, "evidence_id": evidence_id,
                                       "span": source_span, "text": text})
        return claim_id

    def review_claim(self, claim_id: str, reviewer: str, *, accept: bool, reason: str) -> None:
        if claim_id not in self.claims:
            raise ValueError("Claim not found")
        if self.claims[claim_id]["status"] != "proposed":
            raise ValueError("Claim has already been reviewed")
        if not reviewer.strip() or not reason.strip():
            raise ValueError("Reviewer and reason are required")
        status = "accepted" if accept else "rejected"
        self.claims[claim_id] = {**self.claims[claim_id], "status": status,
                                 "reviewer": reviewer, "review_reason": reason}
        self._event("claim.reviewed", {"claim_id": claim_id, "reviewer": reviewer,
                                        "status": status, "reason": reason})

    def verify_original(self, evidence_id: str) -> bool:
        if evidence_id not in self.receipts:
            raise ValueError("Evidence not found")
        r = self.receipts[evidence_id]
        b = self._originals[evidence_id]
        return len(b) == r.original_bytes and digest_bytes(b) == r.original_sha256

    def verify_event_chain(self) -> bool:
        previous = ZERO_HASH
        for expected_sequence, event in enumerate(self.events, 1):
            envelope = {key: value for key, value in event.items() if key != "digest"}
            if (envelope["sequence"] != expected_sequence
                    or envelope["previous_digest"] != previous
                    or envelope["case_id"] != self.case_id
                    or digest_bytes(canonical_json(envelope)) != event["digest"]):
                return False
            previous = event["digest"]
        return True

    def report_draft(self) -> dict[str, Any]:
        if not self.verify_event_chain() or not all(self.verify_original(x) for x in self.receipts):
            raise RuntimeError("Cannot create report from failed local integrity checks")
        findings = []
        for claim in self.claims.values():
            if claim["status"] == "accepted":
                r = self.receipts[claim["source_evidence_id"]]
                findings.append({
                    "finding": claim["text"],
                    "reviewer": claim["reviewer"],
                    "evidence_id": r.evidence_id,
                    "source_filename": r.filename,
                    "source_span": claim["source_span"],
                    "evidence_sha256": r.original_sha256,
                })
        return {
            "title": "SYNTHETIC INVEOS REFERENCE REPORT - NOT FOR CLIENT USE",
            "case_id": self.case_id,
            "case_title": self.title,
            "status": "draft_not_released",
            "reviewed_findings": findings,
            "unreviewed_claims_excluded": sum(1 for c in self.claims.values() if c["status"] != "accepted"),
            "event_chain_tip": self.events[-1]["digest"],
            "limitations": "In-memory, unsignable, not compliant custody, no identity or access controls",
        }


def demo() -> None:
    case = SyntheticCase("FICTIONAL: Northbank supplier invoice review")
    invoice = case.intake("fictional-invoice.txt", b"Fictional invoice A: 120 units, reference X123")
    claim = case.propose_claim(invoice.evidence_id, "The fictional invoice states 120 units", "text:0-46")
    case.review_claim(claim, "synthetic-reviewer", accept=True, reason="Manually checked original sample")
    print(json.dumps(case.report_draft(), indent=2))
    print(f"Integrity demonstration: originals verified={case.verify_original(invoice.evidence_id)}, "
          f"event chain verified={case.verify_event_chain()}")


if __name__ == "__main__":
    demo()
