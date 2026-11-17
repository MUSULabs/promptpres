"""Where a finished upload goes, how a queued session reaches the worker, and where run files are read (D-062).

The defaults are the local / Docker / Pilot behaviour: files stay on this machine's disk and `worker.runner`
polls the sessions table, so nothing has to be sent anywhere. `deploy_modal.py` installs its own three
functions when a cloud container starts (upload -> Modal Volume, dispatch -> GPU job, run files <- Volume);
`api/` and `worker/` never import `modal`.

ไฟล์อัปโหลดไปอยู่ที่ไหน งานวิเคราะห์ถูกส่งไปอย่างไร และอ่านไฟล์ผลของรอบซ้อมจากที่ใด: ค่าเริ่มต้นคือพฤติกรรมเดิมบนเครื่องเดียว
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable


def _keep_local(local: Path, _session_id: str) -> Path:
    """The upload already sits in UPLOAD_DIR/<session_id>/: store that path."""
    return local


def _runner_polls(_session_id: str) -> None:
    """worker.runner takes queued sessions from the database itself."""


def _local_run_file(runs_dir: Path, session_id: str, name: str) -> Path | None:
    path = Path(runs_dir) / session_id / name
    return path if path.is_file() else None


_publish_upload: Callable[[Path, str], Path] = _keep_local
_dispatch: Callable[[str], None] = _runner_polls
_run_file: Callable[[Path, str, str], Path | None] = _local_run_file


def install(*, publish_upload=None, dispatch=None, run_file=None) -> None:
    """Replace any of the three hooks (deploy_modal.py does this once per container)."""
    global _publish_upload, _dispatch, _run_file
    _publish_upload = publish_upload or _publish_upload
    _dispatch = dispatch or _dispatch
    _run_file = run_file or _run_file


def reset() -> None:
    """Back to the local defaults (tests)."""
    install(publish_upload=_keep_local, dispatch=_runner_polls, run_file=_local_run_file)


def publish_upload(local: Path, session_id: str) -> Path:
    """Move a complete, validated upload to where the worker reads it; returns the path to store in the DB."""
    return _publish_upload(Path(local), session_id)


def dispatch(session_id: str) -> None:
    """Ask for the analysis of a session that is now queued."""
    _dispatch(session_id)


def run_file(runs_dir: Path, session_id: str, name: str) -> Path | None:
    """A file the worker wrote for this session (result page: video, transcript, metadata), or None."""
    return _run_file(Path(runs_dir), session_id, name)


def trim_cache(root: Path, max_bytes: int, keep: Path | None = None) -> int:
    """Delete the least recently used files under root until it holds at most max_bytes (D-063).

    The cloud web tier keeps a local copy of each run file it serves (deploy_modal.run_file); without a bound,
    playing many sessions in one long-lived container would fill its disk. `keep` (the file just fetched) is
    never deleted. A file being streamed may be deleted: the open handle keeps reading, the next request
    downloads it again. Returns the number of files removed.
    """
    files = []
    for path in Path(root).rglob("*"):
        try:
            if path.is_file():
                st = path.stat()
                files.append((max(st.st_atime, st.st_mtime), st.st_size, path))
        except OSError:
            continue
    total, removed = sum(size for _, size, _ in files), 0
    for _, size, path in sorted(files, key=lambda f: f[0]):
        if total <= max_bytes:
            break
        if keep is not None and path == Path(keep):
            continue
        try:
            path.unlink()
            total, removed = total - size, removed + 1
        except OSError:
            continue
    return removed
