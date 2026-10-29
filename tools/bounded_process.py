"""Bound Linux subprocess pipe capture and wall time; not a sandbox by itself."""
from dataclasses import dataclass
import math
import os
import selectors
import signal
import subprocess
import time


@dataclass(frozen=True)
class ProcessResult:
    returncode: int
    stdout: bytes
    stderr: bytes


class ProcessLimitExceeded(RuntimeError):
    def __init__(self, reason, captured_bytes):
        super().__init__(reason)
        self.reason = reason
        self.captured_bytes = captured_bytes


def run_bounded(argv, *, timeout=20, max_output=1024 * 1024):
    """Capture at most max_output bytes TOTAL, including stderr, with no shell.

    Kill the CLI process group on every exit, including inherited pipe holders.
    Docker containers require separate unconditional removal by their caller:
    killing the attach client does not stop a container managed by the daemon.
    Do not pass secrets in argv. No captured bytes are included in exceptions.
    """
    if (not isinstance(timeout, (int, float)) or isinstance(timeout, bool)
            or not math.isfinite(timeout) or not 0 < timeout <= 300):
        raise ValueError('timeout must be finite and in (0, 300] seconds')
    if type(max_output) is not int or not 0 < max_output <= 16 * 1024 * 1024:
        raise ValueError('max_output must be in 1..16777216 bytes')
    if not isinstance(argv, (list, tuple)) or not argv or any(not isinstance(a, str) for a in argv):
        raise ValueError('Expected an argument vector')
    deadline = time.monotonic() + timeout
    captured = [bytearray(), bytearray()]
    total = 0
    with subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, start_new_session=True) as process:
        try:
            with selectors.DefaultSelector() as selector:
                for index, stream in enumerate((process.stdout, process.stderr)):
                    os.set_blocking(stream.fileno(), False)
                    selector.register(stream, selectors.EVENT_READ, index)
                while selector.get_map():
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise ProcessLimitExceeded('wall_time', total)
                    for key, _ in selector.select(min(remaining, 0.1)):
                        # Read one extra byte to detect a crossed combined limit;
                        # never retain that byte or unbounded output in memory.
                        block = os.read(key.fd, min(65536, max_output - total + 1))
                        if not block:
                            selector.unregister(key.fileobj)
                            continue
                        if total + len(block) > max_output:
                            raise ProcessLimitExceeded('output_bytes', total)
                        captured[key.data].extend(block)
                        total += len(block)
                try:
                    code = process.wait(timeout=max(0, deadline - time.monotonic()))
                except subprocess.TimeoutExpired:
                    raise ProcessLimitExceeded('wall_time', total) from None
                return ProcessResult(code, bytes(captured[0]), bytes(captured[1]))
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
