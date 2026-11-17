"""Chunked uploads (D-062): video and report PDF arrive in pieces, then are joined and handled as before.

Why: on the cloud the web app is on Vercel and the API on Modal. A single large POST fails there (Vercel's
proxy rejected a 10 MB body in the D-062 spike; Modal ends a request after 150 s), so the browser sends
8 MB chunks straight to the API address with a signed ticket instead of the login cookie.

  POST /api/sessions/{id}/uploads                          -> ticket {upload_id, url, token, chunk_bytes, chunks}
  PUT  /api/sessions/{id}/uploads/{upload_id}/chunks/{n}   -> one chunk (raw body, sent again on failure)
  POST /api/sessions/{id}/uploads/{upload_id}/complete     -> join, check like a normal upload, then
                                                              video: queue for analysis · pdf: draft topics
The chunks wait in UPLOAD_DIR/<id>/.staging/<upload_id>/ on this machine; the cloud web tier runs as one
container so every chunk of an upload reaches the same disk.
"""
from __future__ import annotations

import json
import math
import shutil
import threading
import time
from collections import Counter, deque
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from fastapi import Path as PathParam
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from promptpres_shared import store
from promptpres_shared.settings import llm_enabled, storage_config

from .auth import direct_origin, grant, throttle
from .boundary import PDF_BYTES, VIDEO_BYTES, chunk_bytes, save_upload

router = APIRouter(prefix="/api/sessions", tags=["uploads"])
MISSING = "ไม่พบการอัปโหลดนี้ กรุณาเริ่มส่งไฟล์ใหม่"
OWNER_BUSY = "มีวิดีโอของท่านรอวิเคราะห์อยู่ {} รอบแล้ว กรุณารอให้เสร็จก่อนส่งรอบใหม่"
QUEUE_FULL = "ขณะนี้มีวิดีโอรอวิเคราะห์จำนวนมาก กรุณาลองส่งใหม่ในอีกสักครู่"
DAY_FULL = "วันนี้ระบบรับวิเคราะห์วิดีโอครบจำนวนแล้ว กรุณาลองใหม่ในวันถัดไป"
TOO_OFTEN = "ส่งวิดีโอถี่เกินไปจากเครือข่ายนี้ กรุณารอสักครู่แล้วลองใหม่"
PDF_FULL = "วันนี้ระบบอ่าน PDF ครบจำนวนแล้ว กรุณาเพิ่มหัวข้อเองหรือเลือกแม่แบบ"
PDF_TOO_OFTEN = "ส่ง PDF ถี่เกินไปจากเครือข่ายนี้ กรุณารอสักครู่แล้วลองใหม่"
UploadId = Annotated[str, PathParam(pattern=r"^[0-9a-f]{32}$")]     # uuid4().hex, like the ticket path (auth.py)


# Rounds that passed the final check but are not committed to the queue yet (copy to storage, then enqueue).
# The check reads the database, so without this two uploads finishing together would both see room and both
# be queued. The cloud web tier is one container (deploy_modal.web max_containers=1), so a process lock is
# enough; the lock is held only for the check, not for the copy.
ADMIT_LOCK = threading.Lock()
ADMITTING: Counter = Counter()


def check_queue(request: Request, *, ticket: bool, hold: bool = False) -> str:
    """Credit guard before a video joins the queue (D-063, config/storage-v0.yaml guard).

    Checked when the browser asks for a video ticket (before any bytes are sent) and again when the upload is
    complete (the decision that counts, hold=True). Per account: at most max_active_per_owner rounds queued or
    processing. For everyone: at most max_active_total, and max_analyses_per_day in the last 24 h, so a flood
    of new Guest accounts still cannot keep the T4 busy. Rounds being admitted right now count too.
    Per caller address (tickets only): a limit wide enough for one classroom behind a campus NAT; it only slows
    a script, the totals above are the real stop.
    hold=True: on success the round keeps its place until release(owner) (after enqueue, or when given up).
    Returns the owner id.
    """
    guard = storage_config()["guard"]
    if ticket:
        throttle(request, "video", int(guard["video_tickets_per_ip_hour"]), 3600, TOO_OFTEN)
    owner = _main().owner(request)
    with ADMIT_LOCK:
        load = store.queue_load(owner)
        pending = sum(ADMITTING.values())
        owner_active = load["owner_active"] + ADMITTING[owner]
        if owner_active >= guard["max_active_per_owner"]:
            raise HTTPException(429, OWNER_BUSY.format(owner_active))
        if load["active"] + pending >= guard["max_active_total"]:
            raise HTTPException(503, QUEUE_FULL)
        if load["today"] + pending >= guard["max_analyses_per_day"]:
            raise HTTPException(503, DAY_FULL)
        if hold:
            ADMITTING[owner] += 1
    return owner


# Start times of the LLM reads of report PDFs in this process (D-066). A read that fails still costs, so the
# attempts are counted here; the database count (successful reads) carries the day over a container restart.
PDF_READS: deque = deque()


def check_pdf(request: Request | None = None, *, take: bool = False) -> None:
    """Credit guard before a report PDF goes to the LLM (D-066, config/storage-v0.yaml guard).

    request: a new PDF upload (ticket or one-request route) from this caller address, throttled per hour.
    take=True: right before the LLM call, which then counts towards pdf_reads_per_day for everyone.
    """
    guard = storage_config()["guard"]
    if request is not None:
        throttle(request, "pdf", int(guard["pdf_tickets_per_ip_hour"]), 3600, PDF_TOO_OFTEN)
    with ADMIT_LOCK:
        now = time.monotonic()
        while PDF_READS and PDF_READS[0] < now - 86400:
            PDF_READS.popleft()
        if max(len(PDF_READS), store.pdf_reads()) >= guard["pdf_reads_per_day"]:
            raise HTTPException(503, PDF_FULL)
        if take:
            PDF_READS.append(now)


def release(owner: str) -> None:
    """The round is in the queue (or was given up): stop holding its place."""
    with ADMIT_LOCK:
        ADMITTING[owner] -= 1
        if ADMITTING[owner] <= 0:
            del ADMITTING[owner]


def prune_staging(upload_dir: Path, max_age_s: float) -> None:
    """Delete chunk folders of uploads that were never completed (older than the ticket lifetime), in every
    session: a round whose upload was abandoned may never ask for another ticket."""
    cutoff = time.time() - max_age_s
    for folder in Path(upload_dir).glob("*/.staging/*"):
        try:
            if folder.stat().st_mtime < cutoff:
                shutil.rmtree(folder, ignore_errors=True)
        except OSError:
            pass


class UploadIn(BaseModel):
    kind: Literal["video", "pdf"]
    filename: str = Field("", max_length=255)
    size: int = Field(gt=0)


def _main():
    from . import main   # noqa: PLC0415 — main includes this router, so import it when a request runs
    return main


def _staging(session_id: str, upload_id: str) -> Path:
    return _main().UPLOAD_DIR / session_id / ".staging" / upload_id


def _editable_session(request: Request, session_id: str) -> dict:
    main = _main()
    session = main._session_or_404(session_id, request)
    main._editable_or_409(session)
    return session


def _meta(session_id: str, upload_id: str) -> dict:
    try:
        return json.loads((_staging(session_id, upload_id) / "meta.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise HTTPException(404, MISSING) from None


@router.post("/{session_id}/uploads", status_code=201)
def start_upload(request: Request, session_id: str, body: UploadIn) -> dict:
    """Check the file the browser is about to send and hand out a ticket for its chunks."""
    main = _main()
    _editable_session(request, session_id)
    ext = Path(body.filename).suffix.lower()
    if body.kind == "video":
        ext = ext or ".webm"
        if ext not in main.VIDEO_TYPES:
            raise HTTPException(422, "รองรับเฉพาะไฟล์ .mp4 .webm .mov")
        check_queue(request, ticket=True)
        limit = VIDEO_BYTES
    else:
        if not llm_enabled():
            raise HTTPException(403, "ยังไม่เปิดใช้การอ่าน PDF กรุณากรอกหัวข้อเอง")
        check_pdf(request)
        ext, limit = ".pdf", PDF_BYTES
    if body.size > limit:
        raise HTTPException(413, "ไฟล์มีขนาดเกินกำหนด")
    upload_id, size = uuid4().hex, chunk_bytes()
    prune_staging(main.UPLOAD_DIR, storage_config()["guard"]["staging_max_age_s"])
    folder = _staging(session_id, upload_id)
    folder.mkdir(parents=True)
    meta = {"kind": body.kind, "ext": ext, "size": body.size, "chunks": math.ceil(body.size / size),
            "chunk_bytes": size}
    (folder / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    ttl = storage_config()["upload"]["ticket_ttl_s"]
    return {"upload_id": upload_id, "url": f"{direct_origin()}/api/sessions/{session_id}/uploads/{upload_id}",
            "token": grant("upload", session_id, main.owner(request), ttl, upload=upload_id),
            "chunk_bytes": size, "chunks": meta["chunks"]}


@router.put("/{session_id}/uploads/{upload_id}/chunks/{index}")
async def put_chunk(request: Request, session_id: str, upload_id: UploadId, index: int) -> dict:
    """Store chunk `index`; sending the same chunk again replaces it."""
    await run_in_threadpool(_editable_session, request, session_id)
    meta = await run_in_threadpool(_meta, session_id, upload_id)
    if not 0 <= index < meta["chunks"]:
        raise HTTPException(422, "ลำดับชิ้นส่วนของไฟล์ไม่ถูกต้อง")
    expected = min(meta["chunk_bytes"], meta["size"] - index * meta["chunk_bytes"])
    data = await request.body()
    if len(data) != expected:
        raise HTTPException(422, "ข้อมูลส่วนนี้ไม่ครบ กรุณาลองส่งใหม่")
    await run_in_threadpool(_write_chunk, _staging(session_id, upload_id), index, data)
    return {"received": index}


def _write_chunk(folder: Path, index: int, data: bytes) -> None:
    temporary = folder / f"{index:05d}.{uuid4().hex}.tmp"
    try:
        temporary.write_bytes(data)
        temporary.replace(folder / f"{index:05d}.part")
    finally:
        temporary.unlink(missing_ok=True)


class _Joined:
    """Read the chunk files one after another, like one file (for save_upload).

    Each chunk file is deleted as soon as it has been read, so joining a 500 MB upload needs about
    500 MB + one chunk of local disk, not twice the file (D-063)."""

    def __init__(self, parts: list[Path]):
        self.parts, self.handle = list(parts), None

    def read(self, size: int) -> bytes:
        while True:
            if self.handle is None:
                if not self.parts:
                    return b""
                self.handle = self.parts.pop(0).open("rb")
            data = self.handle.read(size)
            if data:
                return data
            self.handle.close()
            Path(self.handle.name).unlink(missing_ok=True)
            self.handle = None

    def close(self) -> None:
        if self.handle is not None:
            self.handle.close()


def _join(session_id: str, upload_id: str, meta: dict) -> Path:
    folder = _staging(session_id, upload_id)
    parts = [folder / f"{i:05d}.part" for i in range(meta["chunks"])]
    if not all(p.is_file() for p in parts) or sum(p.stat().st_size for p in parts) != meta["size"]:
        raise HTTPException(409, "ส่งไฟล์ยังไม่ครบทุกส่วน กรุณาลองส่งใหม่")
    joined = _Joined(parts)
    try:
        limit = PDF_BYTES if meta["kind"] == "pdf" else VIDEO_BYTES
        return save_upload(joined, _main().UPLOAD_DIR / session_id, meta["ext"], limit, pdf=meta["kind"] == "pdf")
    finally:
        joined.close()
        shutil.rmtree(folder, ignore_errors=True)


@router.post("/{session_id}/uploads/{upload_id}/complete")
async def complete_upload(request: Request, session_id: str, upload_id: UploadId) -> dict:
    """Join the chunks into one file and continue exactly like the one-request upload endpoints."""
    main = _main()
    await run_in_threadpool(_editable_session, request, session_id)
    meta = await run_in_threadpool(_meta, session_id, upload_id)
    path = await run_in_threadpool(_join, session_id, upload_id, meta)
    if meta["kind"] == "pdf":
        return await main.topics_from_pdf(session_id, path)
    return await main.queue_video(request, session_id, path)
