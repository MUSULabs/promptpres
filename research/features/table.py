"""Raw per-frame landmark columns and the derived per-frame features (pure pandas / numpy).

video.py fills one RAW row per grid frame (names below). derive() adds the DERIVED columns from the
whole raw table of one clip. Nothing here looks at labels or scenario ids.

"Left" / "right" (l / r) always mean the SPEAKER's side, as MediaPipe Pose names them.
Missing = NaN (and *_ok = False): a hand that is not seen is not a still hand, a face that is not
seen is not a face turned to the camera.
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd

from research.features import geometry as g

SIDES = ("l", "r")

# MediaPipe Pose (33 points): the upper body points the features use
POSE_POINTS = {
    "nose": 0, "l_eye": 2, "r_eye": 5, "l_ear": 7, "r_ear": 8, "mouth_l": 9, "mouth_r": 10,
    "l_sh": 11, "r_sh": 12, "l_el": 13, "r_el": 14, "l_wr": 15, "r_wr": 16,
    "l_pinky": 17, "r_pinky": 18, "l_index": 19, "r_index": 20, "l_thumb": 21, "r_thumb": 22,
    "l_hip": 23, "r_hip": 24,
}
HAND_POINTS = 21                     # MediaPipe Hand: 0 = wrist, 9 = middle-finger base, 4/8/12/16/20 = tips
FINGER_TIPS = (4, 8, 12, 16, 20)
# MediaPipe Face mesh (478 points with iris). Names = the subject's own eye, as in MediaPipe's
# FACEMESH_LEFT_EYE / LEFT_IRIS. outer/inner = eye corners, top/bottom = eyelid middles.
EYE_POINTS = {
    "l": {"outer": 263, "inner": 362, "top": 386, "bottom": 374, "iris": 473},
    "r": {"outer": 33, "inner": 133, "top": 159, "bottom": 145, "iris": 468},
}
EYE_BLENDSHAPES = [f"eye{kind}{side}" for kind in ("Blink", "LookDown", "LookIn", "LookOut",
                                                   "LookUp", "Squint", "Wide")
                   for side in ("Left", "Right")]

FRAME_COLUMNS = ["t_s", "frame_t_s", "width", "height", "frame_diff", "dup_frame"]
POSE_COLUMNS = ["pose_ok"] + [f"p_{n}_{c}" for n in POSE_POINTS for c in ("x", "y", "vis", "pres")]
HAND_COLUMNS = [c for s in SIDES for c in
                [f"{s}_hand_ok", f"{s}_hand_score"]
                + [f"h{s}_{k:02d}_{a}" for k in range(HAND_POINTS) for a in ("x", "y", "z")]]
FACE_COLUMNS = (["face_ok", "yaw", "pitch", "roll", "face_tz",
                 "face_x0", "face_y0", "face_x1", "face_y1", "face_illum"]
                + [f"f_{e}_{p}_{a}" for e in EYE_POINTS for p in EYE_POINTS[e] for a in ("x", "y")]
                + [f"bs_{b}" for b in EYE_BLENDSHAPES])
RAW_COLUMNS = FRAME_COLUMNS + POSE_COLUMNS + HAND_COLUMNS + FACE_COLUMNS
BOOL_COLUMNS = ["dup_frame", "pose_ok", "l_hand_ok", "r_hand_ok", "face_ok"]

DERIVED_COLUMNS = (
    ["sw_px", "sw_ref_px"]
    + [f"{s}_{c}" for s in SIDES for c in (
        "wr_src", "wr_nx", "wr_ny", "wr_out", "wr_torso_d", "el_nx", "el_ny", "elbow_deg",
        "hand_cx", "hand_cy", "hand_face_d", "hand_open",
        "wr_speed", "wr_acc", "wr_jerk", "hand_motion")]
    + ["hands_d", "hands_mid_ny", "hands_sym", "motion_energy", "n_wrists_seen", "n_hands_landmarked"]
    + [f"eye_{e}_{c}" for e in EYE_POINTS for c in ("w_px", "ok", "u", "v", "open")]
    + ["iris_x", "iris_y", "eye_open", "face_w_frac", "n1_obs", "n2_obs"]
)


def empty_row(t_s: float, frame_t_s: float, width: int, height: int) -> dict:
    """One raw row with nothing detected yet."""
    row = dict.fromkeys(RAW_COLUMNS, np.nan)
    row |= {"t_s": t_s, "frame_t_s": frame_t_s, "width": width, "height": height}
    row |= dict.fromkeys(BOOL_COLUMNS, False)
    return row


# --------------------------------------------------------------------------- small helpers
def xy(df: pd.DataFrame, prefix: str) -> np.ndarray:
    """(n, 2) array of columns prefix_x, prefix_y."""
    return df[[f"{prefix}_x", f"{prefix}_y"]].to_numpy(float, copy=True)


def pose_xy(df: pd.DataFrame, name: str, vis_min: float) -> np.ndarray:
    """Pose point as (n, 2) pixels; NaN where pose was not found or visibility < vis_min."""
    p = xy(df, f"p_{name}")
    seen = df["pose_ok"].to_numpy(bool) & (df[f"p_{name}_vis"].to_numpy(float) >= vis_min)
    p[~seen] = np.nan
    return p


def hand_xy(df: pd.DataFrame, side: str) -> np.ndarray:
    """All 21 hand points of one side as (n, 21, 2) pixels; NaN where the hand was not found."""
    cols = [f"h{side}_{k:02d}_{a}" for k in range(HAND_POINTS) for a in ("x", "y")]
    h = df[cols].to_numpy(float, copy=True).reshape(len(df), HAND_POINTS, 2)
    h[~df[f"{side}_hand_ok"].to_numpy(bool)] = np.nan
    return h


def nanmean_rows(a: np.ndarray) -> np.ndarray:
    """Mean over axis 1 ignoring NaN; a row with no value stays NaN (no RuntimeWarning)."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmean(a, axis=1)


def nanmedian_all(a: np.ndarray) -> float:
    a = np.asarray(a, float)
    a = a[np.isfinite(a)]
    return float(np.median(a)) if a.size else float("nan")


# --------------------------------------------------------------------------- derived features
def torso(df: pd.DataFrame, vis_min: float):
    """Torso origin (mid-shoulder), per-frame shoulder width, and the clip's reference width.

    The reference width is the median shoulder width over the clip's own frames (no labels used):
    one fixed scale per clip, so turning the shoulders does not change hand distances.
    """
    sh_l, sh_r = pose_xy(df, "l_sh", vis_min), pose_xy(df, "r_sh", vis_min)
    origin = (sh_l + sh_r) / 2
    sw = g.dist(sh_l, sh_r)
    return origin, sw, nanmedian_all(sw)


def side_features(df: pd.DataFrame, side: str, origin, sw_ref: float, p: dict) -> dict:
    """Wrist / elbow / hand features of one side (N1)."""
    vis_min = p["pose_vis_min"]
    hand = hand_xy(df, side)
    hand_ok = df[f"{side}_hand_ok"].to_numpy(bool)
    pose_wr = pose_xy(df, f"{side}_wr", vis_min)
    # wrist: the hand model's wrist point when it found the hand, else the pose wrist
    wr = np.where(hand_ok[:, None], hand[:, 0], pose_wr)
    src = np.where(hand_ok, 2, np.where(np.isfinite(pose_wr[:, 0]), 1, 0))
    el = pose_xy(df, f"{side}_el", vis_min)
    sh = pose_xy(df, f"{side}_sh", vis_min)
    centre = np.where(hand_ok[:, None], nanmean_rows(hand), wr)
    nose = pose_xy(df, "nose", vis_min)

    wr_n = g.normalise(wr, origin, sw_ref)
    el_n = g.normalise(el, origin, sw_ref)
    centre_n = g.normalise(centre, origin, sw_ref)
    outward = 1.0 if side == "l" else -1.0       # speaker's left shows on the image right
    t = df["frame_t_s"].to_numpy(float)
    switched = np.r_[False, src[1:] != src[:-1]]
    speed, acc, jerk = g.motion_magnitudes(wr_n, t, p["max_dt_s"], breaks=switched)
    hand_vel, _ = g.finite_diff(g.normalise(hand, origin, sw_ref), t, p["max_dt_s"])
    tips = hand[:, list(FINGER_TIPS)]
    hand_size = g.dist(hand[:, 0], hand[:, 9])
    tip_d = np.hypot(*(tips - hand[:, :1]).transpose(2, 0, 1))
    return {
        f"{side}_wr_src": src,
        f"{side}_wr_nx": wr_n[:, 0], f"{side}_wr_ny": wr_n[:, 1],
        f"{side}_wr_out": outward * wr_n[:, 0],
        f"{side}_wr_torso_d": np.hypot(wr_n[:, 0], wr_n[:, 1]),
        f"{side}_el_nx": el_n[:, 0], f"{side}_el_ny": el_n[:, 1],
        f"{side}_elbow_deg": g.angle_deg(sh, el, wr),
        f"{side}_hand_cx": centre_n[:, 0], f"{side}_hand_cy": centre_n[:, 1],
        f"{side}_hand_face_d": g.dist(centre, nose) / sw_ref,
        f"{side}_hand_open": tip_d.mean(axis=1) / hand_size,
        f"{side}_wr_speed": speed, f"{side}_wr_acc": acc, f"{side}_wr_jerk": jerk,
        f"{side}_hand_motion": np.hypot(hand_vel[..., 0], hand_vel[..., 1]).mean(axis=1),
    }


def pair_features(f: dict, df: pd.DataFrame, origin, sw_ref: float, p: dict) -> dict:
    """Both-hand features: hand-hand distance, height of the two hands, symmetry, motion energy."""
    lc = np.stack([f["l_hand_cx"], f["l_hand_cy"]], 1)
    rc = np.stack([f["r_hand_cx"], f["r_hand_cy"]], 1)
    t = df["frame_t_s"].to_numpy(float)
    speeds2 = []
    for name in ("l_el", "r_el", "l_wr", "r_wr"):      # pose arm points only: one source, no switching
        pt = g.normalise(pose_xy(df, name, p["pose_vis_min"]), origin, sw_ref)
        speed, _, _ = g.motion_magnitudes(pt, t, p["max_dt_s"])
        speeds2.append(speed**2)
    return {
        "hands_d": g.dist(lc, rc),
        "hands_mid_ny": (lc[:, 1] + rc[:, 1]) / 2,
        "hands_sym": np.hypot(f["l_wr_out"] - f["r_wr_out"], f["l_wr_ny"] - f["r_wr_ny"]),
        "motion_energy": nanmean_rows(np.stack(speeds2, 1)),
        "n_wrists_seen": (f["l_wr_src"] > 0).astype(int) + (f["r_wr_src"] > 0).astype(int),
        "n_hands_landmarked": df["l_hand_ok"].astype(int).to_numpy()
        + df["r_hand_ok"].astype(int).to_numpy(),
    }


def eye_features(df: pd.DataFrame, p: dict) -> dict:
    """Iris position, eyelid openness and quality per eye, plus both-eye summaries (N2).

    iris_x: iris position between the eye corners measured image-left -> image-right (0..1), so
    both eyes agree when the eyes turn; iris_y: mean offset towards the lower lid, in eye widths.
    An eye is used only when the face was found and the eye is at least min_eye_width_px wide.
    """
    face_ok = df["face_ok"].to_numpy(bool)
    out, xs, ys, opens = {}, [], [], []
    for e, parts in EYE_POINTS.items():
        pts = {k: xy(df, f"f_{e}_{k}") for k in parts}
        width = g.dist(pts["outer"], pts["inner"])
        ok = face_ok & (width >= p["min_eye_width_px"])
        u, v = g.eye_iris_position(pts["outer"], pts["inner"], pts["iris"])
        opening = g.eye_openness(pts["outer"], pts["inner"], pts["top"], pts["bottom"])
        u, v, opening = (np.where(ok, a, np.nan) for a in (u, v, opening))
        inner_right = pts["inner"][:, 0] > pts["outer"][:, 0]
        xs.append(np.where(inner_right, u, 1 - u))
        ys.append(v)
        opens.append(opening)
        out |= {f"eye_{e}_w_px": width, f"eye_{e}_ok": ok, f"eye_{e}_u": u,
                f"eye_{e}_v": v, f"eye_{e}_open": opening}
    out |= {"iris_x": nanmean_rows(np.stack(xs, 1)), "iris_y": nanmean_rows(np.stack(ys, 1)),
            "eye_open": nanmean_rows(np.stack(opens, 1)),
            "face_w_frac": (df["face_x1"] - df["face_x0"]).to_numpy(float)
            / df["width"].to_numpy(float)}
    return out


def derive(raw: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Raw table of one clip -> raw + derived columns (order = RAW_COLUMNS + DERIVED_COLUMNS).

    Quality flags (inputs for UNOBSERVABLE; they are features, never labels):
      n1_obs = how many wrists were seen (0, 1, 2), from the hand model or a pose wrist;
      n2_obs = 0 no face, 1 face (head angles) but no usable eye, 2 face and at least one usable eye.
    """
    df = raw.reset_index(drop=True)
    if df.empty:
        return pd.DataFrame(columns=RAW_COLUMNS + DERIVED_COLUMNS)
    origin, sw, sw_ref = torso(df, params["pose_vis_min"])
    f = {"sw_px": sw, "sw_ref_px": np.full(len(df), sw_ref)}
    for side in SIDES:
        f |= side_features(df, side, origin, sw_ref, params)
    f |= pair_features(f, df, origin, sw_ref, params)
    f |= eye_features(df, params)
    any_eye = f["eye_l_ok"] | f["eye_r_ok"]
    f["n1_obs"] = f["n_wrists_seen"]
    f["n2_obs"] = df["face_ok"].astype(int).to_numpy() + any_eye.astype(int)
    derived = pd.DataFrame(f, index=df.index)[DERIVED_COLUMNS]
    out = pd.concat([df[RAW_COLUMNS], derived], axis=1)
    for c in BOOL_COLUMNS + ["eye_l_ok", "eye_r_ok"]:
        out[c] = out[c].astype(bool)
    return out
