"""Read-only SC02 preflight or a fresh, consent-gated batch for the D-057 evaluation."""
from __future__ import annotations

import argparse
import csv
import hashlib
import math
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

import yaml

from eval.snapshot import create_snapshot
from eval.tables import CODES, CONFIG, REPO, md_table, write_outputs
from promptpres_shared.json_files import atomic_json, read_json
from promptpres_shared.settings import (
    MODELS_DIR,
    analysis_settings,
    llm_enabled,
    llm_settings,
    tool,
)

RUBRIC = "v0.9"
MODEL = "google/gemini-2.5-flash-lite"
TOPIC_TITLES = ("ปัญหาและผู้ใช้", "วัตถุประสงค์", "วิธีที่เสนอ", "แผนทดสอบ")
DEFAULT_ROOT = REPO.parents[1] / "Data" / "Collector" / "SC02_dataset_20261022" / "DEV_train_validation"
OUT = REPO / "data" / "eval_sc02_v0_9"
CLIP_ID = re.compile(r"G\d{2}_P\d{2}_S\d{2}_T\d{2}")
GT_FIELDS = ("clip_id", "rater", "T1.speech_span_s", "S1.syllables", "S2.long_pauses", "S2.max_pause_s",
             "S3.fillers", "N1.long_still_spans", "N1.max_still_s", "N2.front_pct", "notes")


@dataclass(frozen=True)
class Clip:
    session_id: str
    video: Path
    duration_s: float
    target_s: float
    topics: list[dict]
    sha256: str
    in_dev_set: bool


def selected_entries() -> list[dict]:
    doc = yaml.safe_load((CONFIG / "eval_clips_sc02.yaml").read_text(encoding="utf-8"))
    entries = doc["clips"]
    ids = [e["clip_id"] for e in entries]
    if (doc["rubric"] != RUBRIC or len(ids) != 8 or len(set(ids)) != 8
            or not all(CLIP_ID.fullmatch(cid) for cid in ids)
            or len({e["participant"] for e in entries}) != 8):
        raise ValueError("ต้องมี 8 รหัสคลิปจากผู้พูดคนละคนในรายการรูบริก v0.9")
    return entries


def _file_in(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or not path.is_file() or not path.stat().st_size:
        raise ValueError(f"ไม่พบไฟล์ที่อ่านได้ภายในชุด SC02: {relative}")
    return path


def _sha256(path: Path) -> str:
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def preflight(root: Path) -> list[Clip]:
    root = root.resolve()
    entries = selected_entries()
    selected = {e["clip_id"] for e in entries}
    registry = {}
    with _file_in(root, "clips.csv").open(encoding="utf-8-sig", newline="") as file:
        for row in csv.DictReader(file):
            cid = Path(row["filename"]).stem
            if cid in selected:
                if cid in registry:
                    raise ValueError(f"รหัสซ้ำในทะเบียน: {cid}")
                registry[cid] = row
    clips = []
    for e in entries:
        cid = e["clip_id"]
        row = registry.get(cid)
        target = float(e["target_s"])
        if (not row or row["participant_id"] != e["participant"] or row["scenario"] != e["scenario"]
                or Path(row["mp4_path"]) != Path(e["mp4"])
                or not math.isfinite(target) or target <= 0 or float(row["scenario_target_seconds"]) != target
                or e["reference"] != f"references/{e['participant']}.json"):
            raise ValueError(f"{cid}: ทะเบียนคลิปไม่ตรงกับรายการคัดสรร")
        video = _file_in(root, e["mp4"])
        source_hash = _sha256(video)
        if source_hash != row["mp4_sha256"].lower():
            raise ValueError(f"{cid}: SHA-256 ของ MP4 ไม่ตรงกับทะเบียน")
        probe = subprocess.run(
            [tool("ffprobe"), "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(video)],
            check=True, capture_output=True, text=True, timeout=30,
        )
        duration = float(probe.stdout)
        # The manifest stores durations rounded to one decimal place.
        if duration <= 0 or not math.isclose(duration, float(e["duration_s"]), abs_tol=0.1):
            raise ValueError(f"{cid}: ความยาววิดีโอไม่ตรงกับรายการคัดสรร")
        points = read_json(_file_in(root, e["reference"])).get("points")
        if not isinstance(points, list) or len(points) != 4 or not all(
            isinstance(p, str) and p.strip() for p in points
        ):
            raise ValueError(f"{cid}: ต้องมีใจความสำคัญที่ยืนยันแล้ว 4 ข้อ")
        topics = [{"id": f"H{i:02d}", "title": title, "order": i, "key_point": point.strip()}
                  for i, (title, point) in enumerate(zip(TOPIC_TITLES, points, strict=True), start=1)]
        clips.append(Clip(f"sc02_{cid}", video, duration, target, topics, source_hash, e["in_dev_set"]))
    return clips


def rating_rows(ids: list[str]):
    for sid in ids:
        for rater in ("R1", "R2", "R3"):
            for code in CODES:
                yield (sid, code, rater, "")


def summary_row(clip: Clip, result: dict, timing: dict) -> tuple[dict, list[dict]]:
    cards = {card["code"]: card for card in result["criteria"]}
    if (result["status"] != "done" or result["session_id"] != clip.session_id
            or set(cards) != set(CODES) or result["versions"]["rubric"] != RUBRIC):
        raise ValueError(f"{clip.session_id}: ผลไม่ครบหรือไม่ใช่รูบริก {RUBRIC}")
    asr = result["versions"]["asr"]
    if asr and "cuda/" not in asr:
        raise ValueError(f"{clip.session_id}: ASR ไม่ได้ประมวลผลบน CUDA")
    row = {"clip_id": clip.session_id, "duration_s": result["duration_s"],
           "processing_s": timing["total"], "target_s": clip.target_s}
    reasons = []
    for code in CODES:
        card = cards[code]
        row[code] = card["level"] if card["status"] == "ok" else "วิเคราะห์ไม่ได้"
        if card["status"] != "ok":
            reasons.append({"clip_id": clip.session_id, "criterion": code, "reason": card["reason"]})
    for code, value in (("S2", "long_pauses"), ("S3", "fillers")):
        row[f"{code}.{value}"] = cards[code]["values"][value] if cards[code]["status"] == "ok" else None
    return row, reasons


def run_batch(clips: list[Clip]) -> None:
    # Heavy imports only after the explicit data-use decision in main().
    import ctranslate2

    from worker.pipeline import run_session

    settings = analysis_settings()
    llm = llm_settings()
    if (settings["thresholds"]["rubric_version"] != RUBRIC or settings["pipeline"]["version"] != "pipeline-v0.9"
            or not settings["pipeline"]["fillers"]["phrases"]):
        raise ValueError("ต้องใช้ thresholds และ pipeline v0.9 ที่เปิดกติกาคำติดปาก")
    if not llm_enabled() or not llm["api_key"] or llm["model"] != MODEL:
        raise ValueError(f"ต้องเปิด OpenRouter และตั้งรุ่น {MODEL} ใน .env")
    if ctranslate2.get_cuda_device_count() < 1:
        raise ValueError("ไม่พบ CUDA GPU สำหรับรอบประเมิน")
    if not all((MODELS_DIR / name).is_file() for name in ("pose.task", "face.task", "hand.task")):
        raise ValueError("ไม่พบไฟล์ MediaPipe ทั้งสามโมเดล")
    if OUT.exists():
        raise ValueError(f"{OUT} มีอยู่แล้ว ให้เก็บชุดเดิมออกจากตำแหน่งนี้ก่อนรันใหม่")
    OUT.parent.mkdir(exist_ok=True)
    results, rows, reasons, provenance = {}, [], [], {}
    with TemporaryDirectory(dir=OUT.parent, prefix=".sc02-work-") as folder:
        work = Path(folder)
        for i, clip in enumerate(clips, 1):
            sid = clip.session_id
            print(f"[{i}/{len(clips)}] {sid}", flush=True)
            result = run_session(clip.video, sid, clip.target_s, run_root=work, reuse=False,
                                 topics=clip.topics, settings=settings)
            timing = read_json(work / sid / "timing.json")
            row, why = summary_row(clip, result, timing)
            results[sid] = result
            rows.append(row)
            reasons.extend(why)
            stage_errors = {k: v for k, v in timing.items() if k.endswith("_error")}
            provenance[sid] = {"source_sha256": clip.sha256, "in_dev_set": clip.in_dev_set,
                               "versions": result["versions"], "timing": timing, "stage_errors": stage_errors}
            print(f"  {timing['total']:.1f} s · ตรวจไม่ได้ {len(why)} เกณฑ์", flush=True)
        snapshot = work / "snapshot"
        create_snapshot(results, [clip.session_id for clip in clips], snapshot)
        atomic_json(snapshot / "run_details.json", provenance)
        cols = [("clip_id", "รหัสคลิป"), ("duration_s", "คลิป (วินาที)"), ("processing_s", "ประมวลผล (วินาที)"),
                ("target_s", "เป้า (วินาที)"), *[(code, code) for code in CODES],
                ("S2.long_pauses", "S2 ครั้ง"), ("S3.fillers", "S3 ครั้ง")]
        report = ["# ผลระบบ SC02 v0.9", "", md_table(rows, cols), "",
                  "เวลาจาก pipeline จริงที่ไม่ใช้ cache · 3 คลิปเคยใช้พัฒนา · ยังไม่ใช่ผลเทียบผู้ประเมิน"]
        if reasons:
            report += ["", "## เหตุที่วิเคราะห์ไม่ได้", "",
                       md_table(reasons, [("clip_id", "รหัสคลิป"), ("criterion", "เกณฑ์"), ("reason", "เหตุผล")])]
        tables = {"summary": rows}
        if reasons:
            tables["unanalyzable"] = reasons
        write_outputs(snapshot, "sc02", "\n".join(report) + "\n", tables)
        snapshot.rename(OUT)
    print(OUT)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--preflight", action="store_true", help="ตรวจข้อมูลในเครื่อง ไม่เรียก OpenRouter")
    mode.add_argument("--allow-openrouter", action="store_true",
                      help="ใช้เมื่อผู้วิจัยยืนยันสิทธิ์ส่งบทถอดเสียงและหัวข้อครบทั้ง 8 คลิป")
    parser.add_argument("--sc02-root", type=Path, default=Path(os.environ.get("PROMPTPRES_SC02", DEFAULT_ROOT)))
    parser.add_argument("--pack-input", action="store_true",
                        help="ร่วมกับ --preflight เท่านั้น: เขียนหัวข้อให้งานเอกสารใน data/ (นอก Git)")
    args = parser.parse_args()
    if args.pack_input and not args.preflight:
        parser.error("--pack-input ต้องใช้กับ --preflight")
    try:
        clips = preflight(args.sc02_root)
        for clip in clips:
            print(f"{clip.session_id} · {clip.duration_s:.1f} s · เป้า {clip.target_s:g} s · 4 หัวข้อ · SHA-256 ตรง")
        if args.pack_input:
            path = OUT.parent / "sc02_rater_pack_input.json"
            path.parent.mkdir(exist_ok=True)
            atomic_json(path, {"rubric": RUBRIC, "codes": CODES, "clips": [
                {"clip_id": c.session_id, "duration_s": c.duration_s, "target_s": c.target_s, "topics": c.topics}
                for c in clips
            ]})
            print(path)
        if args.allow_openrouter:
            run_batch(clips)
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        parser.exit(1, f"SC02: {exc}\n")


if __name__ == "__main__":
    main()
