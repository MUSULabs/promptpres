"""Exercise the Pilot HTTP boundary and the transaction that queues media."""
import importlib.util
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from fastapi.testclient import TestClient

from app import boundary, main, store


def test_invite_and_ownership_cover_history_writes_metadata_and_media(tmp_path, monkeypatch):
    allow = tmp_path / "allow.json"
    allow.write_text(json.dumps({"a@example.test": "P01", "b@example.test": "P02"}))
    origin = "https://pilot.example.test"
    monkeypatch.setenv("PROMPTPRES_MODE", "pilot")
    monkeypatch.setenv("PROMPTPRES_PILOT_ORIGIN", origin)
    monkeypatch.setenv("PROMPTPRES_PILOT_ALLOWLIST", str(allow))
    monkeypatch.setattr(store, "data_root", lambda: tmp_path / "pilot")
    spec = importlib.util.spec_from_file_location("app.pilot_test_main", main.__file__)
    pilot = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, pilot)
    spec.loader.exec_module(pilot)
    monkeypatch.setattr(pilot, "UPLOAD_DIR", tmp_path / "pilot" / "uploads")
    monkeypatch.setattr(pilot, "RUNS_DIR", tmp_path / "pilot" / "runs")
    a = {"Tailscale-User-Login": "a@example.test", "Origin": origin}
    b = {"Tailscale-User-Login": "b@example.test", "Origin": origin}

    with TestClient(pilot.app) as client:
        rejected = client.get("/api/sessions")
        assert rejected.status_code == 403 and rejected.headers["Cache-Control"] == "private, no-store"
        assert client.post("/api/sessions", headers=a | {"Origin": "https://another.example"}).status_code == 403
        assert client.get("/docs", headers=a).status_code == 404
        sid = client.post("/api/sessions", headers=a).json()["session_id"]
        base = f"/api/sessions/{sid}"
        assert client.get("/api/sessions", headers=b).json() == []
        assert client.get("/api/sessions", headers=a).json()[0]["session_id"] == sid
        for url in (base, base + "/result", base + "/metadata", base + "/transcript", f"/api/media/{sid}"):
            assert client.get(url, headers=b).status_code == 404
        assert client.patch(base, headers=b, json={"target_duration_s": 99}).status_code == 404
        assert client.put(base + "/topics", headers=b, json={"topics": []}).status_code == 404
        assert client.post(base + "/video", headers=b, files={"video": ("b.webm", b"video")}).status_code == 404
        assert client.post(base + "/pdf", headers=a, files={"pdf": ("r.pdf", b"%PDF")}).status_code == 403
        assert client.post(base + "/video", headers=a | {"Content-Length": str(600 * 1024**2)}).status_code == 413
        prepared = pilot.RUNS_DIR / sid / "media.mp4"
        prepared.parent.mkdir(parents=True)
        prepared.write_bytes(b"0123456789")
        response = client.get(f"/api/media/{sid}", headers=a | {"Range": "bytes=2-4"})
        assert response.status_code == 206 and response.content == b"234"
        assert response.headers["Cache-Control"] == "private, no-store"


def test_streaming_limit_also_applies_without_content_length(monkeypatch):
    monkeypatch.setattr(boundary, "VIDEO_BYTES", 1)
    monkeypatch.setattr(boundary, "MULTIPART_OVERHEAD", 32)
    with TestClient(main.app) as client:
        sid = client.post("/api/sessions").json()["session_id"]
        context = {"Content-Type": "multipart/form-data; boundary=parts"}
        stream = iter([b"--parts\r\nContent-Disposition: form-data; name=video; filename=x.mp4\r\n\r\n",
                       b"0123456789", b"\r\n--parts--\r\n"])
        assert client.post(f"/api/sessions/{sid}/video", headers=context, content=stream).status_code == 413
        assert store.get_session(sid)["status"] == "created"


def test_two_uploads_publish_one_file_and_queue_once(monkeypatch):
    rendezvous = Barrier(2)
    save = main.save_upload

    def save_both(*args, **kwargs):
        path = save(*args, **kwargs)
        rendezvous.wait(timeout=10)
        return path

    monkeypatch.setattr(main, "save_upload", save_both)
    with TestClient(main.app) as client:
        sid = client.post("/api/sessions").json()["session_id"]
        url = f"/api/sessions/{sid}/video"

        def send(i):
            with TestClient(main.app) as concurrent_client:
                return concurrent_client.post(url, files={"video": ("v.webm", bytes([i]))})

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(send, (1, 2)))
        assert sorted(r.status_code for r in outcomes) == [200, 409]
        saved = store.abs_path(store.get_session(sid)["video_path"])
        assert list(saved.parent.iterdir()) == [saved]
        assert saved.read_bytes() == bytes([1 if outcomes[0].status_code == 200 else 2])
        assert client.patch(f"/api/sessions/{sid}", json={"target_duration_s": 1}).status_code == 409


def test_legacy_sqlite_schema_is_upgraded_without_moving_results(tmp_path, monkeypatch):
    import sqlite3

    old_file = tmp_path / "legacy.db"
    with sqlite3.connect(old_file) as db:
        db.execute("""CREATE TABLE sessions (session_id VARCHAR(32) PRIMARY KEY,
            status VARCHAR(16), target_duration_s FLOAT, video_path TEXT, pdf_path TEXT,
            created_at VARCHAR(40), queued_at VARCHAR(40), started_at VARCHAR(40),
            finished_at VARCHAR(40), attempts INTEGER, error_message TEXT)""")
        db.execute("INSERT INTO sessions VALUES ('s_legacy', 'created', 900, NULL, NULL, 'date', NULL, NULL, NULL, 0, NULL)")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{old_file.as_posix()}")
    assert store.get_session("s_legacy")["owner_id"] is None
    assert store.get_session("s_legacy", "P01") is None
    assert store.get_session("s_legacy")["settings_json"] is None


def test_metadata_is_tied_to_stored_result(tmp_path):
    with TestClient(main.app) as client:
        sid = client.post("/api/sessions").json()["session_id"]
        url = f"/api/sessions/{sid}/metadata"
        result = json.loads((main.REPO / "contracts/mocks/result_ok.json").read_text(encoding="utf-8"))
        store.finish(sid, result | {"session_id": sid})
        assert client.get(url).json() == {"criteria": None, "feedback": None}
        snapshot = main.RUNS_DIR / sid / "snapshot.json"
        snapshot.parent.mkdir(parents=True)
        snapshot.write_text(json.dumps({"config": result["versions"]["config"], "feedback": {"C1_L4": "old"},
                                        "thresholds": {"criteria": {"C1": {"scored_values": ["kendall_tau"]}}}}))
        response = client.get(url).json()
        assert response["feedback"] == {"C1_L4": "old"}
        assert response["criteria"]["C1"]["scored_values"] == ["kendall_tau"]
