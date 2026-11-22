"""PromptPre's API — practice sessions end to end.

Flow (one practice session):
  POST /api/sessions                 -> status "created", target time (default 15 min, D-038)
  POST /api/sessions/{id}/pdf        -> PDF saved, draft topics from the LLM (promptpres_shared.topics), user edits them
  PUT  /api/sessions/{id}/topics     -> confirmed topic list (used by C1 C2)
  POST /api/sessions/{id}/video      -> video saved, status "queued"; worker.runner (separate process) analyses it
  GET  /api/sessions/{id}            -> status for polling: created / queued / processing / done / failed
  GET  /api/sessions/{id}/result     -> Result Contract 1.3 (stub while queued/processing)
  GET  /api/sessions                 -> history, newest first (mock results from contracts/mocks are listed too)
  GET  /api/sessions/{id}/transcript -> timed phrases, fillers and long pauses for the result page (D-046)
  PATCH /api/sessions/{id}           -> change the target time (before the video is sent)
  GET  /api/media/{id}               -> the video for the result page player (FileResponse: Range / 206 for seeking)
  GET  /api/health · /api/criteria · /api/feedback -> health check, scored vs supporting value keys, feedback texts
  POST /api/sessions/{id}/uploads …  -> chunked upload of the video or PDF (D-062, api/app/uploads.py); the web uses
                                        it everywhere, the one-request /video and /pdf endpoints stay for scripts
Errors: every message shown to the user is Thai (request validation too, see thai_validation_error).
Storage: promptpres_shared/store.py (SQLite file by default, PostgreSQL with DATABASE_URL); where uploads and
run files live and how a job reaches the worker: promptpres_shared/storage.py (cloud hooks in deploy_modal.py).
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import yaml
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from promptpres_shared import storage, store
from promptpres_shared.contract import CONTRACT_VERSION, Result, validate_result
from promptpres_shared.settings import (data_root, llm_enabled, load_thresholds, pilot_mode, pipeline_config,
                                        storage_config)
from promptpres_shared.transcript import build_transcript

from .auth import AuthBoundary, direct_origin, grant, public_origins, required as auth_required, router as auth_router
from .boundary import PDF_BYTES, VIDEO_BYTES, RequestBoundary, save_upload
from .uploads import check_pdf, check_queue, release, router as uploads_router

REPO = store.REPO
MOCK_DIR = REPO / "contracts" / "mocks"
CONFIG_DIR = REPO / "config"
UPLOAD_DIR = Path(os.environ.get("PROMPTPRES_UPLOADS", data_root() / "uploads"))
RUNS_DIR = Path(os.environ.get("PROMPTPRES_RUNS", REPO / "data" / "runs"))
FEEDBACK_FILE = os.environ.get("PROMPTPRES_FEEDBACK", "feedback-v0.yaml")
# Local-only sample video for the mock result pages (never committed). Points at any mp4 on disk.
MOCK_VIDEO = os.environ.get("PROMPTPRES_MOCK_VIDEO")

VIDEO_TYPES = (".mp4", ".webm", ".mov")
PILOT = pilot_mode()
if PILOT:
    UPLOAD_DIR, RUNS_DIR = data_root() / "uploads", data_root() / "runs"
LOCKED = "ส่งวิดีโอวิเคราะห์แล้ว แก้ไขรายการหัวข้อหรือเวลาเป้าหมายไม่ได้"

@asynccontextmanager
async def lifespan(_app: FastAPI):
    store.engine()          # create tables if missing
    yield
    store.checkpoint()      # SQLite WAL -> database file on a clean stop (D-050)


app = FastAPI(title="PromptPre's API", version="0.4.0", lifespan=lifespan,
              docs_url=None if PILOT else "/docs", redoc_url=None if PILOT else "/redoc",
              openapi_url=None if PILOT else "/openapi.json")


@app.exception_handler(store.SessionLocked)
async def locked(_request: Request, _exc: store.SessionLocked):
    return JSONResponse({"detail": LOCKED}, status_code=409)


@app.exception_handler(RequestValidationError)
async def thai_validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """Pydantic 422s carry English text; the web shows `detail`, so give a Thai one (+ the raw list)."""
    fields = []
    for err in exc.errors():
        name = ".".join(str(x) for x in err.get("loc", ()) if x not in ("body", "query", "path"))
        if name and name not in fields:
            fields.append(name)
    detail = "ข้อมูลที่ส่งมาไม่ถูกต้องหรือไม่ครบ" + (f": {', '.join(fields)}" if fields else "")
    errors = [{"loc": [str(x) for x in e.get("loc", ())], "type": e.get("type")} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": detail, "errors": errors})


LOCAL_WEB = ("http://localhost:5173", "http://127.0.0.1:5173")


class AllowedOrigins(CORSMiddleware):
    """CORS for the pages listed in PROMPTPRES_PUBLIC_ORIGIN (+ the Vite dev server when login is optional).

    Read on every request, like AuthBoundary, so the list can change without code. Credentials are never
    allowed: direct calls carry a signed ticket instead of the cookie (D-062). Each allowed origin is echoed
    back with `Vary: Origin`.
    """

    def is_allowed_origin(self, origin: str) -> bool:
        return origin in {*public_origins(), *(LOCAL_WEB if not auth_required() else ())}


app.include_router(auth_router)
app.include_router(uploads_router)
app.add_middleware(AuthBoundary)
app.add_middleware(RequestBoundary)
if not PILOT:
    # Outermost: answers preflights before the login check and adds CORS headers to 401/403/413 replies too.
    app.add_middleware(AllowedOrigins, allow_origins=[], allow_methods=["*"], allow_headers=["*"])


def owner(request: Request) -> str | None:
    return getattr(request.state, "owner_id", "__anonymous__")


def thresholds() -> dict:
    return load_thresholds()


@lru_cache(maxsize=1)
def _load_mocks() -> dict[str, Result]:
    if PILOT or auth_required():
        return {}
    out: dict[str, Result] = {}
    for f in sorted(MOCK_DIR.glob("*.json")):
        r = validate_result(json.loads(f.read_text(encoding="utf-8")))
        out[r.session_id] = r
    return out


def _session_or_404(session_id: str, request: Request) -> dict:
    s = store.get_session(session_id, owner(request))
    if s is None:
        raise HTTPException(404, "ไม่พบรอบซ้อมนี้")
    return s


def _editable_or_409(s: dict) -> None:
    if s["status"] != "created":
        raise HTTPException(409, LOCKED)


def topic_limits() -> dict:
    spec = thresholds()["criteria"]["C2"]
    return {"min": spec["unanalyzable"]["min_topics"], "max": spec["max_topics"]}


def _session_view(s: dict) -> dict:
    topics = store.session_topics(s["session_id"])
    confirmed = topics.get("confirmed")
    suggested = topics.get("suggested")
    return {"session_id": s["session_id"], "status": s["status"], "target_duration_s": s["target_duration_s"],
            "created_at": s["created_at"], "queued_at": s["queued_at"], "started_at": s["started_at"],
            "finished_at": s["finished_at"], "error_message": s["error_message"],
            "topic_limits": topic_limits(),
            "pdf_enabled": llm_enabled(),
            "has_pdf": bool(s["pdf_path"]), "has_video": bool(s["video_path"]),
            "confirmed_topics": confirmed["topics"] if confirmed else None,
            "suggested_topics": suggested["topics"] if suggested else None, "source": "session"}


# --------------------------------------------------------------------------- general
@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "contract_version": CONTRACT_VERSION}


def _feedback_config() -> dict:
    return yaml.safe_load((CONFIG_DIR / FEEDBACK_FILE).read_text(encoding="utf-8")) or {}


def _criteria_rows(criteria: dict) -> dict[str, dict]:
    """Card metadata per criterion: level keys, band direction and bounds (thresholds yaml, read-only),
    and the plain-language reading (feedback yaml `interpret`, D-046). The web never computes a level;
    it only places the level the worker gave on a 4-step band and words it."""
    interpret = _feedback_config().get("interpret") or {}
    return {code: {"scored_values": list(spec.get("scored_values") or []),
                   "direction": spec.get("direction"),
                   "levels": {str(level): bounds for level, bounds in (spec.get("levels") or {}).items()},
                   "interpret": interpret.get(code)}
            for code, spec in (criteria or {}).items()}


@app.get("/api/criteria")
def criteria_meta() -> dict[str, dict]:
    """Which value keys determine each criterion's level (config scored_values), plus band and reading.

    Every other key in Result.values is supporting info and is shown apart on the card (D-028).
    """
    return _criteria_rows(thresholds().get("criteria") or {})


@app.get("/api/feedback")
def feedback() -> dict[str, str]:
    """Template feedback texts keyed by feedback_id (config/feedback-*.yaml)."""
    return {k: v for k, v in (_feedback_config().get("feedback") or {}).items()}


# --------------------------------------------------------------------------- sessions
# A target longer than the longest clip the pipeline accepts could never be met (pipeline-v0.yaml prep.max_duration_s).
MAX_TARGET_S = float(pipeline_config()["prep"]["max_duration_s"])


class NewSession(BaseModel):
    target_duration_s: Optional[float] = Field(None, gt=0, le=MAX_TARGET_S)


class TopicIn(BaseModel):
    title: str
    key_point: str = ""


class TopicsIn(BaseModel):
    topics: list[TopicIn]


@app.post("/api/sessions", status_code=201)
def create_session(request: Request, body: NewSession | None = None) -> dict:
    target = (body.target_duration_s if body else None) or thresholds()["criteria"]["T1"]["default_target_s"]
    return _session_view(store.create_session(target, owner(request)))


def _trend_fields(summary: dict) -> dict:
    """levels per criterion + the values that set each level (scored_values) for the trend panel (D-046)."""
    if summary["levels"] is None:
        return {"levels": None, "primary_values": None, "rubric_version": None}
    scored = {code: spec.get("scored_values") or [] for code, spec in (thresholds().get("criteria") or {}).items()}
    primary = {code: {k: v for k, v in values.items() if k in scored.get(code, [])}
               for code, values in summary["values"].items()}
    return {"levels": summary["levels"], "primary_values": primary, "rubric_version": summary["rubric_version"]}


@app.get("/api/sessions")
def list_sessions(request: Request) -> list[dict]:
    """History, newest first. Finished sessions carry levels per criterion — never a total score."""
    rows = [{"session_id": s["session_id"], "status": s["status"], "created_at": s["created_at"],
             "duration_s": s["duration_s"], "target_duration_s": s["target_duration_s"],
             "topics_count": s["topics_count"], "source": "session"} | _trend_fields(s)
            for s in store.list_sessions(owner(request))]
    rows += [{"session_id": r.session_id, "status": r.status, "created_at": r.created_at.isoformat(),
              "duration_s": r.duration_s, "target_duration_s": r.target_duration_s,
              "topics_count": len(r.topics), "source": "mock"}
             | _trend_fields(store.result_summary(r.model_dump(mode="json")) if r.status == "done"
                             else {"levels": None}) for r in _load_mocks().values()]
    return sorted(rows, key=lambda r: r["created_at"], reverse=True)


@app.get("/api/sessions/{session_id}")
def get_session(request: Request, session_id: str) -> dict:
    return _session_view(_session_or_404(session_id, request))


@app.patch("/api/sessions/{session_id}")
def set_target(request: Request, session_id: str, body: NewSession) -> dict:
    s = _session_or_404(session_id, request)
    _editable_or_409(s)
    if body.target_duration_s:
        store.edit_created(session_id, target_duration_s=body.target_duration_s)
    return _session_view(_session_or_404(session_id, request))


@app.post("/api/sessions/{session_id}/pdf")
async def upload_pdf(request: Request, session_id: str, pdf: UploadFile = File(...)) -> dict:
    """Save the report PDF and return draft topics from the LLM (the user edits and confirms them)."""
    s = await run_in_threadpool(_session_or_404, session_id, request)
    _editable_or_409(s)
    if not llm_enabled():
        raise HTTPException(403, "ยังไม่เปิดใช้การอ่าน PDF กรุณากรอกหัวข้อเอง")
    await run_in_threadpool(check_pdf, request)
    path = await run_in_threadpool(save_upload, pdf.file, UPLOAD_DIR / session_id, ".pdf", PDF_BYTES, pdf=True)
    return await topics_from_pdf(session_id, path)


async def topics_from_pdf(session_id: str, path: Path) -> dict:
    """Draft topics from a saved PDF (one-request and chunked uploads); the PDF is removed if this fails."""
    try:
        await run_in_threadpool(lambda: check_pdf(take=True))      # LLM credit guard (D-066)
    except HTTPException:
        path.unlink(missing_ok=True)
        raise
    saved = False
    try:
        draft = await run_in_threadpool(suggest_topics, path)
        await run_in_threadpool(lambda: store.add_topics(
            session_id, "suggested", "pdf", draft["topics"], draft.get("model"), draft.get("prompt"), pdf_path=path
        ))
        saved = True
    except store.SessionLocked:
        raise
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    except Exception as e:
        from promptpres_shared.llm_client import LLMError
        if isinstance(e, LLMError):
            raise HTTPException(502, f"{e} — กรุณาเพิ่มหัวข้อเอง") from None
        raise HTTPException(502, "ดึงหัวข้อจาก PDF ไม่สำเร็จ กรุณาเพิ่มหัวข้อเอง") from None
    finally:
        if not saved:
            path.unlink(missing_ok=True)
    # note: e.g. "the LLM suggested 12 topics, 5-8 recommended" - the draft is kept, the user trims it in the editor
    return {"topics": draft["topics"], "note": draft.get("note"), "model": draft.get("model"),
            "prompt": draft.get("prompt")}


def suggest_topics(pdf: Path) -> dict:
    """promptpres_shared.topics.suggest_topics (PyMuPDF + OpenRouter); imported only when used."""
    from promptpres_shared.topics import suggest_topics as suggest
    return suggest(pdf)


@app.put("/api/sessions/{session_id}/topics")
def confirm_topics(request: Request, session_id: str, body: TopicsIn) -> dict:
    """The user's final list, in their order: ids H01.. and order 1..n are assigned here."""
    s = _session_or_404(session_id, request)
    _editable_or_409(s)
    limits = topic_limits()
    least, most = limits["min"], limits["max"]
    titles = [t.title.strip() for t in body.topics]
    if not least <= len(titles) <= most:
        raise HTTPException(422, f"ต้องมีหัวข้อ {least}–{most} หัวข้อ (ตอนนี้ {len(titles)})")
    if any(not t for t in titles):
        raise HTTPException(422, "ชื่อหัวข้อต้องไม่ว่าง")
    if len({"".join(t.split()).lower() for t in titles}) != len(titles):
        raise HTTPException(422, "มีชื่อหัวข้อซ้ำกัน")
    topics = [{"id": f"H{i:02d}", "title": t.title.strip(), "order": i, "key_point": t.key_point.strip()}
              for i, t in enumerate(body.topics, start=1)]
    suggested = store.latest_topics(session_id, "suggested")
    store.add_topics(session_id, "confirmed", "pdf" if suggested else "manual", topics,
                     suggested["model"] if suggested else None, suggested["prompt"] if suggested else None)
    return _session_view(_session_or_404(session_id, request))


@app.post("/api/sessions/{session_id}/video")
async def upload_video(request: Request, session_id: str, video: UploadFile = File(...)) -> dict:
    """Save the rehearsal video and put the session in the analysis queue."""
    s = await run_in_threadpool(_session_or_404, session_id, request)
    _editable_or_409(s)
    ext = Path(video.filename or "").suffix.lower() or ".webm"
    if ext not in VIDEO_TYPES:
        raise HTTPException(422, "รองรับเฉพาะไฟล์ .mp4 .webm .mov")
    await run_in_threadpool(lambda: check_queue(request, ticket=True))
    path = await run_in_threadpool(save_upload, video.file, UPLOAD_DIR / session_id, ext, VIDEO_BYTES)
    return await queue_video(request, session_id, path)


async def queue_video(request: Request, session_id: str, path: Path) -> dict:
    """Saved video -> where the worker reads it -> queued -> analysis requested (one-request and chunked uploads)."""
    try:
        holder = await run_in_threadpool(lambda: check_queue(request, ticket=False, hold=True))
    except HTTPException:
        path.unlink(missing_ok=True)
        raise
    try:          # the place stays held from the check until the round is committed to the queue (D-063)
        stored = Path(await run_in_threadpool(storage.publish_upload, path, session_id))
        try:
            await run_in_threadpool(store.enqueue, session_id, stored)
        except store.SessionLocked:
            stored.unlink(missing_ok=True)
            raise
        except Exception:
            # If a connection failed during commit, do not delete the winning file.
            saved = await run_in_threadpool(store.get_session, session_id)
            if not saved or store.abs_path(saved["video_path"]) != stored.resolve():
                stored.unlink(missing_ok=True)
            raise
    finally:
        release(holder)
    try:
        await run_in_threadpool(storage.dispatch, session_id)
    except Exception as error:   # noqa: BLE001 — the session stays queued; the maintenance job sends it again
        print(f"[api] dispatch {session_id} failed: {type(error).__name__}", flush=True)
    return await run_in_threadpool(_session_view, await run_in_threadpool(_session_or_404, session_id, request))


@app.get("/api/sessions/{session_id}/result", response_model=Result)
def get_result(request: Request, session_id: str) -> Result:
    mocks = _load_mocks()
    if session_id in mocks:
        return mocks[session_id]
    s = _session_or_404(session_id, request)
    if s["status"] == "created":
        raise HTTPException(409, "ยังไม่ได้ส่งวิดีโอสำหรับรอบซ้อมนี้")
    if s["status"] == "done":
        stored = store.get_result(session_id)
        if stored:
            result = validate_result(stored)
            return result.model_copy(update={"video_url": video_link(request, session_id, result.video_url)})
    failed = s["status"] == "failed"
    return Result(
        contract_version=CONTRACT_VERSION, session_id=session_id,
        status="failed" if failed else s["status"], created_at=s["created_at"], duration_s=None,
        target_duration_s=s["target_duration_s"], video_url=video_link(request, session_id, f"/api/media/{session_id}"),
        versions={"rubric": None, "asr": None, "llm": None, "prompt": None, "config": None},
        criteria=[], topics=[], coach=None,
        error=(s["error_message"] or "วิเคราะห์ไม่สำเร็จ") if failed else None,
    )


def video_link(request: Request, session_id: str, url: str | None) -> str | None:
    """The player URL. With a separate API address (D-062) the video comes straight from it with a signed,
    time-limited link (a <video> tag cannot send the login cookie there); otherwise the stored relative URL."""
    if not url or not direct_origin():
        return url
    ttl = storage_config()["media"]["link_ttl_s"]
    return f"{direct_origin()}/api/media/{session_id}?t={grant('media', session_id, owner(request), ttl)}"


@app.get("/api/sessions/{session_id}/metadata")
def result_metadata(request: Request, session_id: str) -> dict:
    session = _session_or_404(session_id, request)
    if session["status"] != "done":
        return {"criteria": None, "feedback": None}
    result = store.get_result(session_id)
    if not result:
        return {"criteria": None, "feedback": None}
    try:
        snapshot = _run_json(session_id, "snapshot.json")
        if snapshot["config"] == result["versions"]["config"]:
            return {"criteria": _criteria_rows(snapshot["thresholds"]["criteria"]),
                    "feedback": snapshot["feedback"]}
    except (OSError, ValueError, TypeError, KeyError):
        pass
    return {"criteria": None, "feedback": None}


class TranscriptItem(BaseModel):
    start_s: float
    end_s: float
    text: str
    is_filler: bool
    pause_after_s: Optional[float]


def _run_json(session_id: str, name: str):
    """A worker output file of this run, or None when it is missing or unreadable."""
    path = storage.run_file(RUNS_DIR, session_id, name)
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path else None
    except (OSError, ValueError):
        return None


@app.get("/api/sessions/{session_id}/transcript", response_model=list[TranscriptItem])
def transcript(request: Request, session_id: str) -> list[dict]:
    """Timed phrases for the interactive transcript (D-046): fillers flagged (S3), long pauses (S2) attached.

    Reads transcript.json, fillers.json and vad.json the worker wrote; anything missing -> [] (never 500).
    Mock sessions have no run folder -> [].
    """
    if session_id in _load_mocks():
        return []
    _session_or_404(session_id, request)          # ownership first: other Pilot users get 404
    try:
        words = _run_json(session_id, "transcript.json")["words"]
        snapshot = _run_json(session_id, "snapshot.json") or {}
        criteria = (snapshot.get("thresholds") or thresholds())["criteria"]   # the pause rule S2 used
        view = pipeline_config()["transcript_view"]
        fillers = _run_json(session_id, "fillers.json")
        vad = _run_json(session_id, "vad.json") or {}
        return build_transcript(words, fillers if isinstance(fillers, dict) else None, vad.get("segments") or [],
                                float(criteria["S2"]["pause_min_s"]), float(view["gap_s"]), float(view["max_s"]))
    except (KeyError, TypeError, ValueError, AttributeError):
        return []


@app.get("/api/media/{session_id}")
def media(request: Request, session_id: str) -> FileResponse:
    """The small playback copy (cloud, D-062) or the prepared H.264 copy once the worker made it (both seek
    well), else the uploaded file."""
    s = store.get_session(session_id, owner(request))
    if s is not None:
        for name in ("playback.mp4", "media.mp4"):
            prepared = storage.run_file(RUNS_DIR, session_id, name)
            if prepared:
                return FileResponse(prepared, media_type="video/mp4")
        if PILOT:
            raise HTTPException(404, "ยังไม่มีวิดีโอที่ตรวจสอบแล้ว")
        original = store.abs_path(s["video_path"])
        if original and original.exists():
            return FileResponse(original)
        raise HTTPException(404, "ยังไม่มีไฟล์วิดีโอ")
    if session_id in _load_mocks() and MOCK_VIDEO and Path(MOCK_VIDEO).exists():
        return FileResponse(MOCK_VIDEO, media_type="video/mp4")
    raise HTTPException(404, "no video for this session (set PROMPTPRES_MOCK_VIDEO for mocks)")


dist = REPO / "web" / "dist"
if dist.is_dir():
    app.mount("/assets", StaticFiles(directory=dist / "assets", check_dir=False), name="static")

    @app.get("/", include_in_schema=False)
    @app.get("/login", include_in_schema=False)
    @app.get("/new", include_in_schema=False)
    @app.get("/sessions/{web_path:path}", include_in_schema=False)
    def web_app(web_path: str = ""):
        return FileResponse(dist / "index.html")
