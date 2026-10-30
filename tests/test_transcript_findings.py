"""Fictional transcript lineage: independent report and package verification."""
import base64
import copy
import hashlib
import json
import unittest
from tools.verify_report import InvalidReport, verify_report
from tools.report_package import build_package, verify_package


def uid(n):
    return f'00000000-0000-4000-8000-{n:012d}'


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def rehash(report):
    finding = report['transcriptFindings'][0]
    claim = finding['claim']
    claim['digest'] = hashlib.sha256(json.dumps({k: v for k, v in claim.items() if k != 'digest'}, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    finding['review']['claimDigest'] = claim['digest']
    return report


def fixture(corrected=True):
    at = '2026-10-30T00:00:00.000Z'
    raw = dict(id=uid(1), startMs=0, endMs=4500, speakerLabel='Fictional speaker', speakerUncertain=True, text='Fictional café account; date uncertain.')
    original = b'\xef\xbb\xbf' + encode(dict(format='inveos.supplied_transcript.v1', segments=[raw]))
    correction = dict(raw, id=uid(2), version=1, text='Fictional corrected café account.', reason='Fictional correction without audio alignment.', actorId=uid(3), actorName='Fictional corrector', recordedAt=at)
    selected = correction if corrected else raw
    policy = dict(authorityId=uid(4), authorityVersion=1, purpose='Fictional supplied-record review', lawfulBasis='Fictional commissioning only', scope='Fictional supplied transcript only', retentionDays=365, minimisation='Fictional necessary text only')
    source = dict(id=uid(5), filename='fictional-transcript.txt', sha256=hashlib.sha256(original).hexdigest(), sourceTime='2026-10-01T10:00:00+01:00', receivedTime=at, policy=policy)
    claim = dict(id=uid(6), caseId=uid(7), text='The fictional supplied account preserves date uncertainty.', proposedBy=uid(8), proposedAt=at, digest='', source=source,
                 transcript=dict(id=uid(9), title='Fictional interview', registeredBy=uid(10), registeredAt=at, segmentId=raw['id'], sourcePointer='/segments/0', version=1 if corrected else 0, raw=raw, corrections=[correction] if corrected else []),
                 reference=dict(offsetBasis='selected_transcript_utf8_not_original_media', startByte=0, endByte=len(selected['text'].encode()), quote=selected['text'], **{k: selected[k] for k in ('startMs', 'endMs', 'speakerLabel', 'speakerUncertain')}),
                 limitations='Reviewed interpretation of a supplied transcript, not proof of speech or source truth. Timecodes and speaker labels are declared; audio alignment and identity are unverified.')
    review = dict(id=uid(11), claimId=claim['id'], claimDigest='', accepted=True, reason='Fictional independent assessment of the retained transcript.', reviewerId=uid(12), reviewerName='Fictional reviewer', recordedAt=at)
    finding = dict(kind='reviewed_transcript', id=uid(13), text=claim['text'], reviewer=review['reviewerName'], reviewedAt=at, claim=claim, review=review, originalBase64=base64.b64encode(original).decode())
    report = dict(status='draft_not_released', case=dict(id=uid(7), ref='FICTIONAL-001', title='Fictional supplier review', client='Fictional Commission', scope='Supplied fictional records only', jurisdiction='England and Wales'), findings=[], transcriptFindings=[finding], investigation=dict(status='working_context_not_findings', objectives=[], questions=[], hypotheses=[], blockers=[]), limitations='Fictional internal draft; not released or authenticated.')
    return rehash(report)


class TranscriptFindingChecks(unittest.TestCase):
    def test_raw_and_corrected_versions_and_versioned_exhibits(self):
        for corrected in (False, True):
            report = fixture(corrected)
            self.assertEqual(verify_report(encode(report))['transcriptFindingsChecked'], 1)
            package = build_package(encode(report), '2026-10-30T00:00:00Z')
            self.assertEqual(verify_package(package)['schemaVersion'], 'inveos.internal-exhibit-package.v2')

    def test_rehashed_fabricated_raw_pointer_and_selected_offsets_are_rejected(self):
        changes = [lambda c: c['transcript']['raw'].update(text='Fictional fabricated raw content'),
                   lambda c: c['transcript'].update(sourcePointer='/segments/1'),
                   lambda c: c['reference'].update(startByte=1),
                   lambda c: c['reference'].update(offsetBasis='original_media'),
                   lambda c: c['reference'].update(speakerUncertain=False),
                   lambda c: c['reference'].update(endMs=9999)]
        for change in changes:
            report = fixture(); change(report['transcriptFindings'][0]['claim']); rehash(report)
            with self.assertRaises((InvalidReport, ValueError)):
                verify_report(encode(report))

    def test_missing_or_reordered_correction_history_and_boolean_versions_fail(self):
        for change in [lambda t: t.update(corrections=[]), lambda t: t['corrections'][0].update(version=2),
                       lambda t: t.update(version=True), lambda t: t['raw'].update(startMs=False)]:
            report = fixture(); change(report['transcriptFindings'][0]['claim']['transcript']); rehash(report)
            with self.assertRaises((InvalidReport, ValueError)):
                verify_report(encode(report))

    def test_self_review_rejection_and_mismatched_finding_are_not_accepted(self):
        for change in [lambda f: f['review'].update(reviewerId=f['claim']['proposedBy']),
                       lambda f: f['review'].update(reviewerId=uid(3)), lambda f: f['review'].update(accepted=False),
                       lambda f: f.update(text='Fictional finding changed independently'), lambda f: f['review'].update(claimId=uid(999))]:
            report = fixture(); change(report['transcriptFindings'][0])
            with self.assertRaises((InvalidReport, ValueError)):
                verify_report(encode(report))

    def test_duplicate_identity_and_cross_case_promotion_fail(self):
        report = fixture(); report['transcriptFindings'].append(copy.deepcopy(report['transcriptFindings'][0]))
        with self.assertRaises(InvalidReport):
            verify_report(encode(report))
        report = fixture(); report['transcriptFindings'][0]['claim']['caseId'] = uid(999); rehash(report)
        with self.assertRaises(InvalidReport):
            verify_report(encode(report))

    def test_original_bytes_and_trusted_report_digest_are_independent_checks(self):
        report = fixture(); original = encode(report); trusted = hashlib.sha256(original).hexdigest()
        self.assertTrue(verify_report(original, trusted)['trustedReportDigestMatched'])
        report['transcriptFindings'][0]['claim']['text'] = 'A different fictional interpretation remains semantically unverified.'
        report['transcriptFindings'][0]['text'] = report['transcriptFindings'][0]['claim']['text']; rehash(report)
        self.assertEqual(verify_report(encode(report))['findingsChecked'], 1)  # Internal consistency is not authenticity.
        with self.assertRaises(InvalidReport):
            verify_report(encode(report), trusted)

    def test_supplied_integral_number_notation_preserves_original_bytes(self):
        report = fixture(False); finding = report['transcriptFindings'][0]
        original = base64.b64decode(finding['originalBase64']).replace(b'"startMs":0', b'"startMs":0.0').replace(b'"endMs":4500', b'"endMs":4.5e3')
        finding['originalBase64'] = base64.b64encode(original).decode(); finding['claim']['source']['sha256'] = hashlib.sha256(original).hexdigest(); rehash(report)
        self.assertEqual(verify_report(encode(report))['findingsChecked'], 1)
