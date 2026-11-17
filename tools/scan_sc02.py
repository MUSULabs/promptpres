"""Scan the SC02 dataset (read-only) and pick development clips -> config/dev_clips_sc02.yaml.

For every selected clip in clips.csv:
  - ffprobe: duration, fps, audio stream
  - audio level: mean RMS dBFS of the ready-made 16 kHz wav
  - picture: N evenly spaced frames of the mp4 through MediaPipe face / pose / hand
    -> % frames with a face, with both shoulders visible, with at least one hand
Then choose 3-5 presenters whose natural run (S01) shows face, shoulders and hands clearly
with normal sound, and list their scenario clips for per-criterion tests.

The selection rules below are for choosing dev clips only (not scoring thresholds).
Nothing under the dataset folder is written. Full table -> data/scan/sc02_scan.csv (gitignored).

Run:  python tools/scan_sc02.py [--frames 20] [--people 4]
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
from pathlib import Path

import cv2
import numpy as np
import yaml
from mediapipe.tasks.python import BaseOptions, vision

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from worker.extract.landmarks import as_image, head_box  # noqa: E402
from worker.prep import audio_level_dbfs, load_wav, probe  # noqa: E402
from worker.settings import pipeline_config  # noqa: E402

HEAD_MIN_HALF_PX = pipeline_config()["landmarks"]["head_crop_min_half_px"]

DEFAULT_ROOT = REPO.parents[1] / "Data" / "Collector" / "SC02_dataset_20261022" / "DEV_train_validation"
ROOT = Path(os.environ.get("PROMPTPRES_SC02", DEFAULT_ROOT))
OUT_CSV = REPO / "data" / "scan" / "sc02_scan.csv"
OUT_YAML = REPO / "config" / "dev_clips_sc02.yaml"

# dev-clip selection rules (owner brief, 14 Nov 2026)
MIN_FACE_PCT, MIN_SHOULDER_PCT, MIN_HANDS_PCT = 90.0, 90.0, 70.0
DBFS_RANGE = (-45.0, -30.0)
SHOULDER_VISIBILITY = 0.5
TEST_SCENARIOS = {          # S07 (sway) is out of scope (D-033)
    "S02": "S1 พูดเร็วขึ้นช่วงกลาง — อัตราพยางค์สูงกว่า S03",
    "S03": "S1 พูดช้าลงช่วงกลาง",
    "S04": "S2 หยุดเงียบ 2–4 s จำนวน 3 ครั้ง",
    "S05": "S3 เสียงเติม เอ่อ/เอิ่ม 5–8 ครั้ง (คือ แบบ ก็ ไม่นับ)",
    "S06": "N1 มือขยับซ้ำ — ต้องไม่ถูกนับเป็นช่วงมือนิ่ง",
    "S08": "N1 มือนิ่ง 15–20 s — ควรพบช่วงมือนิ่งต่อเนื่อง",
    "S09": "N2 หันตรง/หันข้าง/ก้มดูโน้ต สลับช่วงละ 10–15 s",
    "S10": "C1 สลับลำดับ H03 H01 H04 H02 แต่กล่าวครบ",
    "S11": "C2 กล่าวสาระหลายระดับ (บางส่วน/เพียงชื่อ/ไม่พบ/ครบ)",
    "S12": "N1 มือถูกบัง 15–20 s — ช่วงที่บังต้องไม่นับว่านิ่ง (เห็นมือน้อยอาจวิเคราะห์ไม่ได้)",
}


def landmarkers():
    m = REPO / "models"
    face = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(m / "face.task")), num_faces=1))
    pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(m / "pose.task")), num_poses=1))
    hand = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(m / "hand.task")), num_hands=2))
    return face, pose, hand


def head_crop(bgr, pose_landmarks):
    """Square crop around the nose from the full-size frame: the SAME box as the pipeline
    (worker.extract.landmarks.head_box, half side = shoulder width, min from pipeline-v0.yaml).

    The face model is a short-range detector: on a whole 720p/1080p frame where the presenter's
    face is small it finds nothing (0/10 frames on G07_P04_S01), on this crop 10/10.
    Note: the face_pct numbers stored in dev_clips_sc02.yaml before Nov 2026 used a horizontal-only
    shoulder width, so they can differ slightly from a re-run.
    """
    h, w = bgr.shape[:2]
    L = pose_landmarks[0]
    shoulder_w = math.hypot((L[11].x - L[12].x) * w, (L[11].y - L[12].y) * h)
    x0, y0, x1, y1 = head_box((L[0].x * w, L[0].y * h), shoulder_w, w, h, HEAD_MIN_HALF_PX)
    return bgr[y0:y1, x0:x1]


def frame_stats(mp4: Path, n_frames: int, models) -> dict:
    """% of sampled frames with a face (on the head crop) / both shoulders / at least one hand."""
    face, pose, hand = models
    cap = cv2.VideoCapture(str(mp4))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    idx = np.linspace(0, max(total - 1, 0), n_frames + 2)[1:-1].astype(int)   # skip first/last frame
    seen = {"face": 0, "shoulders": 0, "hands": 0, "frames": 0}
    for i in idx:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
        ok, full = cap.read()
        if not ok:
            continue
        h, w = full.shape[:2]
        small = cv2.resize(full, (960, int(h * 960 / w))) if w > 960 else full   # pose/hands: smaller is enough
        image = as_image(small)
        seen["frames"] += 1
        p = pose.detect(image).pose_landmarks
        seen["shoulders"] += bool(p) and all((p[0][k].visibility or 0) >= SHOULDER_VISIBILITY for k in (11, 12))
        seen["hands"] += bool(hand.detect(image).hand_landmarks)
        if p:
            crop = head_crop(full, p)
            seen["face"] += crop.size > 0 and bool(face.detect(as_image(crop)).face_landmarks)
    cap.release()
    n = max(seen["frames"], 1)
    return {f"{k}_pct": round(100 * seen[k] / n, 1) for k in ("face", "shoulders", "hands")} | {"frames": seen["frames"]}


def scan(n_frames: int) -> list[dict]:
    rows = list(csv.DictReader(open(ROOT / "clips.csv", encoding="utf-8-sig")))
    models = landmarkers()
    out = []
    for k, r in enumerate(rows, 1):
        mp4, wav = ROOT / r["mp4_path"], ROOT / r["wav16k_path"]
        info = probe(mp4)
        samples, _ = load_wav(wav)
        ref = ROOT / "references" / f"{r['participant_id']}.json"
        points = len(json.loads(ref.read_text(encoding="utf-8")).get("points", [])) if ref.exists() else 0
        row = {"clip_id": Path(r["filename"]).stem, "group": r["group_id"], "participant": r["participant_id"],
               "scenario": r["scenario"], "target_s": int(float(r["scenario_target_seconds"])),
               "duration_s": round(info["duration_s"] or 0, 2), "fps": info["fps"],
               "width": info["width"], "height": info["height"], "has_audio": info["has_audio"],
               "dbfs": round(float(audio_level_dbfs(samples)), 2), "ref_points": points,
               "mp4": r["mp4_path"], "wav": r["wav16k_path"], "reference": f"references/{r['participant_id']}.json"}
        row |= frame_stats(mp4, n_frames, models)
        out.append(row)
        print(f"[{k}/{len(rows)}] {row['clip_id']} face {row['face_pct']} sh {row['shoulders_pct']} "
              f"hands {row['hands_pct']} {row['dbfs']} dBFS", flush=True)
    return out


INT_COLS = ("target_s", "width", "height", "ref_points", "frames")
FLOAT_COLS = ("duration_s", "fps", "dbfs", "face_pct", "shoulders_pct", "hands_pct")


def load_csv() -> list[dict]:
    """Re-read an earlier scan (data/scan/sc02_scan.csv) instead of scanning all clips again."""
    rows = list(csv.DictReader(open(OUT_CSV, encoding="utf-8-sig")))
    for r in rows:
        r.update({k: int(float(r[k])) for k in INT_COLS if r.get(k) not in (None, "")})
        r.update({k: float(r[k]) for k in FLOAT_COLS if r.get(k) not in (None, "")})
        r["has_audio"] = r["has_audio"] == "True"
    return rows


def good_s01(r: dict) -> bool:
    return (r["scenario"] == "S01" and r["has_audio"] and r["ref_points"] == 4
            and r["face_pct"] >= MIN_FACE_PCT and r["shoulders_pct"] >= MIN_SHOULDER_PCT
            and r["hands_pct"] >= MIN_HANDS_PCT and DBFS_RANGE[0] <= r["dbfs"] <= DBFS_RANGE[1])


def entry(r: dict, expect: str) -> dict:
    keys = ("clip_id", "participant", "scenario", "target_s", "duration_s", "mp4", "wav", "reference")
    return {k: r[k] for k in keys} | {"expect": expect,
            "qc": {k: r[k] for k in ("face_pct", "shoulders_pct", "hands_pct", "dbfs")}}


def select(rows: list[dict], people: int) -> dict:
    s01 = sorted((r for r in rows if good_s01(r)), key=lambda r: (-r["hands_pct"], -r["dbfs"]))
    chosen, groups = [], set()
    for r in s01:                       # one per group first, then fill up
        if r["group"] not in groups:
            chosen.append(r); groups.add(r["group"])
        if len(chosen) == people:
            break
    for r in s01:
        if len(chosen) == people:
            break
        if r not in chosen:
            chosen.append(r)
    ids = [r["participant"] for r in chosen]
    by_key = {(r["participant"], r["scenario"]): r for r in rows}
    cases = {}
    for sc, expect in TEST_SCENARIOS.items():
        picks = [by_key[(p, sc)] for p in ids if (p, sc) in by_key and by_key[(p, sc)]["has_audio"]]
        picks.sort(key=lambda r: (-r["face_pct"], -r["hands_pct"]))
        cases[sc] = [entry(r, expect) for r in picks[:2]]
    return {"primary_baseline": [entry(r, "End-to-End ฉากซ้อมตามธรรมชาติ") for r in chosen],
            "criterion_test_cases": cases}


def summary(rows: list[dict]) -> dict:
    def stat(key, sel=rows):
        v = np.array([r[key] for r in sel], dtype=float)
        return {"min": round(float(v.min()), 1), "median": round(float(np.median(v)), 1), "max": round(float(v.max()), 1)}
    s01 = [r for r in rows if r["scenario"] == "S01"]
    return {"clips": len(rows), "people": len({r["participant"] for r in rows}),
            "resolution": {f"{w}x{h}": sum(1 for r in rows if (r["width"], r["height"]) == (w, h))
                           for w, h in sorted({(r["width"], r["height"]) for r in rows})},
            "no_audio": sum(1 for r in rows if not r["has_audio"]),
            "dbfs_all": stat("dbfs"), "face_pct_all": stat("face_pct"),
            "shoulders_pct_all": stat("shoulders_pct"), "hands_pct_all": stat("hands_pct"),
            "s01_passing_rules": sum(1 for r in s01 if good_s01(r)), "s01_total": len(s01)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", type=int, default=20)
    ap.add_argument("--people", type=int, default=4)
    ap.add_argument("--from-csv", action="store_true", help="reuse data/scan/sc02_scan.csv, skip the scan")
    args = ap.parse_args()
    if args.from_csv:
        rows = load_csv()
    else:
        rows = scan(args.frames)
        OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
        with open(OUT_CSV, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0]))
            w.writeheader(); w.writerows(rows)
    doc = {"version": "dev-clips-sc02-v1",
           "dataset_root": "Data/Collector/SC02_dataset_20261022/DEV_train_validation  (vault root; env PROMPTPRES_SC02)",
           "rules": {"face_pct_min": MIN_FACE_PCT, "shoulders_pct_min": MIN_SHOULDER_PCT,
                     "hands_pct_min_S01": MIN_HANDS_PCT, "dbfs_range": list(DBFS_RANGE),
                     "frames_per_clip": args.frames, "reference_points": 4},
           "summary": summary(rows)} | select(rows, args.people)
    if OUT_YAML.exists():   # keep notes written by other tools (e.g. tools/scan_s09_yaw.py)
        old = yaml.safe_load(OUT_YAML.read_text(encoding="utf-8")) or {}
        if "notes" in old:
            doc["notes"] = old["notes"]
    header =("# SC02 development clips — generated by tools/scan_sc02.py (do not hand-edit; re-run the script).\n"
              "# Paths are relative to the dataset root. No media in git.\n")
    OUT_YAML.write_text(header + yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")
    print(json.dumps(doc["summary"], ensure_ascii=False, indent=1))
    print("baseline:", [e["clip_id"] for e in doc["primary_baseline"]])


if __name__ == "__main__":
    main()
