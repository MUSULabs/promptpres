"""research/features/table.py: derived per-frame features on a synthetic raw table.

Synthetic speaker (pixels, y down): shoulders at (400, 300) [speaker's left, image right] and
(200, 300) -> shoulder width 200 px, torso origin (300, 300). Nose at (300, 200).
"""
import math

import numpy as np
import pandas as pd
import pytest

from research.features import provenance
from research.features import table as tb

PARAMS = provenance.load_params()
SW = 200.0


def base_row(i: int, dx: float = 0.0) -> dict:
    """Frame i at 10 fps; dx shifts the whole body sideways (sway)."""
    t = round(i / 10, 6)
    row = tb.empty_row(t, t, 1280, 720)
    row["pose_ok"] = True
    pts = {"nose": (300, 200), "l_sh": (400, 300), "r_sh": (200, 300),
           "l_el": (450, 400), "r_el": (150, 400), "l_wr": (500, 500), "r_wr": (100, 500)}
    for name in tb.POSE_POINTS:
        x, y = pts.get(name, (300, 300))
        row |= {f"p_{name}_x": x + dx, f"p_{name}_y": y, f"p_{name}_vis": 1.0, f"p_{name}_pres": 1.0}
    return row


def put_hand(row: dict, side: str, wrist: tuple, tip_d: float = 20.0) -> None:
    """A hand whose wrist is at `wrist`, middle-finger base 10 px above, five tips tip_d px away."""
    wx, wy = wrist
    row[f"{side}_hand_ok"] = True
    row[f"{side}_hand_score"] = 0.9
    for k in range(tb.HAND_POINTS):
        x, y = wx, wy - 5                       # filler points between wrist and fingers
        if k == 0:
            x, y = wx, wy
        elif k == 9:
            x, y = wx, wy - 10
        elif k in tb.FINGER_TIPS:
            x, y = wx, wy - tip_d
        row |= {f"h{side}_{k:02d}_x": x, f"h{side}_{k:02d}_y": y, f"h{side}_{k:02d}_z": 0.0}


def put_face(row: dict, iris_dx: float = 0.0, eye_w: float = 40.0) -> None:
    """Face found; subject's right eye on the image left, left eye on the image right."""
    row |= {"face_ok": True, "yaw": 0.0, "pitch": 0.0, "roll": 0.0,
            "face_x0": 240.0, "face_x1": 360.0, "face_y0": 140.0, "face_y1": 260.0}
    for e, (outer, inner) in {"r": (260.0, 260.0 + eye_w), "l": (340.0, 340.0 - eye_w)}.items():
        mid = (outer + inner) / 2
        pts = {"outer": (outer, 180.0), "inner": (inner, 180.0), "top": (mid, 174.0),
               "bottom": (mid, 186.0), "iris": (mid + iris_dx, 180.0)}
        for part, (x, y) in pts.items():
            row |= {f"f_{e}_{part}_x": x, f"f_{e}_{part}_y": y}


def derive(rows):
    return tb.derive(pd.DataFrame(rows, columns=tb.RAW_COLUMNS), PARAMS)


def test_columns_and_rows():
    df = derive([base_row(i) for i in range(3)])
    assert list(df.columns) == tb.RAW_COLUMNS + tb.DERIVED_COLUMNS
    assert len(df) == 3
    assert len(set(df.columns)) == len(df.columns)
    # nothing that could be a label or a scenario id is a feature
    assert not [c for c in df.columns if "label" in c or "scenario" in c]


def test_empty_table_keeps_columns():
    df = derive([])
    assert df.empty
    assert list(df.columns) == tb.RAW_COLUMNS + tb.DERIVED_COLUMNS


def test_normalised_wrist_geometry_and_sway_removed():
    df = derive([base_row(0), base_row(1, dx=50.0)])
    assert df["sw_ref_px"].iloc[0] == pytest.approx(SW)
    for i in range(2):
        r = df.iloc[i]
        assert (r["l_wr_nx"], r["l_wr_ny"]) == pytest.approx((1.0, 1.0))
        assert (r["r_wr_nx"], r["r_wr_ny"]) == pytest.approx((-1.0, 1.0))
        assert r["l_wr_out"] == pytest.approx(1.0)       # both wrists one shoulder width outwards
        assert r["r_wr_out"] == pytest.approx(1.0)
        assert r["l_wr_torso_d"] == pytest.approx(math.sqrt(2))
        assert r["hands_sym"] == pytest.approx(0.0)
    # the body moved 50 px but the hands did not move relative to it
    assert df["l_wr_speed"].iloc[1] == pytest.approx(0.0)


def test_elbow_angle():
    df = derive([base_row(0)])
    # shoulder (400,300) -> elbow (450,400) -> wrist (500,500): a straight arm
    assert df["l_elbow_deg"].iloc[0] == pytest.approx(180.0)


def test_wrist_source_and_n1_obs():
    hand = base_row(0)
    put_hand(hand, "l", (520.0, 500.0))
    low_vis = base_row(1)
    low_vis["p_r_wr_vis"] = 0.1
    no_pose = tb.empty_row(0.2, 0.2, 1280, 720)
    df = derive([hand, low_vis, no_pose])
    assert df["l_wr_src"].tolist() == [2, 1, 0]
    assert df["r_wr_src"].tolist() == [1, 0, 0]
    assert df["l_wr_nx"].iloc[0] == pytest.approx(1.1)      # the hand model's wrist, not the pose wrist
    assert math.isnan(df["r_wr_nx"].iloc[1])
    assert df["n1_obs"].tolist() == [2, 1, 0]
    assert df["n_hands_landmarked"].tolist() == [1, 0, 0]


def test_speed_uses_frame_time_and_source_switch_is_not_movement():
    rows = []
    for i in range(4):
        r = base_row(i)
        r["p_l_wr_x"] = 500.0 + 20.0 * i                    # 20 px per 0.1 s = 0.1 sw / 0.1 s
        rows.append(r)
    df = derive(rows)
    assert df["l_wr_speed"].iloc[1:].tolist() == pytest.approx([1.0, 1.0, 1.0])
    assert df["l_wr_acc"].iloc[2:].tolist() == pytest.approx([0.0, 0.0])
    # elbows still, wrists: left 1 sw/s, right 0 -> mean of squared speeds = (1 + 0 + 0 + 0) / 4
    assert df["motion_energy"].iloc[1] == pytest.approx(0.25)
    put_hand(rows[2], "l", (540.0, 500.0))
    df = derive(rows)
    assert math.isnan(df["l_wr_speed"].iloc[2])            # pose wrist -> hand wrist
    assert math.isnan(df["l_wr_speed"].iloc[3])            # hand wrist -> pose wrist


def test_hand_face_hand_hand_and_openness():
    r = base_row(0)
    put_hand(r, "l", (300.0, 300.0), tip_d=20.0)
    put_hand(r, "r", (300.0, 340.0), tip_d=20.0)
    df = derive([r])
    row = df.iloc[0]
    assert row["l_hand_open"] == pytest.approx(2.0)            # tips 20 px, hand size 10 px
    # hand centre = mean of the 21 points; both hands share the same shape, 40 px apart
    assert row["hands_d"] == pytest.approx(40.0 / SW)
    assert row["l_hand_face_d"] > 0
    assert row["hands_mid_ny"] == pytest.approx((row["l_hand_cy"] + row["r_hand_cy"]) / 2)


def test_hand_motion_needs_hand_on_both_frames():
    a, b = base_row(0), base_row(1)
    put_hand(a, "l", (500.0, 500.0))
    put_hand(b, "l", (520.0, 500.0))
    df = derive([a, b])
    assert df["l_hand_motion"].iloc[1] == pytest.approx(1.0)
    assert math.isnan(df["r_hand_motion"].iloc[1])


def test_eye_features_and_n2_obs():
    centred, right, small, noface = base_row(0), base_row(1), base_row(2), base_row(3)
    put_face(centred)
    put_face(right, iris_dx=8.0)            # both irises moved 8 px to the image right
    put_face(small, eye_w=8.0)               # eyes too small for iris features
    df = derive([centred, right, small, noface])
    c, r = df.iloc[0], df.iloc[1]
    assert (c["eye_l_u"], c["eye_r_u"], c["iris_x"]) == pytest.approx((0.5, 0.5, 0.5))
    assert c["eye_open"] == pytest.approx(12.0 / 40.0)
    assert r["iris_x"] == pytest.approx(0.7)                 # both eyes agree in image terms
    assert r["eye_r_u"] == pytest.approx(0.7)                # towards the inner corner
    assert r["eye_l_u"] == pytest.approx(0.3)                # towards the outer corner
    assert c["face_w_frac"] == pytest.approx(120.0 / 1280.0)
    assert df["n2_obs"].tolist() == [2, 2, 1, 0]
    assert not df["eye_l_ok"].iloc[2]
    assert math.isnan(df["iris_x"].iloc[2])


def test_bool_columns_stay_bool():
    df = derive([base_row(0), tb.empty_row(0.1, 0.1, 1280, 720)])
    for c in tb.BOOL_COLUMNS + ["eye_l_ok", "eye_r_ok"]:
        assert df[c].dtype == bool


def test_feature_set_hash_changes_with_params_and_columns():
    cols = tb.RAW_COLUMNS + tb.DERIVED_COLUMNS
    h = provenance.feature_set_hash(cols, PARAMS)
    assert h == provenance.feature_set_hash(cols, dict(reversed(PARAMS.items())))
    assert h != provenance.feature_set_hash(cols, PARAMS | {"grid_fps": 5})
    assert h != provenance.feature_set_hash(cols[:-1], PARAMS)


def test_params_respect_protocol_grid_limit():
    assert 0 < PARAMS["grid_fps"] <= 10            # EXPERIMENT_PROTOCOL_V1 §2: at most 10 fps
    assert np.isfinite(PARAMS["max_dt_s"])
