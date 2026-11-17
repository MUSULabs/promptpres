"""Which SC02 S09 clips really show a side turn of the head? (N2 yaw check; dataset read-only)

S09 asks each presenter for front / side / front / looking down at notes, 10-15 s each. The two S09
dev clips (P05, P18) show the notes part but almost no side turn, so the yaw sign was never checked.
This script runs worker.extract.landmarks on the first S09 take of every presenter (cached at
data/runs/sc02_<clip>/landmarks.parquet, gitignored), labels every second with criteria.n2.per_second,
and reports per clip:
  side_pct        share of face-seen seconds labelled side (|yaw| > yaw_side_deg, not looking down)
  longest_side_s  longest run of side seconds
  side_yaw_deg    median yaw inside that run (sign = which way the head turned)
  yaw_p5 / p95    spread of per-frame yaw
  down_pct        share of face-seen seconds labelled down
A clip "shows a clear side turn" when longest_side_s >= CLEAR_SIDE_S.
The table is written into config/dev_clips_sc02.yaml under notes.n2_side_turn_s09
(tools/scan_sc02.py keeps the notes block when it regenerates that file).

    python tools/scan_s09_yaw.py            # all presenters (~1 min per clip the first time)
"""
from __future__ import annotations

import csv
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from worker.criteria import n2  # noqa: E402
from promptpres_shared.settings import load_thresholds  # noqa: E402
from worker.dev_run import ROOT  # noqa: E402
from worker.extract import landmarks  # noqa: E402
from worker.settings import CONFIG_DIR, RUNS_DIR, pipeline_config  # noqa: E402

CLEAR_SIDE_S = 5          # dev-clip selection rule only (not a scoring threshold)
YAML_PATH = CONFIG_DIR / "dev_clips_sc02.yaml"


def s09_clips() -> list[dict]:
    """First selected S09 take of every presenter, from the dataset's clips.csv."""
    with open(ROOT / "clips.csv", encoding="utf-8-sig") as f:
        rows = [r for r in csv.DictReader(f) if r["scenario"] == "S09" and r["mp4_path"]]
    rows.sort(key=lambda r: (r["participant_id"], r["selected_take"] != "1", int(r["take"])))
    first = {}
    for r in rows:
        first.setdefault(r["participant_id"], r)
    return list(first.values())


def landmarks_for(clip_id: str, mp4: Path) -> pd.DataFrame:
    out = RUNS_DIR / f"sc02_{clip_id}" / "landmarks.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    if not out.exists():
        landmarks.extract(mp4, out, pipeline_config()["landmarks"])
    return pd.read_parquet(out)


def measure(df: pd.DataFrame, spec: dict) -> dict:
    secs = n2.per_second(df, spec)
    seen = secs[secs["label"] != "none"]
    side_runs = n2.runs(secs, ("side",))
    longest = max(side_runs, key=lambda r: r["end_s"] - r["start_s"], default=None)
    yaw = df.loc[df["face_ok"].astype(bool), "yaw"]
    out = {"face_seen_s": len(seen),
           "side_pct": round(100 * float((seen["label"] == "side").mean()), 1) if len(seen) else None,
           "down_pct": round(100 * float((seen["label"] == "down").mean()), 1) if len(seen) else None,
           "longest_side_s": 0, "side_at_s": None, "side_yaw_deg": None,
           "yaw_p5": round(float(np.percentile(yaw, 5)), 1) if len(yaw) else None,
           "yaw_p95": round(float(np.percentile(yaw, 95)), 1) if len(yaw) else None}
    if longest:
        a, b = longest["start_s"], longest["end_s"]
        inside = df[(df["t_s"] >= a) & (df["t_s"] < b) & df["face_ok"].astype(bool)]
        out |= {"longest_side_s": int(b - a), "side_at_s": [int(a), int(b)],
                "side_yaw_deg": round(float(inside["yaw"].median()), 1)}
    return out


def write_notes(table: list[dict]) -> None:
    """Replace notes.n2_side_turn_s09 in the dev-clip yaml, keep everything else as it is."""
    text = YAML_PATH.read_text(encoding="utf-8")
    header = "".join(line for line in text.splitlines(keepends=True) if line.startswith("#"))
    doc = yaml.safe_load(text)
    clear = [r["clip_id"] for r in table if r["longest_side_s"] >= CLEAR_SIDE_S]
    doc.setdefault("notes", {})["n2_side_turn_s09"] = {
        "made_by": "tools/scan_s09_yaw.py",
        "rule": f"clear side turn = at least {CLEAR_SIDE_S} s in a row with |yaw| > yaw_side_deg (not down)",
        "clear_side_turn": clear,
        "clips": table,
    }
    YAML_PATH.write_text(header + yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    spec = load_thresholds()["criteria"]["N2"]
    table = []
    for r in s09_clips():
        clip_id = Path(r["filename"]).stem
        row = {"clip_id": clip_id, "participant": r["participant_id"]} | measure(
            landmarks_for(clip_id, ROOT / r["mp4_path"]), spec)
        table.append(row)
        print(row, flush=True)
    write_notes(table)
    print("clear side turn:", [t["clip_id"] for t in table if t["longest_side_s"] >= CLEAR_SIDE_S])


if __name__ == "__main__":
    main()
