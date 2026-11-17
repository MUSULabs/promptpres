"""PDF -> draft topics through the API and the real worker code (only the OpenRouter call is faked):
long drafts are kept with a note, non-report files get a Thai 422, a normal report comes back as is."""
import sys

import pytest
from fastapi.testclient import TestClient

import app.main as main

if str(main.REPO) not in sys.path:
    sys.path.insert(0, str(main.REPO))
from worker.llm import client as llm_client   # noqa: E402
from worker.llm import topics as worker_topics   # noqa: E402

client = TestClient(main.app)


def report_pdf(tmp_path) -> bytes:
    import pymupdf
    doc = pymupdf.open()
    for chapter in ("Chapter 1 Introduction and problem", "Chapter 2 Related work", "Chapter 3 Method and design"):
        page = doc.new_page()
        for i in range(25):
            page.insert_text((72, 72 + 14 * i), f"{chapter} line {i}")
    path = tmp_path / "report.pdf"
    doc.save(str(path))
    doc.close()
    return path.read_bytes()


def fake_llm(monkeypatch, payload):
    monkeypatch.setattr(llm_client, "chat_json",
                        lambda system, user, **kw: (payload, {"model": "vendor/model-a", "purpose": kw.get("purpose")}))


def topics_reply(n, **extra):
    return {"is_valid_document": True, "rejection_reason": "",
            "topics": [{"title": f"หัวข้อ {i}", "key_point": f"ใจความ {i}"} for i in range(1, n + 1)]} | extra


def upload(tmp_path):
    sid = client.post("/api/sessions").json()["session_id"]
    return sid, client.post(f"/api/sessions/{sid}/pdf", files={"pdf": ("report.pdf", report_pdf(tmp_path), "application/pdf")})


def test_topic_limits_are_the_same_everywhere():
    """config (C2 min_topics / max_topics) = worker defaults = web TopicEditor.tsx (the browser cannot read yaml)."""
    c2 = main.thresholds()["criteria"]["C2"]
    lo, hi = c2["unanalyzable"]["min_topics"], c2["max_topics"]
    assert (lo, hi) == (3, 15)
    assert (worker_topics.MIN_TOPICS, worker_topics.MAX_DRAFT_TOPICS) == (lo, hi)
    response = client.post("/api/sessions")
    assert response.json()["topic_limits"] == {"min": lo, "max": hi}


def test_confirm_uses_the_config_limit(tmp_path):
    sid = client.post("/api/sessions").json()["session_id"]
    topics = [{"title": f"หัวข้อ {i}", "key_point": ""} for i in range(16)]
    r = client.put(f"/api/sessions/{sid}/topics", json={"topics": topics})
    assert r.status_code == 422 and "3–15" in r.json()["detail"]
    assert client.put(f"/api/sessions/{sid}/topics", json={"topics": topics[:15]}).status_code == 200


def test_twelve_topics_come_back_for_editing(tmp_path, monkeypatch):
    """The Solar Rooftop case: 12 topics used to give 422 and lose the whole draft."""
    fake_llm(monkeypatch, topics_reply(12))
    sid, r = upload(tmp_path)
    assert r.status_code == 200
    body = r.json()
    assert len(body["topics"]) == 12 and body["topics"][11]["id"] == "H12"
    assert "12 หัวข้อ" in body["note"] and body["prompt"] == "topics-v2"
    s = client.get(f"/api/sessions/{sid}").json()
    assert len(s["suggested_topics"]) == 12 and s["confirmed_topics"] is None
    # the user can confirm all 12 as they are (editor / API limit 15)
    put = client.put(f"/api/sessions/{sid}/topics",
                     json={"topics": [{"title": t["title"], "key_point": t["key_point"]} for t in body["topics"]]})
    assert put.status_code == 200 and len(put.json()["confirmed_topics"]) == 12


def test_non_report_file_is_rejected_with_thai_422(tmp_path, monkeypatch):
    fake_llm(monkeypatch, {"is_valid_document": False, "rejection_reason": "ไฟล์นี้เป็นเมนูอาหาร", "topics": []})
    sid, r = upload(tmp_path)
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail.startswith("ไฟล์ที่แนบไม่ใช่รายงานโครงงานหรือสไลด์นำเสนอ (ไฟล์นี้เป็นเมนูอาหาร)")
    assert "กรุณาแนบไฟล์รายงานหรือสไลด์" in detail
    assert client.get(f"/api/sessions/{sid}").json()["suggested_topics"] is None


@pytest.mark.parametrize("n", [5, 8])
def test_normal_report_gives_merged_topics_without_note(tmp_path, monkeypatch, n):
    fake_llm(monkeypatch, topics_reply(n))
    _, r = upload(tmp_path)
    assert r.status_code == 200
    assert len(r.json()["topics"]) == n and r.json()["note"] is None
