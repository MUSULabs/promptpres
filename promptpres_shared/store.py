"""Sessions, topic lists, results and the analysis queue in one database (shared by the API and worker.runner).

- DATABASE_URL picks the database: unset = SQLite file data/promptpres.db (local `python dev.py`),
  postgresql://... = PostgreSQL (docker compose). Same code for both (SQLAlchemy Core).
- The queue is the sessions table itself: the API sets status 'queued'; worker.runner takes the oldest
  with claim_next() (one atomic UPDATE, so two runners can never take the same session).
- Status: created (waiting for topics / video) -> queued -> processing -> done | failed
- File paths are stored relative to the repo so the API container and the host worker agree.

ฐานข้อมูลเดียวกันใช้ทั้งฝั่ง API และ worker: ตาราง sessions เป็นทั้งข้อมูลรอบซ้อมและคิวงาน
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import (Column, Float, ForeignKey, Integer, MetaData, String, Table, Text, create_engine, event,
                        func, insert, select, update)
from sqlalchemy.engine import Engine
from promptpres_shared.settings import data_root, pilot_mode

REPO = Path(os.environ.get("PROMPTPRES_ROOT", Path(__file__).resolve().parents[1]))


meta = MetaData()
users = Table(
    "users", meta,
    Column("id", Text, primary_key=True),
    Column("email", Text, unique=True, nullable=False),
    Column("display_name", Text, nullable=False),
    Column("password_hash", Text, nullable=False),
    Column("created_at", Text, nullable=False),
)
auth_sessions = Table(
    "auth_sessions", meta,
    Column("token_hash", String(64), primary_key=True),
    Column("user_id", Text, ForeignKey("users.id"), nullable=False),
    Column("expires_at", Float, nullable=False),
    Column("is_guest", Integer, nullable=False, default=0),
)
sessions = Table(
    "sessions", meta,
    Column("session_id", String(32), primary_key=True),
    Column("owner_id", String(64)),
    Column("settings_json", Text),
    Column("status", String(16), nullable=False, default="created"),
    Column("target_duration_s", Float, nullable=False),
    Column("video_path", Text),            # relative to REPO
    Column("pdf_path", Text),              # relative to REPO
    Column("created_at", String(40), nullable=False),
    Column("queued_at", String(40)),
    Column("started_at", String(40)),
    Column("finished_at", String(40)),
    Column("attempts", Integer, nullable=False, default=0),
    Column("error_message", Text),
)
topics_versions = Table(
    "topics_versions", meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("session_id", String(32), ForeignKey("sessions.session_id"), nullable=False, index=True),
    Column("kind", String(16), nullable=False),       # suggested (from the PDF) | confirmed (by the user)
    Column("source", String(16), nullable=False),     # pdf | manual
    Column("topics_json", Text, nullable=False),
    Column("model", String(120)),
    Column("prompt", String(60)),
    Column("created_at", String(40), nullable=False),
)
results = Table(
    "results", meta,
    Column("session_id", String(32), ForeignKey("sessions.session_id"), primary_key=True),
    Column("result_json", Text, nullable=False),
    Column("created_at", String(40), nullable=False),
)

_engine: Engine | None = None


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url or pilot_mode():
        db = data_root() / "promptpres.db"
        db.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{db.as_posix()}"
    for prefix in ("postgresql://", "postgres://"):      # Supabase and most hosts hand out either form
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


TRANSACTION_POOLER_PORT = 6543      # Supabase Supavisor transaction mode: no prepared statements, no client pool


def postgres_options(url: str) -> dict:
    """create_engine() options for PostgreSQL (D-062).

    Session pooler / direct connection (port 5432): a small pool per process, because Supabase Free allows
    15 pooled connections per role and the web, GPU and maintenance containers share them.
    Transaction pooler (port 6543): no pool and psycopg prepared statements off, as Supabase requires.
    """
    from sqlalchemy.engine import make_url
    from sqlalchemy.pool import NullPool
    if make_url(url).port == TRANSACTION_POOLER_PORT:
        return {"poolclass": NullPool, "connect_args": {"prepare_threshold": None}}
    return {"pool_size": 3, "max_overflow": 2, "pool_pre_ping": True, "pool_recycle": 300}


def engine() -> Engine:
    """The shared engine (created on first use from DATABASE_URL, tables created if missing)."""
    global _engine
    if _engine is None:
        url = database_url()
        if url.startswith("sqlite"):
            _engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30},
                                    hide_parameters=True)

            @event.listens_for(_engine, "connect")
            def _sqlite_pragmas(conn, _record):      # readers and the runner do not block each other
                cur = conn.cursor()
                cur.execute("PRAGMA journal_mode=WAL")
                cur.execute("PRAGMA busy_timeout=30000")    # same as timeout=30: wait instead of "database is locked"
                cur.execute("PRAGMA foreign_keys=ON")
                cur.close()
        else:
            # hide_parameters: a failed statement is logged without its values (an email, a password hash)
            _engine = create_engine(url, hide_parameters=True, **postgres_options(url))
        from .migrations import migrate
        try:
            migrate(_engine, meta)
        except Exception:
            reset_engine()
            raise
    return _engine


def checkpoint() -> None:
    """SQLite only: fold the WAL into the database file before a shutdown, backup or Volume commit.
    Best effort — a busy database keeps its WAL and SQLite replays it on the next open."""
    if _engine is None or not str(_engine.url).startswith("sqlite"):
        return
    try:
        with _engine.connect() as c:
            c.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")
    except Exception:           # noqa: BLE001 — shutdown must not fail on a locked database
        pass


def reset_engine() -> None:
    """Forget the engine (tests switch DATABASE_URL between cases)."""
    global _engine
    if _engine is not None:
        _engine.dispose()
    _engine = None


def rel(path: Path) -> str:
    """Path stored in the database: relative to REPO when possible."""
    p = Path(path).resolve()
    try:
        return p.relative_to(REPO.resolve()).as_posix()
    except ValueError:
        return p.as_posix()


def abs_path(stored: str | None) -> Path | None:
    if not stored:
        return None
    p = Path(stored)
    return p if p.is_absolute() else REPO / p


# --------------------------------------------------------------------------- sessions
def create_session(target_duration_s: float, owner_id: str | None = None) -> dict:
    sid = "s_" + uuid.uuid4().hex[:30]
    with engine().begin() as c:
        c.execute(insert(sessions).values(session_id=sid, status="created", owner_id=None if owner_id == "__anonymous__" else owner_id, target_duration_s=float(target_duration_s),
                                          created_at=now(), attempts=0))
    return get_session(sid)


def get_session(session_id: str, owner_id: str | None = None) -> dict | None:
    with engine().connect() as c:
        stmt = select(sessions).where(sessions.c.session_id == session_id)
        if owner_id is not None:
            stmt = stmt.where(sessions.c.owner_id.is_(None) if owner_id == "__anonymous__" else sessions.c.owner_id == owner_id)
        row = c.execute(stmt).mappings().first()
    return dict(row) if row else None


def list_sessions(owner_id: str | None = None) -> list[dict]:
    """One statement for history: latest confirmed topics, stored duration and, for finished sessions,
    each card's level and values (D-046 trend panel; no total across criteria)."""
    latest = (select(topics_versions.c.topics_json)
              .where(topics_versions.c.session_id == sessions.c.session_id,
                     topics_versions.c.kind == "confirmed")
              .order_by(topics_versions.c.id.desc()).limit(1).scalar_subquery())
    stmt = (select(sessions.c.session_id, sessions.c.status, sessions.c.created_at, sessions.c.target_duration_s,
                   latest.label("confirmed_json"), results.c.result_json)
            .outerjoin(results, results.c.session_id == sessions.c.session_id)
            .order_by(sessions.c.created_at.desc()))
    if owner_id is not None:
        stmt = stmt.where(sessions.c.owner_id.is_(None) if owner_id == "__anonymous__" else sessions.c.owner_id == owner_id)
    with engine().connect() as c:
        rows = [dict(r) for r in c.execute(stmt).mappings()]
    for row in rows:
        row["topics_count"] = len(json.loads(row.pop("confirmed_json") or "[]"))
        result = json.loads(row.pop("result_json") or "null") or {}
        row["duration_s"] = result.get("duration_s")
        row |= result_summary(result) if row["status"] == "done" else {"levels": None, "values": None,
                                                                        "rubric_version": None}
    return rows


def result_summary(result: dict) -> dict:
    """Per-criterion level (None = unanalyzable) and measured values of one result, plus its rubric version."""
    cards = result.get("criteria") or []
    return {"levels": {c["code"]: c.get("level") for c in cards},
            "values": {c["code"]: c.get("values") or {} for c in cards},
            "rubric_version": (result.get("versions") or {}).get("rubric")}


class SessionLocked(RuntimeError):
    """The session no longer accepts edits."""


def _edit_created(connection, session_id: str, **values) -> None:
    stmt = update(sessions).where(sessions.c.session_id == session_id, sessions.c.status == "created")
    if connection.execute(stmt.values(**(values or {"status": "created"}))).rowcount != 1:
        raise SessionLocked


def edit_created(session_id: str, **values) -> None:
    with engine().begin() as c:
        _edit_created(c, session_id, **values)


def update_session(session_id: str, **values) -> None:
    with engine().begin() as c:
        c.execute(update(sessions).where(sessions.c.session_id == session_id).values(**values))


# --------------------------------------------------------------------------- topics
def add_topics(session_id: str, kind: str, source: str, topics: list[dict],
               model: str | None = None, prompt: str | None = None, *, pdf_path: Path | None = None) -> None:
    with engine().begin() as c:
        _edit_created(c, session_id, **({"pdf_path": rel(pdf_path)} if pdf_path else {}))
        c.execute(insert(topics_versions).values(session_id=session_id, kind=kind, source=source,
                                                 topics_json=json.dumps(topics, ensure_ascii=False),
                                                 model=model, prompt=prompt, created_at=now()))


def latest_topics(session_id: str, kind: str) -> dict | None:
    """Newest topic version of one kind: {topics, source, model, prompt, created_at} or None."""
    with engine().connect() as c:
        row = c.execute(select(topics_versions).where(topics_versions.c.session_id == session_id,
                                                      topics_versions.c.kind == kind)
                        .order_by(topics_versions.c.id.desc()).limit(1)).mappings().first()
    if not row:
        return None
    return _topic_version(row)


def session_topics(session_id: str) -> dict[str, dict]:
    """Latest confirmed and suggested versions in one query; older drafts are not loaded."""
    ranked = select(
        topics_versions.c.kind, topics_versions.c.topics_json, topics_versions.c.source,
        topics_versions.c.model, topics_versions.c.prompt, topics_versions.c.created_at,
        func.row_number().over(partition_by=topics_versions.c.kind, order_by=topics_versions.c.id.desc()).label("rank"),
    ).where(topics_versions.c.session_id == session_id,
            topics_versions.c.kind.in_(("confirmed", "suggested"))).subquery()
    with engine().connect() as connection:
        rows = connection.execute(select(ranked).where(ranked.c.rank == 1)).mappings()
        return {row["kind"]: _topic_version(row) for row in rows}


def _topic_version(row) -> dict:
    return {"topics": json.loads(row["topics_json"]), "source": row["source"], "model": row["model"],
            "prompt": row["prompt"], "created_at": row["created_at"]}


# --------------------------------------------------------------------------- queue
def enqueue(session_id: str, video_path: Path) -> None:
    from .settings import analysis_settings

    edit_created(session_id, video_path=rel(video_path), status="queued", queued_at=now(),
                 error_message=None, settings_json=json.dumps(analysis_settings(), ensure_ascii=False))


def claim_next() -> dict | None:
    """Take the oldest queued session: one UPDATE ... WHERE status='queued', so only one runner wins it."""
    with engine().begin() as c:
        sid = c.execute(select(sessions.c.session_id).where(sessions.c.status == "queued")
                        .order_by(sessions.c.queued_at, sessions.c.created_at).limit(1)).scalar()
        if sid is None:
            return None
        won = c.execute(update(sessions).where(sessions.c.session_id == sid, sessions.c.status == "queued")
                        .values(status="processing", started_at=now(), attempts=sessions.c.attempts + 1)).rowcount
    return get_session(sid) if won == 1 else None


def finish(session_id: str, result: dict) -> None:
    """Store a Result (status done) and mark the session done."""
    with engine().begin() as c:
        c.execute(results.delete().where(results.c.session_id == session_id))
        c.execute(insert(results).values(session_id=session_id, created_at=now(),
                                         result_json=json.dumps(result, ensure_ascii=False)))
        c.execute(update(sessions).where(sessions.c.session_id == session_id)
                  .values(status="done", finished_at=now(), error_message=None))


def fail(session_id: str, message: str) -> None:
    """Mark the session failed with a Thai message the user can read."""
    update_session(session_id, status="failed", finished_at=now(), error_message=message)


def get_result(session_id: str) -> dict | None:
    with engine().connect() as c:
        row = c.execute(select(results.c.result_json).where(results.c.session_id == session_id)).first()
    return json.loads(row[0]) if row else None


INTERRUPTED = "การวิเคราะห์ถูกขัดจังหวะซ้ำ กรุณาส่งวิดีโอใหม่"


def claim(session_id: str) -> dict | None:
    """Cloud worker (D-062): take this one queued session (same atomic UPDATE as claim_next)."""
    with engine().begin() as c:
        won = c.execute(update(sessions).where(sessions.c.session_id == session_id, sessions.c.status == "queued")
                        .values(status="processing", started_at=now(), attempts=sessions.c.attempts + 1)).rowcount
    return get_session(session_id) if won == 1 else None


def requeue(session_id: str) -> bool:
    """Put a session the stopping worker was analysing back in the queue (pre-emption, D-062)."""
    with engine().begin() as c:
        return c.execute(update(sessions).where(sessions.c.session_id == session_id,
                                                sessions.c.status == "processing")
                         .values(status="queued", queued_at=now(), started_at=None)).rowcount == 1


def ping() -> None:
    """One cheap query: the maintenance job keeps the free Supabase project active with it."""
    with engine().connect() as c:
        c.exec_driver_sql("SELECT 1")


def _ago(seconds: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat(timespec="seconds")


def sweep(stale_after_s: float, lost_after_s: float, max_attempts: int) -> dict:
    """Time-based queue repair for several worker containers (D-062; recover_stuck stays for one local runner).

    - processing longer than stale_after_s (the worker died without its exit handler): back to the queue,
      or failed after max_attempts
    - queued longer than lost_after_s: returned as `lost` so the caller sends the job again
    Timestamps are ISO-8601 UTC strings of one fixed format, so string order is time order.
    """
    stale_before, lost_before = _ago(stale_after_s), _ago(lost_after_s)
    with engine().begin() as c:
        stuck = c.execute(select(sessions.c.session_id, sessions.c.attempts)
                          .where(sessions.c.status == "processing", sessions.c.started_at < stale_before)).all()
        requeued, failed = [], []
        for sid, attempts in stuck:
            if attempts < max_attempts:
                c.execute(update(sessions).where(sessions.c.session_id == sid, sessions.c.status == "processing")
                          .values(status="queued", queued_at=now(), started_at=None))
                requeued.append(sid)
            else:
                c.execute(update(sessions).where(sessions.c.session_id == sid, sessions.c.status == "processing")
                          .values(status="failed", finished_at=now(), error_message=INTERRUPTED))
                failed.append(sid)
        lost = c.execute(select(sessions.c.session_id)
                         .where(sessions.c.status == "queued", sessions.c.queued_at < lost_before)).scalars().all()
    return {"requeued": requeued, "failed": failed, "lost": [s for s in lost if s not in requeued]}


def queue_load(owner_id: str | None, day_s: float = 86400) -> dict:
    """Numbers the upload guard checks before a video joins the queue (D-063): rounds of this owner and of
    everyone that are queued or processing now, and rounds sent for analysis in the last day_s seconds."""
    active = sessions.c.status.in_(("queued", "processing"))
    mine = sessions.c.owner_id.is_(None) if owner_id in (None, "__anonymous__") else sessions.c.owner_id == owner_id
    with engine().connect() as c:
        row = c.execute(select(
            func.count().filter(active & mine), func.count().filter(active),
            func.count().filter(sessions.c.queued_at >= _ago(day_s)))).one()
    return {"owner_active": row[0], "active": row[1], "today": row[2]}


def pdf_reads(day_s: float = 86400) -> int:
    """Report PDFs the LLM turned into draft topics in the last day_s seconds, all users (PDF guard, D-066)."""
    with engine().connect() as c:
        return c.execute(select(func.count()).select_from(topics_versions).where(
            topics_versions.c.kind == "suggested", topics_versions.c.created_at >= _ago(day_s))).scalar_one()


def is_member(owner_id: str | None) -> bool:
    """Registered accounts have ids u_...; Guests (g_...), legacy browser owners and anonymous rounds do not."""
    return bool(owner_id) and owner_id.startswith("u_")


def expired_videos(guest_days: float, member_days: float, window_days: float) -> list[dict]:
    """Finished sessions whose video files are past retention (D-062): Guest rounds after guest_days,
    member rounds after member_days. Only sessions that crossed the line in the last window_days are
    returned, so the job stays small and simply repeats a deletion that has already happened."""
    rows = []
    with engine().connect() as c:
        for member, days in ((False, guest_days), (True, member_days)):
            found = c.execute(select(sessions.c.session_id, sessions.c.owner_id, sessions.c.video_path)
                              .where(sessions.c.status.in_(("done", "failed")),
                                     sessions.c.finished_at < _ago(days * 86400),
                                     sessions.c.finished_at >= _ago((days + window_days) * 86400))).mappings()
            rows += [dict(r) for r in found if is_member(r["owner_id"]) == member]
    return rows


def failed_uploads(days: float, window_days: float) -> list[dict]:
    """Failed sessions older than `days` (inside the same moving window): their raw upload can go (D-062)."""
    with engine().connect() as c:
        rows = c.execute(select(sessions.c.session_id, sessions.c.video_path)
                         .where(sessions.c.status == "failed", sessions.c.video_path.is_not(None),
                                sessions.c.finished_at < _ago(days * 86400),
                                sessions.c.finished_at >= _ago((days + window_days) * 86400))).mappings()
        return [dict(r) for r in rows]


def recover_stuck(max_attempts: int) -> dict:
    """Sessions left in 'processing' by a runner that stopped: back to the queue, or failed after max_attempts.

    Called when worker.runner starts, so the queue never waits forever on a dead job.
    """
    with engine().begin() as c:
        stuck = c.execute(select(sessions.c.session_id, sessions.c.attempts)
                          .where(sessions.c.status == "processing")).all()
        requeued, failed = [], []
        for sid, attempts in stuck:
            if attempts < max_attempts:
                c.execute(update(sessions).where(sessions.c.session_id == sid)
                          .values(status="queued", queued_at=now(), started_at=None))
                requeued.append(sid)
            else:
                c.execute(update(sessions).where(sessions.c.session_id == sid)
                          .values(status="failed", finished_at=now(), error_message=INTERRUPTED))
                failed.append(sid)
    return {"requeued": requeued, "failed": failed}
