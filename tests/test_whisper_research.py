"""First-party protocol/boundary tests, not synthetic replacements for ASR benchmarks."""
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from tools import whisper_research_inputs as inputs
from tools.experiment_whisper import errors, validate_output, fixtures
from tools.speech_fixture import pcm_wave, resample
from tools.build_whisper_research import write_tar


class WhisperResearchTests(unittest.TestCase):
    def archive(self, entries):
        value = io.BytesIO()
        with tarfile.open(fileobj=value, mode='w') as archive:
            for name, data, kind in entries:
                item = tarfile.TarInfo(name)
                item.type, item.size = kind, len(data)
                if kind == tarfile.SYMTYPE:
                    item.linkname = '/etc/passwd'
                archive.addfile(item, io.BytesIO(data))
        return value.getvalue()

    def test_cache_requires_exact_pinned_bytes_and_offline_misses_do_not_network(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            item = {'name': 'fixture.bin', 'bytes': 8, 'sha256': hashlib.sha256(b'fiction!').hexdigest(), 'url': 'https://huggingface.co/fictional/unfetched'}
            with patch('urllib.request.build_opener', side_effect=AssertionError('offline network')):
                with self.assertRaisesRegex(ValueError, 'absent'):
                    inputs.artifact(item, cache)
                (cache / item['name']).write_bytes(b'fiction!')
                self.assertEqual(inputs.artifact(item, cache), b'fiction!')
                (cache / item['name']).write_bytes(b'tampered')
                with self.assertRaisesRegex(ValueError, 'differs'):
                    inputs.artifact(item, cache)

    def test_research_cache_denies_symlinks_and_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'target').write_bytes(b'fixture')
            (root / 'alias').symlink_to(root / 'target')
            with self.assertRaisesRegex(ValueError, 'Symlink'):
                inputs.safe_path(root / 'alias')
            with self.assertRaisesRegex(ValueError, 'name'):
                inputs.artifact({'name': '../secret'}, root)

    def test_artifact_origins_and_redirects_remain_https_on_the_fixed_provider_domains(self):
        for value in ['http://github.com/a', 'https://github.com.evil.test/a', 'https://127.0.0.1/a', 'https://user@github.com/a', 'https://github.com:444/a', 'https://hf.co.evil.test/a']:
            with self.subTest(url=value), self.assertRaises(ValueError):
                inputs.safe_url(value)
        for value in ['https://github.com/a', 'https://release-assets.githubusercontent.com/a', 'https://cas-bridge.xethub.hf.co/a']:
            self.assertEqual(inputs.safe_url(value), value)

    def test_archives_deny_links_devices_duplicates_traversal_and_expansion(self):
        for entries in [[('../escape', b'fake', tarfile.REGTYPE)], [('alias', b'', tarfile.SYMTYPE)], [('device', b'', tarfile.CHRTYPE)], [('same', b'1', tarfile.REGTYPE), ('same', b'2', tarfile.REGTYPE)]]:
            with self.subTest(entries=entries), self.assertRaises(ValueError):
                inputs.tar_entries(self.archive(entries))
        data = self.archive([('safe', b'fictional', tarfile.REGTYPE)])
        with self.assertRaisesRegex(ValueError, 'bound'):
            inputs.tar_entries(data, maximum=2)
        self.assertEqual(inputs.tar_entries(data), {'safe': b'fictional'})

    def test_reproducible_source_bundle_has_regular_readonly_entries(self):
        with tempfile.TemporaryDirectory() as directory:
            first, second = Path(directory) / 'first.tar', Path(directory) / 'second.tar'
            write_tar(first, {'source/LICENSE': b'Fictional terms', 'runner.cpp': b'Fictional harness'})
            write_tar(second, {'runner.cpp': b'Fictional harness', 'source/LICENSE': b'Fictional terms'})
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with tarfile.open(first) as archive:
                self.assertTrue(all(m.isfile() and m.mode == 0o444 and m.mtime == 1 for m in archive))

    def test_actual_committed_synthetic_audio_matches_recorded_bytes(self):
        cases = fixtures()
        self.assertEqual([c[0] for c in cases], ['supplier', 'uncertainty', 'silence', 'supplier_quiet', 'supplier_noise'])
        self.assertEqual(cases, fixtures())
        self.assertTrue(all(data.startswith(b'RIFF') and len(data) <= 960044 for _, data, _ in cases))
        self.assertTrue(all('Fictional' in text for name, _, text in cases if name != 'silence'))

    def test_integer_fixture_resampling_retains_pcm_bounds(self):
        data = pcm_wave(b'\x00\x00\xff\x7f\x00\x80\x01\x00')
        converted = resample(data)
        self.assertEqual(converted[44:], data[44:-2])
        with self.assertRaises(Exception):
            resample(b'not a wave')

    def test_output_context_and_types_are_checked_without_inventing_timing_accuracy(self):
        base = {'format': 'inveos.whisper_research.v1', 'sampleRate': 16000, 'samples': 16000, 'segments': [{'startMs': 0, 'endMs': 500, 'text': 'Fictional recognised words'}]}
        self.assertEqual(validate_output(json.dumps(base), 16000), (base, True))
        base['segments'][0]['endMs'] = 1500
        self.assertFalse(validate_output(json.dumps(base), 16000)[1])
        base['segments'][0]['endMs'] = '500'
        with self.assertRaises(ValueError):
            validate_output(json.dumps(base), 16000)
        with self.assertRaises(ValueError):
            validate_output(json.dumps(base), 32000)
        with self.assertRaises(ValueError):
            validate_output(' ' * (128 * 1024 + 1), 16000)

    def test_word_errors_preserve_substitutions_and_hallucinated_words_on_silence(self):
        self.assertEqual(errors('Twelve cartons', 'Twelve cartons.')['normalisedWordErrorRate'], 0)
        self.assertEqual(errors('Twelve cartons', 'Two cartons')['normalisedWordErrorRate'], .5)
        self.assertEqual(errors('Twelve cartons', '')['normalisedWordErrorRate'], 1)
        silence = errors('', 'Thank you')
        self.assertEqual(silence['wordsOnSilence'], 2)
        self.assertIsNone(silence['normalisedWordErrorRate'])


if __name__ == '__main__':
    unittest.main()
