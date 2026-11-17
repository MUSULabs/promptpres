"""worker.runner with the pipeline faked: queue claim, done / failed, recovery of interrupted sessions."""
import json

import pytest

from worker import runner
from worker.settings import REPO

store = runner.store
OK = json.loads((REPO / "contracts" / "mocks" / "result_ok.json").read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{(tmp_path / 'q.db').as_posix()}")
    store.reset_engine()
    monkeypatch.setattr(runner, "RUNS_DIR", tmp_path / "runs")
    yield
    store.reset_engine()


def queued(tmp_path, topics=True):
    s = store.create_session(600)
    video = tmp_path / f"{s['session_id']}.webm"
    video.write_bytes(b"video")
    if topics:
        store.add_topics(s["session_id"], "confirmed", "manual",
                         [{"id": f"H0{i}", "title": f"t{i}", "order": i, "key_point": ""} for i in (1, 2, 3)])
    store.enqueue(s["session_id"], video)
    return s["session_id"]


def test_claim_is_one_session_at_a_time(tmp_path):
    a, b = queued(tmp_path), queued(tmp_path)
    first = store.claim_next()
    assert first["session_id"] == a and first["status"] == "processing" and first["attempts"] == 1
    assert store.claim_next()["session_id"] == b
    assert store.claim_next() is None


def test_success_stores_result_with_video_url(tmp_path, monkeypatch):
    sid = queued(tmp_path)
    seen = {}

    def fake_run(video, session_id, target, run_root, reuse, topics, settings):
        assert settings["thresholds"]["criteria"]["T1"]["default_target_s"] == 900
        seen.update(video=video, target=target, topics=topics)
        return OK | {"session_id": session_id}
    monkeypatch.setattr(runner.pipeline, "run_session", fake_run)
    assert runner.run(once=True) == 1
    s = store.get_session(sid)
    assert s["status"] == "done" and s["finished_at"]
    assert store.get_result(sid)["video_url"] == f"/api/media/{sid}"
    assert seen["target"] == 600 and len(seen["topics"]["topics"]) == 3 and seen["video"].exists()


def test_pipeline_crash_fails_with_thai_message_and_trace_file(tmp_path, monkeypatch):
    sid = queued(tmp_path)

    def boom(*a, **k):
        raise MemoryError("cuda")
    monkeypatch.setattr(runner.pipeline, "run_session", boom)
    runner.run(once=True)
    s = store.get_session(sid)
    assert s["status"] == "failed" and "ระบบวิเคราะห์ขัดข้อง (MemoryError)" in s["error_message"]
    assert "MemoryError" in (runner.RUNS_DIR / sid / "runner_error.txt").read_text(encoding="utf-8")


def test_pipeline_failed_result_keeps_its_message(tmp_path, monkeypatch):
    sid = queued(tmp_path)
    monkeypatch.setattr(runner.pipeline, "run_session",
                        lambda *a, **k: {"status": "failed", "error": "อ่านไฟล์วิดีโอไม่ได้"})
    runner.run(once=True)
    assert store.get_session(sid)["error_message"] == "อ่านไฟล์วิดีโอไม่ได้"


def test_interrupted_sessions_are_requeued_then_failed(tmp_path, monkeypatch):
    sid = queued(tmp_path)
    store.claim_next()                                   # runner died while processing (attempt 1)
    fixed = store.recover_stuck(max_attempts=2)
    assert fixed == {"requeued": [sid], "failed": []} and store.get_session(sid)["status"] == "queued"
    store.claim_next()                                   # died again (attempt 2)
    fixed = store.recover_stuck(max_attempts=2)
    s = store.get_session(sid)
    assert fixed["failed"] == [sid] and s["status"] == "failed" and s["error_message"] == store.INTERRUPTED


def test_runner_start_recovers_before_working(tmp_path, monkeypatch):
    sid = queued(tmp_path)
    store.claim_next()
    monkeypatch.setattr(runner.pipeline, "run_session", lambda video, session_id, *a, **k: OK | {"session_id": session_id})
    assert runner.run(once=True) == 1 and store.get_session(sid)["status"] == "done"
