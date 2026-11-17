"""D-062 cloud worker: run_one with fake storage hooks, time-based queue repair, retention queries, playback copy,
and the .env guard that keeps a cloud DATABASE_URL away from local runs."""
import json
import os
import subprocess
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import update

from promptpres_shared import settings
from worker import prep, runner
from worker.settings import REPO, tool

store = runner.store
OK = json.loads((REPO / "contracts" / "mocks" / "result_ok.json").read_text(encoding="utf-8"))
PLAYBACK = {"max_height": 480, "crf": 28, "preset": "veryfast", "audio_kbps": 64}


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{(tmp_path / 'q.db').as_posix()}")
    store.reset_engine()
    monkeypatch.setattr(runner, "RUNS_DIR", tmp_path / "runs")
    yield
    store.reset_engine()


class Volume:
    """Stand-in for the Modal hooks: a dict of stored paths -> bytes."""

    def __init__(self, tmp_path):
        self.tmp, self.files, self.removed = tmp_path, {}, []

    def fetch(self, stored):
        local = self.tmp / "in" / os.path.basename(stored)
        local.parent.mkdir(exist_ok=True)
        local.write_bytes(self.files[stored])
        return local

    def publish(self, run_dir, names):
        for name in names:
            self.files[f"runs/{run_dir.name}/{name}"] = (run_dir / name).read_bytes()

    def discard(self, stored):
        self.removed.append(stored)
        self.files.pop(stored, None)

    def hooks(self):
        return {"fetch": self.fetch, "publish": self.publish, "discard": self.discard}


def queued(volume, owner=None):
    s = store.create_session(600, owner)
    store.enqueue(s["session_id"], f"/media/uploads/{s['session_id']}/x.webm")
    stored = store.get_session(s["session_id"])["video_path"]    # as the database keeps it on this OS
    volume.files[stored] = b"video bytes"
    return s["session_id"], stored


def fake_pipeline(monkeypatch, status="done"):
    def run(video, session_id, target, run_root, reuse, topics, settings):
        folder = run_root / session_id
        folder.mkdir(parents=True, exist_ok=True)
        for name in ("media.mp4", "audio.wav", "landmarks.parquet", "transcript.json", "snapshot.json", "result.json"):
            (folder / name).write_bytes(b"{}")
        assert open(video, "rb").read() == b"video bytes"
        if status == "failed":
            return OK | {"session_id": session_id, "status": "failed", "error": "ไฟล์เสีย", "criteria": []}
        return OK | {"session_id": session_id}
    monkeypatch.setattr(runner.pipeline, "run_session", run)


def test_run_one_keeps_small_files_and_playback_then_cleans_up(tmp_path, monkeypatch):
    volume = Volume(tmp_path)
    sid, stored = queued(volume)
    fake_pipeline(monkeypatch)
    made = []
    monkeypatch.setattr(prep, "make_playback", lambda media, out, cfg: made.append(cfg) or out.write_bytes(b"small"))
    assert runner.run_one(sid, **volume.hooks()) == "done"
    assert store.get_session(sid)["status"] == "done" and store.get_result(sid)["video_url"] == f"/api/media/{sid}"
    kept = {k.split("/")[-1] for k in volume.files if k.startswith(f"runs/{sid}/")}
    assert kept == {"playback.mp4", "transcript.json", "snapshot.json", "result.json"}
    assert made and made[0]["max_height"] == 480                     # config/storage-v0.yaml playback
    assert volume.removed == [stored] and stored not in volume.files  # raw upload deleted once done
    assert not (runner.RUNS_DIR / sid).exists() and not (tmp_path / "in" / "x.webm").exists()


def test_run_one_falls_back_to_the_analysis_copy(tmp_path, monkeypatch):
    volume = Volume(tmp_path)
    sid, _ = queued(volume)
    fake_pipeline(monkeypatch)

    def broken(*_a):
        raise prep.MediaError("x")
    monkeypatch.setattr(prep, "make_playback", broken)
    assert runner.run_one(sid, **volume.hooks()) == "done"
    assert f"runs/{sid}/media.mp4" in volume.files and f"runs/{sid}/playback.mp4" not in volume.files


def test_run_one_failed_pipeline_and_unclaimable_and_retry_limit(tmp_path, monkeypatch):
    volume = Volume(tmp_path)
    sid, stored = queued(volume)
    fake_pipeline(monkeypatch, status="failed")
    assert runner.run_one(sid, **volume.hooks()) == "failed"
    assert store.get_session(sid)["error_message"] == "ไฟล์เสีย" and volume.removed == [stored]
    assert runner.run_one(sid, **volume.hooks()) is None                # no longer queued: nothing to do
    again, stored2 = queued(volume)
    with store.engine().begin() as c:
        c.execute(update(store.sessions).where(store.sessions.c.session_id == again).values(attempts=5))
    assert runner.run_one(again, **volume.hooks()) == "failed"
    assert store.get_session(again)["error_message"] == store.INTERRUPTED and stored2 in volume.removed


def test_unreadable_upload_fails_the_session_but_keeps_the_file(tmp_path, monkeypatch):
    volume = Volume(tmp_path)
    sid, stored = queued(volume)
    volume.files.pop(stored)
    fake_pipeline(monkeypatch)
    assert runner.run_one(sid, **volume.hooks()) == "failed"
    assert store.get_session(sid)["status"] == "failed" and volume.removed == []


def test_requeue_after_preemption_then_claim_again(tmp_path):
    volume = Volume(tmp_path)
    sid, _ = queued(volume)
    assert store.claim(sid)["attempts"] == 1 and store.claim(sid) is None
    assert store.requeue(sid) and store.get_session(sid)["status"] == "queued"
    assert not store.requeue(sid)                                       # only a processing session goes back
    assert store.claim(sid)["attempts"] == 2


def _age(sid, **columns_seconds_ago):
    when = {k: (datetime.now(timezone.utc) - timedelta(seconds=v)).isoformat(timespec="seconds")
            for k, v in columns_seconds_ago.items()}
    with store.engine().begin() as c:
        c.execute(update(store.sessions).where(store.sessions.c.session_id == sid).values(**when))


def test_sweep_requeues_stale_fails_spent_and_reports_lost(tmp_path):
    volume = Volume(tmp_path)
    stale, fresh, spent, lost = (queued(volume)[0] for _ in range(4))
    for sid in (stale, fresh, spent):
        store.claim(sid)
    _age(stale, started_at=5000)
    _age(spent, started_at=5000)
    with store.engine().begin() as c:
        c.execute(update(store.sessions).where(store.sessions.c.session_id == spent).values(attempts=2))
    _age(lost, queued_at=4000)
    swept = store.sweep(stale_after_s=4200, lost_after_s=1800, max_attempts=2)
    assert swept == {"requeued": [stale], "failed": [spent], "lost": [lost]}
    assert store.get_session(fresh)["status"] == "processing"
    assert store.get_session(spent)["error_message"] == store.INTERRUPTED


def test_retention_windows_for_guests_members_and_failed_uploads(tmp_path):
    volume = Volume(tmp_path)
    rows = {}
    for name, owner, days, status in (("guest_old", "g_1", 8, "done"), ("guest_new", "g_2", 6, "done"),
                                      ("member_8", "u_1", 8, "done"), ("member_31", "u_2", 31, "done"),
                                      ("anon_8", None, 8, "failed"), ("guest_too_old", "g_3", 30, "done"),
                                      ("failed_2d", "u_3", 2, "failed")):
        sid, _ = queued(volume, owner)
        store.update_session(sid, status=status)
        _age(sid, finished_at=days * 86400)
        rows[name] = sid
    expired = {r["session_id"] for r in store.expired_videos(guest_days=7, member_days=30, window_days=2)}
    assert expired == {rows["guest_old"], rows["member_31"], rows["anon_8"]}
    failed = {r["session_id"] for r in store.failed_uploads(days=1, window_days=2)}
    assert failed == {rows["failed_2d"]}
    assert store.is_member("u_1") and not store.is_member("g_1") and not store.is_member(None)


def has_ffmpeg() -> bool:
    try:
        tool("ffmpeg"), tool("ffprobe")
        return True
    except FileNotFoundError:
        return False


@pytest.mark.skipif(not has_ffmpeg(), reason="ffmpeg not installed")
def test_playback_copy_is_small_keeps_time_and_never_upscales(tmp_path):
    big, small = tmp_path / "big.mp4", tmp_path / "small.mp4"
    for path, size in ((big, "1280x720"), (small, "320x240")):
        subprocess.run([tool("ffmpeg"), "-v", "error", "-f", "lavfi", "-i", f"testsrc=size={size}:rate=30:duration=4",
                        "-f", "lavfi", "-i", "sine=frequency=300:duration=4", "-c:v", "libx264", "-c:a", "aac",
                        "-shortest", str(path)], check=True)
    out = prep.make_playback(big, tmp_path / "playback.mp4", PLAYBACK)
    info, source = prep.probe(out), prep.probe(big)
    assert (info["width"], info["height"]) == (854, 480) and info["has_audio"]
    assert info["duration_s"] == pytest.approx(source["duration_s"], abs=0.1)
    assert info["fps"] == pytest.approx(30, abs=0.01)
    kept = prep.probe(prep.make_playback(small, tmp_path / "playback_small.mp4", PLAYBACK))
    assert (kept["width"], kept["height"]) == (320, 240)
    assert not list(tmp_path.glob("*.tmp.mp4"))


def test_dotenv_feeds_only_the_llm_settings(tmp_path, monkeypatch):
    (tmp_path / ".env").write_text("DATABASE_URL=postgresql://cloud.example/db\nOPENROUTER_MODEL=pinned/model\n"
                                   "PROMPTPRES_SESSION_SECRET=x\n", encoding="utf-8")
    monkeypatch.setattr(settings, "REPO", tmp_path)
    for key in ("DATABASE_URL", "OPENROUTER_MODEL", "PROMPTPRES_SESSION_SECRET"):
        monkeypatch.delenv(key, raising=False)
    settings.load_env.cache_clear()
    try:
        settings.load_env()
        assert os.environ.get("OPENROUTER_MODEL") == "pinned/model"
        assert "DATABASE_URL" not in os.environ and "PROMPTPRES_SESSION_SECRET" not in os.environ
    finally:
        settings.load_env.cache_clear()
        monkeypatch.delenv("OPENROUTER_MODEL", raising=False)


def test_queued_settings_survive_the_json_round_trip_into_real_scoring(tmp_path):
    """D-062 regression: store.enqueue saves analysis_settings() as JSON, which turns the integer level keys of
    every thresholds `levels` map into strings. The runner must hand the pipeline exactly what config/ loaded,
    or every scored criterion fails with KeyError. No fakes: real config, real database row, real criteria."""
    from worker.session import Session
    sid = store.create_session(600, None)["session_id"]
    store.enqueue(sid, tmp_path / "x.webm")
    stored = store.get_session(sid)["settings_json"]
    original = settings.analysis_settings()
    restored = runner.queued_settings(stored)
    assert restored == original                                    # identical, including int level keys
    assert all(set(spec["levels"]) <= {2, 3, 4} for spec in restored["thresholds"]["criteria"].values())
    assert runner.queued_settings(None) is None
    vad = {"duration_s": 70.0, "segments": [{"start_s": 1.0 + 6 * i, "end_s": 5.5 + 6 * i} for i in range(10)]}
    vad |= {"first_start_s": 1.0, "last_end_s": 59.5, "speech_span_s": 58.5, "articulation_time_s": 45.0}
    session = Session(sid, tmp_path, 60.0, prep={"probe": {"duration_s": 70.0}, "flags": {}}, vad=vad, topics=[])
    for snapshot in (original, restored, json.loads(stored)):
        cards = {c["code"]: c for c in runner.pipeline.score(session, snapshot["thresholds"])}
        if snapshot is not original and snapshot is not restored:   # the raw JSON is what broke the cloud run
            assert cards["T1"]["status"] == "unanalyzable" and "KeyError" in cards["T1"]["reason"]
            continue
        assert cards["T1"]["status"] == "ok" and cards["T1"]["level"] == 4, cards["T1"]
        assert cards["S2"]["status"] == "ok" and cards["S2"]["level"] in (1, 2, 3, 4), cards["S2"]


def test_a_poison_job_reaches_the_gpu_at_most_max_attempts_times(tmp_path, monkeypatch):
    """D-063: a video that kills its container (pre-emption with the exit hook, or a hard crash such as OOM
    without it) is never retried forever: after max_attempts it is failed and its upload deleted."""
    volume = Volume(tmp_path)
    limit = runner.pipeline_config()["runner"]["max_attempts"]
    for hard_crash in (False, True):
        sid, stored = queued(volume)
        for attempt in range(1, limit + 1):          # each try: claimed, then the container dies mid-job
            assert store.claim(sid)["attempts"] == attempt
            if hard_crash:                            # no exit hook: the 15-minute sweep finds it later
                _age(sid, started_at=5000)
                swept = store.sweep(4200, 1800, limit)
                assert swept["requeued" if attempt < limit else "failed"] == [sid]
            else:                                     # exit hook requeues; Modal restarts the same input
                assert store.requeue(sid)
        if not hard_crash:                            # the restarted input after the last pre-emption
            fake_pipeline(monkeypatch)
            monkeypatch.setattr(runner.pipeline, "run_session", lambda *a, **k: pytest.fail("analysed again"))
            assert runner.run_one(sid, **volume.hooks()) == "failed" and stored in volume.removed
        assert store.get_session(sid)["status"] == "failed"
        assert store.get_session(sid)["error_message"] == store.INTERRUPTED
        assert runner.run_one(sid, **volume.hooks()) is None


@pytest.mark.skipif(not has_ffmpeg(), reason="ffmpeg not installed")
def test_browser_webm_with_uneven_frame_times_and_no_duration_to_playback(tmp_path):
    """D-063: MediaRecorder-style webm (no Duration in the header, uneven frame times) -> media.mp4 ->
    playback.mp4 keeps the same length, so evidence times still point at the same moment."""
    src = tmp_path / "rec.webm"
    with open(src, "wb") as f:                        # written to a pipe: no Duration; setpts jitter = VFR
        subprocess.run([tool("ffmpeg"), "-v", "error", "-f", "lavfi", "-i", "testsrc=size=640x480:rate=30:duration=10",
                        "-f", "lavfi", "-i", "sine=frequency=300:duration=10",
                        "-vf", "setpts=N/30/TB+if(eq(mod(N\\,7)\\,0)\\,0.02/TB\\,0)", "-fps_mode", "vfr",
                        "-c:v", "libvpx", "-deadline", "realtime", "-c:a", "libopus", "-shortest", "-f", "webm",
                        "pipe:1"], stdout=f, check=True)
    assert prep.probe(src, input_format="matroska")["duration_s"] is None
    out = prep.prepare(src, tmp_path / "run", runner.pipeline_config()["prep"])
    media = prep.probe(tmp_path / "run" / "media.mp4")
    assert out["probe"]["duration_source"] == "media.mp4" and media["constant_fps"]
    play = prep.probe(prep.make_playback(tmp_path / "run" / "media.mp4", tmp_path / "run" / "playback.mp4", PLAYBACK))
    assert play["duration_s"] == pytest.approx(media["duration_s"], abs=0.1)
    assert media["duration_s"] == pytest.approx(10, abs=0.3)
    assert play["height"] == 480 and play["has_audio"]
