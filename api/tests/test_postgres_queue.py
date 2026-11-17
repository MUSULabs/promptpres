"""PostgreSQL transaction test; only runs against an explicit scratch server."""
import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

from app import store
from promptpres_shared.migrations import RLS_TABLES


def test_postgres_queue_has_one_winner(tmp_path, monkeypatch):
    target = os.environ.get("PROMPTPRES_TEST_POSTGRES")
    if not target:
        pytest.skip("no scratch PostgreSQL configured")
    url = make_url(target).set(drivername="postgresql+psycopg")
    server = create_engine(url)
    schema = "pt_" + uuid4().hex
    with server.begin() as db:
        db.exec_driver_sql(f"CREATE SCHEMA {schema}")
    url = url.update_query_dict({"options": f"-csearch_path={schema}"})
    monkeypatch.setenv("DATABASE_URL", url.render_as_string(hide_password=False))

    def enqueue(i):
        try:
            store.enqueue(sid, tmp_path / f"{i}.mp4")
        except store.SessionLocked:
            return False
        return True

    try:
        sid = store.create_session(900, "P01")["session_id"]
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sum(pool.map(enqueue, (1, 2))) == 1
        assert store.claim_next()["session_id"] == sid
        assert store.claim_next() is None
        # D-062 cloud queue: requeue after pre-emption, claim by id, time-based sweep, row-level security
        assert store.requeue(sid) and store.claim(sid)["attempts"] == 2 and store.claim(sid) is None
        assert store.sweep(stale_after_s=3600, lost_after_s=1800, max_attempts=2) ==             {"requeued": [], "failed": [], "lost": []}
        store.ping()
        # D-063 upload guard counts (COUNT ... FILTER) on PostgreSQL: one processing round of P01, sent today
        assert store.queue_load("P01") == {"owner_active": 1, "active": 1, "today": 1}
        assert store.queue_load("P02")["owner_active"] == 0
        with store.engine().connect() as db:
            secured = dict(db.exec_driver_sql(
                "SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                f"WHERE n.nspname = '{schema}' AND c.relkind = 'r'").all())
            assert db.exec_driver_sql("SELECT MAX(version) FROM schema_versions").scalar() == 4
        assert secured == {table: True for table in RLS_TABLES}
    finally:
        store.reset_engine()
        with server.begin() as db:
            db.exec_driver_sql(f"DROP SCHEMA {schema} CASCADE")
        server.dispose()


def test_database_url_forms_and_pool_settings(monkeypatch):
    """Supabase hands out postgres:// or postgresql://; port 6543 (transaction pooler) gets no pool and no
    prepared statements, everything else a small pool (D-062)."""
    from sqlalchemy.pool import NullPool
    for given in ("postgres://u:p@h:5432/db", "postgresql://u:p@h:5432/db"):
        monkeypatch.setenv("DATABASE_URL", given)
        assert store.database_url() == "postgresql+psycopg://u:p@h:5432/db"
    session = store.postgres_options("postgresql+psycopg://u:p@aws-1-us-east-1.pooler.supabase.com:5432/postgres")
    assert session == {"pool_size": 3, "max_overflow": 2, "pool_pre_ping": True, "pool_recycle": 300}
    transaction = store.postgres_options("postgresql+psycopg://u:p@aws-1-us-east-1.pooler.supabase.com:6543/postgres")
    assert transaction == {"poolclass": NullPool, "connect_args": {"prepare_threshold": None}}
