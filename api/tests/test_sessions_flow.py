"""Practice-session flow through the API: create -> PDF topics -> confirm -> video -> queue -> result."""
import json
from pathlib import Path

import jsonschema
import pytest
from fastapi.testclient import TestClient

import app.main as main
from app import store

client = TestClient(main.app)
REPO = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((REPO / "contracts" / "result.schema.json").read_text(encoding="utf-8"))
PDF = b"%PDF-1.4 fake report"
DRAFT = {"topics": [{"id": f"H0{i}", "title": t, "expected_order": i, "key_point": f"kp {i}"}
                    for i, t in enumerate(["ปัญหา", "วัตถุประสงค์", "วิธีที่เสนอ", "แผนทดสอบ"], start=1)],
         "model": "vendor/model-a", "prompt": "topics-v1"}


def new(**body):
    r = client.post("/api/sessions", json=body or None)
    assert r.status_code == 201
    return r.json()["session_id"]


def send_video(sid, name="rec.webm", data=b"\x1aE\xdf\xa3fake"):
    return client.post(f"/api/sessions/{sid}/video", files={"video": (name, data, "video/webm")})


def test_create_uses_default_target_900():
    sid = new()
    s = client.get(f"/api/sessions/{sid}").json()
    assert s["status"] == "created" and s["target_duration_s"] == 900 and not s["has_video"]
    assert client.get(f"/api/sessions/{new(target_duration_s=600)}").json()["target_duration_s"] == 600


def test_pdf_returns_draft_topics(monkeypatch):
    monkeypatch.setattr(main, "suggest_topics", lambda path: DRAFT)
    sid = new()
    r = client.post(f"/api/sessions/{sid}/pdf", files={"pdf": ("r.pdf", PDF, "application/pdf")})
    assert r.status_code == 200 and [t["title"] for t in r.json()["topics"]][0] == "ปัญหา"
    s = client.get(f"/api/sessions/{sid}").json()
    assert s["has_pdf"] and len(s["suggested_topics"]) == 4 and s["confirmed_topics"] is None
    assert next((main.UPLOAD_DIR / sid).glob("*.pdf")).read_bytes() == PDF


def test_pdf_errors_are_thai_messages(monkeypatch):
    sid = new()
    assert client.post(f"/api/sessions/{sid}/pdf", files={"pdf": ("r.pdf", b"not a pdf", "application/pdf")}).status_code == 422

    def boom(path):
        raise RuntimeError("network")
    monkeypatch.setattr(main, "suggest_topics", boom)
    r = client.post(f"/api/sessions/{sid}/pdf", files={"pdf": ("r.pdf", PDF, "application/pdf")})
    assert r.status_code == 502 and "เพิ่มหัวข้อเอง" in r.json()["detail"]


def test_confirm_topics_renumbers_in_user_order(monkeypatch):
    monkeypatch.setattr(main, "suggest_topics", lambda path: DRAFT)
    sid = new()
    client.post(f"/api/sessions/{sid}/pdf", files={"pdf": ("r.pdf", PDF, "application/pdf")})
    body = {"topics": [{"title": "แผนทดสอบ"}, {"title": " ปัญหา ", "key_point": "x"}, {"title": "หัวข้อใหม่"}]}
    s = client.put(f"/api/sessions/{sid}/topics", json=body).json()
    assert [(t["id"], t["title"], t["order"]) for t in s["confirmed_topics"]] == [
        ("H01", "แผนทดสอบ", 1), ("H02", "ปัญหา", 2), ("H03", "หัวข้อใหม่", 3)]
    assert store.latest_topics(sid, "confirmed")["source"] == "pdf"


@pytest.mark.parametrize("titles, msg", [(["ก", "ข"], "3–15"), (["ก", "ข", " "], "ไม่ว่าง"), (["ก", "ข", "ก"], "ซ้ำ")])
def test_bad_topic_lists_are_rejected(titles, msg):
    r = client.put(f"/api/sessions/{new()}/topics", json={"topics": [{"title": t} for t in titles]})
    assert r.status_code == 422 and msg in r.json()["detail"]


def test_video_queues_and_locks_the_session():
    sid = new()
    client.put(f"/api/sessions/{sid}/topics", json={"topics": [{"title": t} for t in "กขค"]})
    assert client.get(f"/api/sessions/{sid}/result").status_code == 409           # no video yet
    s = send_video(sid).json()
    assert s["status"] == "queued" and s["has_video"]
    assert client.put(f"/api/sessions/{sid}/topics", json={"topics": [{"title": t} for t in "กขค"]}).status_code == 409
    assert send_video(sid).status_code == 409
    assert client.patch(f"/api/sessions/{sid}", json={"target_duration_s": 60}).status_code == 409
    res = client.get(f"/api/sessions/{sid}/result").json()
    jsonschema.validate(res, SCHEMA)
    assert res["status"] == "queued" and res["criteria"] == [] and res["video_url"] == f"/api/media/{sid}"
    assert client.get(f"/api/media/{sid}").content == b"\x1aE\xdf\xa3fake"


def test_wrong_video_type_is_rejected():
    assert send_video(new(), name="slides.pptx").status_code == 422


def test_done_and_failed_results_come_from_the_store():
    ok = json.loads((REPO / "contracts" / "mocks" / "result_ok.json").read_text(encoding="utf-8"))
    sid = new()
    send_video(sid)
    assert store.claim_next()["session_id"] == sid
    store.finish(sid, ok | {"session_id": sid})
    res = client.get(f"/api/sessions/{sid}/result").json()
    assert res["status"] == "done" and len(res["criteria"]) == 8
    bad = new()
    send_video(bad)
    store.fail(bad, "อ่านไฟล์วิดีโอไม่ได้")
    res = client.get(f"/api/sessions/{bad}/result").json()
    jsonschema.validate(res, SCHEMA)
    assert res["status"] == "failed" and res["error"] == "อ่านไฟล์วิดีโอไม่ได้"
    assert client.get(f"/api/sessions/{bad}").json()["error_message"] == "อ่านไฟล์วิดีโอไม่ได้"


def test_history_is_newest_first_and_includes_mocks():
    a = new()
    b = new()
    client.put(f"/api/sessions/{b}/topics", json={"topics": [{"title": t} for t in "กขคง"]})
    rows = client.get("/api/sessions").json()
    ids = [r["session_id"] for r in rows]
    assert {a, b, "s_mock_ok"} <= set(ids)
    assert [r["created_at"] for r in rows] == sorted((r["created_at"] for r in rows), reverse=True)
    assert next(r for r in rows if r["session_id"] == b)["topics_count"] == 4


def test_unknown_session_is_404():
    assert client.get("/api/sessions/s_nope").status_code == 404
    assert client.post("/api/sessions/s_nope/video", files={"video": ("a.mp4", b"x", "video/mp4")}).status_code == 404


def test_history_rows_carry_levels_for_finished_sessions_only():
    """D-046 trend panel: per-criterion level + the values that set it; no total score field."""
    ok = json.loads((REPO / "contracts" / "mocks" / "result_ok.json").read_text(encoding="utf-8"))
    done, waiting = new(), new()
    send_video(done)
    assert store.claim_next()["session_id"] == done
    store.finish(done, ok | {"session_id": done})
    rows = {r["session_id"]: r for r in client.get("/api/sessions").json()}
    row = rows[done]
    assert row["levels"] == {c["code"]: c["level"] for c in ok["criteria"]}
    assert row["primary_values"]["S2"] == {"long_pauses_per_min": 1.8, "max_pause_s": 4.2}
    assert "hands_active_pct" not in row["primary_values"]["N1"]          # supporting info is not a primary value
    assert row["rubric_version"] == ok["versions"]["rubric"]
    assert rows[waiting]["levels"] is None and rows[waiting]["primary_values"] is None
    assert rows["s_mock_partial"]["levels"]["N1"] is None                    # unanalyzable stays None
    assert not any(key in row for key in ("score", "total", "total_score", "grade"))
