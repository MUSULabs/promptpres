"""Main entry point: analyse one video and write data/runs/<session_id>/result.json (Result Contract 1.3).

ลำดับงาน: prep -> landmarks (ภาพ) -> VAD -> ASR -> fillers -> coverage (LLM + ตรวจ quote; ต้องมีหัวข้อที่ยืนยัน)
-> เกณฑ์ 8 ตัว (แต่ละตัวพังแยกกัน) -> ประกอบ Result (+ topics ระดับบนสุด)
-> AI coach (D-046: LLM สรุปจากผล 8 เกณฑ์เท่านั้น + Evidence Verification Guard; พัง/ไม่ผ่าน = coach null)
-> ตรวจกับ contracts/result.schema.json และ Pydantic model ก่อนบันทึก
ขั้นตอนหนึ่งพัง -> เฉพาะเกณฑ์ที่ใช้ขั้นตอนนั้นเป็น "วิเคราะห์ไม่ได้" (landmarks -> N1 N2, ASR -> S1 S3 C1 C2,
LLM -> C1 C2)
versions: rubric / config / ASR / LLM / prompt ของทุกผล (CLAUDE.md rule 8) · prompt ต่อท้าย coach-v2 เมื่อโค้ชผ่าน

CLI:  python -m worker.pipeline <video> --session-id ID [--target-s 900] [--topics topics.json] [--reuse]
      --topics = รายการหัวข้อที่ผู้ใช้ยืนยัน: [{id, title, order, key_point}] หรือผลของ worker.llm.topics
      --reuse  = ใช้ไฟล์ที่มี manifest ตรงกับแหล่งวิดีโอ ค่าตั้ง รุ่นของขั้น และผลขั้นก่อนหน้า
                 ผล LLM ผูกกับ model, prompt, หัวข้อ, transcript และค่าตรวจหลักฐาน
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from promptpres_shared.contract import CONTRACT_VERSION, validate_result
from promptpres_shared.json_files import atomic_json
from promptpres_shared.settings import MODELS_DIR, RUNS_DIR, analysis_settings, llm_enabled, use_llm_config
from worker.artifacts import Artifacts, digest

from worker import prep as prep_mod
from worker.criteria import c1, c2, n1, n2, s1, s2, s3, t1
from worker.criteria.base import clamp_evidence
from worker.extract import asr, fillers, landmarks, vad
from worker.llm import coach, coverage
from worker.session import Session

CRITERIA_ORDER = ["C1", "C2", "S1", "S2", "S3", "N1", "N2", "T1"]
# Bump the relevant stage version whenever its output or algorithms change.
STAGE_VERSIONS = {"prep": 1, "landmarks": 1, "vad": 1, "asr": 1, "fillers": 1}


def model_revision(paths):
    """Fingerprint local model files without reading model weights into memory."""
    return [prep_mod.fingerprint(path) for path in sorted(paths) if path.is_file()]


def score(session: Session, thresholds: dict) -> list[dict]:
    """All 8 criterion cards in contract order."""
    th = thresholds["criteria"]
    built = {
        "C1": lambda: c1.run(session, th["C1"], th["C2"]),
        "C2": lambda: c2.run(session, th["C2"]),
        "T1": lambda: t1.run(session, th["T1"]),
        "S1": lambda: s1.run(session, th["S1"], th["S3"]),
        "S2": lambda: s2.run(session, th["S2"]),
        "S3": lambda: s3.run(session, th["S3"]),
        "N1": lambda: n1.run(session, th["N1"]),
        "N2": lambda: n2.run(session, th["N2"]),
    }
    duration = ((session.prep or {}).get("probe") or {}).get("duration_s")
    cards = [built[c]() for c in CRITERIA_ORDER]
    for card in cards:      # one bad time must not fail validate() for the whole session
        card["evidence"] = clamp_evidence(card["evidence"], duration)
    return cards


def confirmed_topics(topics) -> tuple[list[dict], str | None]:
    """Topic list from a list, a {"topics": [...], "prompt": ...} dict or a JSON file -> (topics, prompt).

    Each topic -> {id, title, order, key_point}; `expected_order` (worker.llm.topics) is read as order.
    """
    if topics is None:
        return [], None
    if isinstance(topics, (str, Path)):
        topics = json.loads(Path(topics).read_text(encoding="utf-8"))
    prompt = topics.get("prompt") if isinstance(topics, dict) else None
    items = topics.get("topics", []) if isinstance(topics, dict) else topics
    out = []
    for n, t in enumerate(items, start=1):
        out.append({"id": str(t["id"]), "title": str(t["title"]),
                    "order": int(t.get("order") or t.get("expected_order") or n),
                    "key_point": str(t.get("key_point") or "")})
    return out, prompt


def validate(result: dict) -> None:
    validate_result(result)


def base_result(session_id: str, thresholds: dict, cfg: dict) -> dict:
    return {"contract_version": CONTRACT_VERSION, "session_id": session_id, "status": "done",
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "duration_s": None, "target_duration_s": None, "video_url": None,
            "versions": {"rubric": thresholds.get("rubric_version"), "asr": None, "llm": None, "prompt": None,
                         "config": f"{thresholds['version']} + {cfg['version']}"},
            "criteria": [], "topics": [], "coach": None, "error": None}


def run_session(video: str | Path, session_id: str, target_duration_s: float | None = None,
                run_root: Path = RUNS_DIR, reuse: bool = False, topics=None, settings=None) -> dict:
    """Analyse one video; write result.json + timing.json into run_root/session_id; return the result.

    reuse=True: reuse committed stages for the same input bytes and stage settings.
    topics: the confirmed topic list (see confirmed_topics); without it C1 C2 are unanalyzable.
    """
    snapshot = settings if settings is not None else analysis_settings()
    cfg, thresholds = snapshot["pipeline"], snapshot["thresholds"]
    run_dir = Path(run_root) / session_id
    run_dir.mkdir(parents=True, exist_ok=True)
    result, timing, t0 = base_result(session_id, thresholds, cfg), {}, time.perf_counter()
    video = Path(video)
    hash_started = time.perf_counter()
    source = prep_mod.source_digest(video)
    artifacts = Artifacts(run_dir, source, reuse, timing)
    timing["input_identity"] = round(time.perf_counter() - hash_started, 3)
    topic_list, topics_prompt = confirmed_topics(topics)
    result["versions"]["config"] += f" [{digest(snapshot)[:12]}]"
    if topic_list:
        atomic_json(run_dir / "topics.json", topic_list)
    elif (run_dir / "topics.json").exists():
        (run_dir / "topics.json").unlink()

    try:
        prepared = _stage(artifacts, "prep", cfg["prep"],
                         lambda dest: prep_mod.prepare(video, dest, cfg["prep"]), "prep.json")
    except (prep_mod.MediaError, subprocess.TimeoutExpired) as exc:
        result |= {"status": "failed", "error": str(exc) if isinstance(exc, prep_mod.MediaError)
                   else "เตรียมวิดีโอเกินเวลาที่กำหนด"}
        return _finish(result, run_dir, timing, t0, snapshot)

    result["duration_s"] = prepared["probe"]["duration_s"]
    result["target_duration_s"] = float(target_duration_s or thresholds["criteria"]["T1"]["default_target_s"])
    session = Session(session_id, run_dir, result["target_duration_s"], prep=prepared, topics=topic_list)
    session.extra["contextual_fillers"] = cfg.get("fillers")
    _extract_signals(session, cfg, thresholds, artifacts, timing)
    _analyse_content(session, cfg, thresholds, result, timing, topics_prompt, reuse=reuse and source is not None,
                     source=source)
    if session.transcript:
        result["versions"]["asr"] = asr.version_string(session.transcript)
    started = time.perf_counter()
    result["criteria"] = score(session, thresholds)
    if next(card for card in result["criteria"] if card["code"] == "C2")["status"] == "ok":
        result["topics"] = c2.contract_topics(session)
    timing["criteria"] = round(time.perf_counter() - started, 1)
    _coach(result, cfg, run_dir, timing, transcript=session.transcript, confirmed=session.topics, reuse=reuse and source is not None)
    return _finish(result, run_dir, timing, t0, snapshot)


def _stage(artifacts, name, inputs, fn, output):
    return artifacts.run(name, [STAGE_VERSIONS[name], inputs], fn, output)


def _extract_signals(session, cfg, thresholds, artifacts, timing):
    run_dir, prepared = session.run_dir, session.prep
    prep_key = artifacts.key("prep")
    def attempt(name, inputs, fn, output):
        try:
            return _stage(artifacts, name, inputs, fn, output)
        except Exception as exc:
            timing[f"{name}_error"] = type(exc).__name__
            return None

    session.landmarks = attempt(
        "landmarks", [prep_key, cfg["landmarks"], model_revision(MODELS_DIR.glob("*.task"))],
        lambda dest: landmarks.extract(run_dir / "media.mp4", dest / "landmarks.parquet", cfg["landmarks"]),
        "landmarks.parquet")
    if prepared["audio"]:
        wav = run_dir / "audio.wav"
        session.vad = attempt("vad", [prep_key, cfg["vad"]],
                              lambda dest: vad.detect_speech(wav, dest / "vad.json", cfg["vad"]), "vad.json")
        if not prepared["flags"]:
            session.transcript = attempt(
                "asr", [prep_key, cfg["asr"], model_revision((MODELS_DIR / "whisper").rglob("*"))],
                lambda dest: asr.transcribe(wav, dest / "transcript.json", cfg["asr"]), "transcript.json")
            if session.transcript:
                spec = thresholds["criteria"]["S3"]
                session.fillers = attempt(
                    "fillers", [prep_key, artifacts.key("asr"), session.vad, spec, cfg.get("fillers")],
                    lambda dest: fillers.detect(wav, session.transcript, session.vad, dest / "fillers.json", spec, cfg.get("fillers")),
                    "fillers.json")


def _analyse_content(session, cfg, thresholds, result, timing, topics_prompt, *, reuse, source):
    if not (llm_enabled() and session.topics and (session.transcript or {}).get("words")):
        return
    started = time.perf_counter()
    try:
        with use_llm_config(cfg["llm"]):
            analysed = coverage.analyse(session.topics, session.transcript, result["duration_s"],
                                        session.run_dir / "coverage.json", cfg["llm"], thresholds["criteria"]["C2"],
                                        reuse=reuse, source=source)
        timing["coverage"] = "cached" if analysed.get("cached") else round(time.perf_counter() - started, 1)
        result["versions"]["llm"] = analysed["model"]
        result["versions"]["prompt"] = " + ".join(p for p in (topics_prompt, analysed["prompt"]) if p)
        session.coverage = analysed
    except Exception as error:  # LLM failure is isolated to C1/C2.
        session.extra["coverage_error"] = timing["coverage_error"] = type(error).__name__


def _coach(result, cfg, run_dir, timing, *, reuse, transcript=None, confirmed=None):
    """Layer 3 coach from the scored cards; any failure leaves coach = null and the session done."""
    spec = cfg.get("coach") or {}          # settings snapshots queued before D-046 have no coach section
    if not (spec.get("enabled") and llm_enabled()):
        return
    started = time.perf_counter()
    try:
        with use_llm_config(cfg["llm"]):
            out = coach.generate(result["criteria"], result["topics"] or confirmed or [], result["duration_s"],
                                 result["target_duration_s"], run_dir / "coach.json", spec, reuse=reuse, transcript=transcript)
    except Exception as error:  # noqa: BLE001 — the coach is optional; the measured cards stand alone
        timing["coach_error"] = str(error) if isinstance(error, coach.CoachRejected) else type(error).__name__
        return
    result["coach"] = {"status": "ok", "items": out["items"], "hidden_count": int(out.get("hidden", 0))}
    result["versions"]["llm"] = result["versions"]["llm"] or out["model"]
    result["versions"]["prompt"] = " + ".join(p for p in (result["versions"]["prompt"], out["prompt"]) if p)
    timing["coach"] = "cached" if out.get("cached") else round(time.perf_counter() - started, 1)


def _finish(result: dict, run_dir: Path, timing: dict, t0: float, snapshot: dict) -> dict:
    if result["status"] == "failed":
        result["criteria"] = []
    validate(result)
    timing["total"] = round(time.perf_counter() - t0, 1)
    atomic_json(run_dir / "snapshot.json", {"config": result["versions"]["config"], **snapshot})
    atomic_json(run_dir / "result.json", result)
    atomic_json(run_dir / "timing.json", timing)
    return result


def main() -> None:
    ap = argparse.ArgumentParser(description="Analyse one rehearsal video -> result.json")
    ap.add_argument("video")
    ap.add_argument("--session-id", required=True)
    ap.add_argument("--target-s", type=float, default=None, help="target duration in seconds")
    ap.add_argument("--reuse", action="store_true", help="reuse prep/landmarks/vad/asr outputs already in the run folder")
    ap.add_argument("--topics", help="confirmed topic list (JSON)")
    args = ap.parse_args()
    res = run_session(args.video, args.session_id, args.target_s, reuse=args.reuse, topics=args.topics)
    sys.stdout.reconfigure(encoding="utf-8")
    for c in res["criteria"]:
        print(c["code"], c["status"], c["level"], c["values"] or c["reason"])
    print("status:", res["status"], res["error"] or "", "->", RUNS_DIR / args.session_id / "result.json")


if __name__ == "__main__":
    main()
