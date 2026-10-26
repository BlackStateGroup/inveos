"""Synthetic-only contract tests for the research example."""
import unittest

from examples.evidence_flow_demo import SyntheticCase


class EvidenceFlowDemoTests(unittest.TestCase):
    def setUp(self):
        self.case = SyntheticCase('FICTIONAL: supplier case')
        self.receipt = self.case.intake('invoice.txt', b'fictional data', claimed_captured_at='2026-10-23T10:00:00Z')

    def test_original_integrity_and_receipt(self):
        self.assertEqual(self.receipt.original_bytes, 14)
        self.assertEqual(self.receipt.claimed_captured_at, '2026-10-23T10:00:00Z')
        self.assertNotEqual(self.receipt.received_at, self.receipt.claimed_captured_at)
        self.assertTrue(self.case.verify_original(self.receipt.evidence_id))

    def test_original_tamper_detected(self):
        self.case._originals[self.receipt.evidence_id] = b'changed data'
        self.assertFalse(self.case.verify_original(self.receipt.evidence_id))
        with self.assertRaises(RuntimeError):
            self.case.report_draft()

    def test_source_required(self):
        with self.assertRaises(ValueError):
            self.case.propose_claim('non-existent', 'a finding', 'page 1')
        with self.assertRaises(ValueError):
            self.case.propose_claim(self.receipt.evidence_id, 'a finding', '')

    def test_unreviewed_claim_excluded(self):
        self.case.propose_claim(self.receipt.evidence_id, 'Hypothesis', 'page 1')
        result = self.case.report_draft()
        self.assertEqual(result['reviewed_findings'], [])
        self.assertEqual(result['unreviewed_claims_excluded'], 1)

    def test_rejected_claim_excluded_and_reason_retained(self):
        claim = self.case.propose_claim(self.receipt.evidence_id, 'Unfounded suggestion', 'line 1')
        self.case.review_claim(claim, 'reviewer', accept=False, reason='Not supported')
        self.assertEqual(self.case.report_draft()['reviewed_findings'], [])
        self.assertEqual(self.case.claims[claim]['review_reason'], 'Not supported')

    def test_only_reviewed_claims_in_report(self):
        accepted = self.case.propose_claim(self.receipt.evidence_id, 'Sample says X', 'bytes 0-10')
        self.case.review_claim(accepted, 'reviewer', accept=True, reason='Checked')
        self.case.propose_claim(self.receipt.evidence_id, 'Unverified', 'bytes 10-14')
        report = self.case.report_draft()
        self.assertEqual(len(report['reviewed_findings']), 1)
        self.assertEqual(report['reviewed_findings'][0]['source_span'], 'bytes 0-10')
        self.assertEqual(report['status'], 'draft_not_released')

    def test_cannot_review_twice(self):
        claim = self.case.propose_claim(self.receipt.evidence_id, 'Sample says X', 'line 1')
        self.case.review_claim(claim, 'reviewer', accept=True, reason='Checked')
        with self.assertRaises(ValueError):
            self.case.review_claim(claim, 'other', accept=False, reason='Changed mind')

    def test_event_tamper_detected(self):
        self.assertTrue(self.case.verify_event_chain())
        self.case.events[0]['details']['title'] = 'altered'
        self.assertFalse(self.case.verify_event_chain())
        with self.assertRaises(RuntimeError):
            self.case.report_draft()

    def test_chained_sequence_detects_removal(self):
        self.case.propose_claim(self.receipt.evidence_id, 'Something', 'line 1')
        self.case.events.pop(1)
        self.assertFalse(self.case.verify_event_chain())

    def test_distinct_evidence_receipts_for_identical_bytes(self):
        copy = self.case.intake('copy.txt', b'fictional data')
        self.assertNotEqual(copy.evidence_id, self.receipt.evidence_id)
        self.assertEqual(copy.original_sha256, self.receipt.original_sha256)
        self.assertTrue(self.case.verify_event_chain())


if __name__ == '__main__':
    unittest.main()
