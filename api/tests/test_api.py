from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    assert client.get("/api/health").json() == {"ok": True, "contract_version": "1.3"}


def test_mock_results_served():
    for sid in ("s_mock_ok", "s_mock_partial", "s_mock_failed"):
        r = client.get(f"/api/sessions/{sid}/result")
        assert r.status_code == 200
        assert r.json()["session_id"] == sid


def test_criteria_meta():
    meta = client.get("/api/criteria").json()
    assert sorted(meta) == ["C1", "C2", "N1", "N2", "S1", "S2", "S3", "T1"]
    assert meta["N1"]["scored_values"] == ["long_still_per_min", "max_still_s"]
    # D-046: band bounds and plain-language reading for the 4-step band on each card
    assert meta["S1"]["direction"] == "range" and meta["S1"]["levels"]["4"]["syllables_per_s"] == [4.0, 6.0]
    assert set(meta["C1"]["interpret"]["levels"]) == {"1", "2", "3", "4"}          # JSON object keys
    assert meta["S1"]["interpret"]["range"]["above"] and meta["T1"]["interpret"]["sign"]["key"] == "diff_s"


def test_unknown_session_404():
    assert client.get("/api/sessions/nope/result").status_code == 404


def test_feedback_map():
    fb = client.get("/api/feedback").json()
    assert "S2_L2" in fb and fb["S2_L2"] and "interpret" not in fb
    assert not any("[ร่าง" in text for text in fb.values())


def test_create_then_video_is_queued():
    sid = client.post("/api/sessions", json={"target_duration_s": 600}).json()["session_id"]
    r = client.post(f"/api/sessions/{sid}/video", files={"video": ("rec.webm", b"fake webm bytes", "video/webm")})
    assert r.status_code == 200
    res = client.get(f"/api/sessions/{sid}/result").json()
    assert res["status"] == "queued" and res["criteria"] == [] and res["target_duration_s"] == 600
