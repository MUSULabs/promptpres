"""N2: การหันหน้าสื่อสารกับผู้ฟัง — วัดทิศทางศีรษะ (Head direction — ไม่ใช่การสบตา ไม่ตีความอารมณ์หรือความมั่นใจ)

อ่าน: landmarks.parquet (face_ok, yaw, pitch ต่อเฟรม ~10 fps; pitch < 0 = ก้ม — ตรวจกับคลิป S09 แล้ว)
ค่าที่รายงาน: front_pct (ใช้คิดระดับ) · side_pct, down_pct, up_other_pct, face_visible_pct, analysed_s (ข้อมูลประกอบ)
วิธีคิด:
  1. ดูเฉพาะช่วงพูด (เริ่มพูดถึงหยุดพูดครั้งสุดท้าย จาก VAD) ถ้าไม่มีเสียงใช้ทั้งคลิป
  2. แบ่งเป็นช่องละ 1 วินาที; วินาทีที่ "เห็นหน้า" = มีเฟรมที่เจอหน้าอย่างน้อย min_face_frames_ratio ของเฟรมในวินาทีนั้น
     มุมของวินาที = ค่ามัธยฐานของ yaw / pitch ในเฟรมที่เจอหน้า
  3. จัดกลุ่มตามลำดับ: ก้ม (pitch < pitch_down_deg แม้จะหันข้างด้วย) -> หันข้าง (|yaw| > yaw_side_deg)
     -> เงย/อื่น ๆ (pitch > pitch_up_deg) -> มองตรง
  4. front_pct = วินาทีที่มองตรง / วินาทีที่เห็นหน้า x 100 ; วินาทีที่ไม่เห็นหน้าไม่นับว่ามองตรง
  5. evidence = ช่วงก้มหรือหันข้างต่อเนื่องอย่างน้อย evidence_min_s วินาที (เก็บช่วงยาวสุด max_evidence ช่วง)
วิเคราะห์ไม่ได้: ไม่มีข้อมูลจุดสำคัญ หรือเห็นหน้าน้อยกว่า min_face_visible_pct ของเวลา
config: thresholds-v0.yaml criteria.N2
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from worker.criteria.base import Unanalyzable, safe_run

CODE = "N2"
LABEL_TH = {"down": "ก้ม", "side": "หันข้าง"}


def classify(yaw: float, pitch: float, spec: dict) -> str:
    """One second -> 'down' / 'side' / 'up_other' / 'front' (down is checked first)."""
    if not (math.isfinite(yaw) and math.isfinite(pitch)):    # NaN fails every test and would read as "front"
        raise ValueError("head angle is not a number")
    if pitch < spec["pitch_down_deg"]:
        return "down"
    if abs(yaw) > spec["yaw_side_deg"]:
        return "side"
    if pitch > spec["pitch_up_deg"]:
        return "up_other"
    return "front"


def in_window(df: pd.DataFrame, window: tuple[float, float] | None) -> pd.DataFrame:
    if window is None:
        return df
    start, end = window
    return df[(df["t_s"] >= start) & (df["t_s"] < end)]


def per_second(df: pd.DataFrame, spec: dict) -> pd.DataFrame:
    """One row per whole second: label ('none' when the face was not seen well enough)."""
    sec = np.floor(df["t_s"]).astype(int)
    rows = []
    for s, g in df.groupby(sec):
        seen = g[g["face_ok"].astype(bool)]
        if len(seen) < spec["min_face_frames_ratio"] * len(g) or seen.empty:
            rows.append({"sec": s, "label": "none"})
            continue
        rows.append({"sec": s, "label": classify(float(seen["yaw"].median()), float(seen["pitch"].median()), spec)})
    return pd.DataFrame(rows, columns=["sec", "label"])


def runs(secs: pd.DataFrame, labels: tuple[str, ...]) -> list[dict]:
    """Consecutive seconds that share one label in `labels` -> [{label, start_s, end_s}]."""
    out, cur = [], None
    for s, lab in zip(secs["sec"], secs["label"]):
        if cur and lab == cur["label"] and s == cur["end_s"]:
            cur["end_s"] = s + 1
            continue
        if cur:
            out.append(cur)
        cur = {"label": lab, "start_s": s, "end_s": s + 1} if lab in labels else None
    if cur:
        out.append(cur)
    return out


def compute(session, spec: dict) -> dict:
    df = session.landmarks
    if df is None or df.empty:
        raise Unanalyzable("ไม่มีข้อมูลจุดสำคัญของร่างกายจากวิดีโอ")
    df = in_window(df, session.speech_window())
    secs = per_second(df, spec)
    if secs.empty:
        raise Unanalyzable("ไม่มีช่วงวิดีโอระหว่างที่พูด")
    total = len(secs)
    seen = secs[secs["label"] != "none"]
    face_pct = 100 * len(seen) / total
    need = spec["unanalyzable"]["min_face_visible_pct"]
    if face_pct < need:
        raise Unanalyzable(f"เห็นใบหน้าเพียง {face_pct:.0f}% ของเวลาพูด (ต้องอย่างน้อย {need}%)")

    def pct(label):
        return round(100 * float((seen["label"] == label).sum()) / len(seen), 1)

    long_runs = [r for r in runs(secs, ("down", "side")) if r["end_s"] - r["start_s"] >= spec["evidence_min_s"]]
    long_runs = sorted(long_runs, key=lambda r: r["start_s"] - r["end_s"])[: spec["max_evidence"]]
    evidence = [{"start_s": float(r["start_s"]), "end_s": float(r["end_s"]),
                 "note": f"{LABEL_TH[r['label']]}ต่อเนื่อง {r['end_s'] - r['start_s']} วินาที"}
                for r in sorted(long_runs, key=lambda r: r["start_s"])]
    return {
        "values": {"front_pct": pct("front"), "side_pct": pct("side"), "down_pct": pct("down"),
                   "up_other_pct": pct("up_other"), "face_visible_pct": round(face_pct, 1),
                   "analysed_s": float(total)},
        "evidence": evidence,
    }


def run(session, spec: dict) -> dict:
    """Contract `criterion` dict for N2 (never raises)."""
    return safe_run(CODE, lambda: compute(session, spec), spec)
