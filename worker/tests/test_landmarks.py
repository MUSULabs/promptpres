"""landmarks.py helpers (pure) + one run of the real MediaPipe models on a tiny synthetic video."""
import json
from types import SimpleNamespace
from unittest.mock import Mock

import cv2
import numpy as np
import pandas as pd
import pytest

from worker.extract import landmarks
from worker.settings import MODELS_DIR, pipeline_config


def test_partial_model_startup_releases_models_and_capture(monkeypatch, tmp_path):
    from mediapipe.tasks.python import vision

    pose, hand, capture = Mock(), Mock(), Mock()
    capture.isOpened.return_value = True
    capture.get.return_value = 30.0
    monkeypatch.setattr(landmarks.cv2, "VideoCapture", lambda _: capture)
    monkeypatch.setattr(vision, "PoseLandmarker", SimpleNamespace(create_from_options=lambda _: pose))
    monkeypatch.setattr(vision, "HandLandmarker", SimpleNamespace(create_from_options=lambda _: hand))
    fail = Mock(side_effect=RuntimeError("face startup failed"))
    monkeypatch.setattr(vision, "FaceLandmarker", SimpleNamespace(create_from_options=fail))

    with pytest.raises(RuntimeError, match="face startup failed"):
        landmarks.extract(tmp_path / "video.mp4", tmp_path / "out.parquet", pipeline_config()["landmarks"])
    pose.close.assert_called_once()
    hand.close.assert_called_once()
    capture.release.assert_called_once()


def rot_x(deg):
    a = np.radians(deg)
    return np.array([[1, 0, 0], [0, np.cos(a), -np.sin(a)], [0, np.sin(a), np.cos(a)]])


def rot_y(deg):
    a = np.radians(deg)
    return np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])


def as4x4(r, scale=1.0, move=(0, 0, -50)):
    m = np.eye(4)
    m[:3, :3] = r * scale
    m[:3, 3] = move
    return m


def test_head_angles_sign_convention():
    # +20 deg about x in MediaPipe's face frame = chin down (checked on SC02 S09) -> project pitch -20
    yaw, pitch, roll = landmarks.head_angles(as4x4(rot_x(20)))
    assert pitch == pytest.approx(-20, abs=0.1) and abs(yaw) < 0.1 and abs(roll) < 0.1
    yaw, pitch, _ = landmarks.head_angles(as4x4(rot_y(30)))
    assert abs(yaw) == pytest.approx(30, abs=0.1) and abs(pitch) < 0.1


def test_head_angles_ignore_scale_and_position():
    a = landmarks.head_angles(as4x4(rot_x(-10) @ rot_y(25)))
    b = landmarks.head_angles(as4x4(rot_x(-10) @ rot_y(25), scale=3.0, move=(5, 9, -80)))
    assert a == pytest.approx(b, abs=1e-6)


def test_head_box_is_square_and_inside_the_frame():
    assert landmarks.head_box((500, 200), 120, 1280, 720, 80) == (380, 80, 620, 320)
    assert landmarks.head_box((500, 200), 30, 1280, 720, 80) == (420, 120, 580, 280)   # min half 80 px
    assert landmarks.head_box((20, 10), 120, 1280, 720, 80) == (0, 0, 140, 130)        # clipped at the edge


def test_hands_go_to_the_nearer_pose_wrist():
    pose = {"l": (300, 500), "r": (700, 500)}
    got = landmarks.assign_hands([(690, 520), (310, 480)], pose, 200, 1.0)
    assert got == {"l": (310, 480), "r": (690, 520)}
    assert landmarks.assign_hands([(1000, 100)], pose, 200, 1.0) == {"l": None, "r": None}   # too far
    got = landmarks.assign_hands([(700, 500), (705, 505)], pose, 200, 1.0)               # both near right
    assert got["r"] == (700, 500) and got["l"] is None


def test_sample_step():
    assert landmarks.sample_step(30, 10) == 3 and landmarks.sample_step(60, 10) == 6
    assert landmarks.sample_step(5, 10) == 1


@pytest.mark.skipif(not (MODELS_DIR / "face.task").exists(), reason="MediaPipe models not downloaded")
def test_real_models_on_an_empty_scene(tmp_path):
    video = tmp_path / "grey.mp4"
    w = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*"mp4v"), 30, (320, 240))
    for _ in range(60):                                       # 2 s at 30 fps, nobody in the picture
        w.write(np.full((240, 320, 3), 128, np.uint8))
    w.release()
    df = landmarks.extract(video, tmp_path / "landmarks.parquet", pipeline_config()["landmarks"])
    assert list(df.columns) == landmarks.COLUMNS and len(df) == 20
    assert df["t_s"].iloc[1] == pytest.approx(0.1)
    assert not df[["pose_ok", "l_hand_ok", "r_hand_ok", "face_ok"]].any().any()
    assert df["yaw"].isna().all()                             # unseen face stays empty, never "front"
    assert pd.read_parquet(tmp_path / "landmarks.parquet").shape == df.shape
    assert json.loads((tmp_path / "landmarks.json").read_text())["frames"] == 20
