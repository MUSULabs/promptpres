"""MediaPipe pose / hand / face at ~10 fps -> landmarks.parquet (one row per sampled frame).

ขั้นตอนต่อเฟรมที่สุ่ม (ทุก round(fps_ต้นฉบับ / 10) เฟรม):
  1. Pose (models/pose.task) บนภาพย่อกว้าง 960 px -> จมูก ไหล่ ข้อมือ พร้อม visibility
  2. Hand (models/hand.task) บนภาพย่อเดียวกัน -> ข้อมือของมือที่เจอ (จุดที่ 0) จับคู่เข้าข้างซ้าย/ขวา
     ของผู้พูดโดยดูว่าอยู่ใกล้ข้อมือของ Pose ข้างไหน (ไม่ใช้ป้าย handedness ของ MediaPipe เพราะขึ้นกับการกลับภาพ)
  3. Face (models/face.task) บน "ภาพตัดรอบศีรษะ" จากภาพเต็ม: สี่เหลี่ยมจัตุรัสรอบจมูก ด้านละ 2 x ความกว้างไหล่
     — โมเดลหน้าเป็นแบบระยะใกล้ บนภาพเต็มที่หน้าเล็กจะหาไม่เจอ (บทเรียนเฟส 1: 0/10 เฟรม vs 10/10 บนภาพตัด)
     -> facial transformation matrix -> yaw / pitch / roll (head_angles)

พิกัดทุกตัวเป็นพิกเซลของภาพเต็ม ("ซ้าย/ขวา" = ข้างของตัวผู้พูด ตามจุด Pose 11/12/15/16)
ช่องที่มองไม่เห็นเก็บเป็น NaN และ *_ok = False: มือหาย/ถูกบัง != มือนิ่ง, ไม่เห็นหน้า != หันตรง
เวลา t_s = เลขเฟรม / fps ของไฟล์ (วิดีโอ CFR หลัง prep, D-030)
config: pipeline-v0.yaml landmarks (fps, pose_width, head_crop_min_half_px, pose_visibility, hand_match_max_sw)
"""
from __future__ import annotations

from contextlib import ExitStack, contextmanager

import json
import math
import time
from pathlib import Path

import cv2
import numpy as np
import pandas as pd

from promptpres_shared.settings import MODELS_DIR

# Pose landmark indices (MediaPipe Pose, 33 points)
NOSE, L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST = 0, 11, 12, 15, 16
SIDES = ("l", "r")

COLUMNS = ["t_s", "frame", "width", "height", "pose_ok", "nose_x", "nose_y",
           "l_sh_x", "l_sh_y", "l_sh_vis", "r_sh_x", "r_sh_y", "r_sh_vis",
           "l_wr_x", "l_wr_y", "l_wr_vis", "r_wr_x", "r_wr_y", "r_wr_vis",
           "l_hand_ok", "l_hand_x", "l_hand_y", "r_hand_ok", "r_hand_x", "r_hand_y",
           "face_ok", "yaw", "pitch", "roll"]

# Sign of the pitch from the matrix: +1 keeps cv2's x-angle, -1 flips it.
# Project convention (config N2): pitch > 0 = head up, pitch < 0 = head down.
# Checked 14 Nov 2026 with tools/explore_n2.py on SC02 S09 (front / looking down at notes):
#   G07_P05_S09_T01 front ~ -2 deg, reading notes -15..-30 deg;
#   G09_P18_S09_T01 front ~ 0 deg, reading notes -13..-20 deg  -> cv2's x-angle must be flipped.
PITCH_SIGN = -1.0


# --------------------------------------------------------------------------- pure helpers
def sample_step(src_fps: float, target_fps: float) -> int:
    """Keep every n-th frame so that about target_fps frames per second are analysed."""
    return max(1, round(src_fps / target_fps))


def head_angles(matrix) -> tuple[float, float, float]:
    """(yaw, pitch, roll) in degrees from MediaPipe's 4x4 facial transformation matrix.

    1. take the 3x3 rotation part and make it a clean rotation (SVD: drop scale/shear)
    2. split it into angles about x (pitch), y (yaw), z (roll) with OpenCV's RQ decomposition
    3. apply the project sign: pitch < 0 = looking down, pitch > 0 = up; |yaw| = turned sideways
    """
    m = np.asarray(matrix, dtype=float)[:3, :3]
    u, _, vt = np.linalg.svd(m)
    rot = u @ vt
    angles = cv2.RQDecomp3x3(rot)[0]          # (about x, about y, about z) in degrees
    pitch, yaw, roll = PITCH_SIGN * angles[0], angles[1], angles[2]
    return float(yaw), float(pitch), float(roll)


def head_box(nose_xy: tuple[float, float], shoulder_w_px: float, width: int, height: int,
             min_half_px: float) -> tuple[int, int, int, int]:
    """Square (x0, y0, x1, y1) around the nose; half side = shoulder width (at least min_half_px)."""
    half = max(shoulder_w_px, min_half_px)
    cx, cy = nose_xy
    x0, y0 = max(int(cx - half), 0), max(int(cy - half), 0)
    x1, y1 = min(int(cx + half), width), min(int(cy + half), height)
    return x0, y0, max(x1, x0 + 1), max(y1, y0 + 1)


def assign_hands(hand_wrists: list[tuple[float, float]], pose_wrists: dict, shoulder_w_px: float,
                 max_sw: float) -> dict:
    """Give each detected hand to the nearer pose wrist ('l' / 'r'), if within max_sw shoulder widths.

    Returns {"l": (x, y) or None, "r": (x, y) or None}. Two hands never go to the same side:
    pairs are taken closest first.
    """
    out = {"l": None, "r": None}
    if not hand_wrists or shoulder_w_px <= 0:
        return out
    pairs = []
    for i, (hx, hy) in enumerate(hand_wrists):
        for side, p in pose_wrists.items():
            if p is not None:
                pairs.append((math.hypot(hx - p[0], hy - p[1]), i, side))
    used = set()
    for dist, i, side in sorted(pairs):
        if dist > max_sw * shoulder_w_px or i in used or out[side] is not None:
            continue
        out[side] = hand_wrists[i]
        used.add(i)
    return out


def empty_row(t_s: float, frame: int, width: int, height: int) -> dict:
    row = dict.fromkeys(COLUMNS, np.nan)
    row |= {"t_s": t_s, "frame": frame, "width": width, "height": height,
            "pose_ok": False, "l_hand_ok": False, "r_hand_ok": False, "face_ok": False}
    return row


# --------------------------------------------------------------------------- MediaPipe
@contextmanager
def load_models():
    """Pose + hand in VIDEO mode (tracking across frames), face in IMAGE mode (the crop moves)."""
    from mediapipe.tasks.python import BaseOptions, vision   # noqa: PLC0415 — heavy import

    def opts(name):
        return BaseOptions(model_asset_path=str(MODELS_DIR / name))
    video = vision.RunningMode.VIDEO
    with ExitStack() as cleanup:
        pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
            base_options=opts("pose.task"), running_mode=video, num_poses=1))
        cleanup.callback(pose.close)
        hand = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
            base_options=opts("hand.task"), running_mode=video, num_hands=2))
        cleanup.callback(hand.close)
        face = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=opts("face.task"), num_faces=1, output_facial_transformation_matrixes=True))
        cleanup.callback(face.close)
        yield pose, hand, face


def as_image(bgr):
    import mediapipe as mp   # noqa: PLC0415
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    return mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))


def analyse_frame(full, small, t_ms: int, models, cfg: dict, row: dict) -> dict:
    """Fill one row from one frame (full = original size, small = pose_width wide)."""
    pose, hand, face = models
    h, w = full.shape[:2]
    image = as_image(small)
    p = pose.detect_for_video(image, t_ms).pose_landmarks
    hands = hand.detect_for_video(image, t_ms).hand_landmarks
    if not p:
        return row
    L = p[0]

    def px(k):
        return L[k].x * w, L[k].y * h

    row["pose_ok"] = True
    row["nose_x"], row["nose_y"] = px(NOSE)
    for side, sh, wr in (("l", L_SHOULDER, L_WRIST), ("r", R_SHOULDER, R_WRIST)):
        row[f"{side}_sh_x"], row[f"{side}_sh_y"] = px(sh)
        row[f"{side}_sh_vis"] = float(L[sh].visibility or 0.0)
        row[f"{side}_wr_x"], row[f"{side}_wr_y"] = px(wr)
        row[f"{side}_wr_vis"] = float(L[wr].visibility or 0.0)
    shoulder_w = math.hypot(row["l_sh_x"] - row["r_sh_x"], row["l_sh_y"] - row["r_sh_y"])

    hand_wrists = [(hl[0].x * w, hl[0].y * h) for hl in hands]
    pose_wrists = {s: (row[f"{s}_wr_x"], row[f"{s}_wr_y"]) for s in SIDES}
    for side, xy in assign_hands(hand_wrists, pose_wrists, shoulder_w, cfg["hand_match_max_sw"]).items():
        if xy is not None:
            row[f"{side}_hand_ok"] = True
            row[f"{side}_hand_x"], row[f"{side}_hand_y"] = xy

    x0, y0, x1, y1 = head_box(px(NOSE), shoulder_w, w, h, cfg["head_crop_min_half_px"])
    crop = full[y0:y1, x0:x1]
    if crop.size:
        fr = face.detect(as_image(crop))
        if fr.face_landmarks and fr.facial_transformation_matrixes:
            row["face_ok"] = True
            row["yaw"], row["pitch"], row["roll"] = head_angles(fr.facial_transformation_matrixes[0])
    return row


def extract(video_mp4: Path, out_parquet: Path, cfg: dict) -> pd.DataFrame:
    """Write landmarks.parquet + landmarks.json next to it; return the table."""
    t0 = time.perf_counter()
    cap = cv2.VideoCapture(str(video_mp4))
    with ExitStack() as cleanup:
        cleanup.callback(cap.release)
        if not cap.isOpened():
            raise RuntimeError(f"เปิดวิดีโอไม่ได้: {video_mp4}")
        src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        step = sample_step(src_fps, cfg["fps"])
        models = cleanup.enter_context(load_models())
        rows, i = [], 0
        while True:
            if i % step:
                if not cap.grab():          # skip without decoding into a picture
                    break
                i += 1
                continue
            ok, full = cap.read()
            if not ok:
                break
            h, w = full.shape[:2]
            small = cv2.resize(full, (cfg["pose_width"], round(h * cfg["pose_width"] / w))) \
                if w > cfg["pose_width"] else full
            t_s = i / src_fps
            row = empty_row(round(t_s, 3), i, w, h)
            rows.append(analyse_frame(full, small, int(round(t_s * 1000)), models, cfg, row))
            i += 1
    df = pd.DataFrame(rows, columns=COLUMNS)
    df.to_parquet(out_parquet, index=False)
    info = {"models": ["pose.task", "hand.task", "face.task"], "source_fps": src_fps, "step": step,
            "frames": len(df), "pose_pct": _pct(df["pose_ok"]), "face_pct": _pct(df["face_ok"]),
            "both_hands_pct": _pct(df["l_hand_ok"] & df["r_hand_ok"]),
            "seconds": round(time.perf_counter() - t0, 1)}
    Path(out_parquet).with_suffix(".json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    return df


def _pct(mask: pd.Series) -> float:
    return round(100 * float(mask.mean()), 1) if len(mask) else 0.0
