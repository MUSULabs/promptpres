"""Regression tests from the full-system audit (Nov 2026): SQLite settings, video Range requests,
upload filenames, Thai error messages for bad requests and bad PDFs."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

import app.main as main
from app import store

client = TestClient(main.app)


def new_session() -> str:
    r = client.post("/api/sessions")
    assert r.status_code == 201
    return r.json()["session_id"]


def test_sqlite_runs_in_wal_mode_with_busy_timeout():
    """Web polling reads while the worker writes: WAL + busy timeout, never 'database is locked'."""
    with store.engine().connect() as conn:
        assert conn.execute(text("PRAGMA journal_mode")).scalar().lower() == "wal"
        assert conn.execute(text("PRAGMA busy_timeout")).scalar() >= 30000


def test_media_supports_range_requests_for_seeking():
    sid = new_session()
    data = bytes(range(256)) * 8
    assert client.post(f"/api/sessions/{sid}/video", files={"video": ("a.mp4", data, "video/mp4")}).status_code == 200
    full = client.get(f"/api/media/{sid}")
    assert full.status_code == 200 and full.headers["accept-ranges"] == "bytes"
    part = client.get(f"/api/media/{sid}", headers={"Range": "bytes=100-199"})
    assert part.status_code == 206
    assert part.headers["content-range"] == f"bytes 100-199/{len(data)}" and part.content == data[100:200]


def test_prepared_media_mp4_is_served_with_range(isolated):
    sid = new_session()
    client.post(f"/api/sessions/{sid}/video", files={"video": ("a.webm", b"webm-bytes", "video/webm")})
    run = main.RUNS_DIR / sid
    run.mkdir(parents=True)
    (run / "media.mp4").write_bytes(b"0123456789" * 10)
    r = client.get(f"/api/media/{sid}", headers={"Range": "bytes=0-9"})
    assert r.status_code == 206 and r.headers["content-type"] == "video/mp4" and r.content == b"0123456789"


@pytest.mark.parametrize("name", ["วิดีโอ ซ้อม ครั้งที่ 1.webm", "../../evil.webm", "a b/../../x.MP4"])
def test_upload_filename_never_reaches_the_path(name, isolated):
    sid = new_session()
    r = client.post(f"/api/sessions/{sid}/video", files={"video": (name, b"data", "video/webm")})
    assert r.status_code == 200
    saved = list((main.UPLOAD_DIR / sid).iterdir())
    assert len(saved) == 1 and len(saved[0].stem) == 32 and saved[0].suffix in (".webm", ".mp4")
    assert saved[0].resolve().parent == (main.UPLOAD_DIR / sid).resolve()


def test_request_validation_errors_are_thai():
    r = client.post("/api/sessions", json={"target_duration_s": -5})
    assert r.status_code == 422
    body = r.json()
    assert isinstance(body["detail"], str) and "ข้อมูลที่ส่งมาไม่ถูกต้อง" in body["detail"]
    assert "target_duration_s" in body["detail"]


def make_pdf(path, text_lines, password=None):
    import pymupdf
    doc = pymupdf.open()
    page = doc.new_page()
    for i, line in enumerate(text_lines):
        page.insert_text((72, 72 + 14 * i), line)
    if password:
        doc.save(str(path), encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw=password, owner_pw=password + "x")
    else:
        doc.save(str(path))
    doc.close()
    return path.read_bytes()


def post_pdf(sid, data):
    return client.post(f"/api/sessions/{sid}/pdf", files={"pdf": ("รายงาน ฉบับ.pdf", data, "application/pdf")})


def test_password_pdf_gets_thai_422(tmp_path):
    data = make_pdf(tmp_path / "p.pdf", ["Problem statement of the project users"] * 30, password="secret")
    r = post_pdf(new_session(), data)
    assert r.status_code == 422 and "รหัสผ่าน" in r.json()["detail"]


def test_scanned_pdf_without_text_gets_thai_422(tmp_path):
    r = post_pdf(new_session(), make_pdf(tmp_path / "s.pdf", []))
    assert r.status_code == 422 and "ภาพสแกน" in r.json()["detail"]


def test_corrupt_pdf_gets_thai_422():
    r = post_pdf(new_session(), b"%PDF-1.7\n" + b"\x00garbage" * 50)
    assert r.status_code == 422 and "กรอกหัวข้อเอง" in r.json()["detail"]


def test_llm_error_detail_is_passed_through(monkeypatch):
    from promptpres_shared.llm_client import LLMError

    def boom(_path):
        raise LLMError("ยังไม่ได้ตั้ง OPENROUTER_API_KEY")
    monkeypatch.setattr(main, "suggest_topics", boom)
    r = post_pdf(new_session(), b"%PDF-1.4 x")
    assert r.status_code == 502 and "OPENROUTER_API_KEY" in r.json()["detail"] and "เพิ่มหัวข้อเอง" in r.json()["detail"]
