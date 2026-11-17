"""Queue runner: take queued sessions from the database one at a time and analyse them with worker.pipeline.

ขั้นตอน
1. เริ่มทำงาน: store.recover_stuck() — session ที่ค้างสถานะ processing จาก runner รอบก่อนที่หยุดกลางคัน
   กลับเข้าคิว ถ้าลองไม่ถึง max_attempts ครั้ง; ครบแล้วเป็น failed พร้อมเหตุผล (คิวจึงไม่ค้างตลอดไป)
2. วนรอบ: store.claim_next() เอา session ที่รอนานที่สุด (UPDATE เดียว ไม่มีสอง runner ได้งานเดียวกัน)
   -> pipeline.run_session(วิดีโอ, หัวข้อที่ผู้ใช้ยืนยัน, เวลาเป้าหมาย) -> data/runs/<id>/result.json
   - ผลปกติ (status done)  -> store.finish(): เก็บ Result + video_url สำหรับเครื่องเล่นบนเว็บ
   - pipeline บอก failed (เช่นไฟล์วิดีโอเสีย) -> store.fail() ด้วยข้อความของ pipeline
   - เกิด exception -> store.fail("ระบบวิเคราะห์ขัดข้อง ...") ข้อความไทย; ชนิดข้อผิดพลาดเขียนลง
     data/runs/<id>/runner_error.txt สำหรับผู้พัฒนา ไม่แสดงต่อผู้ใช้
3. ไม่มีงาน -> รอ poll_s วินาทีแล้วดูใหม่

    python -m worker.runner            # run forever (python dev.py starts it)
    python -m worker.runner --once     # process what is queued now, then exit
config: pipeline-v0.yaml runner.poll_s, runner.max_attempts · database: DATABASE_URL (default SQLite file)
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path

from worker import pipeline
from promptpres_shared import store
from promptpres_shared.process_lock import runner_lock
from promptpres_shared.settings import RUNS_DIR, pipeline_config

CRASH = "ระบบวิเคราะห์ขัดข้อง ({}) กรุณาลองส่งวิดีโอใหม่อีกครั้ง"


def log(msg: str) -> None:
    print(f"[runner {time.strftime('%H:%M:%S')}] {msg}", flush=True)


def _int_levels(obj):
    """JSON turns the integer level keys of a thresholds `levels` map (4, 3, 2) into strings; turn them back."""
    if isinstance(obj, dict):
        return {key: ({int(k): _int_levels(v) for k, v in value.items()} if key == "levels" and isinstance(value, dict)
                      else _int_levels(value)) for key, value in obj.items()}
    if isinstance(obj, list):
        return [_int_levels(v) for v in obj]
    return obj


def queued_settings(settings_json: str | None) -> dict | None:
    """The analysis settings frozen at enqueue time (store.enqueue), exactly as config/ loaded them."""
    return _int_levels(json.loads(settings_json)) if settings_json else None


def process(session: dict, after_analysis=None) -> str:
    """Analyse one claimed session; always leaves it done or failed. Returns the final status.

    after_analysis(run_dir) (cloud worker, D-062) runs once result.json exists and before the result is
    stored, so the files the result page needs are in place when it first loads. Its failure never changes
    the scores: the session is still stored as done.
    """
    sid = session["session_id"]
    try:
        confirmed = store.latest_topics(sid, "confirmed")
        result = pipeline.run_session(store.abs_path(session["video_path"]), sid, session["target_duration_s"],
                                      run_root=RUNS_DIR, reuse=True, topics=confirmed,
                                      settings=queued_settings(session.get("settings_json")))
    except Exception as e:  # noqa: BLE001 — the session must end failed, never stay processing
        (RUNS_DIR / sid).mkdir(parents=True, exist_ok=True)
        (RUNS_DIR / sid / "runner_error.txt").write_text(type(e).__name__, encoding="utf-8")
        store.fail(sid, CRASH.format(type(e).__name__))
        return "failed"
    if result["status"] == "failed":
        store.fail(sid, result["error"] or CRASH.format("pipeline"))
        return "failed"
    if after_analysis is not None:
        try:
            after_analysis(RUNS_DIR / sid)
        except Exception as e:  # noqa: BLE001 — playback/copy problems must not lose the measured result
            log(f"{sid}: after-analysis step failed ({type(e).__name__}); result kept")
    store.finish(sid, result | {"video_url": f"/api/media/{sid}"})
    return "done"


# Files the cloud worker copies to storage after a run (D-062). The API reads snapshot/transcript/fillers/vad;
# the rest are kept for checking a result. media.mp4, audio.wav and landmarks.parquet are not kept.
KEEP_DONE = ("result.json", "snapshot.json", "timing.json", "prep.json", "vad.json", "transcript.json",
             "fillers.json", "topics.json", "coverage.json", "coach.json")
KEEP_FAILED = ("result.json", "timing.json", "runner_error.txt")


def run_one(session_id: str, *, fetch, publish, discard) -> str | None:
    """Cloud worker (D-062): analyse the one session the API dispatched, then tidy up.

    fetch(stored_path) -> local video path · publish(run_dir, names) copies kept files to storage ·
    discard(stored_path) deletes the raw upload. All three come from deploy_modal.py.
    1. claim the session (None if it is no longer queued: another worker has it, or it is finished)
    2. analyse with the unchanged pipeline (process); after result.json: playback.mp4 + kept files are published
    3. the raw upload is deleted once the session is done or finally failed; the local run folder always
    Returns the final status, or None when there was nothing to do.
    """
    from promptpres_shared.settings import storage_config
    from worker import prep

    max_attempts = pipeline_config()["runner"]["max_attempts"]
    session = store.claim(session_id)
    if session is None:
        return None
    stored = session["video_path"]
    if session["attempts"] > max_attempts:
        store.fail(session_id, store.INTERRUPTED)
        discard(stored)
        return "failed"
    run_dir, local = RUNS_DIR / session_id, None

    def keep_outputs(folder):
        names = list(KEEP_DONE)
        try:
            prep.make_playback(folder / "media.mp4", folder / "playback.mp4", storage_config()["playback"])
            names.append("playback.mp4")
        except Exception as e:  # noqa: BLE001 — the player falls back to the analysis copy
            log(f"{session_id}: playback copy failed ({type(e).__name__}); keeping media.mp4")
            names.append("media.mp4")
        publish(folder, [n for n in names if (folder / n).is_file()])

    try:
        try:
            local = fetch(stored)
        except Exception as e:  # noqa: BLE001 — without the upload there is nothing to analyse
            log(f"{session_id}: upload could not be read ({type(e).__name__})")
            store.fail(session_id, CRASH.format(type(e).__name__))
            return "failed"
        status = process(dict(session, video_path=str(local)), after_analysis=keep_outputs)
        if status == "failed":
            publish(run_dir, [n for n in KEEP_FAILED if (run_dir / n).is_file()])
        discard(stored)
        return status
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)
        if local is not None:
            Path(local).unlink(missing_ok=True)


def run(once: bool = False, poll_s: float | None = None) -> int:
    """Main loop; returns how many sessions were processed (for --once and tests)."""
    with runner_lock(RUNS_DIR):
        try:
            return _run(once, poll_s)
        finally:
            store.checkpoint()      # SQLite WAL -> database file when the worker stops (D-050)


def _run(once, poll_s):
    cfg = pipeline_config()["runner"]
    poll_s = cfg["poll_s"] if poll_s is None else poll_s
    fixed = store.recover_stuck(cfg["max_attempts"])
    if fixed["requeued"] or fixed["failed"]:
        log(f"recovered stuck sessions: requeued {fixed['requeued']}, failed {fixed['failed']}")
    log("waiting for work")
    done = 0
    while True:
        session = store.claim_next()
        if session is None:
            if once:
                return done
            time.sleep(poll_s)
            continue
        t0 = time.perf_counter()
        log(f"{session['session_id']}: start (attempt {session['attempts']})")
        status = process(session)
        done += 1
        log(f"{session['session_id']}: {status} in {time.perf_counter() - t0:.0f} s")


def main() -> None:
    ap = argparse.ArgumentParser(description="Analyse queued sessions (PromptPre's worker)")
    ap.add_argument("--once", action="store_true", help="process the current queue, then exit")
    ap.add_argument("--poll-s", type=float, default=None)
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        run(args.once, args.poll_s)
    except KeyboardInterrupt:
        log("stopped")


if __name__ == "__main__":
    main()
