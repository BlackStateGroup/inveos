#!/usr/bin/env python3
"""Measure actual pinned CPU speech inference on fictional generated PCM; never a reviewed transcript."""
from array import array
import json
from pathlib import Path
import random
import re
import shutil
import sys
import tempfile
import time
import uuid
from .bounded_process import ProcessLimitExceeded, run_bounded
from .probe_worker_isolation import command, container_args, check_configuration
from .speech_fixture import pcm_wave
from .whisper_research_inputs import ROOT, LOCK, require, sha, safe_path


def words(text):
    return re.findall(r"[a-z0-9]+(?:'[a-z0-9]+)?", text.lower())


def errors(reference, hypothesis):
    a, b = words(reference), words(hypothesis)
    previous = list(range(len(b) + 1))
    for i, token in enumerate(a, 1):
        row = [i]
        for j, other in enumerate(b, 1):
            row.append(min(row[-1] + 1, previous[j] + 1, previous[j - 1] + (token != other)))
        previous = row
    return {'referenceWords': len(a), 'hypothesisWords': len(b), 'wordEdits': previous[-1], 'normalisedWordErrorRate': previous[-1] / len(a) if a else None, 'wordsOnSilence': len(b) if not a else None}


def validate_output(data, samples):
    require(isinstance(data, str) and len(data.encode('utf-8')) <= 128 * 1024, 'Inference output byte bound')
    def unique(pairs):
        value = {}
        for key, item in pairs:
            require(key not in value, 'Duplicate inference field')
            value[key] = item
        return value
    result = json.loads(data, object_pairs_hook=unique, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite inference value')))
    require(isinstance(result, dict), 'Inference object required')
    require(set(result) == {'format', 'sampleRate', 'samples', 'segments'} and result['format'] == 'inveos.whisper_research.v1' and type(result['sampleRate']) is int and result['sampleRate'] == 16000 and type(result['samples']) is int and result['samples'] == samples, 'Inference context differs')
    require(isinstance(result['segments'], list) and len(result['segments']) <= 128, 'Segment bound')
    valid, prior = True, 0
    for segment in result['segments']:
        require(isinstance(segment, dict) and set(segment) == {'startMs', 'endMs', 'text'} and type(segment['startMs']) is int and type(segment['endMs']) is int and isinstance(segment['text'], str), 'Malformed segment')
        require(len(segment['text'].encode('utf-8')) <= 16384, 'Segment text bound')
        valid = valid and 0 <= prior <= segment['startMs'] <= segment['endMs'] <= samples * 1000 / 16000
        prior = segment['endMs']
    return result, valid


def fixtures():
    root = ROOT / 'research/whisper/fixtures'
    receipt = json.loads((root / 'receipt.json').read_text())
    result = []
    for item in receipt['fixtures']:
        data = (root / item['file']).read_bytes()
        require(sha(data) == item['sha256'] and len(data) == item['bytes'], 'Fictional fixture changed')
        result.append((item['file'][:-4], data, item['referenceText']))
    result.append(('silence', pcm_wave(bytes(16000 * 2 * 3)), ''))
    # Deterministic integer attenuation and low-amplitude white noise. These
    # controlled transformations are not microphone/environmental recordings.
    source = array('h', result[0][1][44:])
    if sys.byteorder != 'little':
        source.byteswap()
    generator = random.Random(431)
    noisy = array('h', (max(-32768, min(32767, v + generator.randrange(-1800, 1801))) for v in source))
    quiet = array('h', (v // 10 for v in source))
    if sys.byteorder != 'little':
        noisy.byteswap()
        quiet.byteswap()
    result += [('supplier_quiet', pcm_wave(quiet.tobytes()), result[0][2]), ('supplier_noise', pcm_wave(noisy.tobytes()), result[0][2])]
    return result


def execute(image, model, wave_bytes, *, timeout=180, expect_timeout=False):
    info = json.loads(command('image', 'inspect', image).stdout)[0]
    require(info['Id'] == image, 'Research runtime identity differs')
    with tempfile.TemporaryDirectory(prefix='inveos-whisper-inference-') as directory:
        root = Path(directory)
        root.chmod(0o755)
        shutil.copyfile(model, root / 'model.bin')
        (root / 'audio.wav').write_bytes(wave_bytes)
        for p in root.iterdir():
            p.chmod(0o444)
        model_digest = sha((root / 'model.bin').read_bytes())
        name = 'inveos-whisper-inference-' + uuid.uuid4().hex
        start = time.monotonic()
        try:
            command(*container_args(name, image, root, info['Config'].get('Volumes') or {}, runtime=True), 'exec /opt/inveos/inveos-whisper /original/model.bin /original/audio.wav')
            check_configuration(json.loads(command('inspect', name).stdout)[0], info['Config'].get('Volumes') or {}, runtime=True)
            try:
                outcome = run_bounded(['docker', 'start', '--attach', name], timeout=timeout, max_output=256 * 1024)
                require(not expect_timeout, 'Forced short deadline unexpectedly completed')
                return {'returnCode': outcome.returncode, 'stdout': outcome.stdout.decode('utf-8'), 'stderr': outcome.stderr.decode('utf-8'), 'stdoutSha256': sha(outcome.stdout), 'stderrSha256': sha(outcome.stderr), 'seconds': time.monotonic() - start}
            except ProcessLimitExceeded:
                require(expect_timeout, 'Inference exceeded its time/output bound')
                return {'deadlineEnforced': True, 'seconds': time.monotonic() - start}
        finally:
            command('rm', '--force', name, check=False)
            require(command('inspect', name, check=False).returncode != 0, 'Inference container survived cleanup')
            require((root / 'audio.wav').read_bytes() == wave_bytes and sha((root / 'model.bin').read_bytes()) == model_digest, 'Read-only inference input changed')


def experiment(cache, built, output):
    lock = json.loads(LOCK.read_text())
    build = json.loads((built / 'build-receipt.json').read_text())
    require(build['inputLockSha256'] == sha(LOCK.read_bytes()) and build['binarySha256'] == sha((built / 'inveos-whisper').read_bytes()), 'Build provenance changed')
    model = cache / 'ggml-tiny.en.bin'
    safe_path(model)
    expected = next(a for a in lock['artifacts'] if a['name'] == model.name)
    require(model.stat().st_size == expected['bytes'] and sha(model.read_bytes()) == expected['sha256'], 'Model differs from qualified input')
    image = build['runtimeImageId']
    output.mkdir(parents=True, exist_ok=True)
    runs = []
    cases = fixtures()
    for name, data, reference in cases:
        repetitions = []
        for attempt in range(2):
            run = execute(image, model, data)
            require(run['returnCode'] == 0, 'Actual bounded transcription failed for ' + name)
            value, times_valid = validate_output(run['stdout'], (len(data) - 44) // 2)
            text = ' '.join(s['text'] for s in value['segments'])
            repetitions.append(value)
            receipt = {'case': name, 'attempt': attempt + 1, 'originalSha256': sha(data), 'originalBytes': len(data), 'modelSha256': expected['sha256'], 'runtimeImageId': image, 'referenceText': reference, 'recognisedText': text, 'reportedTimestampRangesValid': times_valid, 'output': value, 'seconds': run['seconds'], 'stdoutSha256': run['stdoutSha256'], 'stderrSha256': run['stderrSha256'], 'accuracy': errors(reference, text)}
            (output / (name + '-' + str(attempt + 1) + '.json')).write_text(json.dumps(receipt, indent=2) + '\n')
            runs.append(receipt)
        require(repetitions[0] == repetitions[1], 'Repeated greedy outputs differ for ' + name)
    invalid = [('truncated', cases[0][1][:-1]), ('wrong_rate', cases[0][1][:24] + (8000).to_bytes(4, 'little') + cases[0][1][28:]), ('oversized', cases[0][1] + bytes(960044))]
    failures = []
    for name, data in invalid:
        run = execute(image, model, data, timeout=30)
        require(run['returnCode'] == 2 and not run['stdout'] and 'Unsupported or malformed bounded PCM fixture' in run['stderr'], 'Malformed audio did not fail before inference')
        failures.append({'case': name, 'returnCode': run['returnCode'], 'seconds': run['seconds'], 'originalSha256': sha(data)})
    cancellation = execute(image, model, cases[0][1], timeout=0.05, expect_timeout=True)
    receipt = {'format': 'inveos.whisper_research_experiment.v1', 'buildReceiptSha256': sha((built / 'build-receipt.json').read_bytes()), 'runs': runs, 'repeatedOutputsIdentical': True, 'malformedAudio': failures, 'shortDeadlineCancellation': cancellation, 'limitation': 'Actual inference on five controlled synthetic English cases, not representative speech accuracy, speaker identity, exact quotation timing, field/device or professional acceptance. Short deadline may cancel before model initialisation. Every output is unreviewed; no application integration or model/runtime distribution approval.'}
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return {'actualInferenceRuns': len(runs), 'malformedAudioRejections': len(failures), 'shortDeadlineCancellation': cancellation, 'results': [{k: r[k] for k in ('case', 'attempt', 'accuracy', 'reportedTimestampRangesValid')} for r in runs]}


def main():
    import argparse
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--cache', type=Path, default=ROOT / '.research-cache/whisper-inputs')
    p.add_argument('--built', type=Path, default=ROOT / '.research-cache/whisper-built')
    p.add_argument('--output', type=Path, default=ROOT / 'output/evals/whisper')
    a = p.parse_args()
    print(json.dumps(experiment(a.cache, a.built, a.output), indent=2))


if __name__ == '__main__':
    main()
