"""Single runner per storage root; lock automatically released on exit."""
from contextlib import contextmanager
import os


@contextmanager
def runner_lock(root):
    root.mkdir(parents=True, exist_ok=True)
    with (root / ".runner.lock").open("a+b") as handle:
        if not handle.tell():
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        if os.name == "nt":
            from msvcrt import locking, LK_NBLCK
            acquire = lambda: locking(handle.fileno(), LK_NBLCK, 1)
        else:
            from fcntl import flock, LOCK_EX, LOCK_NB
            acquire = lambda: flock(handle.fileno(), LOCK_EX | LOCK_NB)
        try:
            acquire()
        except OSError as exc:
            raise RuntimeError("A runner is already active for this storage root") from exc
        yield
