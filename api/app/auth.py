"""Account authentication, signed browser ownership and atomic Guest registration (D-050)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, insert, select, update
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

from promptpres_shared import store
from promptpres_shared.settings import pilot_mode

router = APIRouter(prefix="/api/auth", tags=["auth"])
COOKIE = "pt_session"
ROUNDS = 600_000
DEV_SECRET = secrets.token_bytes(32)
RATE_LOCK = threading.Lock()
ATTEMPTS: dict[str, deque] = defaultdict(deque)
RATE_PER_MINUTE = 60     # register/login/guest per caller; a class behind one campus NAT shares one address


def required() -> bool:
    return os.environ.get("PROMPTPRES_REQUIRE_LOGIN", "0") == "1" and not pilot_mode()


def secret() -> bytes:
    value = os.environ.get("PROMPTPRES_SESSION_SECRET", "")
    if required() and len(value) < 32:
        raise RuntimeError("PROMPTPRES_SESSION_SECRET must contain at least 32 characters")
    return value.encode() if value else DEV_SECRET


def public_origins() -> list[str]:
    """PROMPTPRES_PUBLIC_ORIGIN may list several origins, comma-separated (D-062: the Vercel address and,
    later, a custom domain). The first one is the canonical address; every listed one may send writes."""
    raw = os.environ.get("PROMPTPRES_PUBLIC_ORIGIN", "")
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]


def public_origin() -> str:
    origins = public_origins()
    return origins[0] if origins else ""


def direct_origin() -> str:
    """Address of this API itself when the web app is served from another origin (D-062: the Modal URL that
    receives video chunks and serves the player directly). Empty = everything on one origin."""
    return os.environ.get("PROMPTPRES_DIRECT_ORIGIN", "").strip().rstrip("/")


def https(request: Request) -> bool:
    """Secure cookies follow the real scheme: the configured public origin, else this request."""
    origin = public_origin()
    return origin.startswith("https://") if origin else request.url.scheme == "https"


def client_key(request: Request) -> str:
    """Who is calling, for the rate limit.

    PROMPTPRES_TRUSTED_PROXY=1: one reverse proxy in front (Caddy) -> the last X-Forwarded-For entry.
    PROMPTPRES_TRUSTED_PROXY=vercel (D-062): Vercel's rewrite sends the visitor in X-Real-IP, and Modal drops
    X-Forwarded-For. A caller who skips Vercel can set that header too, so this limit only slows guessing;
    the PBKDF2 cost of each password check stays the real protection.
    """
    proxy = os.environ.get("PROMPTPRES_TRUSTED_PROXY")
    if proxy == "vercel" and request.headers.get("x-real-ip", "").strip():
        return request.headers["x-real-ip"].strip()
    forwarded = request.headers.get("x-forwarded-for", "")
    if proxy == "1" and forwarded:
        return forwarded.rsplit(",", 1)[-1].strip() or "local"
    return request.client.host if request.client else "local"


# Signed tickets for calls that reach the API directly, without the login cookie (D-062): browsers do not send
# a first-party cookie to the Modal address. A ticket names one purpose, one session and its owner.
UPLOAD_PATH = re.compile(r"^/api/sessions/([^/]+)/uploads/([0-9a-f]{32})/(?:chunks/\d+|complete)$")
MEDIA_PATH = re.compile(r"^/api/media/([^/]+)$")


def grant(purpose: str, session_id: str, owner_id: str | None, ttl_s: float, **extra) -> str:
    return sign({"purpose": purpose, "sid": session_id, "owner": owner_id or "__anonymous__",
                 "exp": time.time() + ttl_s, **extra})


def ticket_owner(request: Request) -> str | None:
    """The owner named by a valid ticket for exactly this request path, else None."""
    if match := UPLOAD_PATH.match(request.url.path):
        payload = unsigned(request.headers.get("x-upload-token"))
        ok = payload and payload.get("purpose") == "upload" and payload.get("sid") == match[1] \
            and payload.get("upload") == match[2]
    elif match := MEDIA_PATH.match(request.url.path):
        payload = unsigned(request.query_params.get("t"))
        ok = payload and payload.get("purpose") == "media" and payload.get("sid") == match[1]
    else:
        return None
    owner = payload.get("owner") if ok else None
    return owner if isinstance(owner, str) else None


def password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ROUNDS)
    return f"pbkdf2_sha256${ROUNDS}${salt.hex()}${digest.hex()}"


def password_matches(password: str, stored: str) -> bool:
    try:
        algorithm, rounds, salt, expected = stored.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(rounds))
        return hmac.compare_digest(actual.hex(), expected)
    except (ValueError, TypeError):
        return False


def sign(payload: dict) -> str:
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    return raw + "." + hmac.new(secret(), raw.encode(), hashlib.sha256).hexdigest()


def unsigned(value: str | None) -> dict | None:
    try:
        raw, signature = (value or "").rsplit(".", 1)
        if not hmac.compare_digest(signature, hmac.new(secret(), raw.encode(), hashlib.sha256).hexdigest()):
            return None
        payload = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
        if not isinstance(payload, dict) or float(payload["exp"]) <= time.time():
            return None
        return payload
    except (ValueError, KeyError, TypeError):
        return None


def identity(request: Request) -> dict | None:
    payload = unsigned(request.cookies.get(COOKIE))
    if not payload or not isinstance(payload.get("token"), str):
        return None
    digest = hashlib.sha256(payload["token"].encode()).hexdigest()
    with store.engine().connect() as db:
        row = db.execute(select(store.users, store.auth_sessions.c.is_guest,
                                store.auth_sessions.c.token_hash)
                         .join(store.auth_sessions, store.users.c.id == store.auth_sessions.c.user_id)
                         .where(store.auth_sessions.c.token_hash == digest,
                                store.auth_sessions.c.expires_at > time.time())).mappings().first()
    return dict(row) if row else None


def legacy_owner(request: Request) -> str | None:
    """Only a signed, unexpired anonymous owner may be claimed; never trust an owner in a form."""
    payload = unsigned(request.cookies.get("pt_owner"))
    owner = payload.get("owner_id") if payload else None
    if not isinstance(owner, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", owner):
        return None
    with store.engine().connect() as db:
        if db.execute(select(store.users.c.id).where(store.users.c.id == owner)).first():
            return None
    return owner


def public_user(user: dict | None) -> dict | None:
    if user is None:
        return None
    return {k: user[k] for k in ("id", "email", "display_name")} | {"is_guest": bool(user.get("is_guest"))}


def issue(db, user_id: str, request: Request, response: Response, guest=False):
    lifetime = 86400 if guest else 7 * 86400
    token, expires = secrets.token_urlsafe(32), time.time() + lifetime
    db.execute(delete(store.auth_sessions).where(store.auth_sessions.c.expires_at <= time.time()))
    db.execute(insert(store.auth_sessions).values(token_hash=hashlib.sha256(token.encode()).hexdigest(),
               user_id=user_id, expires_at=expires, is_guest=int(guest)))
    response.set_cookie(COOKIE, sign({"token": token, "exp": expires}), max_age=lifetime,
                        httponly=True, secure=https(request), samesite="lax", path="/")
    response.delete_cookie("pt_owner", path="/")


def throttle(request: Request, bucket: str, limit: int, window_s: float, message: str) -> None:
    """Bounded sliding window per caller address in this API process (the cloud web tier is one container)."""
    key = f"{bucket}:{client_key(request)}"
    now = time.monotonic()
    with RATE_LOCK:
        for old in list(ATTEMPTS):
            if not ATTEMPTS[old] or ATTEMPTS[old][-1] < now - max(window_s, 3600):
                del ATTEMPTS[old]
        attempts = ATTEMPTS[key]
        while attempts and attempts[0] < now - window_s:
            attempts.popleft()
        if len(attempts) >= limit:
            raise HTTPException(429, message)
        attempts.append(now)


def rate_limit(request: Request):
    """Shared by register/login/guest."""
    throttle(request, "auth", RATE_PER_MINUTE, 60, "ลองหลายครั้งเกินไป กรุณารอหนึ่งนาที")


class Login(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=128)


class Register(Login):
    display_name: str = Field(min_length=1, max_length=80)


def email_key(value: str) -> str:
    value = value.strip().casefold()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value) or value.endswith("@guest.invalid"):
        raise HTTPException(422, "กรุณากรอกอีเมลให้ถูกต้อง")
    return value


@router.post("/register", status_code=201)
def register(body: Register, request: Request, response: Response):
    rate_limit(request)
    email, name = email_key(body.email), body.display_name.strip()
    if not name:
        raise HTTPException(422, "กรุณากรอกชื่อที่แสดง")
    current = identity(request)
    previous = current["id"] if current and current["is_guest"] else legacy_owner(request) if not current else None
    user = {"id": "u_" + secrets.token_hex(16), "email": email, "display_name": name,
            "password_hash": password_hash(body.password), "created_at": store.now()}
    try:
        with store.engine().begin() as db:
            db.execute(insert(store.users).values(**user))
            if previous and current:
                # Recheck the Guest login inside this transaction: a session revoked or expired since
                # identity() ran (logout, a second registration) may not hand its rounds over.
                alive = db.execute(select(store.auth_sessions.c.token_hash).where(
                    store.auth_sessions.c.token_hash == current["token_hash"],
                    store.auth_sessions.c.user_id == previous, store.auth_sessions.c.is_guest == 1,
                    store.auth_sessions.c.expires_at > time.time())).first()
                if alive is None:
                    raise HTTPException(401, "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง")
            if previous:
                db.execute(update(store.sessions).where(store.sessions.c.owner_id == previous).values(owner_id=user["id"]))
                db.execute(delete(store.auth_sessions).where(store.auth_sessions.c.user_id == previous))
                if current:  # the Guest account row has no rounds left and can never log in again
                    db.execute(delete(store.users).where(store.users.c.id == previous))
            issue(db, user["id"], request, response)
    except IntegrityError:
        raise HTTPException(409, "อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบ") from None
    return {"user": public_user(user), "required": required()}


@router.post("/login")
def login(body: Login, request: Request, response: Response):
    rate_limit(request)
    email = email_key(body.email)
    with store.engine().begin() as db:
        row = db.execute(select(store.users).where(store.users.c.email == email)).mappings().first()
        if not row or not password_matches(body.password, row["password_hash"]):
            raise HTTPException(401, "อีเมลหรือรหัสผ่านไม่ถูกต้อง")
        issue(db, row["id"], request, response)
    return {"user": public_user(dict(row)), "required": required()}


@router.post("/guest")
def guest(request: Request, response: Response):
    rate_limit(request)
    current = identity(request)
    if current:
        return {"user": public_user(current), "required": required()}
    uid = "g_" + secrets.token_hex(16)
    user = {"id": uid, "email": uid + "@guest.invalid", "display_name": "ผู้ทดลองใช้งาน",
            "password_hash": "!guest", "created_at": store.now()}
    with store.engine().begin() as db:
        db.execute(insert(store.users).values(**user))
        old = legacy_owner(request)
        if old:
            db.execute(update(store.sessions).where(store.sessions.c.owner_id == old).values(owner_id=uid))
        issue(db, uid, request, response, guest=True)
    return {"user": public_user(user | {"is_guest": True}), "required": required()}


@router.post("/logout")
def logout(request: Request, response: Response):
    current = identity(request)
    if current:
        with store.engine().begin() as db:
            db.execute(delete(store.auth_sessions).where(store.auth_sessions.c.token_hash == current["token_hash"]))
    response.delete_cookie(COOKIE, path="/")
    response.delete_cookie("pt_owner", path="/")
    return {"user": None, "required": required()}


@router.get("/me")
def me(request: Request):
    return {"user": public_user(identity(request)), "required": required()}


class AuthBoundary:
    def __init__(self, app):
        self.app = app
        secret()  # Cloud must fail closed without a persistent signing secret.
        if required() and not public_origin():
            # Behind a TLS proxy request.base_url may read http://, which would reject every write.
            raise RuntimeError("PROMPTPRES_PUBLIC_ORIGIN must be set when login is required")

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or pilot_mode() or not scope["path"].startswith("/api/"):
            return await self.app(scope, receive, send)
        request = Request(scope)
        private = scope["path"].startswith(("/api/sessions", "/api/media"))
        ticket = ticket_owner(request)          # direct upload chunk / video link (D-062), no cookie involved
        current = await run_in_threadpool(identity, request) if not ticket else None
        old = await run_in_threadpool(legacy_owner, request) if not current and not ticket else None
        signed_in = bool(ticket or current or old)
        if private and required() and not signed_in:
            return await JSONResponse({"detail": "กรุณาเข้าสู่ระบบ"}, 401)(scope, receive, send)
        if private and not signed_in and (COOKIE in request.cookies or "pt_owner" in request.cookies):
            return await JSONResponse({"detail": "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง"}, 401)(scope, receive, send)
        if scope["method"] not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin")
            allowed = public_origins() or [str(request.base_url).rstrip("/")]
            local = {"http://localhost:5173", "http://127.0.0.1:5173"} if not required() else set()
            if (required() and not origin) or (origin and origin not in {*allowed, *local}):
                return await JSONResponse({"detail": "คำขอต้องมาจากหน้าเว็บ PromptPre's"}, 403)(scope, receive, send)
        if signed_in:
            scope.setdefault("state", {})["owner_id"] = ticket or (current["id"] if current else old)
        async def no_store(message):
            if message["type"] == "http.response.start":
                message = dict(message, headers=[*message.get("headers", []), (b"cache-control", b"private, no-store")])
            await send(message)
        await self.app(scope, receive, no_store)
