import base64
import copy
import hashlib
import json
import unittest
from tools.verify_transcript import verify_bytes


def encode(payload):
    digest = hashlib.sha256(json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    return json.dumps({'format': 'inveos.transcript_export.v1', 'payload': payload, 'sha256': digest}, ensure_ascii=False).encode()


def fixture():
    identity = '00000000-0000-4000-8000-000000000001'
    raw = {'id': identity, 'startMs': 0, 'endMs': 1500, 'speakerLabel': 'Fictional speaker A',
           'speakerUncertain': True, 'text': 'Fictional supplied statement — uncertain attribution.'}
    original = ('\ufeff' + json.dumps({'format': 'inveos.supplied_transcript.v1', 'segments': [raw]}, ensure_ascii=False)).encode()
    edit = {**raw, 'id': '00000000-0000-4000-8000-000000000002', 'version': 1, 'endMs': 1600,
            'text': 'Fictional corrected text; no audio alignment is claimed.', 'reason': 'Fictional analyst correction to supplied context.',
            'actorId': identity, 'actorName': 'Fictional investigator', 'recordedAt': '2026-10-29T10:10:00.000Z'}
    return {'caseId': identity, 'transcriptId': identity, 'title': 'Fictional interview', 'createdBy': identity,
            'registeredAt': '2026-10-29T10:00:00.000Z', 'exportedAt': '2026-10-29T11:00:00.000Z',
            'source': {'evidenceId': identity, 'digest': hashlib.sha256(original).hexdigest(), 'authorityVersion': 1,
                       'sourceTime': '2026-10-28T09:30:00+01:00', 'receivedTime': '2026-10-29T09:30:00.000Z',
                       'filename': 'fictional-transcript.txt', 'originalBase64': base64.b64encode(original).decode()},
            'segments': [{'raw': raw, 'corrections': [edit], 'current': {**raw, 'text': edit['text'], 'endMs': 1600}}],
            'interpretation': 'unreviewed_transcript_context_not_findings'}


class TranscriptVerifierTests(unittest.TestCase):
    def test_preserved_bom_and_unicode_original_and_distinct_correction_verify_offline(self):
        receipt = verify_bytes(encode(fixture()))
        self.assertEqual(receipt['corrections'], 1)
        self.assertFalse(receipt['audioAlignmentVerified'])
        self.assertFalse(receipt['actorAuthenticityVerified'])

    def test_rehashed_fabricated_raw_history_and_promoted_status_are_rejected(self):
        mutations = [lambda p: p['segments'][0]['raw'].update(startMs=False),
                     lambda p: p['segments'][0]['raw'].update(text='Invented raw statement.'),
                     lambda p: p['segments'][0]['current'].update(speakerUncertain=False),
                     lambda p: p['segments'][0]['corrections'][0].update(version=2),
                     lambda p: p['segments'][0]['corrections'][0].update(startMs=True),
                     lambda p: p['source'].update(digest='0' * 64),
                     lambda p: p.update(interpretation='reviewed_finding'),
                     lambda p: p['segments'][0]['corrections'].clear()]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                payload = copy.deepcopy(fixture())
                mutate(payload)
                with self.assertRaises(ValueError):
                    verify_bytes(encode(payload))

    def test_changed_manifest_duplicate_keys_and_unbounded_packages_are_rejected(self):
        data = encode(fixture())
        with self.assertRaises(ValueError):
            verify_bytes(data.replace(b'Fictional interview', b'Changed interview'))
        with self.assertRaises(ValueError):
            verify_bytes(data.replace(b'"format":', b'"sha256":"duplicate","format":', 1))
        with self.assertRaises(ValueError):
            verify_bytes(b' ' * 2097153)

    def test_integer_valued_source_number_notation_preserves_exact_original(self):
        payload = fixture()
        source = payload['source']
        original = base64.b64decode(source['originalBase64']).replace(b'"startMs": 0', b'"startMs": -0.0').replace(b'"endMs": 1500', b'"endMs": 1.5e3')
        source.update(originalBase64=base64.b64encode(original).decode(), digest=hashlib.sha256(original).hexdigest())
        self.assertTrue(verify_bytes(encode(payload))['verified'])
