#!/usr/bin/env python3
"""Independently verify retained audio, recognition, corrections and review references.

No model, audio decoder, application server or network is used. Consistent bytes
and declared reviews do not authenticate actors or prove speech accuracy.
"""
import argparse
import base64
import hashlib
import json
import math
import struct
from pathlib import Path
try:
    from tools.verify_transcript import require, decode, keys, identifier, string, timestamp, HEX
    from tools.verify_report import verify_source_use
except ModuleNotFoundError:
    from verify_transcript import require, decode, keys, identifier, string, timestamp, HEX
    from verify_report import verify_source_use

MAX_BYTES = 2097152
PROFILE_DIGEST = '65c401acf789f238f77cec0c79605b40fb24efdae81f8b4dc11586c23920aeb9'


def serialise(value, canonical=False):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=canonical, allow_nan=False).encode('utf-8')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def unbase(value, limit):
    require(type(value) is str, 'Missing encoded source bytes')
    data = base64.b64decode(value, validate=True)
    require(0 < len(data) <= limit and base64.b64encode(data).decode() == value, 'Source byte encoding or bound differs')
    return data


def integral(value):
    return type(value) in (int, float) and math.isfinite(value) and int(value) == value and abs(value) <= 9007199254740991


def audio(data):
    require(44 < len(data) <= 262144 and len(data) % 2 == 0, 'PCM byte bound')
    values = struct.unpack('<4sI4s4sIHHIIHH4sI', data[:44])
    require(values == (b'RIFF', len(data) - 8, b'WAVE', b'fmt ', 16, 1, 1, 16000, 32000, 2, 16, b'data', len(data) - 44), 'Unsupported PCM structure')
    samples = (len(data) - 44) // 2
    duration = samples / 16
    return {'sampleRate': 16000, 'channels': 1, 'sampleBits': 16, 'samples': samples, 'durationMs': int(duration) if duration.is_integer() else duration, 'dataOffset': 44, 'byteLength': len(data)}


def rebuild(original, raw_bytes, context):
    # JSONB and exported object order do not define the derivative byte encoding.
    # Reconstruct the profile's fixed field order before checking its byte digest.
    context = {k: context[k] for k in ('tenantId', 'caseId', 'jobId', 'evidenceId', 'sourceDigest', 'authorityVersion')}
    pcm = audio(original)
    raw = decode(raw_bytes.decode('utf-8'))
    keys(raw, {'format', 'sampleRate', 'samples', 'segments'})
    require(raw['format'] == 'inveos.whisper_research.v1' and integral(raw['sampleRate']) and raw['sampleRate'] == 16000 and integral(raw['samples']) and raw['samples'] == pcm['samples'], 'Recognition source differs')
    require(type(raw['segments']) is list and len(raw['segments']) <= 128, 'Speech segment bound')
    previous, offset, text, segments = 0, 0, '', []
    for index, value in enumerate(raw['segments']):
        keys(value, {'startMs', 'endMs', 'text'})
        require(integral(value['startMs']) and integral(value['endMs']), 'Invalid reported timestamp')
        string(value['text'], 16384, empty=True)
        require(len(value['text'].encode('utf-8')) <= 16384, 'Raw speech text byte bound')
        start, end = int(value['startMs']), int(value['endMs'])
        if index:
            text += '\n'; offset += 1
        first = offset
        text += value['text']; offset += len(value['text'].encode('utf-8'))
        require(offset <= 131072, 'Recognised text bound')
        segments.append({'index': index, 'sourcePointer': '/segments/' + str(index), 'startMs': start, 'endMs': end, 'text': value['text'], 'startByte': first, 'endByte': offset, 'rangeWithinOriginal': 0 <= start < end <= pcm['durationMs'], 'ordered': previous <= start})
        previous = end
    return {'format': 'inveos_speech_derivative_v1', 'context': context, 'profileDigest': PROFILE_DIGEST, 'rawDigest': sha(raw_bytes), 'reviewState': 'unreviewed', 'offsetBasis': 'recognised_utf8_not_original_audio', 'audio': pcm, 'text': text, 'segments': segments, 'coverage': {'reportedRangesValid': all(s['rangeWithinOriginal'] and s['ordered'] for s in segments), 'alignmentVerified': False, 'speechAccuracyVerified': False}}


def account(raw, edit=None):
    fields = ('startMs', 'endMs', 'hasSpeech', 'text', 'speakerLabel', 'speakerUncertain')
    return {k: edit[k] for k in fields} if edit else {'startMs': raw['startMs'], 'endMs': raw['endMs'], 'hasSpeech': True, 'text': raw['text'], 'speakerLabel': 'Unattributed', 'speakerUncertain': True}


def verify_bytes(data):
    require(0 < len(data) <= MAX_BYTES, 'Speech context exceeds two MiB')
    package = decode(data.decode('utf-8'))
    keys(package, {'format', 'payload', 'sha256'})
    require(package['format'] == 'inveos.speech_context.v1', 'Unknown speech context format')
    payload = package['payload']
    require(sha(serialise(payload, True)) == package['sha256'], 'Speech context manifest differs')
    keys(payload, set('caseId jobId source profile profileDigest rawBase64 rawDigest derivative derivativeDigest processedAt requestedBy segments sourceUse exportedAt interpretation'.split()))
    for k in ('caseId', 'jobId', 'requestedBy'):
        identifier(payload[k])
    for k in ('processedAt', 'exportedAt'):
        timestamp(payload[k], utc=True)
    require(payload['interpretation'] == 'internal_speech_context_not_findings', 'Speech context state promoted')
    require(type(payload['profile']) is str and sha(payload['profile'].encode()) == payload['profileDigest'] == PROFILE_DIGEST, 'Unsupported recognition profile')
    source = payload['source']
    keys(source, set('evidenceId digest filename sourceTime receivedTime authorityId authorityVersion originalBase64'.split()))
    identifier(source['evidenceId']); identifier(source['authorityId'])
    string(source['filename'], 128); timestamp(source['sourceTime']); timestamp(source['receivedTime'], utc=True)
    require(type(source['authorityVersion']) is int and source['authorityVersion'] > 0, 'Invalid source authority version')
    original = unbase(source['originalBase64'], 262144)
    require(type(source['digest']) is str and HEX.fullmatch(source['digest']) and sha(original) == source['digest'], 'Audio original fingerprint differs')
    raw_bytes = unbase(payload['rawBase64'], 131072)
    require(sha(raw_bytes) == payload['rawDigest'], 'Raw recognition fingerprint differs')
    context = payload['derivative'].get('context') if type(payload['derivative']) is dict else None
    keys(context, set('tenantId caseId jobId evidenceId sourceDigest authorityVersion'.split()))
    identifier(context['tenantId'])
    require(context['caseId'] == payload['caseId'] and context['jobId'] == payload['jobId'] and context['evidenceId'] == source['evidenceId'] and context['sourceDigest'] == source['digest'] and type(context['authorityVersion']) is int and context['authorityVersion'] > 0, 'Speech derivative scope differs')
    derivative = rebuild(original, raw_bytes, context)
    require(serialise(derivative, True) == serialise(payload['derivative'], True) and sha(serialise(derivative)) == payload['derivativeDigest'], 'Speech derivative or range flags differ from raw output')
    require(type(payload['segments']) is list and len(payload['segments']) == len(derivative['segments']), 'Speech segment histories differ')
    request_ids, corrections, reviews = set(), 0, 0
    for index, item in enumerate(payload['segments']):
        keys(item, {'raw', 'corrections', 'reviews'})
        raw = derivative['segments'][index]
        require(serialise(item['raw'], True) == serialise(raw, True), 'Raw segment history changed')
        require(type(item['corrections']) is list and len(item['corrections']) <= 100, 'Correction history bound')
        for version, edit in enumerate(item['corrections'], 1):
            keys(edit, set('id segmentIndex version startMs endMs hasSpeech text speakerLabel speakerUncertain reason actorId actorName recordedAt'.split()))
            identifier(edit['id']); identifier(edit['actorId'])
            require(edit['id'] not in request_ids and type(edit['segmentIndex']) is int and edit['segmentIndex'] == index and type(edit['version']) is int and edit['version'] == version, 'Correction identity or sequence differs')
            request_ids.add(edit['id'])
            require(type(edit['startMs']) is int and type(edit['endMs']) is int and 0 <= edit['startMs'] < edit['endMs'] <= derivative['audio']['durationMs'], 'Correction lies outside original audio')
            require(type(edit['hasSpeech']) is bool and type(edit['speakerUncertain']) is bool, 'Correction uncertainty or speech state differs')
            string(edit['text'], 10000, empty=not edit['hasSpeech']); string(edit['speakerLabel'], 120, empty=not edit['hasSpeech'])
            require(len(edit['text'].encode()) <= 16384 and (edit['hasSpeech'] or (edit['text'] == edit['speakerLabel'] == '' and edit['speakerUncertain'])), 'No-speech correction or text bound differs')
            string(edit['reason'], 3000); require(len(edit['reason'].strip()) >= 10, 'Correction reason missing')
            string(edit['actorName'], 1500000, empty=True, controls=True); timestamp(edit['recordedAt'], utc=True)
            corrections += 1
        require(type(item['reviews']) is list and len(item['reviews']) <= 101, 'Review history bound')
        versions = set()
        for entry in item['reviews']:
            keys(entry, {'context', 'decision'})
            d = entry['decision']; keys(d, set('id segmentIndex version accepted reason reviewerId reviewerName recordedAt digest'.split()))
            identifier(d['id']); identifier(d['reviewerId'])
            v = d['version']; require(type(v) is int and 0 <= v <= len(item['corrections']) and v not in versions and type(d['segmentIndex']) is int and d['segmentIndex'] == index and d['id'] not in request_ids, 'Review identity or version differs')
            versions.add(v); request_ids.add(d['id'])
            chosen = account(raw, item['corrections'][v - 1] if v else None)
            expected = {'format': 'inveos.speech_review_context.v1', 'caseId': payload['caseId'], 'jobId': payload['jobId'], 'sourceDigest': source['digest'], 'derivativeDigest': payload['derivativeDigest'], 'authorityVersion': context['authorityVersion'], 'segmentIndex': index, 'version': v, 'account': chosen}
            require(serialise(entry['context'], True) == serialise(expected, True), 'Review selected another source or account')
            require(d['reviewerId'] != payload['requestedBy'] and all(d['reviewerId'] != e['actorId'] for e in item['corrections'][:v]), 'Review independence differs')
            require(type(d['accepted']) is bool and (not d['accepted'] or (0 <= chosen['startMs'] < chosen['endMs'] <= derivative['audio']['durationMs'] and (not chosen['hasSpeech'] or chosen['text'].strip()))), 'Invalid reported range was accepted')
            string(d['reason'], 3000); require(len(d['reason'].strip()) >= 10, 'Review reason missing')
            string(d['reviewerName'], 1500000, empty=True, controls=True); timestamp(d['recordedAt'], utc=True)
            snapshot = {'context': expected, 'decision': {k: val for k, val in d.items() if k != 'digest'}}
            require(sha(serialise(snapshot, True)) == d['digest'], 'Speech review fingerprint differs')
            reviews += 1
    proof_source = {'id': source['evidenceId'], 'filename': source['filename'], 'sha256': source['digest'], 'sourceTime': source['sourceTime'], 'receivedTime': source['receivedTime'], 'authorityId': source['authorityId'], 'authorityVersion': source['authorityVersion']}
    proof_count = verify_source_use({'case': {'id': payload['caseId']}, 'findings': [{'source': proof_source}], 'sourceUse': payload['sourceUse']})
    return {'verified': True, 'sourceSha256': source['digest'], 'segments': len(payload['segments']), 'corrections': corrections, 'reviewDecisions': reviews, 'sourceUseDeclarationsChecked': proof_count, 'reportedRangesValid': derivative['coverage']['reportedRangesValid'], 'recognitionAccuracyVerified': False, 'audioAlignmentVerified': False, 'actorAuthenticityVerified': False, 'clientReleaseApproved': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('package', type=Path); args = parser.parse_args()
    try:
        with args.package.open('rb') as handle:
            result = verify_bytes(handle.read(MAX_BYTES + 1))
    except (ValueError, OSError, UnicodeError, RecursionError, TypeError, KeyError, OverflowError) as error:
        parser.exit(1, 'Verification failed: ' + str(error) + '\n')
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
