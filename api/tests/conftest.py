"""Every API test gets its own empty SQLite database and upload/run folders (never the real data/)."""
import pytest

import app.main as main
from app import store


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{(tmp_path / 'test.db').as_posix()}")
    store.reset_engine()
    monkeypatch.setattr(main, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(main, "RUNS_DIR", tmp_path / "runs")
    yield tmp_path
    store.reset_engine()
