"""Run the whole system locally without Docker:  python dev.py

Starts three processes (Ctrl+C stops all of them):
  1. API     uvicorn api.app.main:app  http://127.0.0.1:8000/docs
  2. web     vite dev server           http://localhost:5173   (open this one)
  3. worker  python -m worker.runner   analyses queued sessions one at a time (GPU if available)
Database: SQLite file data/promptpres.db unless DATABASE_URL is set. Uploads: data/uploads, results: data/runs.
Requires: pip install -r api/requirements.txt -r worker/requirements.txt, npm install (in web/), FFmpeg,
models in models/ and OPENROUTER_API_KEY / OPENROUTER_MODEL in .env (for PDF topics and C2).
Optional: PROMPTPRES_MOCK_VIDEO = any local mp4 so the example (mock) result pages have a video.
    python dev.py --no-worker      # API + web only (e.g. on a machine without the models)
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
npm = shutil.which("npm") or "npm"
procs = [
    subprocess.Popen([sys.executable, "-m", "uvicorn", "api.app.main:app", "--reload", "--port", "8000"], cwd=ROOT),
    subprocess.Popen([npm, "run", "dev"], cwd=ROOT / "web", shell=os.name == "nt"),
]
if "--no-worker" not in sys.argv:
    procs.append(subprocess.Popen([sys.executable, "-m", "worker.runner"], cwd=ROOT))
print("web http://localhost:5173  ·  API http://127.0.0.1:8000/docs  ·  worker "
      + ("off" if "--no-worker" in sys.argv else "on") + "  (Ctrl+C to stop)")
try:
    for p in procs:
        p.wait()
except KeyboardInterrupt:
    pass
finally:
    for p in procs:
        p.terminate()
