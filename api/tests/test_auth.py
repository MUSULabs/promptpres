"""D-050 real SQLite WAL auth/ownership/migration regressions."""
import sqlite3
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import auth, main
from promptpres_shared import store

BODY = {"email": "member@example.com", "display_name": "Tester", "password": "correct horse battery"}


@pytest.fixture(autouse=True)
def auth_environment(monkeypatch):
    monkeypatch.setenv("PROMPTPRES_SESSION_SECRET", "test-secret-" * 4)
    auth.ATTEMPTS.clear()


def test_register_transfers_only_guest_and_cross_browser_login():
    a, b, c = (TestClient(main.app) for _ in range(3))
    guest = a.post("/api/auth/guest").json()["user"]
    assert guest["is_guest"] and a.post("/api/auth/guest").json()["user"]["id"] == guest["id"]
    old_cookie = a.cookies.get("pt_session")
    mine = a.post("/api/sessions").json()["session_id"]
    b.post("/api/auth/guest")
    other = b.post("/api/sessions").json()["session_id"]
    assert b.get(f"/api/sessions/{mine}").status_code == 404
    member = a.post("/api/auth/register", json=BODY)
    assert member.status_code == 201 and not member.json()["user"]["is_guest"]
    uid = member.json()["user"]["id"]
    assert store.get_session(mine)["owner_id"] == uid
    assert store.get_session(other)["owner_id"] != uid
    assert c.post("/api/auth/login", json={"email": " MEMBER@EXAMPLE.COM ", "password": BODY["password"]}).status_code == 200
    assert c.get(f"/api/sessions/{mine}").status_code == 200
    assert c.get(f"/api/sessions/{other}/transcript").status_code == 404
    replay = TestClient(main.app)
    replay.cookies.set("pt_session", old_cookie)
    assert replay.get(f"/api/sessions/{mine}").status_code == 401
    with store.engine().connect() as db:
        saved = db.execute(select(store.users).where(store.users.c.id == uid)).mappings().one()
        assert saved["password_hash"].startswith("pbkdf2_sha256$") and BODY["password"] not in saved["password_hash"]
        assert db.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"


def test_duplicate_registration_preserves_guest_history():
    member, guest = TestClient(main.app), TestClient(main.app)
    member.post("/api/auth/register", json=BODY)
    uid = guest.post("/api/auth/guest").json()["user"]["id"]
    sid = guest.post("/api/sessions").json()["session_id"]
    assert guest.post("/api/auth/register", json=BODY).status_code == 409
    assert store.get_session(sid)["owner_id"] == uid
    assert guest.get(f"/api/sessions/{sid}").status_code == 200


def test_registration_rolls_back_transfer_when_session_issue_fails(monkeypatch):
    client = TestClient(main.app, raise_server_exceptions=False)
    uid = client.post("/api/auth/guest").json()["user"]["id"]
    sid = client.post("/api/sessions").json()["session_id"]
    def fail(*args, **kwargs):
        raise RuntimeError("simulated write failure")
    monkeypatch.setattr(auth, "issue", fail)
    assert client.post("/api/auth/register", json=BODY).status_code == 500
    assert store.get_session(sid)["owner_id"] == uid
    assert client.get("/api/auth/me").json()["user"]["id"] == uid
    with store.engine().connect() as db:
        assert db.execute(select(store.users).where(store.users.c.email == BODY["email"])).first() is None


def test_signed_legacy_owner_is_claimed_but_unowned_round_is_not():
    client = TestClient(main.app)
    sid = store.create_session(60, "legacy_browser")["session_id"]
    unowned = store.create_session(60)["session_id"]
    client.cookies.set("pt_owner", auth.sign({"owner_id": "legacy_browser", "exp": time.time() + 60}))
    uid = client.post("/api/auth/register", json=BODY).json()["user"]["id"]
    assert store.get_session(sid)["owner_id"] == uid
    assert store.get_session(unowned)["owner_id"] is None


def test_tamper_expiry_logout_and_anonymous_do_not_expose_accounts():
    client = TestClient(main.app)
    client.post("/api/auth/register", json=BODY)
    sid = client.post("/api/sessions").json()["session_id"]
    signed = client.cookies.get("pt_session")
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get(f"/api/sessions/{sid}").status_code == 404
    client.cookies.set("pt_session", signed)
    assert client.get(f"/api/sessions/{sid}").status_code == 401
    client.cookies.set("pt_session", signed + "tamper")
    assert client.get(f"/api/sessions/{sid}").status_code == 401
    assert auth.unsigned(auth.sign({"token": "x", "exp": time.time() - 1})) is None


def test_cloud_auth_cookie_origin_and_rate_limit(monkeypatch):
    monkeypatch.setenv("PROMPTPRES_REQUIRE_LOGIN", "1")
    monkeypatch.setenv("PROMPTPRES_PUBLIC_ORIGIN", "https://testserver")
    client = TestClient(main.app, base_url="https://testserver")
    assert client.post("/api/sessions").status_code == 401
    assert client.post("/api/auth/guest").status_code == 403
    assert client.post("/api/auth/guest", headers={"Origin": "https://evil.example"}).status_code == 403
    ok = client.post("/api/auth/guest", headers={"Origin": "https://testserver"})
    assert ok.status_code == 200
    assert all(x in ok.headers["set-cookie"] for x in ("Secure", "HttpOnly", "SameSite=lax"))
    for _ in range(auth.RATE_PER_MINUTE - 1):
        client.post("/api/auth/guest", headers={"Origin": "https://testserver"})
    assert client.post("/api/auth/guest", headers={"Origin": "https://testserver"}).status_code == 429


def test_login_does_not_merge_guest_and_rejects_wrong_password():
    member, guest = TestClient(main.app), TestClient(main.app)
    member.post("/api/auth/register", json=BODY)
    guest_id = guest.post("/api/auth/guest").json()["user"]["id"]
    sid = guest.post("/api/sessions").json()["session_id"]
    assert guest.post("/api/auth/login", json=BODY | {"password": "incorrect"}).status_code == 401
    assert guest.post("/api/auth/login", json=BODY).status_code == 200
    assert store.get_session(sid)["owner_id"] == guest_id
    assert guest.get(f"/api/sessions/{sid}/metadata").status_code == 404


def test_additive_migration_and_checkpoint_reopen():
    sid = store.create_session(60, "legacy")["session_id"]
    with store.engine().connect() as db:
        assert db.exec_driver_sql("SELECT MAX(version) FROM schema_versions").scalar() == 4   # v4 = RLS (PostgreSQL only)
        db.commit()
        db.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")
    store.reset_engine()
    assert store.get_session(sid)["owner_id"] == "legacy"


def test_forged_or_unsigned_owner_cookie_claims_nothing():
    sid = store.create_session(60, "legacy_browser")["session_id"]
    forgeries = ["legacy_browser", "bGVnYWN5X2Jyb3dzZXI.0000",
                 auth.sign({"owner_id": "legacy_browser", "exp": time.time() + 60}) + "x",
                 auth.sign({"owner_id": "legacy_browser", "exp": time.time() - 1})]
    for n, forged in enumerate(forgeries):
        client = TestClient(main.app)
        client.cookies.set("pt_owner", forged)
        assert client.get(f"/api/sessions/{sid}").status_code == 401
        assert client.post("/api/auth/register", json=BODY | {"email": f"m{n}@example.com"}).status_code == 201
        assert store.get_session(sid)["owner_id"] == "legacy_browser"


def test_owner_in_request_body_is_ignored():
    client = TestClient(main.app)
    sid = store.create_session(60, "someone_else")["session_id"]
    made = client.post("/api/auth/register", json=BODY | {"owner_id": "someone_else", "previous": "someone_else"})
    assert made.status_code == 201 and store.get_session(sid)["owner_id"] == "someone_else"
    assert client.get(f"/api/sessions/{sid}").status_code == 404


def test_guest_logged_out_elsewhere_cannot_hand_rounds_over(monkeypatch):
    """The Guest login is checked again inside the registration transaction."""
    client = TestClient(main.app)
    uid = client.post("/api/auth/guest").json()["user"]["id"]
    sid = client.post("/api/sessions").json()["session_id"]
    seen, calls = auth.identity, []

    def revoked_after_lookup(request):
        found = seen(request)
        calls.append(request.url.path)
        # 1st call = AuthBoundary, 2nd = register(): revoke right after register() has looked the Guest up.
        if calls.count("/api/auth/register") == 2:
            with store.engine().begin() as db:
                db.execute(store.auth_sessions.delete().where(store.auth_sessions.c.user_id == uid))
        return found
    monkeypatch.setattr(auth, "identity", revoked_after_lookup)
    assert client.post("/api/auth/register", json=BODY).status_code == 401
    assert store.get_session(sid)["owner_id"] == uid
    with store.engine().connect() as db:
        assert db.execute(select(store.users).where(store.users.c.email == BODY["email"])).first() is None


def test_guest_account_row_is_removed_after_registration_and_expired_logins_are_cleaned():
    client = TestClient(main.app)
    uid = client.post("/api/auth/guest").json()["user"]["id"]
    with store.engine().begin() as db:
        db.execute(store.auth_sessions.insert().values(token_hash="e" * 64, user_id=uid,
                                                       expires_at=time.time() - 5, is_guest=1))
    assert client.post("/api/auth/register", json=BODY).status_code == 201
    with store.engine().connect() as db:
        assert db.execute(select(store.users).where(store.users.c.id == uid)).first() is None
        assert db.execute(select(store.auth_sessions).where(store.auth_sessions.c.token_hash == "e" * 64)).first() is None


def test_cookie_is_secure_only_over_https(monkeypatch):
    plain = TestClient(main.app).post("/api/auth/guest")
    assert "Secure" not in plain.headers["set-cookie"] and "HttpOnly" in plain.headers["set-cookie"]
    tls = TestClient(main.app, base_url="https://testserver").post("/api/auth/guest",
                                                                  headers={"Origin": "https://testserver"})
    assert "Secure" in tls.headers["set-cookie"]
    monkeypatch.setenv("PROMPTPRES_PUBLIC_ORIGIN", "https://pt.example.org")       # TLS ends at the proxy
    proxied = TestClient(main.app).post("/api/auth/guest", headers={"Origin": "https://pt.example.org"})
    assert proxied.status_code == 200 and "Secure" in proxied.headers["set-cookie"]


def test_login_required_without_public_origin_refuses_to_start(monkeypatch):
    monkeypatch.setenv("PROMPTPRES_REQUIRE_LOGIN", "1")
    monkeypatch.delenv("PROMPTPRES_PUBLIC_ORIGIN", raising=False)
    with pytest.raises(RuntimeError, match="PROMPTPRES_PUBLIC_ORIGIN"):
        auth.AuthBoundary(main.app)


def test_rate_limit_counts_per_user_behind_a_trusted_proxy(monkeypatch):
    monkeypatch.setenv("PROMPTPRES_TRUSTED_PROXY", "1")
    client = TestClient(main.app)
    for _ in range(auth.RATE_PER_MINUTE):
        client.post("/api/auth/login", json=BODY, headers={"X-Forwarded-For": "203.0.113.5"})
    assert client.post("/api/auth/login", json=BODY, headers={"X-Forwarded-For": "203.0.113.5"}).status_code == 429
    other = client.post("/api/auth/login", json=BODY, headers={"X-Forwarded-For": "198.51.100.7, 203.0.113.9"})
    assert other.status_code == 401
    monkeypatch.delenv("PROMPTPRES_TRUSTED_PROXY")
    auth.ATTEMPTS.clear()
    for n in range(auth.RATE_PER_MINUTE):               # without the setting the header is not trusted
        client.post("/api/auth/login", json=BODY, headers={"X-Forwarded-For": f"203.0.113.{n}"})
    assert client.post("/api/auth/login", json=BODY, headers={"X-Forwarded-For": "192.0.2.1"}).status_code == 429


def test_dev_mode_without_login_keeps_the_rounds_made_before_accounts():
    """No cookie and login not required: rounds without an owner stay visible, a member's rounds do not."""
    old = store.create_session(60)["session_id"]
    anonymous, member = TestClient(main.app), TestClient(main.app)
    assert anonymous.get(f"/api/sessions/{old}").status_code == 200
    assert old in [r["session_id"] for r in anonymous.get("/api/sessions").json()]
    new = anonymous.post("/api/sessions").json()["session_id"]
    assert store.get_session(new)["owner_id"] is None
    member.post("/api/auth/register", json=BODY)
    private = member.post("/api/sessions").json()["session_id"]
    assert anonymous.get(f"/api/sessions/{private}").status_code == 404


def test_upgrade_from_the_schema_before_accounts(tmp_path, monkeypatch):
    """A version-2 database (no users / auth_sessions) gains the tables and keeps every round and owner."""
    path = tmp_path / "old.db"
    store.reset_engine()
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{path.as_posix()}")
    sid = store.create_session(60, "legacy")["session_id"]
    store.checkpoint()
    store.reset_engine()
    db = sqlite3.connect(path)
    db.executescript("DROP TABLE auth_sessions; DROP TABLE users; DELETE FROM schema_versions WHERE version >= 3;")
    assert db.execute("SELECT MAX(version) FROM schema_versions").fetchone()[0] == 2
    db.close()
    assert store.get_session(sid)["owner_id"] == "legacy"
    with store.engine().connect() as c:
        assert c.exec_driver_sql("SELECT MAX(version) FROM schema_versions").scalar() == 4
        assert c.execute(select(store.users)).first() is None
    assert TestClient(main.app).post("/api/auth/register", json=BODY).status_code == 201
    store.checkpoint()
    store.reset_engine()
    wal = path.with_name("old.db-wal")
    assert not wal.exists() or wal.stat().st_size == 0
    assert store.get_session(sid)["owner_id"] == "legacy"
    store.reset_engine()


def test_vercel_visitor_address_and_several_public_origins(monkeypatch):
    """D-062: behind Vercel the visitor is X-Real-IP (Modal drops X-Forwarded-For); every listed origin may write."""
    monkeypatch.setenv("PROMPTPRES_TRUSTED_PROXY", "vercel")
    client = TestClient(main.app)
    for _ in range(auth.RATE_PER_MINUTE):
        client.post("/api/auth/login", json=BODY, headers={"X-Real-IP": "203.0.113.5"})
    assert client.post("/api/auth/login", json=BODY, headers={"X-Real-IP": "203.0.113.5"}).status_code == 429
    assert client.post("/api/auth/login", json=BODY, headers={"X-Real-IP": "198.51.100.7"}).status_code == 401
    monkeypatch.setenv("PROMPTPRES_REQUIRE_LOGIN", "1")
    monkeypatch.setenv("PROMPTPRES_PUBLIC_ORIGIN", "https://promptpres.vercel.app, https://promptpres.example.ac.th/")
    assert auth.public_origin() == "https://promptpres.vercel.app"
    web = TestClient(main.app, base_url="https://promptpres.vercel.app")
    for origin in ("https://promptpres.vercel.app", "https://promptpres.example.ac.th"):
        assert web.post("/api/auth/guest", headers={"Origin": origin, "X-Real-IP": "192.0.2.9"}).status_code == 200
    assert web.post("/api/auth/guest", headers={"Origin": "https://evil.example", "X-Real-IP": "192.0.2.9"}).status_code == 403


def test_a_failed_statement_is_logged_without_its_values():
    """D-066: an error during register must not print the email or password hash into the cloud logs."""
    from sqlalchemy import insert
    from sqlalchemy.exc import IntegrityError
    secret = "pbkdf2_sha256$600000$feedface$secret-digest"
    with pytest.raises(IntegrityError) as failed, store.engine().begin() as db:
        db.execute(insert(store.users).values(id="u_x", email=None, password_hash=secret))
    assert secret not in str(failed.value) and "hidden due to hide_parameters" in str(failed.value)
