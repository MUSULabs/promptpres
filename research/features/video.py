"""One video -> feature table (Parquet or CSV) + <name>.meta.json with all versions.

Per grid frame (GridSampler, features_v2.yaml grid_fps, real decoded timestamps kept):
  1. Pose (models/pose.task, VIDEO mode) on a copy pose_width wide -> 21 upper-body points with
     visibility and presence.
  2. Hand (models/hand.task, VIDEO mode, 2 hands) on the same copy -> 21 points per hand, given to
     the speaker's left/right by the nearer pose wrist (geometry.match_hands).
  3. Face (models/face.task, IMAGE mode) on a square crop around the nose taken from the full frame
     (the face model is short-range; same crop rule as production) -> head yaw/pitch/roll from the
     facial transformation matrix (production head_angles, same sign convention), eye corners,
     eyelids, iris centres, eye blendshapes, face box and face-region brightness.
Then table.derive() adds the derived per-frame features. Coordinates are full-frame pixels.

Run one video:  python -m research.features.video VIDEO OUT.parquet
"""
from __future__ import annotations

import argparse
import json
import math
import time
from contextlib import ExitStack, contextmanager
from pathlib import Path

import cv2
import numpy as np
import pandas as pd

from promptpres_shared.settings import MODELS_DIR
from research.features import EXTRACTOR_VERSION, provenance
from research.features import geometry as g
from research.features import table as tb
from worker.extract.landmarks import (  # read-only reuse of production helpers
    head_angles,
    head_box,
)


# --------------------------------------------------------------------------- MediaPipe
@contextmanager
def load_models(models_dir: Path):
    """Pose + hand in VIDEO mode (tracking across frames), face in IMAGE mode (the crop moves)."""
    from mediapipe.tasks.python import (
        BaseOptions,
        vision,
    )

    def opts(name):
        return BaseOptions(model_asset_path=str(Path(models_dir) / name))
    video = vision.RunningMode.VIDEO
    with ExitStack() as cleanup:
        pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
            base_options=opts("pose.task"), running_mode=video, num_poses=1))
        cleanup.callback(pose.close)
        hand = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
            base_options=opts("hand.task"), running_mode=video, num_hands=2))
        cleanup.callback(hand.close)
        face = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=opts("face.task"), num_faces=1, output_face_blendshapes=True,
            output_facial_transformation_matrixes=True))
        cleanup.callback(face.close)
        yield pose, hand, face


def as_image(bgr):
    import mediapipe as mp
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    return mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))


def fill_pose(row: dict, landmarks, w: int, h: int) -> None:
    row["pose_ok"] = True
    for name, k in tb.POSE_POINTS.items():
        lm = landmarks[k]
        row[f"p_{name}_x"], row[f"p_{name}_y"] = lm.x * w, lm.y * h
        row[f"p_{name}_vis"] = float(lm.visibility or 0.0)
        row[f"p_{name}_pres"] = float(lm.presence or 0.0)


def fill_hands(row: dict, result, w: int, h: int, params: dict) -> None:
    """Put each detected hand on the speaker's side whose pose wrist is nearer."""
    hands = result.hand_landmarks
    wrists = [(hl[0].x * w, hl[0].y * h) for hl in hands]
    pose_wrists = {s: (row[f"p_{s}_wr_x"], row[f"p_{s}_wr_y"]) for s in tb.SIDES}
    shoulder_w = math.hypot(row["p_l_sh_x"] - row["p_r_sh_x"], row["p_l_sh_y"] - row["p_r_sh_y"])
    for side, i in g.match_hands(wrists, pose_wrists, shoulder_w, params["hand_match_max_sw"]).items():
        if i is None:
            continue
        row[f"{side}_hand_ok"] = True
        row[f"{side}_hand_score"] = float(result.handedness[i][0].score) if result.handedness else np.nan
        for k, lm in enumerate(hands[i]):
            row[f"h{side}_{k:02d}_x"], row[f"h{side}_{k:02d}_y"] = lm.x * w, lm.y * h
            row[f"h{side}_{k:02d}_z"] = lm.z


def fill_face(row: dict, full, face_model, params: dict) -> None:
    """Face on a crop around the nose; every output is converted back to full-frame pixels."""
    h, w = full.shape[:2]
    nose = (row["p_nose_x"], row["p_nose_y"])
    shoulder_w = math.hypot(row["p_l_sh_x"] - row["p_r_sh_x"], row["p_l_sh_y"] - row["p_r_sh_y"])
    x0, y0, x1, y1 = head_box(nose, shoulder_w, w, h, params["head_crop_min_half_px"])
    crop = full[y0:y1, x0:x1]
    if not crop.size:
        return
    res = face_model.detect(as_image(crop))
    if not (res.face_landmarks and res.facial_transformation_matrixes):
        return
    cw, ch = x1 - x0, y1 - y0
    pts = np.array([(x0 + lm.x * cw, y0 + lm.y * ch) for lm in res.face_landmarks[0]])
    matrix = np.asarray(res.facial_transformation_matrixes[0], float)
    row["face_ok"] = True
    row["yaw"], row["pitch"], row["roll"] = head_angles(matrix)
    row["face_tz"] = float(matrix[2, 3])
    fx0, fy0 = pts.min(axis=0)
    fx1, fy1 = pts.max(axis=0)
    row["face_x0"], row["face_y0"], row["face_x1"], row["face_y1"] = fx0, fy0, fx1, fy1
    box = full[max(int(fy0), 0):min(int(fy1) + 1, h), max(int(fx0), 0):min(int(fx1) + 1, w)]
    if box.size:
        row["face_illum"] = float(cv2.cvtColor(box, cv2.COLOR_BGR2GRAY).mean())
    for eye, parts in tb.EYE_POINTS.items():
        for part, k in parts.items():
            if k < len(pts):
                row[f"f_{eye}_{part}_x"], row[f"f_{eye}_{part}_y"] = pts[k]
    if res.face_blendshapes:
        scores = {c.category_name: c.score for c in res.face_blendshapes[0]}
        for name in tb.EYE_BLENDSHAPES:
            row[f"bs_{name}"] = float(scores.get(name, np.nan))


def analyse_frame(full, ts_ms: int, models, params: dict, row: dict) -> dict:
    """Fill one raw row from one frame."""
    pose, hand, face = models
    h, w = full.shape[:2]
    small = full
    if w > params["pose_width"]:
        small = cv2.resize(full, (params["pose_width"], round(h * params["pose_width"] / w)))
    image = as_image(small)
    pose_res = pose.detect_for_video(image, ts_ms)
    hand_res = hand.detect_for_video(image, ts_ms)
    if not pose_res.pose_landmarks:
        return row
    fill_pose(row, pose_res.pose_landmarks[0], w, h)
    fill_hands(row, hand_res, w, h, params)
    fill_face(row, full, face, params)
    return row


# --------------------------------------------------------------------------- video loop
def grid_frames(cap, sampler: g.GridSampler, stats: dict):
    """Yield (grid t_s, real frame time, frame) for the frames that fill the grid.

    The real time is the decoder's timestamp of that frame (correct for variable-rate WebM). If the
    decoder gives no increasing timestamps, frame index / container fps is used and counted.
    """
    fps = cap.get(cv2.CAP_PROP_FPS)
    fallback_fps = fps if 1 <= fps <= 240 else 30.0
    stats.update(container_fps=fps, frames_decoded=0, pts_fallbacks=0)
    last = -1.0
    while cap.grab():
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        if stats["frames_decoded"] and t <= last:
            t = last + 1.0 / fallback_fps
            stats["pts_fallbacks"] += 1
        stats["frames_decoded"] += 1
        last = t
        grid_t = sampler.take(t)
        if grid_t is None:
            continue
        ok, frame = cap.retrieve()
        if ok:
            yield grid_t, round(t, 6), frame


def thumb_diff(frame, prev, params: dict):
    """Small grey copy of the frame and its mean absolute difference to the previous sampled one."""
    small = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), tuple(params["thumb_size"]),
                       interpolation=cv2.INTER_AREA).astype(np.float32)
    diff = float(np.abs(small - prev).mean()) if prev is not None else float("nan")
    return small, diff


def extract_rows(video: Path, models_dir: Path, params: dict, stats: dict) -> list[dict]:
    cap = cv2.VideoCapture(str(video))
    rows: list[dict] = []
    with ExitStack() as cleanup:
        cleanup.callback(cap.release)
        if not cap.isOpened():
            raise RuntimeError(f"cannot open video: {video}")
        models = cleanup.enter_context(load_models(models_dir))
        sampler = g.GridSampler(params["grid_fps"], params["grid_tolerance_s"])
        prev, last_ms = None, -1
        for grid_t, frame_t, frame in grid_frames(cap, sampler, stats):
            h, w = frame.shape[:2]
            row = tb.empty_row(grid_t, frame_t, w, h)
            prev, row["frame_diff"] = thumb_diff(frame, prev, params)
            row["dup_frame"] = bool(row["frame_diff"] < params["dup_diff_max"])
            ts_ms = max(round(frame_t * 1000), last_ms + 1)   # MediaPipe needs increasing ms
            last_ms = ts_ms
            rows.append(analyse_frame(frame, ts_ms, models, params, row))
    return rows


def write_table(df: pd.DataFrame, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.suffix.lower() == ".csv":
        df.to_csv(out, index=False)
    else:
        df.to_parquet(out, index=False)


def meta_path(out: Path) -> Path:
    return out.with_name(out.stem + ".meta.json")


def _pct(series) -> float:
    return round(100 * float(np.mean(series)), 1) if len(series) else 0.0


def summary(df: pd.DataFrame) -> dict:
    lag = (df["frame_t_s"] - df["t_s"]).to_numpy(float)
    return {
        "rows": len(df),
        "frame_lag_s": {"median": round(float(np.median(lag)), 4) if len(lag) else None,
                        "max": round(float(np.max(lag)), 4) if len(lag) else None},
        "dup_frame_pct": _pct(df["dup_frame"]),
        "pose_pct": _pct(df["pose_ok"]), "face_pct": _pct(df["face_ok"]),
        "l_hand_pct": _pct(df["l_hand_ok"]), "r_hand_pct": _pct(df["r_hand_ok"]),
        "n1_obs_pct": {str(k): _pct(df["n1_obs"] == k) for k in (0, 1, 2)},
        "n2_obs_pct": {str(k): _pct(df["n2_obs"] == k) for k in (0, 1, 2)},
    }


def extract_video(video: Path, out: Path, params: dict | None = None,
                  models_dir: Path = MODELS_DIR, extra_meta: dict | None = None) -> pd.DataFrame:
    """Write the feature table to `out` (.parquet or .csv) and `<stem>.meta.json`; return the table."""
    video, out = Path(video), Path(out)
    params = params or provenance.load_params()
    missing = provenance.missing_models(models_dir)
    if missing:
        raise FileNotFoundError(f"MediaPipe model files missing in {models_dir}: {missing} "
                                "(not downloaded automatically; ask the owner)")
    t0 = time.perf_counter()
    stats: dict = {}
    raw = pd.DataFrame(extract_rows(video, models_dir, params, stats), columns=tb.RAW_COLUMNS)
    df = tb.derive(raw, params)
    write_table(df, out)
    runtime = time.perf_counter() - t0
    duration = float(df["frame_t_s"].max()) if len(df) else 0.0
    meta = {
        "extractor": "research.features", "extractor_version": EXTRACTOR_VERSION,
        "params": params, "params_sha256": provenance.params_hash(params),
        "feature_set_sha256": provenance.feature_set_hash(list(df.columns), params),
        "columns": len(df.columns), "time_base": "seconds from the start of the source video",
        "models": provenance.model_info(str(models_dir)),
        "libraries": provenance.library_versions(), "code": provenance.code_version(),
        "source": {"path": str(video), "bytes": video.stat().st_size,
                   "sha256": provenance.sha256_file(video), **stats, "duration_s": round(duration, 3)},
        "summary": summary(df),
        "runtime_s": round(runtime, 1),
        "processed_rows_per_s": round(len(df) / runtime, 2) if runtime else None,
        "runtime_per_video_s": round(runtime / duration, 3) if duration else None,
        **(extra_meta or {}),
    }
    meta_path(out).write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    return df


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("video", type=Path)
    ap.add_argument("out", type=Path, help=".parquet (default) or .csv")
    ap.add_argument("--models", type=Path, default=MODELS_DIR)
    args = ap.parse_args(argv)
    df = extract_video(args.video, args.out, models_dir=args.models)
    print(json.dumps(summary(df), indent=2))


if __name__ == "__main__":
    main()
