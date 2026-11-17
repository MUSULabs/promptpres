"""Run the pipeline on SC02 development clips listed in config/dev_clips_sc02.yaml (read-only input).

T1 target = the scenario's target time from clips.csv (S01 180 s, other scenarios 60 s).
C1 C2 topics = the presenter's SC02 reference (references/Pxx.json: 4 key points, confirmed by the
presenter at recording time) with the protocol's topic names H01-H04 (sc02_topics).
Results go to data/runs/sc02_<clip_id>/; a summary table is printed and saved to data/runs/dev_summary.json.

    python -m worker.dev_run --set primary_baseline --limit 1
    python -m worker.dev_run --clips G01_P02_S02_T01 G01_P02_S03_T01
    python -m worker.dev_run --fresh --clips ...      # redo every stage (default reuses data/runs outputs)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import yaml

from worker.pipeline import run_session
from worker.settings import CONFIG_DIR, REPO, RUNS_DIR

DEFAULT_ROOT = REPO.parents[1] / "Data" / "Collector" / "SC02_dataset_20261022" / "DEV_train_validation"
ROOT = Path(os.environ.get("PROMPTPRES_SC02", DEFAULT_ROOT))
MEASURED = ("C1", "C2", "S1", "S2", "S3", "N1", "N2", "T1")
# SC02 protocol: the 4 reference points are always in this order (S10 asks for H03 H01 H04 H02)
SC02_TITLES = ("ปัญหาและผู้ใช้", "วัตถุประสงค์", "วิธีที่เสนอ", "แผนทดสอบ")


def sc02_topics(reference: str) -> list[dict]:
    """Confirmed topic list from an SC02 reference file (read-only): H01-H04 with the key points."""
    ref = json.loads((ROOT / reference).read_text(encoding="utf-8"))
    return [{"id": f"H{i:02d}", "title": title, "order": i, "key_point": point}
            for i, (title, point) in enumerate(zip(SC02_TITLES, ref["points"]), start=1)]


def all_entries(doc: dict) -> list[dict]:
    items = list(doc["primary_baseline"])
    for cases in doc["criterion_test_cases"].values():
        items += cases
    return items


def from_clips_csv(clip_id: str) -> dict:
    """Any SC02 clip not listed in the yaml: path, target and reference from the dataset's clips.csv."""
    import csv   # noqa: PLC0415
    with open(ROOT / "clips.csv", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if Path(r["filename"]).stem == clip_id and r["mp4_path"]:
                return {"clip_id": clip_id, "participant": r["participant_id"], "scenario": r["scenario"],
                        "target_s": float(r["scenario_target_seconds"]), "mp4": r["mp4_path"],
                        "reference": f"references/{r['participant_id']}.json"}
    raise SystemExit(f"clip {clip_id} not found in dev_clips_sc02.yaml or clips.csv")


def pick(doc: dict, set_name: str | None, clip_ids: list[str] | None, limit: int | None) -> list[dict]:
    if clip_ids:
        by_id = {e["clip_id"]: e for e in all_entries(doc)}
        return [by_id[c] if c in by_id else from_clips_csv(c) for c in clip_ids]
    if set_name == "primary_baseline":
        items = doc["primary_baseline"]
    else:
        items = [e for cases in doc["criterion_test_cases"].values() for e in cases]
    return items[:limit] if limit else items


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", default="primary_baseline", choices=["primary_baseline", "criterion_test_cases"])
    ap.add_argument("--clips", nargs="*")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--fresh", action="store_true", help="rerun every stage (default: reuse outputs of the same video)")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    doc = yaml.safe_load((CONFIG_DIR / "dev_clips_sc02.yaml").read_text(encoding="utf-8"))
    summary = []
    for e in pick(doc, args.set, args.clips, args.limit):
        sid = f"sc02_{e['clip_id']}"
        topics = sc02_topics(e["reference"]) if e.get("reference") else None
        res = run_session(ROOT / e["mp4"], sid, e["target_s"], reuse=not args.fresh, topics=topics)
        timing = json.loads((RUNS_DIR / sid / "timing.json").read_text(encoding="utf-8"))
        row = {"clip_id": e["clip_id"], "scenario": e["scenario"], "duration_s": res["duration_s"],
               "target_s": e["target_s"], "asr": res["versions"]["asr"], "llm": res["versions"]["llm"],
               "topics": res["topics"], "timing": timing}
        for c in res["criteria"]:
            if c["code"] in MEASURED:
                row[c["code"]] = {"level": c["level"], "values": c["values"], "reason": c["reason"],
                                  "evidence": c["evidence"]}
        summary.append(row)
        print(json.dumps({k: row[k] for k in ("clip_id", *MEASURED, "timing")},
                         ensure_ascii=False, default=str), flush=True)
    out = RUNS_DIR / "dev_summary.json"
    old = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {}
    old.update({r["clip_id"]: r for r in summary})
    out.write_text(json.dumps(old, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
