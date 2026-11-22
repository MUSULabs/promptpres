"""Smoke run of the whole extractor on a short lavfi test pattern (no person in it).

Skipped when ffmpeg, MediaPipe or the model files are missing. Checks the time grid, the columns,
the 'nothing seen' path (all quality flags 0, no made-up values) and the version record.
"""
import importlib.util
import json
import shutil
import subprocess

import pandas as pd
import pytest

from promptpres_shared.settings import MODELS_DIR
from research.features import EXTRACTOR_VERSION, provenance
from research.features import table as tb

pytestmark = [
    pytest.mark.skipif(importlib.util.find_spec("mediapipe") is None, reason="mediapipe not installed"),
    pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not on PATH"),
    pytest.mark.skipif(bool(provenance.missing_models(MODELS_DIR)),
                       reason=f"MediaPipe model files missing in {MODELS_DIR}"),
]


@pytest.fixture(scope="module")
def smoke(tmp_path_factory):
    from research.features.video import (
        extract_video,
        meta_path,
    )
    d = tmp_path_factory.mktemp("smoke")
    video = d / "pattern.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
                    "testsrc=size=320x240:rate=30:duration=2", "-pix_fmt", "yuv420p", str(video)],
                   check=True, timeout=60)
    out = d / "pattern.parquet"
    df = extract_video(video, out, models_dir=MODELS_DIR)
    return df, out, json.loads(meta_path(out).read_text(encoding="utf-8"))


def test_grid_and_times(smoke):
    df, out, _ = smoke
    assert len(df) == 20                                        # 2 s at 10 rows/s
    assert df["t_s"].tolist() == pytest.approx([i / 10 for i in range(20)])
    assert (df["frame_t_s"] - df["t_s"]).abs().max() < 0.01     # CFR 30 fps: exact grid frames
    assert pd.read_parquet(out).shape == df.shape


def test_nothing_seen_is_missing_not_zero(smoke):
    df, _, _ = smoke
    assert list(df.columns) == tb.RAW_COLUMNS + tb.DERIVED_COLUMNS
    assert not df["pose_ok"].any()
    assert not df["face_ok"].any()
    assert (df["n1_obs"] == 0).all()
    assert (df["n2_obs"] == 0).all()
    assert df["l_wr_speed"].isna().all()
    assert df["iris_x"].isna().all()


def test_meta_records_versions(smoke):
    _, _, meta = smoke
    assert meta["extractor_version"] == EXTRACTOR_VERSION
    assert meta["params"]["grid_fps"] == 10
    assert len(meta["feature_set_sha256"]) == 64
    assert [m["file"] for m in meta["models"]] == list(provenance.MODEL_FILES)
    assert all(len(m["sha256"]) == 64 for m in meta["models"])
    assert meta["libraries"]["mediapipe"]
    assert meta["source"]["frames_decoded"] == 60
    assert meta["summary"]["rows"] == 20
    assert meta["runtime_s"] >= 0
