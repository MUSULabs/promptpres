"""N1: การใช้ท่าทางมือประกอบการพูด — วัดช่วงมือนิ่งต่อเนื่อง (Continuous hand-still spans) — ไม่ตีความความหมายของท่ามือ

อ่าน: landmarks.parquet (ข้อมือจากโมเดลมือ l_hand_*/r_hand_*, ไหล่จาก Pose)
ค่าที่รายงาน: long_still_per_min, max_still_s (ใช้คิดระดับ)
             hands_visible_pct, hands_active_pct, long_still_spans (ข้อมูลประกอบ ห้ามใช้คิดระดับ D-028)
วิธีคิด:
  1. ดูเฉพาะช่วงพูด (จาก VAD) ถ้าไม่มีเสียงใช้ทั้งคลิป
  2. ตำแหน่งข้อมือเทียบจุดกึ่งกลางไหล่ หารด้วยความกว้างไหล่ (ค่ามัธยฐานทั้งคลิป) -> หน่วย "ความกว้างไหล่"
  3. ความเร็ว = ระยะที่ข้อมือเลื่อนระหว่างเฟรมติดกัน / เวลาระหว่างเฟรม (ความกว้างไหล่ต่อวินาที)
     คิดได้เฉพาะเมื่อเห็นมือข้างนั้นทั้งสองเฟรม แล้วเฉลี่ยเคลื่อนที่แบบกึ่งกลาง smooth_s วินาที (ลดการสั่นของจุด)
  4. สถานะต่อเฟรม:
       นิ่ง    = เห็นมือทั้งสองข้าง และความเร็วทั้งสองข้าง < motion_threshold
       ขยับ    = มือข้างที่เห็นข้างใดข้างหนึ่งเร็ว >= motion_threshold
       ไม่ทราบ = นอกนั้น (มือหลุดเฟรม/ถูกบัง/เพิ่งกลับมาเห็น) — **ไม่นับว่านิ่งเด็ดขาด**
  5. ช่วงนิ่ง = เฟรม "นิ่ง" ติดกัน; เฟรมขยับหรือไม่ทราบตัดช่วงทันที (ไม่เชื่อมช่องว่าง)
     ช่วงที่ยาว >= long_still_s = 1 ช่วงมือนิ่งต่อเนื่อง
  6. long_still_per_min = จำนวนช่วง / นาทีที่วิเคราะห์ ; max_still_s = ช่วงนิ่งที่ยาวที่สุด (0 ถ้าไม่มี)
วิเคราะห์ไม่ได้: ไม่มีข้อมูล, หาความกว้างไหล่ไม่ได้, หรือเห็นมือทั้งสองข้างน้อยกว่า min_hands_visible_pct ของเวลา
config: thresholds-v0.yaml criteria.N1 (motion_threshold, long_still_s, smooth_s, levels, min_hands_visible_pct)
วิธี: ความกว้างไหล่มัธยฐานเป็นหน่วยเทียบ, ต้องเห็นทั้งสองข้าง, ไม่เชื่อมช่องว่าง (แนวคิดจากต้นแบบเดิม) + การทำให้เรียบตาม SPEC_V2
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from worker.criteria.base import Unanalyzable, safe_run
from worker.criteria.n2 import in_window

CODE = "N1"
STILL, MOVING, UNKNOWN = "still", "moving", "unknown"


def hand_speed(df: pd.DataFrame, side: str, shoulder_w: float, dt: float, smooth_s: float) -> np.ndarray:
    """Wrist speed of one hand in shoulder widths per second; NaN where it cannot be measured."""
    mid_x = (df["l_sh_x"] + df["r_sh_x"]) / 2
    mid_y = (df["l_sh_y"] + df["r_sh_y"]) / 2
    x = ((df[f"{side}_hand_x"] - mid_x) / shoulder_w).to_numpy(float)
    y = ((df[f"{side}_hand_y"] - mid_y) / shoulder_w).to_numpy(float)
    seen = (df[f"{side}_hand_ok"].astype(bool) & df["pose_ok"].astype(bool)).to_numpy()
    t = df["t_s"].to_numpy(float)

    speed = np.full(len(df), np.nan)
    for i in range(1, len(df)):
        gap = t[i] - t[i - 1]
        if seen[i] and seen[i - 1] and 0 < gap <= 1.5 * dt:
            speed[i] = np.hypot(x[i] - x[i - 1], y[i] - y[i - 1]) / gap

    window = max(1, int(round(smooth_s / dt)))
    smooth = pd.Series(speed).rolling(window, center=True, min_periods=1).mean().to_numpy(copy=True)
    smooth[np.isnan(speed)] = np.nan          # a frame we could not measure stays unknown
    return smooth


def frame_states(left: np.ndarray, right: np.ndarray, threshold: float) -> list[str]:
    out = []
    for a, b in zip(left, right):
        if (not np.isnan(a) and a >= threshold) or (not np.isnan(b) and b >= threshold):
            out.append(MOVING)
        elif not np.isnan(a) and not np.isnan(b):
            out.append(STILL)                    # both hands seen and both slow
        else:
            out.append(UNKNOWN)
    return out


def still_spans(states: list[str], t: np.ndarray, dt: float) -> list[dict]:
    """Runs of consecutive STILL frames -> [{start_s, end_s, seconds}]; each frame stands for dt seconds."""
    spans, start = [], None
    for i, s in enumerate(states + [UNKNOWN]):
        if s == STILL and start is None:
            start = i
        elif s != STILL and start is not None:
            spans.append({"start_s": float(t[start]), "end_s": float(t[i - 1] + dt), "seconds": (i - start) * dt})
            start = None
    return spans


def compute(session, spec: dict) -> dict:
    df = session.landmarks
    if df is None or df.empty:
        raise Unanalyzable("ไม่มีข้อมูลจุดสำคัญของร่างกายจากวิดีโอ")
    df = in_window(df, session.speech_window()).reset_index(drop=True)
    if len(df) < 2:
        raise Unanalyzable("ไม่มีช่วงวิดีโอระหว่างที่พูด")

    both_seen = df["l_hand_ok"].astype(bool) & df["r_hand_ok"].astype(bool)
    visible_pct = 100 * float(both_seen.mean())
    need = spec["unanalyzable"]["min_hands_visible_pct"]
    if visible_pct < need:
        raise Unanalyzable(f"เห็นมือทั้งสองข้างเพียง {visible_pct:.0f}% ของเวลาพูด (ต้องอย่างน้อย {need}%) "
                           "— มือหลุดเฟรมหรือถูกบังไม่นับว่านิ่ง")
    pose = df[df["pose_ok"].astype(bool)]
    shoulder_w = float(np.median(np.hypot(pose["l_sh_x"] - pose["r_sh_x"], pose["l_sh_y"] - pose["r_sh_y"])))
    if not shoulder_w > 0:
        raise Unanalyzable("หาความกว้างไหล่ไม่ได้ จึงวัดการขยับมือไม่ได้")

    t = df["t_s"].to_numpy(float)
    dt = float(np.median(np.diff(t)))
    left = hand_speed(df, "l", shoulder_w, dt, spec["smooth_s"])
    right = hand_speed(df, "r", shoulder_w, dt, spec["smooth_s"])
    states = frame_states(left, right, spec["motion_threshold"])
    spans = still_spans(states, t, dt)
    long_spans = [s for s in spans if s["seconds"] >= spec["long_still_s"] - 1e-9]

    minutes = len(df) * dt / 60
    judged = sum(s != UNKNOWN for s in states)
    return {
        "values": {
            "long_still_per_min": round(len(long_spans) / minutes, 2),
            "max_still_s": round(max((s["seconds"] for s in spans), default=0.0), 1),
            "long_still_spans": len(long_spans),
            "hands_visible_pct": round(visible_pct, 1),
            "hands_active_pct": round(100 * states.count(MOVING) / judged, 1) if judged else None,
        },
        "evidence": [{"start_s": round(s["start_s"], 2), "end_s": round(s["end_s"], 2),
                      "note": f"มือนิ่งต่อเนื่อง {s['seconds']:.0f} วินาที"} for s in long_spans],
    }


def run(session, spec: dict) -> dict:
    """Contract `criterion` dict for N1 (never raises)."""
    return safe_run(CODE, lambda: compute(session, spec), spec)
