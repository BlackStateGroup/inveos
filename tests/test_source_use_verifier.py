"""Fictional source-use declarations; copied-tool/API evidence is tested separately."""
import copy
import hashlib
import json
import unittest
from tests.test_transcript_findings import fixture as transcript_fixture, uid, encode
from tools.verify_report import InvalidReport, verify_report
from tools.report_package import build_package, verify_package


def rehash(proof):
    record, decision, review = proof['record'], proof['decision'], proof['metadataReview']
    for value in (record, decision):
        if value is decision:
            value['sourceDigest'] = record['digest']
            review['digest'] = record['digest']
        value['digest'] = hashlib.sha256(json.dumps({k: v for k, v in value.items() if k != 'digest'}, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return proof


def fixture():
    report = transcript_fixture()
    source = report['transcriptFindings'][0]['claim']['source']
    at = '2026-10-30T00:00:00.000Z'
    record = dict(url='https://records.example.test/fictional', publisher='Fictional supplied register', retrievedAt=at, method='Fictional supplied record, no server collection.', trustGrade='unassessed', termsReference='Fictional permission record supplied for the fixture.', purpose='Fictional source comparison only.', lawfulBasis='Fictional commissioned review.', scope='Fictional supplied record only.', retentionDays=30, minimisation='Fictional pertinent passages only.', annotation='Fictional source assertions remain unverified.', id=uid(200), caseId=report['case']['id'], version=1, original={**{k: source[k] for k in ('id', 'filename', 'sha256', 'sourceTime', 'receivedTime')}, 'authorityId': source['policy']['authorityId'], 'authorityVersion': 1, 'status': 'Verified'}, recordedBy=uid(201), recordedAt=at, withdrawn=False, digest='')
    decision = dict(id=uid(202), caseId=report['case']['id'], sourceId=record['id'], evidenceId=source['id'], sequence=1, sourceVersion=1, sourceDigest='', authorityVersion=1, permission='analysis', reason='Fictional reviewed terms permit internal analysis only.', actorId=uid(203), actorName='Fictional source-use reviewer', recordedAt=at, expiresAt='2026-10-31T00:00:00.000Z', digest='')
    review = dict(id=uid(204), digest='', accepted=True, reviewerId=uid(203), reviewerName='Fictional source metadata reviewer', reason='Fictional source metadata independently inspected.', recordedAt=at)
    report['sourceUse'] = [rehash(dict(decision=decision, record=record, metadataReview=review))]
    return report


class SourceUseVerification(unittest.TestCase):
    def test_retained_permission_proof_and_complete_package_verify(self):
        report = fixture()
        self.assertEqual(verify_report(encode(report))['sourceUseDecisionsChecked'], 1)
        verify_package(build_package(encode(report), '2026-10-30T01:00:00Z'))

    def test_changed_metadata_or_decision_without_digest_update_is_rejected(self):
        for section, key, value in [('decision', 'permission', 'analysis_and_release'), ('record', 'termsReference', 'Fictional altered terms')]:
            report = fixture(); report['sourceUse'][0][section][key] = value
            with self.assertRaises(InvalidReport):
                verify_report(encode(report))

    def test_rehashed_cross_case_and_original_substitutions_are_rejected(self):
        for section, key, value in [('decision', 'caseId', uid(209)), ('decision', 'evidenceId', uid(209)), ('record', 'caseId', uid(209)), ('record', 'version', 2), ('decision', 'authorityVersion', 2)]:
            report = fixture(); proof = report['sourceUse'][0]; proof[section][key] = value; rehash(proof)
            with self.assertRaises(InvalidReport):
                verify_report(encode(report))
        report = fixture(); proof = report['sourceUse'][0]; proof['record']['original']['sha256'] = 'a' * 64; rehash(proof)
        with self.assertRaises(InvalidReport):
            verify_report(encode(report))

    def test_blocked_withdrawn_rejected_and_self_reviewed_declarations_are_rejected(self):
        for section, key, value in [('decision', 'permission', 'blocked'), ('record', 'withdrawn', True), ('metadataReview', 'accepted', False), ('decision', 'actorId', uid(201)), ('metadataReview', 'reviewerId', uid(201))]:
            report = fixture(); proof = report['sourceUse'][0]; proof[section][key] = value; rehash(proof)
            with self.assertRaises(InvalidReport):
                verify_report(encode(report))

    def test_duplicate_proofs_invalid_numbers_and_expiry_order_are_rejected(self):
        report = fixture(); report['sourceUse'].append(copy.deepcopy(report['sourceUse'][0]))
        with self.assertRaises(InvalidReport):
            verify_report(encode(report))
        for key, value in [('sequence', True), ('sourceVersion', False), ('expiresAt', None), ('expiresAt', '2026-10-29T00:00:00.000Z'), ('expiresAt', '2027-01-01T00:00:00.000Z')]:
            report = fixture(); proof = report['sourceUse'][0]; proof['decision'][key] = value; rehash(proof)
            with self.assertRaises(InvalidReport):
                verify_report(encode(report))

    def test_coherent_rehash_requires_trusted_whole_report_fingerprint(self):
        report = fixture(); trusted = hashlib.sha256(encode(report)).hexdigest()
        report['sourceUse'][0]['decision']['reason'] = 'Fictional coherently rewritten declaration.'
        rehash(report['sourceUse'][0])
        self.assertEqual(verify_report(encode(report))['sourceUseDecisionsChecked'], 1)
        with self.assertRaises(InvalidReport):
            verify_report(encode(report), expected_sha256=trusted)
        del report['sourceUse']
        verify_report(encode(report))  # Old formats cannot disclose an omitted server-side register.
        with self.assertRaises(InvalidReport):
            verify_report(encode(report), expected_sha256=trusted)


if __name__ == '__main__':
    unittest.main()
