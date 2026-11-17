"""D-062 chunked uploads, signed tickets, CORS for the web origin, signed video links and the storage hooks."""
import json
import re
import time

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import auth, main, uploads
from promptpres_shared import storage, store

client = TestClient(main.app)
WEB = "https://promptpres.vercel.app"
API = "https://api.promptpres.test"


@pytest.fixture(autouse=True)
def hooks(monkeypatch):
    monkeypatch.setenv("PROMPTPRES_SESSION_SECRET", "test-secret-" * 4)
    monkeypatch.setattr(uploads, "chunk_bytes", lambda: 4)          # 4-byte chunks keep the tests small
    auth.ATTEMPTS.clear()
    uploads.ADMITTING.clear()
    uploads.PDF_READS.clear()
    storage.reset()
    yield
    storage.reset()
    assert not uploads.ADMITTING                                    # every request gave its held place back


def new_session(c=client) -> str:
    return c.post("/api/sessions").json()["session_id"]


def ticket(sid, kind="video", data=b"0123456789", name="rec.webm", c=client, **headers):
    r = c.post(f"/api/sessions/{sid}/uploads", json={"kind": kind, "filename": name, "size": len(data)}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def send(t, data: bytes, c=client, **headers):
    base = t["url"].replace(API, "")
    for i in range(t["chunks"]):
        part = data[i * t["chunk_bytes"]:(i + 1) * t["chunk_bytes"]]
        r = c.put(f"{base}/chunks/{i}", content=part, headers={"X-Upload-Token": t["token"], **headers})
        assert r.status_code == 200, r.text
    return c.post(f"{base}/complete", headers={"X-Upload-Token": t["token"], **headers})


def test_chunked_video_is_joined_queued_and_dispatched():
    sent = []
    storage.install(dispatch=sent.append)
    sid, data = new_session(), b"\x1aE\xdf\xa3 fake webm bytes"
    t = ticket(sid, data=data)
    assert t["chunks"] == 5 and t["chunk_bytes"] == 4 and t["url"] == f"/api/sessions/{sid}/uploads/{t['upload_id']}"
    done = send(t, data)
    assert done.status_code == 200 and done.json()["status"] == "queued"
    assert store.abs_path(store.get_session(sid)["video_path"]).read_bytes() == data
    assert sent == [sid]
    assert not (main.UPLOAD_DIR / sid / ".staging" / t["upload_id"]).exists()
    assert client.post(f"/api/sessions/{sid}/uploads", json={"kind": "video", "filename": "x.webm", "size": 3}).status_code == 409


def test_chunk_checks_and_resend():
    sid = new_session()
    t = ticket(sid, data=b"0123456789")
    base, token = t["url"], {"X-Upload-Token": t["token"]}
    assert client.put(f"{base}/chunks/3", content=b"0123", headers=token).status_code == 422      # index past the end
    assert client.put(f"{base}/chunks/0", content=b"01", headers=token).status_code == 422        # short chunk
    assert client.put(f"{base}/chunks/2", content=b"89", headers=token).status_code == 200        # last chunk is short
    assert client.post(f"{base}/complete", headers=token).status_code == 409                       # 0 and 1 missing
    for i, part in ((0, b"XXXX"), (0, b"0123"), (1, b"4567")):                                # resend replaces
        assert client.put(f"{base}/chunks/{i}", content=part, headers=token).status_code == 200
    assert client.post(f"{base}/complete", headers=token).status_code == 200
    assert store.abs_path(store.get_session(sid)["video_path"]).read_bytes() == b"0123456789"
    assert client.post(f"/api/sessions/{sid}/uploads/{'0' * 32}/complete", headers=token).status_code == 409


def test_ticket_rejects_bad_files():
    sid = new_session()
    bad = client.post(f"/api/sessions/{sid}/uploads", json={"kind": "video", "filename": "deck.pptx", "size": 10})
    assert bad.status_code == 422
    huge = client.post(f"/api/sessions/{sid}/uploads", json={"kind": "video", "filename": "a.mp4", "size": 600 * 1024**2})
    assert huge.status_code == 413
    missing = client.put(f"/api/sessions/{sid}/uploads/{'a' * 32}/chunks/0", content=b"x")
    assert missing.status_code == 404
    for odd in ("..", "A" * 32, "a" * 31):                    # upload ids are uuid4().hex, nothing else reaches a path
        assert client.post(f"/api/sessions/{sid}/uploads/{odd}/complete").status_code in (404, 422)
        assert client.put(f"/api/sessions/{sid}/uploads/{odd}/chunks/0", content=b"x").status_code in (404, 422)
    assert client.put(f"/api/sessions/{sid}/uploads/{'A' * 32}/chunks/0", content=b"x").status_code == 422


def test_chunked_pdf_gives_draft_topics(monkeypatch):
    monkeypatch.setattr(main, "suggest_topics", lambda path: {"topics": [{"title": "บทนำ", "key_point": ""}],
                                                              "model": "m", "prompt": "p"})
    sid = new_session()
    pdf = b"%PDF-1.4 tiny"
    r = send(ticket(sid, kind="pdf", data=pdf, name="report.pdf"), pdf)
    assert r.status_code == 200 and r.json()["topics"][0]["title"] == "บทนำ"
    assert client.get(f"/api/sessions/{sid}").json()["has_pdf"] is True
    sid2 = new_session()
    assert send(ticket(sid2, kind="pdf", data=b"not a pdf!", name="x.pdf"), b"not a pdf!").status_code == 422


def test_cloud_tickets_replace_the_cookie_only_for_their_own_upload(monkeypatch):
    monkeypatch.setenv("PROMPTPRES_REQUIRE_LOGIN", "1")
    monkeypatch.setenv("PROMPTPRES_PUBLIC_ORIGIN", WEB)
    monkeypatch.setenv("PROMPTPRES_DIRECT_ORIGIN", API)
    web = TestClient(main.app, base_url=WEB)
    assert web.post("/api/auth/guest", headers={"Origin": WEB}).status_code == 200
    sid = web.post("/api/sessions", headers={"Origin": WEB}).json()["session_id"]
    other = web.post("/api/sessions", headers={"Origin": WEB}).json()["session_id"]
    t = ticket(sid, c=web, Origin=WEB)
    assert t["url"].startswith(f"{API}/api/sessions/{sid}/uploads/")
    direct = TestClient(main.app, base_url=API)            # no cookie, like a browser calling the Modal address
    base = t["url"].replace(API, "")
    good = {"X-Upload-Token": t["token"], "Origin": WEB}
    assert direct.put(f"{base}/chunks/0", content=b"0123", headers={"Origin": WEB}).status_code == 401
    assert direct.put(f"{base}/chunks/0", content=b"0123", headers={**good, "X-Upload-Token": "x.y"}).status_code == 401
    assert direct.put(f"{base}/chunks/0", content=b"0123", headers={**good, "Origin": "https://evil.example"}).status_code == 403
    stolen = base.replace(sid, other)                       # a ticket for one session opens nothing else
    assert direct.put(f"{stolen}/chunks/0", content=b"0123", headers=good).status_code == 401
    expired = auth.sign({"purpose": "upload", "sid": sid, "owner": "x", "exp": time.time() - 1,
                         "upload": t["upload_id"]})
    assert direct.put(f"{base}/chunks/0", content=b"0123", headers={**good, "X-Upload-Token": expired}).status_code == 401
    assert send(t, b"0123456789", c=direct, Origin=WEB).status_code == 200
    assert direct.get(f"/api/sessions/{sid}", headers=good).status_code == 401  # the ticket is not a login


def test_cors_answers_only_listed_web_origins(monkeypatch):
    monkeypatch.setenv("PROMPTPRES_REQUIRE_LOGIN", "1")
    monkeypatch.setenv("PROMPTPRES_PUBLIC_ORIGIN", f"{WEB},https://promptpres.example.ac.th")
    path = f"/api/sessions/s_x/uploads/{'0' * 32}/chunks/0"
    ask = {"Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "x-upload-token"}
    for origin in (WEB, "https://promptpres.example.ac.th"):
        r = client.options(path, headers={"Origin": origin, **ask})
        assert r.status_code == 200 and r.headers["access-control-allow-origin"] == origin
        assert "Origin" in r.headers["vary"] and "access-control-allow-credentials" not in r.headers
    evil = client.options(path, headers={"Origin": "https://evil.example", **ask})
    assert evil.status_code == 400 and "access-control-allow-origin" not in evil.headers
    denied = client.get("/api/sessions", headers={"Origin": WEB})                 # 401 still carries CORS headers
    assert denied.status_code == 401 and denied.headers["access-control-allow-origin"] == WEB


def test_signed_video_link_and_playback_first(monkeypatch):
    monkeypatch.setenv("PROMPTPRES_REQUIRE_LOGIN", "1")
    monkeypatch.setenv("PROMPTPRES_PUBLIC_ORIGIN", WEB)
    monkeypatch.setenv("PROMPTPRES_DIRECT_ORIGIN", API)
    web = TestClient(main.app, base_url=WEB)
    web.post("/api/auth/guest", headers={"Origin": WEB})
    sid = web.post("/api/sessions", headers={"Origin": WEB}).json()["session_id"]
    send(ticket(sid, c=web, Origin=WEB), b"0123456789", c=web, Origin=WEB)
    store.claim(sid)
    ok = json.loads((main.REPO / "contracts/mocks/result_ok.json").read_text(encoding="utf-8"))
    store.finish(sid, ok | {"session_id": sid, "video_url": f"/api/media/{sid}"})
    run = main.RUNS_DIR / sid
    run.mkdir(parents=True)
    (run / "media.mp4").write_bytes(b"analysis copy")
    (run / "playback.mp4").write_bytes(b"small copy")
    url = web.get(f"/api/sessions/{sid}/result").json()["video_url"]
    assert re.fullmatch(rf"{API}/api/media/{sid}\?t=[\w-]+\.[0-9a-f]+", url)
    direct = TestClient(main.app, base_url=API)
    got = direct.get(url.replace(API, ""), headers={"Range": "bytes=0-4"})
    assert got.status_code == 206 and got.content == b"small"
    assert direct.get(f"/api/media/{sid}").status_code == 401
    assert direct.get(url.replace(API, "").replace(sid, "s_other")).status_code == 401
    assert direct.get(url.replace(API, "")[:-2] + "00").status_code == 401


def test_run_files_come_through_the_storage_hook(tmp_path):
    sid = new_session()
    send(ticket(sid), b"0123456789")
    elsewhere = tmp_path / "volume" / sid
    elsewhere.mkdir(parents=True)
    (elsewhere / "playback.mp4").write_bytes(b"from the volume")
    asked = []

    def from_volume(runs_dir, session_id, name):
        asked.append(name)
        path = elsewhere / name
        return path if path.is_file() else None

    storage.install(run_file=from_volume)
    assert client.get(f"/api/media/{sid}").content == b"from the volume"
    assert client.get(f"/api/sessions/{sid}/transcript").json() == []
    assert "playback.mp4" in asked and "transcript.json" in asked


def test_upload_survives_a_failed_dispatch():
    def broken(_sid):
        raise ConnectionError("modal unreachable")
    storage.install(dispatch=broken)
    sid = new_session()
    r = send(ticket(sid), b"0123456789")
    assert r.status_code == 200 and r.json()["status"] == "queued"


def test_chunk_body_limit_is_checked_before_reading():
    sid = new_session()
    t = ticket(sid)
    too_big = client.put(f"{t['url']}/chunks/0", content=b"x", headers={"X-Upload-Token": t["token"],
                                                                         "Content-Length": str(64 * 1024**2)})
    assert too_big.status_code == 413


# --------------------------------------------------------------------------- D-063 credit guard and disk bounds
def guard(monkeypatch, **changes):
    from promptpres_shared.settings import storage_config
    cfg = storage_config()
    patched = cfg | {"guard": cfg["guard"] | changes}
    monkeypatch.setattr(uploads, "storage_config", lambda: patched)
    return patched["guard"]


VIDEO = {"kind": "video", "filename": "x.webm", "size": 10}


def queue_one(c=client) -> str:
    sid = new_session(c)
    assert send(ticket(sid, c=c), b"0123456789", c=c).json()["status"] == "queued"
    return sid


def test_one_owner_may_have_two_rounds_waiting_then_gets_429_before_sending_bytes():
    storage.install(dispatch=lambda sid: None)
    assert uploads.storage_config()["guard"]["max_active_per_owner"] == 2
    first, second = queue_one(), queue_one()
    third = new_session()
    r = client.post(f"/api/sessions/{third}/uploads", json=VIDEO)
    assert r.status_code == 429 and "2 รอบ" in r.json()["detail"]
    assert not (main.UPLOAD_DIR / third / ".staging").exists()           # refused before any chunk folder
    store.update_session(first, status="done")                           # one finished -> room again
    assert queue_one() and store.get_session(second)["status"] == "queued"


def test_totals_for_everyone_stop_a_flood_of_new_guest_accounts(monkeypatch):
    storage.install(dispatch=lambda sid: None)
    guard(monkeypatch, max_active_total=2, max_active_per_owner=5)
    queue_one(), queue_one()
    r = client.post(f"/api/sessions/{new_session()}/uploads", json=VIDEO)
    assert r.status_code == 503 and r.json()["detail"] == uploads.QUEUE_FULL
    guard(monkeypatch, max_active_total=50, max_active_per_owner=50, max_analyses_per_day=2)
    r = client.post(f"/api/sessions/{new_session()}/uploads", json=VIDEO)
    assert r.status_code == 503 and r.json()["detail"] == uploads.DAY_FULL
    assert store.queue_load("__anonymous__") == {"owner_active": 2, "active": 2, "today": 2}
    assert store.queue_load("g_someone_else") == {"owner_active": 0, "active": 2, "today": 2}


def test_complete_step_checks_again_and_removes_the_joined_file():
    sent = []
    storage.install(dispatch=sent.append)
    sid = new_session()
    t = ticket(sid)                                                    # allowed when the ticket was given
    queue_one(), queue_one()                                           # meanwhile two other rounds queued
    r = send(t, b"0123456789")
    assert r.status_code == 429 and store.get_session(sid)["status"] == "created" and sid not in sent
    assert [p for p in (main.UPLOAD_DIR / sid).rglob("*") if p.is_file()] == []   # no joined file or chunk left


def as_owner(owner_id):
    from types import SimpleNamespace
    return SimpleNamespace(state=SimpleNamespace(owner_id=owner_id))


def test_rounds_between_the_check_and_the_queue_hold_their_place(monkeypatch):
    """Scrutiny of D-063: the check reads the database while the copy to storage takes seconds, so two uploads
    finishing together both saw room. A passed check now holds a place until release()."""
    guard(monkeypatch, max_active_per_owner=2, max_active_total=3)
    a, b = as_owner("g_a"), as_owner("g_b")
    held = [uploads.check_queue(a, ticket=False, hold=True), uploads.check_queue(a, ticket=False, hold=True)]
    with pytest.raises(HTTPException) as e:                             # nothing in the database yet, still 2 held
        uploads.check_queue(a, ticket=False, hold=True)
    assert e.value.status_code == 429
    held.append(uploads.check_queue(b, ticket=False, hold=True))       # another account: own limit, shared total
    with pytest.raises(HTTPException) as e:
        uploads.check_queue(as_owner("g_c"), ticket=False)
    assert e.value.status_code == 503 and e.value.detail == uploads.QUEUE_FULL
    for owner in held:
        uploads.release(owner)
    assert not uploads.ADMITTING and uploads.check_queue(a, ticket=False) == "g_a"


def test_held_place_is_given_back_when_the_copy_or_the_queue_fails():
    def broken_copy(path, sid):
        assert uploads.ADMITTING == {"__anonymous__": 1}               # held while the file is copied
        raise OSError("volume unavailable")
    storage.install(publish_upload=broken_copy)
    sid = new_session()
    with pytest.raises(OSError):
        send(ticket(sid), b"0123456789")
    assert not uploads.ADMITTING
    storage.reset()
    storage.install(dispatch=lambda s: None)
    queue_one()
    assert not uploads.ADMITTING                                         # released once committed to the queue


def test_one_request_video_upload_is_guarded_too():
    storage.install(dispatch=lambda sid: None)
    queue_one(), queue_one()
    sid = new_session()
    r = client.post(f"/api/sessions/{sid}/video", files={"video": ("x.webm", b"\x1aE\xdf\xa3 webm", "video/webm")})
    assert r.status_code == 429 and not (main.UPLOAD_DIR / sid).exists()


def test_video_tickets_per_address_allow_a_classroom_but_stop_a_script(monkeypatch):
    guard(monkeypatch, video_tickets_per_ip_hour=3)
    sid = new_session()
    assert [client.post(f"/api/sessions/{sid}/uploads", json=VIDEO).status_code for _ in range(4)] == [201, 201, 201, 429]
    assert client.post(f"/api/sessions/{sid}/uploads", json=VIDEO).json()["detail"] == uploads.TOO_OFTEN
    assert storage_default_allows_a_classroom()


def storage_default_allows_a_classroom() -> bool:
    from promptpres_shared.settings import storage_config
    return storage_config()["guard"]["video_tickets_per_ip_hour"] >= 60      # 30 students x 2 rounds behind one NAT


def test_joining_deletes_each_chunk_as_soon_as_it_is_read(tmp_path):
    parts = []
    for i, data in enumerate((b"aaaa", b"bbbb", b"cc")):
        (tmp_path / f"{i:05d}.part").write_bytes(data)
        parts.append(tmp_path / f"{i:05d}.part")
    joined, seen = uploads._Joined(parts), []
    while chunk := joined.read(4):
        seen.append((chunk, sum(p.exists() for p in parts)))
    assert seen == [(b"aaaa", 3), (b"bbbb", 2), (b"cc", 1)]           # never more than the unread chunks + 1
    assert not any(p.exists() for p in parts)


def test_unfinished_uploads_are_pruned_after_the_ticket_lifetime_in_every_session(tmp_path):
    """An abandoned round may never ask for another ticket, so its chunks are found from any session's ticket."""
    import os
    old = tmp_path / "s_abandoned" / ".staging" / "old"
    new = tmp_path / "s_current" / ".staging" / "new"
    for folder in (old, new):
        folder.mkdir(parents=True)
        (folder / "00000.part").write_bytes(b"x" * 8)
    os.utime(old, (time.time() - 8000, time.time() - 8000))
    joined = tmp_path / "s_abandoned" / "video.webm"
    joined.write_bytes(b"x")
    os.utime(joined, (time.time() - 8000, time.time() - 8000))
    uploads.prune_staging(tmp_path, 7200)
    assert not old.exists() and new.exists() and joined.exists()         # only chunk folders are touched
    uploads.prune_staging(tmp_path / "missing", 7200)                   # no folder: nothing to do


def test_a_new_ticket_prunes_other_sessions_abandoned_chunks():
    import os
    abandoned = new_session()
    t = ticket(abandoned)
    folder = main.UPLOAD_DIR / abandoned / ".staging" / t["upload_id"]
    os.utime(folder, (time.time() - 8000, time.time() - 8000))
    ticket(new_session())
    assert not folder.exists()


def test_local_copy_cache_drops_least_recently_used_files_first(tmp_path):
    import os
    files = {}
    for age, name in ((300, "a/playback.mp4"), (200, "b/playback.mp4"), (100, "c/transcript.json"), (0, "d/playback.mp4")):
        path = tmp_path / name
        path.parent.mkdir(parents=True)
        path.write_bytes(b"x" * 100)
        os.utime(path, (time.time() - age, time.time() - age))
        files[name[0]] = path
    os.utime(files["a"])                                                # a was just used again (cache hit)
    assert storage.trim_cache(tmp_path, 250, keep=files["d"]) == 2
    assert {k for k, p in files.items() if p.exists()} == {"a", "d"}
    assert storage.trim_cache(tmp_path, 0, keep=files["d"]) == 1 and files["d"].exists()


# --------------------------------------------------------------------------- D-066 LLM credit guard for report PDFs
PDF = b"%PDF-1.4 tiny"


def read_pdf(sid=None):
    sid = sid or new_session()
    r = client.post(f"/api/sessions/{sid}/uploads", json={"kind": "pdf", "filename": "r.pdf", "size": len(PDF)})
    return r if r.status_code != 201 else send(r.json(), PDF)


def test_pdf_reads_stop_at_the_daily_total_failed_reads_count_and_a_restart_keeps_the_successful_ones(monkeypatch):
    """Every PDF read is one paid LLM call: at most pdf_reads_per_day for everyone, counted when the call starts
    (a failed call costs too); after a container restart the database still holds the day's successful reads."""
    guard(monkeypatch, pdf_reads_per_day=2)
    calls = []

    def suggest(path):
        calls.append(path)
        if len(calls) == 1:
            raise RuntimeError("provider returned prose instead of JSON")
        return {"topics": [{"title": "บทนำ", "key_point": ""}], "model": "m", "prompt": "p"}
    monkeypatch.setattr(main, "suggest_topics", suggest)
    assert read_pdf().status_code == 502 and read_pdf().status_code == 200
    sid = new_session()
    refused = read_pdf(sid)
    assert refused.status_code == 503 and refused.json()["detail"] == uploads.PDF_FULL and len(calls) == 2
    assert not (main.UPLOAD_DIR / sid / ".staging").exists()                 # refused before any bytes were sent
    uploads.PDF_READS.clear()                                               # container restart: 1 success in the DB
    assert read_pdf().status_code == 200 and len(calls) == 3
    uploads.PDF_READS.clear()
    assert read_pdf().status_code == 503 and len(calls) == 3                 # 2 successes in the DB


def test_pdf_uploads_per_address_are_throttled_on_both_routes(monkeypatch):
    guard(monkeypatch, pdf_tickets_per_ip_hour=2)
    monkeypatch.setattr(main, "suggest_topics", lambda path: {"topics": [{"title": "บทนำ", "key_point": ""}]})
    sid = new_session()
    assert read_pdf(sid).status_code == 200
    one_request = client.post(f"/api/sessions/{sid}/pdf", files={"pdf": ("r.pdf", PDF, "application/pdf")})
    assert one_request.status_code == 200
    third = read_pdf(sid)
    assert third.status_code == 429 and third.json()["detail"] == uploads.PDF_TOO_OFTEN
    assert client.post(f"/api/sessions/{sid}/pdf", files={"pdf": ("r.pdf", PDF, "application/pdf")}).status_code == 429
