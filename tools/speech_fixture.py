#!/usr/bin/env python3
"""Create explicitly fictional, non-human speech fixtures with a host-only eSpeak NG tool."""
import argparse
from array import array
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import wave
from .bounded_process import run_bounded

ROOT = Path(__file__).resolve().parents[1]
TEXTS = {'supplier': 'Fictional interview. The supplier sent twelve cartons on Monday.', 'uncertainty': 'Fictional statement. I did not check the ownership record.'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def pcm_wave(samples):
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(samples)
    return stream.getvalue()


def resample(data):
    with wave.open(io.BytesIO(data), 'rb') as source:
        if source.getnchannels() != 1 or source.getsampwidth() != 2 or source.getcomptype() != 'NONE' or not 8000 <= source.getframerate() <= 48000 or source.getnframes() > 30 * source.getframerate():
            raise ValueError('Unexpected fixture generator PCM')
        rate = source.getframerate()
        values = array('h', source.readframes(source.getnframes()))
    if sys.byteorder != 'little':
        values.byteswap()
    output = array('h')
    for i in range((len(values) - 1) * 16000 // rate):
        pos, remainder = divmod(i * rate, 16000)
        output.append((values[pos] * (16000 - remainder) + values[pos + 1] * remainder) // 16000)
    if sys.byteorder != 'little':
        output.byteswap()
    return pcm_wave(output.tobytes())


def generate(output):
    output.mkdir(parents=True, exist_ok=True)
    version = run_bounded(['espeak-ng', '--version'], max_output=4096)
    if version.returncode:
        raise ValueError('Fixture generation needs the documented host eSpeak NG tool')
    receipts = []
    with tempfile.TemporaryDirectory(prefix='inveos-fictional-speech-') as directory:
        for name, text in TEXTS.items():
            path = Path(directory) / (name + '.wav')
            result = run_bounded(['espeak-ng', '-v', 'en-gb', '-s', '150', '-w', str(path), text], timeout=15, max_output=65536)
            if result.returncode or not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
                raise ValueError('Fictional speech generation failed or exceeded bound')
            data = resample(path.read_bytes())
            (output / (name + '.wav')).write_bytes(data)
            receipts.append({'file': name + '.wav', 'referenceText': text, 'sha256': sha(data), 'bytes': len(data), 'samples': (len(data) - 44) // 2, 'sampleRate': 16000})
    receipt = {'format': 'inveos.fictional_speech_fixture.v1', 'generatorVersion': version.stdout.decode().strip(), 'command': ['espeak-ng', '-v', 'en-gb', '-s', '150', '-w', '<temporary WAV>', '<fictional text>'], 'generatorBinarySha256': sha(Path('/usr/bin/espeak-ng').read_bytes()), 'resampling': 'First-party integer linear interpolation to mono signed PCM16 LE at16000Hz; canonical44-byte RIFF header.', 'fixtures': receipts, 'limitation': 'Generated formant speech only; no human speaker, actual interview, microphone/device, accent/noise or representative recognition acceptance. Generator is a host test tool, not an application dependency.'}
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'research/whisper/fixtures')
    parser.add_argument('--generate', action='store_true')
    args = parser.parse_args()
    if args.generate:
        print(json.dumps(generate(args.output), indent=2))
    else:
        receipt = json.loads((args.output / 'receipt.json').read_text())
        for item in receipt['fixtures']:
            data = (args.output / item['file']).read_bytes()
            if len(data) != item['bytes'] or sha(data) != item['sha256']:
                raise ValueError('Committed fictional speech fixture differs from receipt')
        print('Fictional speech fixture bytes verified; no synthesis or ASR run.')


if __name__ == '__main__':
    main()
