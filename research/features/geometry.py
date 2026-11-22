"""Pure geometry on landmark arrays. No MediaPipe, no video; every function is tested on
synthetic points in research/tests/test_features_geometry.py.

Conventions
- Points are image pixels of the full frame: x to the right, y DOWN (as OpenCV / MediaPipe).
- Arrays run over frames first: one point per frame = shape (n, 2); k points per frame = (n, k, 2).
- A missing point is NaN. Every function lets NaN pass through (a missing input gives a missing
  output); nothing is filled in or interpolated.
"""
from __future__ import annotations

import math

import numpy as np


def dist(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Euclidean distance between matching points of a and b, shape (n, 2) -> (n,)."""
    d = np.asarray(a, float) - np.asarray(b, float)
    return np.hypot(d[..., 0], d[..., 1])


def normalise(points: np.ndarray, origin: np.ndarray, scale) -> np.ndarray:
    """(points - origin) / scale, per frame.

    points (n, 2) or (n, k, 2); origin (n, 2) = torso origin of each frame; scale = one number or
    (n,) = body size. Subtracting the origin removes body sway; dividing removes camera distance.
    """
    p = np.asarray(points, float)
    o = np.asarray(origin, float)
    s = np.asarray(scale, float)
    if p.ndim == 3:
        o = o[:, None, :]
        s = s[:, None, None] if s.ndim else s
    elif s.ndim:
        s = s[:, None]
    return (p - o) / s


def angle_deg(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> np.ndarray:
    """Angle a-b-c at b in degrees (0..180), per frame. Elbow angle = angle(shoulder, elbow, wrist)."""
    u = np.asarray(a, float) - np.asarray(b, float)
    v = np.asarray(c, float) - np.asarray(b, float)
    cos = (u * v).sum(-1) / (np.hypot(u[..., 0], u[..., 1]) * np.hypot(v[..., 0], v[..., 1]))
    return np.degrees(np.arccos(np.clip(cos, -1.0, 1.0)))


def eye_iris_position(outer: np.ndarray, inner: np.ndarray, iris: np.ndarray):
    """Iris centre in the eye's own frame, per frame -> (u, v).

    u = position along the line outer corner -> inner corner (0 = at the outer corner, 1 = at the
        inner corner, 0.5 = centred).
    v = offset across that line, in eye widths, positive = towards the lower lid (image down).
    Both are relative to the eye corners, so head position and distance to the camera cancel out.
    This is a feature only: it does not say where the person is looking.
    """
    o = np.asarray(outer, float)
    axis = np.asarray(inner, float) - o
    d = np.asarray(iris, float) - o
    length2 = (axis**2).sum(-1)
    u = (d * axis).sum(-1) / length2
    # unit normal of the corner line, turned so that it points down the image (y > 0)
    normal = np.stack([-axis[..., 1], axis[..., 0]], -1)
    normal = np.where((normal[..., 1:2] < 0), -normal, normal)
    v = (d * normal).sum(-1) / length2
    return u, v


def eye_openness(outer, inner, top, bottom) -> np.ndarray:
    """Eyelid gap / eye width (a simple eye aspect ratio), per frame. Closed eye -> about 0."""
    return dist(top, bottom) / dist(outer, inner)


def finite_diff(values: np.ndarray, t_s: np.ndarray, max_dt: float):
    """Backward difference d(values)/dt between consecutive rows, and the time it belongs to.

    values (n, ...) sampled at t_s (n,). Row k gets (values[k] - values[k-1]) / (t[k] - t[k-1]) at
    the midpoint time (t[k] + t[k-1]) / 2. Row 0, rows after a gap longer than max_dt and rows with a
    missing value on either side are NaN. Applying it again to (result, midpoint times) gives the
    next derivative: position -> velocity -> acceleration -> jerk.
    """
    v = np.asarray(values, float)
    t = np.asarray(t_s, float)
    out = np.full_like(v, np.nan)
    t_mid = np.full_like(t, np.nan)
    if len(t) < 2:
        return out, t_mid
    dt = t[1:] - t[:-1]
    ok = np.isfinite(dt) & (dt > 0) & (dt <= max_dt)
    shape = (-1,) + (1,) * (v.ndim - 1)
    safe_dt = np.where(ok, dt, np.nan).reshape(shape)
    out[1:] = (v[1:] - v[:-1]) / safe_dt
    t_mid[1:] = (t[1:] + t[:-1]) / 2
    return out, t_mid


def motion_magnitudes(xy: np.ndarray, t_s: np.ndarray, max_dt: float, breaks=None):
    """Speed, acceleration and jerk magnitudes of one point track (n, 2), per row (causal).

    Units follow the input: normalised shoulder widths in -> sw/s, sw/s^2, sw/s^3 out.
    Jerk needs four consecutive rows without a gap. breaks (n,) bool: rows where the track changed
    source (e.g. pose wrist -> hand wrist); the step into such a row is not a real movement, so its
    velocity (and the acceleration / jerk built on it) is NaN.
    """
    vel, t1 = finite_diff(xy, t_s, max_dt)
    if breaks is not None:
        vel[np.asarray(breaks, bool)] = np.nan
    acc, t2 = finite_diff(vel, t1, max_dt)
    jerk, _ = finite_diff(acc, t2, max_dt)

    def mag(a):
        return np.hypot(a[..., 0], a[..., 1])
    return mag(vel), mag(acc), mag(jerk)


def match_hands(hand_wrists: list, pose_wrists: dict, shoulder_w: float, max_sw: float) -> dict:
    """Give each detected hand to the speaker side whose pose wrist is nearer.

    hand_wrists = [(x, y), ...] wrist point of each detected hand; pose_wrists = {"l": (x, y) or
    None, "r": ...}. A hand is accepted only within max_sw shoulder widths of that pose wrist, and
    pairs are taken closest first so one side never gets two hands. MediaPipe's own left/right label
    is not used: it depends on whether the picture is mirrored. Returns {"l": index or None, "r": ...}.
    Same rule as production `worker/extract/landmarks.assign_hands`, but returning indices.
    """
    out = {"l": None, "r": None}
    if not hand_wrists or not shoulder_w > 0:
        return out
    pairs = []
    for i, (hx, hy) in enumerate(hand_wrists):
        for side, p in pose_wrists.items():
            if p is not None and all(map(math.isfinite, p)):
                pairs.append((math.hypot(hx - p[0], hy - p[1]), i, side))
    used = set()
    for d, i, side in sorted(pairs):
        if d > max_sw * shoulder_w or i in used or out[side] is not None:
            continue
        out[side] = i
        used.add(i)
    return out


class GridSampler:
    """Choose which decoded frames fill a fixed time grid (k / fps seconds, k = 0, 1, 2, ...).

    Frames arrive in time order with their real timestamps. A frame fills grid point k when its time
    is at least k / fps - tolerance and grid point k is not filled yet; it fills the latest such grid
    point. So a 30 fps file gives exactly every third frame, and a variable-rate file gives the first
    frame at or just after each grid time (its real time is kept separately as frame_t_s).
    take(t) returns the grid time to use, or None to skip the frame.
    """

    def __init__(self, fps: float, tolerance_s: float):
        self.step = 1.0 / fps
        self.tol = tolerance_s
        self.next_k = 0

    def take(self, t_s: float) -> float | None:
        k = math.floor((t_s + self.tol) / self.step)
        if k < self.next_k:
            return None
        self.next_k = k + 1
        return round(k * self.step, 6)
