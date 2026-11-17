"""Pilot identity and streaming request limits, before multipart parsing."""
import json
import os
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit
from uuid import uuid4

from starlette.datastructures import Headers
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse

from promptpres_shared.settings import pilot_mode, storage_config

PDF_BYTES = 30 * 1024**2
VIDEO_BYTES = 512 * 1024**2
MULTIPART_OVERHEAD = 64 * 1024


def pilot_config():
    origin = os.environ["PROMPTPRES_PILOT_ORIGIN"].rstrip("/")
    parsed = urlsplit(origin)
    if parsed.scheme != "https" or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username:
        raise ValueError("PROMPTPRES_PILOT_ORIGIN must be an HTTPS origin")
    mapping = json.loads(Path(os.environ["PROMPTPRES_PILOT_ALLOWLIST"]).read_text(encoding="utf-8"))
    if not isinstance(mapping, dict) or not mapping or any(
        not isinstance(owner, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", owner)
        for owner in mapping.values()
    ):
        raise ValueError("The Pilot allowlist must map login names to pseudonyms")
    normalized = {login.strip().casefold(): owner for login, owner in mapping.items()}
    if "" in normalized or len(normalized) != len(mapping) or len(set(normalized.values())) != len(mapping):
        raise ValueError("Pilot pseudonyms must be unique")
    return origin, normalized


SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
WRITE_METHODS = {"POST", "PUT", "PATCH"}   # PUT: upload chunks (D-062)
BODY_TOO_LARGE = "ข้อมูลที่ส่งมีขนาดเกินกำหนด"


def _pilot_identity(scope, headers, config):
    origin, owners = config
    values = headers.getlist("tailscale-user-login")
    login = unquote(values[0], errors="replace").strip().casefold() if len(values) == 1 else ""
    owner = owners.get(login)
    if not owner:
        return "บัญชีนี้ไม่ได้รับสิทธิ์เข้าทดลอง"
    if scope["method"] not in SAFE_METHODS and headers.get("origin") != origin:
        return "คำขอต้องมาจากหน้าเว็บ PromptPre's"
    scope.setdefault("state", {})["owner_id"] = owner
    return None


CHUNK_PATH = re.compile(r"^/api/sessions/[^/]+/uploads/[^/]+/chunks/\d+$")


def chunk_bytes() -> int:
    """Size of one upload chunk (config/storage-v0.yaml upload.chunk_mb, D-062)."""
    return int(storage_config()["upload"]["chunk_mb"]) * 1024**2


def _body_limit(path):
    if path.endswith("/video"):
        return VIDEO_BYTES + MULTIPART_OVERHEAD
    if path.endswith("/pdf"):
        return PDF_BYTES + MULTIPART_OVERHEAD
    if CHUNK_PATH.match(path):
        return chunk_bytes()            # raw body, no multipart wrapping
    return 128 * 1024


def _length_allowed(size, limit):
    return size is None or (size.isascii() and size.isdecimal() and len(size) <= 12 and int(size) <= limit)


def _bounded_receiver(receive, limit):
    received = 0

    async def bounded_receive():
        nonlocal received
        message = await receive()
        received += len(message.get("body", b""))
        if received > limit:
            raise HTTPException(413, BODY_TOO_LARGE)
        return message

    return bounded_receive


def _private_sender(send):
    async def private_send(message):
        if message["type"] == "http.response.start":
            headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != b"cache-control"]
            message = dict(message, headers=[*headers, (b"cache-control", b"private, no-store")])
        await send(message)

    return private_send


class RequestBoundary:
    def __init__(self, app):
        self.app = app
        self.config = pilot_config() if pilot_mode() else None

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = Headers(scope=scope)
        if self.config:
            send = _private_sender(send)
            if message := _pilot_identity(scope, headers, self.config):
                return await JSONResponse({"detail": message}, status_code=403)(scope, receive, send)
        if scope["method"] in WRITE_METHODS:
            limit = _body_limit(scope["path"])
            if not _length_allowed(headers.get("content-length"), limit):
                return await JSONResponse({"detail": BODY_TOO_LARGE}, status_code=413)(scope, receive, send)
            receive = _bounded_receiver(receive, limit)
        await self.app(scope, receive, send)


def save_upload(upload, folder: Path, suffix: str, limit: int, *, pdf=False) -> Path:
    """Run in a worker thread; publish an immutable upload only after validation."""
    folder.mkdir(parents=True, exist_ok=True)
    temporary = folder / f"{uuid4().hex}.part"
    target = temporary.with_suffix(suffix)
    try:
        total = 0
        with temporary.open("xb") as out:
            while chunk := upload.read(1024 * 1024):
                if total == 0 and pdf and not chunk.startswith(b"%PDF"):
                    raise HTTPException(422, "ไฟล์นี้ไม่ใช่ PDF")
                total += len(chunk)
                if total > limit:
                    raise HTTPException(413, "ไฟล์มีขนาดเกินกำหนด")
                out.write(chunk)
        if not total:
            raise HTTPException(422, "ไฟล์ว่างเปล่า")
        temporary.replace(target)
        return target
    finally:
        temporary.unlink(missing_ok=True)
