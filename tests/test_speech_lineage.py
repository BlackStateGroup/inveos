"""Fictional exported protocol corpus; these tests do not execute or benchmark ASR."""
import base64
import copy
import json
from pathlib import Path
import unittest
from tools.verify_speech_context import verify_bytes, serialise, sha, rebuild
from tools.verify_report import verify_report, InvalidReport
from tools.report_package import build_package, verify_package

ROOT = Path(__file__).resolve().parents[1]


def rehash(report):
    f = report['speechFindings'][0]; c = f['claim']; package = c['context']; p = package['payload']
    # Rehash only declared records, without repairing their semantic relationships.
    for segment in p['segments']:
        for review in segment['reviews']:
            d = review['decision']; d['digest'] = sha(serialise({'context': review['context'], 'decision': {k: v for k, v in d.items() if k != 'digest'}}, True))
    package['sha256'] = sha(serialise(p, True))
    c['digest'] = sha(serialise({k: v for k, v in c.items() if k != 'digest'}, True))
    f['review']['claimDigest'] = c['digest']
    return report


def fixture():
    r = json.loads((ROOT / 'tests/fixtures/speech-report-template.json').read_text())
    f = r['speechFindings'][0]; c = f['claim']; p = c['context']['payload']
    original = (ROOT / 'research/whisper/fixtures/supplier.wav').read_bytes()
    p['source']['originalBase64'] = base64.b64encode(original).decode()
    derivative = rebuild(original, base64.b64decode(p['rawBase64']), p['derivative']['context'])
    p['derivative'] = derivative; p['derivativeDigest'] = sha(serialise(derivative))
    for segment in p['segments']:
        for review in segment['reviews']:
            review['context']['derivativeDigest'] = p['derivativeDigest']
    rehash(r)
    c['reference']['correspondenceDigest'] = p['segments'][0]['reviews'][0]['decision']['digest']
    return rehash(r)


class SpeechLineageTests(unittest.TestCase):
    def test_exported_context_report_and_audio_exhibits_agree(self):
        r = fixture(); p = r['speechFindings'][0]['claim']['context']
        checked = verify_bytes(serialise(p))
        self.assertTrue(checked['verified']); self.assertFalse(checked['recognitionAccuracyVerified'])
        self.assertEqual(verify_report(serialise(r))['speechFindingsChecked'], 1)
        package = build_package(serialise(r), '2026-01-02T00:00:00Z')
        self.assertEqual(verify_package(package)['schemaVersion'], 'inveos.internal-exhibit-package.v3')

    def test_json_object_reordering_preserves_declared_derivative_byte_digest(self):
        r = json.loads(json.dumps(fixture(), sort_keys=True))
        self.assertEqual(verify_report(serialise(r))['findingsChecked'], 1)

    def test_rehashed_source_quote_version_authority_and_account_tampering(self):
        changes = [lambda c: c['reference'].__setitem__('quote', 'Invented quotation'),
                   lambda c: c['reference'].__setitem__('startByte', True),
                   lambda c: c['reference'].__setitem__('endByte', 1),
                   lambda c: c['reference'].__setitem__('version', 0),
                   lambda c: c['reference'].__setitem__('segmentIndex', True),
                   lambda c: c['reference']['account'].__setitem__('speakerUncertain', False),
                   lambda c: c['reference'].__setitem__('offsetBasis', 'original_audio'),
                   lambda c: c['source']['policy'].__setitem__('authorityVersion', 2),
                   lambda c: c.__setitem__('proposedBy', c['context']['payload']['segments'][0]['reviews'][0]['decision']['reviewerId']),
                   lambda c: c.__setitem__('limitations', 'Speech and speaker identity proved')]
        for i, change in enumerate(changes):
            with self.subTest(case=i):
                r = fixture(); change(r['speechFindings'][0]['claim']); rehash(r)
                with self.assertRaises(InvalidReport): verify_report(serialise(r))

    def test_rehashed_context_rejects_rewritten_raw_audio_ranges_and_corrections(self):
        changes = [lambda p: p['source'].__setitem__('originalBase64', base64.b64encode(b'fictional corrupt audio').decode()),
                   lambda p: p['derivative']['coverage'].__setitem__('alignmentVerified', True),
                   lambda p: p['derivative']['context'].__setitem__('authorityVersion', True),
                   lambda p: p['segments'][0]['corrections'][0].__setitem__('version', 2),
                   lambda p: p['segments'][0]['corrections'][0].__setitem__('startMs', -1),
                   lambda p: p['segments'][0]['corrections'][0].__setitem__('endMs', 10000),
                   lambda p: p['segments'][0]['corrections'][0].__setitem__('hasSpeech', False),
                   lambda p: p['segments'][0]['reviews'][0]['decision'].__setitem__('reviewerId', p['requestedBy']),
                   lambda p: p['segments'][0]['reviews'][0]['context']['account'].__setitem__('text', 'Changed account'),
                   lambda p: p.__setitem__('interpretation', 'reviewed_facts')]
        for i, change in enumerate(changes):
            with self.subTest(case=i):
                r = fixture(); change(r['speechFindings'][0]['claim']['context']['payload']); rehash(r)
                with self.assertRaises(InvalidReport): verify_report(serialise(r))

    def test_duplicate_and_falsely_accepted_findings_fail(self):
        r = fixture(); r['speechFindings'].append(copy.deepcopy(r['speechFindings'][0]))
        with self.assertRaises(InvalidReport): verify_report(serialise(r))
        for accepted in (False, 1, 'true'):
            r = fixture(); r['speechFindings'][0]['review']['accepted'] = accepted
            with self.assertRaises(InvalidReport): verify_report(serialise(r))

    def test_duplicate_json_keys_and_nonfinite_numbers_fail(self):
        package = fixture()['speechFindings'][0]['claim']['context']
        raw = serialise(package)
        for data in (raw[:-1]+b',"format":"inveos.speech_context.v1"}', raw.replace(b'"segmentIndex":0', b'"segmentIndex":NaN', 1)):
            with self.assertRaises(ValueError): verify_bytes(data)


if __name__ == '__main__':
    unittest.main()
