"""Check the head-angle signs on SC02 clips (read-only input): per-second yaw / pitch timeline.

Runs worker.extract.landmarks on each clip (cached at data/runs/sc02_<clip>/landmarks.parquet; the
pipeline reuses it) and prints one line per second: median yaw, median pitch, share of frames with a face.
S09 = front 5 s before speaking, then front / side / front / looking down at notes, 10-15 s each:
the notes part must show clearly negative pitch (project convention: pitch < 0 = down).

    python tools/explore_n2.py G07_P05_S09_T01 G09_P18_S09_T01
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import yaml

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from worker.dev_run import ROOT, all_entries  # noqa: E402
from worker.extract import landmarks  # noqa: E402
from worker.settings import CONFIG_DIR, RUNS_DIR, pipeline_config  # noqa: E402


def load(clip_id: str) -> pd.DataFrame:
    doc = yaml.safe_load((CONFIG_DIR / "dev_clips_sc02.yaml").read_text(encoding="utf-8"))
    entry = {e["clip_id"]: e for e in all_entries(doc)}[clip_id]
    out = RUNS_DIR / f"sc02_{clip_id}" / "landmarks.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    if not out.exists():
        landmarks.extract(ROOT / entry["mp4"], out, pipeline_config()["landmarks"])
    return pd.read_parquet(out)


def timeline(df: pd.DataFrame) -> pd.DataFrame:
    df = df.assign(sec=df["t_s"].astype(int))
    g = df.groupby("sec")
    return pd.DataFrame({"face": g["face_ok"].mean().round(2),
                         "yaw": g["yaw"].median().round(1), "pitch": g["pitch"].median().round(1),
                         "roll": g["roll"].median().round(1)})


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    for clip in sys.argv[1:]:
        df = load(clip)
        tl = timeline(df)
        print(f"== {clip}: {len(df)} frames, face {100 * df['face_ok'].mean():.0f}%, "
              f"median yaw {df['yaw'].median():.1f}, pitch {df['pitch'].median():.1f}")
        print(tl.to_string())


if __name__ == "__main__":
    main()
