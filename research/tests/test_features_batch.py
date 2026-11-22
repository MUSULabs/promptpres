"""research/features/batch.py: clip list reading, selection and source paths (no video)."""
from pathlib import Path

import yaml

from research.features import batch

CLIPS_YAML = """
version: dev-clips-test
primary_baseline:
- clip_id: G90_P90_S01_T01
  participant: P90
  mp4: media/mp4/train/G90/P90/G90_P90_S01_T01.mp4
criterion_test_cases:
  S02:
  - clip_id: G90_P90_S02_T01
    participant: P90
    mp4: media/mp4/train/G90/P90/G90_P90_S02_T01.mp4
  N2:
    clips:
    - clip_id: G91_P91_S09_T01
      participant: P91
      mp4: media/mp4/train/G91/P91/G91_P91_S09_T01.mp4
    - clip_id: G90_P90_S01_T01
      participant: P90
      mp4: media/mp4/train/G90/P90/G90_P90_S01_T01.mp4
"""


def test_collect_clips_any_depth_without_duplicates():
    clips = batch.collect_clips(yaml.safe_load(CLIPS_YAML))
    assert [c["clip_id"] for c in clips] == ["G90_P90_S01_T01", "G90_P90_S02_T01", "G91_P91_S09_T01"]


def test_select_by_id_participant_and_limit():
    clips = batch.collect_clips(yaml.safe_load(CLIPS_YAML))
    assert [c["clip_id"] for c in batch.select(clips, only=["G91_P91_S09_T01"])] == ["G91_P91_S09_T01"]
    assert len(batch.select(clips, participants=["P90"])) == 2
    assert len(batch.select(clips, limit=1)) == 1


def test_source_path_mp4_and_original_webm():
    clip = {"mp4": "media/mp4/train/G90/P90/G90_P90_S01_T01.mp4"}
    root = Path("ROOT")
    assert batch.source_path(root, clip, "mp4") == root / "media/mp4/train/G90/P90/G90_P90_S01_T01.mp4"
    assert batch.source_path(root, clip, "original") == \
        root / "media/original/train/G90/P90/G90_P90_S01_T01.webm"


def test_default_output_is_git_ignored_data_folder():
    assert batch.DEFAULT_OUT.is_relative_to(batch.REPO / "data")


def test_missing_video_is_recorded_not_raised(tmp_path):
    class Args:
        media, format, overwrite, models = "mp4", "parquet", False, tmp_path
    clip = {"clip_id": "G90_P90_S01_T01", "mp4": "media/mp4/x.mp4"}
    rec = batch.run_clip(clip, tmp_path, tmp_path / "out", Args)
    assert rec["status"] == "missing_video"
    batch.append_run(tmp_path, rec)
    batch.append_run(tmp_path, rec | {"status": "ok"})
    lines = (tmp_path / "runs.csv").read_text(encoding="utf-8").splitlines()
    assert lines[0].split(",") == batch.RUN_FIELDS
    assert len(lines) == 3


def test_main_stops_when_models_are_missing(tmp_path):
    clips = tmp_path / "clips.yaml"
    clips.write_text(CLIPS_YAML, encoding="utf-8")
    code = batch.main(["--clips", str(clips), "--root", str(tmp_path), "--out", str(tmp_path / "o"),
                       "--models", str(tmp_path / "no_models")])
    assert code == 2
    assert not (tmp_path / "o").exists()
