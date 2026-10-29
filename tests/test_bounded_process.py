from pathlib import Path
import sys
import tempfile
import time
import unittest

from tools.bounded_process import ProcessLimitExceeded, run_bounded


class BoundedProcessTests(unittest.TestCase):
    def run_python(self, source, **kwargs):
        return run_bounded([sys.executable, '-c', source], **kwargs)

    def test_exact_combined_boundary_binary_and_exit_status(self):
        result = self.run_python('import os; os.write(1,b"\\xff"*1024); os.write(2,b"e"*1024); raise SystemExit(7)', max_output=2048)
        self.assertEqual((result.returncode, result.stdout, result.stderr), (7, b'\xff'*1024, b'e'*1024))

    def test_floods_on_either_or_both_streams_are_bounded(self):
        for source in [
            'import os\nwhile True: os.write(1,b"x"*65536)',
            'import os\nwhile True: os.write(2,b"x"*65536)',
            'import os\nwhile True: os.write(1,b"x"*500); os.write(2,b"x"*500)',
        ]:
            with self.subTest(source=source), self.assertRaises(ProcessLimitExceeded) as error:
                self.run_python(source, max_output=1000, timeout=2)
            self.assertEqual(error.exception.reason, 'output_bytes')
            self.assertLessEqual(error.exception.captured_bytes, 1000)

    def test_deadline_includes_closed_pipes_and_inherited_pipes(self):
        for source in [
            'import time; time.sleep(10)',
            'import os,time; os.close(1); os.close(2); time.sleep(10)',
            'import os,time\nif os.fork()==0: time.sleep(10)\nelse: os._exit(0)',
        ]:
            started = time.monotonic()
            with self.subTest(source=source), self.assertRaises(ProcessLimitExceeded) as error:
                self.run_python(source, timeout=0.2)
            self.assertEqual(error.exception.reason, 'wall_time')
            self.assertLess(time.monotonic() - started, 3)

    def test_timeout_kills_descendants_before_delayed_side_effect(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'must-not-exist'
            source = ('import os,time,pathlib\n'
                      'if os.fork()==0:\n time.sleep(0.6); pathlib.Path('+repr(str(path))+').touch()\n'
                      'else: time.sleep(10)')
            with self.assertRaises(ProcessLimitExceeded):
                self.run_python(source, timeout=0.2)
            time.sleep(0.7)
            self.assertFalse(path.exists())

    def test_no_shell_or_inherited_stdin(self):
        result = run_bounded([sys.executable, '-c', 'import sys; print(sys.argv[1]); print(len(sys.stdin.read()))', '$(not-a-command)'])
        self.assertEqual(result.stdout, b'$(not-a-command)\n0\n')

    def test_invalid_limits_rejected_before_spawn(self):
        for kwargs in [{'timeout': 0}, {'timeout': float('nan')}, {'timeout': float('inf')},
                       {'timeout': True}, {'max_output': 0}, {'max_output': 16777217}, {'max_output': True}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                run_bounded(['/nonexistent'], **kwargs)
        with self.assertRaises(ValueError):
            run_bounded('echo nope')


if __name__ == '__main__':
    unittest.main()
