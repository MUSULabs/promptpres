"""Start one API and GPU worker on the Windows pilot host, or delete a pilot round offline."""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def remove_round(session_id):
    from promptpres_shared import store
    from promptpres_shared.process_lock import runner_lock
    from promptpres_shared.settings import data_root
    from sqlalchemy import select

    if not re.fullmatch(r"s_[a-f0-9]{10}|s_[a-f0-9]{30}", session_id):
        raise SystemExit("Invalid session ID")
    root = data_root().resolve()
    with runner_lock(root), runner_lock(root / "runs"):
        with store.engine().begin() as db:
            stmt = select(store.sessions.c.session_id).where(store.sessions.c.session_id == session_id)
            if db.scalar(stmt) is None:
                raise SystemExit("Pilot session not found")
            for category in ("uploads", "runs"):
                folder = root / category / session_id
                if folder.exists():
                    if folder.resolve() != folder:
                        raise SystemExit("Unexpected storage path")
                    shutil.rmtree(folder)
            db.exec_driver_sql("PRAGMA secure_delete=ON")
            for table in (store.results, store.topics_versions, store.sessions):
                db.execute(table.delete().where(table.c.session_id == session_id))
        with store.engine().connect() as db:
            db.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")
    print("Pilot round removed. Apply the same retention policy to any exported copies or backups.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--delete-round", metavar="SESSION_ID", help="stop Pilot before deleting")
    args = parser.parse_args()
    os.environ["PROMPTPRES_MODE"] = "pilot"
    if args.delete_round:
        return remove_round(args.delete_round)
    from api.app.boundary import pilot_config
    from promptpres_shared.process_lock import runner_lock
    from promptpres_shared.settings import data_root

    pilot_config()
    if not (ROOT / "web" / "dist" / "index.html").is_file():
        raise SystemExit("Build web/dist before starting Pilot")
    with runner_lock(data_root()):
        procs = []
        try:
            procs.append(subprocess.Popen([sys.executable, "-m", "uvicorn", "api.app.main:app",
                                           "--host", "127.0.0.1", "--port", "8000", "--no-proxy-headers",
                                           "--no-access-log"], cwd=ROOT))
            procs.append(subprocess.Popen([sys.executable, "-m", "worker.runner"], cwd=ROOT))
            import time
            while all(p.poll() is None for p in procs):
                time.sleep(0.5)
            raise SystemExit("A Pilot process stopped")
        except KeyboardInterrupt:
            pass
        finally:
            for process in procs:
                if process.poll() is None:
                    process.terminate()
            for process in procs:
                process.wait()


if __name__ == "__main__":
    main()
