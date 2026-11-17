"""Modal deployment (D-062): CPU web API + on-demand T4 analyser + 15-minute CPU maintenance job.

Once:   modal volume create --version=2 promptpres-models
        modal volume create --version=2 promptpres-media
        modal run deploy_modal.py::download_models      (Whisper large-v3 + MediaPipe tasks into promptpres-models)
Deploy: modal deploy deploy_modal.py                    (the web front end is on Vercel: web/vercel.json)

- web: FastAPI on CPU in us-east, next to Supabase us-east-1 (D-062 spike: 2 ms per query from us-east,
  84 ms from eu-west where Modal otherwise placed it). One container, so every chunk of an upload reaches the
  same disk. It never mounts the media Volume and never calls reload(): Modal's reload() fails while any file
  on the Volume is open (a video being streamed) and the Volume looks empty while it runs. Uploads go up and
  run files come down through the Volume API instead.
- Analyser: T4 GPU + 4 CPU cores (MediaPipe runs on the CPU), started only for a queued session and stopped
  60 s after the last one. Packages pinned to the versions the thesis numbers came from
  (worker/requirements-linux.lock = worker/requirements-windows.lock versions).
- maintain: every 15 min on 0.25 CPU, any region, stops 2 s after each run (D-063): SELECT 1 (keeps Supabase
  Free active), queue repair, video retention.
Database: DATABASE_URL (PostgreSQL) in the promptpres-secrets Secret. There is no SQLite fallback on Modal.
"""
import json
import threading
from pathlib import Path, PurePosixPath
from uuid import uuid4

import modal

ROOT = Path(__file__).resolve().parent
app = modal.App("promptpres")
media = modal.Volume.from_name("promptpres-media", version=2)     # uploads/<id>/…, runs/<id>/…
models = modal.Volume.from_name("promptpres-models", version=2)
secrets = [modal.Secret.from_name("promptpres-secrets")]
MEDIA = PurePosixPath("/media")    # prefix stored in the database for files inside promptpres-media
SCRATCH = "/tmp/promptpres"        # container-local disk: chunk staging, run folders, download cache
ENV = {"PYTHONPATH": "/repo:/repo/api", "PROMPTPRES_DATA": SCRATCH, "PROMPTPRES_UPLOADS": f"{SCRATCH}/uploads",
       "PROMPTPRES_RUNS": f"{SCRATCH}/runs", "PROMPTPRES_MODELS": "/models", "PROMPTPRES_REQUIRE_LOGIN": "1",
       "PROMPTPRES_TRUSTED_PROXY": "vercel"}


def with_code(image):
    # Explicit allowlist: never the checkout root, local credentials, participant data under data/ or test files.
    for directory in ("api", "promptpres_shared", "worker", "config", "contracts"):
        image = image.add_local_dir(ROOT / directory, remote_path=f"/repo/{directory}",
                                    ignore=["tests", "**/__pycache__", "**/.env*", "**/*.pyc"])
    return image


web_image = with_code(modal.Image.debian_slim(python_version="3.12")
                      .pip_install_from_requirements(str(ROOT / "api/requirements-linux.lock"))
                      .env(ENV))
gpu_image = with_code(modal.Image.from_registry("nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04", add_python="3.12")
                      .apt_install("ffmpeg", "libegl1", "libgl1", "libgles2", "libglib2.0-0", "libice6", "libsm6")
                      .pip_install_from_requirements(str(ROOT / "worker/requirements-linux.lock"))
                      .env(ENV)).add_local_file(ROOT / "tools/download_models.py",
                                                remote_path="/repo/tools/download_models.py")


# --------------------------------------------------------------------------- media Volume through its API
def remote_path(stored) -> str | None:
    """Database path (/media/uploads/<id>/<file>) -> path inside promptpres-media, or None if not stored there."""
    path = PurePosixPath(str(stored or "").replace("\\", "/"))
    return str(path.relative_to(MEDIA)) if path.is_relative_to(MEDIA) else None


def put_files(pairs) -> None:
    with media.batch_upload(force=True) as batch:
        for local, remote in pairs:
            batch.put_file(str(local), remote)


def get_file(remote: str, local: Path) -> Path:
    local.parent.mkdir(parents=True, exist_ok=True)
    temporary = local.with_name(f".{local.name}.{uuid4().hex}.part")
    try:
        with temporary.open("wb") as out:
            media.read_file_into_fileobj(remote, out)
        temporary.replace(local)
    finally:
        temporary.unlink(missing_ok=True)
    return local


def remove(remote: str | None, recursive: bool = False) -> bool:
    if not remote:
        return False
    try:
        media.remove_file(remote, recursive=recursive)
        return True
    except Exception:  # noqa: BLE001 — already gone
        return False


# --------------------------------------------------------------------------- hooks for the web container
def publish_upload(local: Path, session_id: str) -> Path:
    remote = f"uploads/{session_id}/{local.name}"
    put_files([(local, remote)])
    local.unlink(missing_ok=True)
    return Path(str(MEDIA / remote))


def dispatch(session_id: str) -> None:
    Analyser().run.spawn(session_id)


_downloads = threading.Lock()


def run_file(runs_dir: Path, session_id: str, name: str) -> Path | None:
    """Local copy of runs/<id>/<name>, downloaded once per container (the player then gets Range/206 from disk)."""
    path = runs_dir / session_id / name
    if path.is_file():
        path.touch()                    # recently used: trim_cache deletes the oldest copies first
        return path
    with _downloads:
        if path.is_file():
            return path
        try:
            get_file(f"runs/{session_id}/{name}", path)
        except Exception:  # noqa: BLE001 — not on the Volume (not made yet, or removed by retention)
            return None
        from promptpres_shared.settings import storage_config
        from promptpres_shared.storage import trim_cache
        trim_cache(runs_dir, int(storage_config()["media"]["cache_max_mb"]) * 1024**2, keep=path)
        return path


def require_postgres() -> None:
    import os
    if not os.environ.get("DATABASE_URL", "").startswith(("postgresql://", "postgres://")):
        raise RuntimeError("Set DATABASE_URL (PostgreSQL) in the promptpres-secrets Secret")


@app.function(image=web_image, secrets=secrets, region="us-east", cpu=1.0, memory=1024,
              min_containers=0, max_containers=1, scaledown_window=300, timeout=1200)
@modal.concurrent(max_inputs=32)
@modal.asgi_app()
def web():
    require_postgres()
    from promptpres_shared import storage
    storage.install(publish_upload=publish_upload, dispatch=dispatch, run_file=run_file)
    from api.app.main import app as api
    return api


# --------------------------------------------------------------------------- GPU analyser
def fetch_upload(stored) -> Path:
    remote = remote_path(stored)
    if remote is None:
        raise FileNotFoundError("upload is not in promptpres-media")
    return get_file(remote, Path(SCRATCH) / "in" / PurePosixPath(remote).name)


def publish_run(run_dir: Path, names) -> None:
    put_files([(run_dir / name, f"runs/{run_dir.name}/{name}") for name in names])


def discard_upload(stored) -> bool:
    """Delete a raw upload; its folder uploads/<session_id>/ holds only that file, so the folder goes too."""
    remote = remote_path(stored)
    folder = PurePosixPath(remote).parent if remote else None
    if folder is not None and len(folder.parts) == 2 and folder.parts[0] == "uploads":
        return remove(str(folder), recursive=True)
    return remove(remote)


@app.cls(image=gpu_image, secrets=secrets, gpu="T4", cpu=4.0, memory=8192, volumes={"/models": models},
         min_containers=0, max_containers=4, scaledown_window=60, timeout=3600)
class Analyser:
    @modal.enter()
    def ready(self):
        require_postgres()
        self.current = None
        if not (Path("/models") / "whisper").is_dir():
            raise RuntimeError("Models missing: run `modal run deploy_modal.py::download_models` once")

    @modal.method()
    def run(self, session_id: str):
        from worker import runner
        self.current = session_id
        try:
            return runner.run_one(session_id, fetch=fetch_upload, publish=publish_run, discard=discard_upload)
        finally:
            self.current = None

    @modal.exit()
    def stop(self):
        # Pre-emption or a stop mid-job: back to the queue; Modal restarts this input and it claims it again.
        if self.current:
            from promptpres_shared import store
            store.requeue(self.current)


# --------------------------------------------------------------------------- maintenance and setup
# No region pin (D-063): nobody waits on this job, and a pinned region costs more per second. cpu/memory are
# the smallest that run it; scaledown_window=2 lets the container stop right after the run instead of idling
# Modal's default 60 s every 15 minutes.
@app.function(image=web_image, secrets=secrets, schedule=modal.Period(minutes=15), cpu=0.25, memory=256,
              scaledown_window=2, timeout=600)
def maintain():
    require_postgres()
    from promptpres_shared import store
    from promptpres_shared.settings import pipeline_config, storage_config
    cfg = storage_config()
    store.ping()
    queue = cfg["queue"]
    swept = store.sweep(queue["stale_processing_s"], queue["lost_queue_s"], pipeline_config()["runner"]["max_attempts"])
    for session_id in swept["requeued"] + swept["lost"]:
        Analyser().run.spawn(session_id)
    keep = cfg["retention"]
    removed = 0
    for row in store.expired_videos(keep["guest_video_days"], keep["member_video_days"], keep["window_days"]):
        for name in ("playback.mp4", "media.mp4"):
            removed += remove(f"runs/{row['session_id']}/{name}")
        removed += discard_upload(row["video_path"])
    for row in store.failed_uploads(keep["failed_upload_days"], keep["window_days"]):
        removed += discard_upload(row["video_path"])
    print(json.dumps({"requeued": len(swept["requeued"]), "failed": len(swept["failed"]),
                      "resent": len(swept["lost"]), "files_removed": removed}), flush=True)


@app.function(image=gpu_image, volumes={"/models": models}, timeout=3600)
def download_models():
    from tools.download_models import download
    download()
    models.commit()
