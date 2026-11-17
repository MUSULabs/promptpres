"""Local API for browser regressions; no repository DB, worker, or external service."""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import uvicorn
from fastapi import HTTPException
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles

REPO = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(REPO), str(REPO / "api")]


def fixture_result(session_id: str, partial: bool, target: float):
    result = json.loads((REPO / "contracts/mocks/result_ok.json").read_text(encoding="utf-8"))
    result.update(session_id=session_id, created_at=datetime.now(timezone.utc).isoformat(),
                  duration_s=5.0, target_duration_s=target, video_url=f"/api/media/{session_id}")
    result["versions"]["rubric"] = "v0.7"
    for card in result["criteria"]:
        for evidence in card["evidence"]:
            evidence.update(start_s=2.0, end_s=3.0)
        if card["code"] == "T1":
            card["values"]["speech_span_s"] = 3.0
        if partial and card["code"] == "C2":
            card.update(status="unanalyzable", level=None, feedback_id=None, reason="หลักฐานไม่พอ")
    for topic in result["topics"]:
        if topic["first_mention_s"] is not None:
            topic["first_mention_s"] = 2.0
    # D-046 coach: every cited time matches the 2-3 s evidence above (both [m:ss] and [mm:ss] forms)
    result["coach"] = {"status": "ok", "hidden_count": 0, "items": [
        {"kind": "strength", "code": "S1", "text": "ความเร็วการพูดอยู่ในช่วงแนะนำตลอด", "cite_s": []},
        {"kind": "focus", "code": "N1", "text": "มือนิ่งค้างที่ [0:02] ลองใช้มือชี้สไลด์", "cite_s": [2.0]},
        {"kind": "focus", "code": "S2", "text": "หยุดเงียบที่ [00:02] เตรียมประโยคเชื่อมไว้", "cite_s": [2.0]},
        {"kind": "plan", "code": None, "text": "ซ้อมช่วงเปลี่ยนหัวข้ออีก 2 รอบ", "cite_s": []}]}
    return result


# Transcript files the worker would write: "สวัสดี" / filler "เอ่อ" / "ครับ" / 2.1 s silence / "ต่อไป"
def piece(text, start, end):
    return {"word": text, "start_s": start, "end_s": end, "probability": 0.9}


TRANSCRIPT = {"words": [piece("สวัส", 0.2, 0.6), piece("ดี", 0.6, 0.9), piece("เอ่อ", 1.0, 1.4),
                        piece("ครับ", 2.0, 2.4), piece("ต่อ", 4.6, 4.75), piece("ไป", 4.75, 4.9)]}
FILLERS = {"text": [{"start_s": 1.0, "end_s": 1.4, "text": "เอ่อ", "words": [2], "source": "text"}],
           "acoustic": [], "count_acoustic": False}
VAD = {"segments": [{"start_s": 0.1, "end_s": 2.5}, {"start_s": 4.6, "end_s": 4.95}]}


def change_rubric(session_id: str, version: str = "v0.9"):
    from promptpres_shared import store
    result = store.get_result(session_id)
    result["versions"]["rubric"] = version
    store.finish(session_id, result)
    return {}


def set_environment(root: Path, port: int, login: bool):
    if login:   # cloud mode: /api/sessions needs an account or a Guest (web/tests/auth-required.spec.ts)
        os.environ.update(PROMPTPRES_REQUIRE_LOGIN="1", PROMPTPRES_PUBLIC_ORIGIN=f"http://127.0.0.1:{port}",
                          PROMPTPRES_SESSION_SECRET="browser-test-secret-not-for-real-use-0123456789")
    else:
        os.environ.update(PROMPTPRES_REQUIRE_LOGIN="0")
    os.environ.update(DATABASE_URL=f"sqlite:///{(root / 'browser.db').as_posix()}",
                      PROMPTPRES_MODE="dev", PROMPTPRES_UPLOADS=str(root / "uploads"),
                      PROMPTPRES_RUNS=str(root / "runs"), PROMPTPRES_MOCK_VIDEO="",
                      OPENROUTER_API_KEY="")


def serve(root: Path, port: int = 18370, login: bool = False):
    set_environment(root, port, login)
    from app import main
    from promptpres_shared import store
    from promptpres_shared.json_files import atomic_json
    from promptpres_shared.settings import analysis_settings, tool

    main.MOCK_DIR = root / "no-mocks"
    dist = REPO / "web" / "dist"
    main.app.mount("/assets", StaticFiles(directory=dist / "assets"), name="test-assets")
    clip = root / "test.webm"
    subprocess.run([tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                    "testsrc2=size=160x90:rate=15:duration=5", "-c:v", "libvpx", str(clip)], check=True)

    @main.app.get("/browser-test/clip", include_in_schema=False)
    def sample_clip():
        return main.FileResponse(clip, media_type="video/webm")

    @main.app.get("/browser-test/ready", include_in_schema=False)
    def ready():
        return PlainTextResponse(os.environ["PROMPTPRES_BROWSER_TEST_INSTANCE"])

    @main.app.post("/browser-test/{session_id}/{action}", include_in_schema=False)
    def set_test_state(session_id: str, action: str):
        row = store.get_session(session_id)
        if row is None:
            raise HTTPException(404)
        if action == "processing" and row["status"] == "queued":
            store.update_session(session_id, status="processing")
        elif action in {"done", "partial"} and row["status"] == "processing":
            save_result(session_id, action == "partial", row["target_duration_s"])
        else:
            raise HTTPException(409)
        return {}

    main.app.add_api_route("/browser-rubric/{session_id}", change_rubric, methods=["POST"])

    def save_result(session_id: str, partial: bool, target: float):
        result = fixture_result(session_id, partial, target)
        run = main.RUNS_DIR / session_id
        run.mkdir(parents=True)
        # In dev mode the real media endpoint falls back to the uploaded file.
        atomic_json(run / "snapshot.json", {"config": result["versions"]["config"], **analysis_settings()})
        atomic_json(run / "transcript.json", TRANSCRIPT)
        atomic_json(run / "fillers.json", FILLERS)
        atomic_json(run / "vad.json", VAD)
        store.finish(session_id, result)

    @main.app.get("/{path:path}", include_in_schema=False)
    def serve_web(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404)
        return main.FileResponse(dist / "index.html")

    uvicorn.run(main.app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    serve(Path(sys.argv[1]), int(sys.argv[2]) if len(sys.argv) > 2 else 18370, "login" in sys.argv[3:])
