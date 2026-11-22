"""Clip list -> one feature table per clip (research extractor v2, local only).

Reads any yaml in the config/dev_clips_sc02.yaml style: every mapping that has `clip_id` and `mp4`
(at any depth) is a clip; the mp4 path is relative to the SC02 root (env PROMPTPRES_SC02).
Writes <out>/<clip_id>.parquet + <clip_id>.meta.json and appends one line per clip to
<out>/runs.csv. The default output folder is under data/ (git-ignored): feature tables come from
real videos and never go into git.

    python -m research.features.batch --clips config/dev_clips_sc02.yaml --only G09_P18_S01_T01
    python -m research.features.batch --clips ... --media original   # source WebM, real timestamps
"""
from __future__ import annotations

import argparse
import csv
import logging
import os
import time
from pathlib import Path

import yaml

from promptpres_shared.settings import MODELS_DIR
from research.features import EXTRACTOR_VERSION, provenance
from research.features.video import extract_video, meta_path

REPO = provenance.REPO
DEFAULT_SC02 = REPO.parents[1] / "Data" / "Collector" / "SC02_dataset_20261022" / "DEV_train_validation"
DEFAULT_OUT = REPO / "data" / "research_features" / f"v{EXTRACTOR_VERSION}"
RUN_FIELDS = ["clip_id", "media", "status", "rows", "duration_s", "runtime_s", "error"]
log = logging.getLogger("research.features.batch")


def collect_clips(node) -> list[dict]:
    """Every mapping with clip_id + mp4, depth first, first occurrence of each clip_id kept."""
    found: list[dict] = []
    seen: set[str] = set()

    def walk(n):
        if isinstance(n, dict):
            if "clip_id" in n and "mp4" in n and n["clip_id"] not in seen:
                seen.add(n["clip_id"])
                found.append(n)
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(node)
    return found


def select(clips: list[dict], only=None, participants=None, limit=None) -> list[dict]:
    out = [c for c in clips
           if (not only or c["clip_id"] in only)
           and (not participants or c.get("participant") in participants)]
    return out[:limit] if limit else out


def source_path(root: Path, clip: dict, media: str) -> Path:
    """mp4 = the CFR MP4 listed in the clip list; original = the source WebM next to it.

    media/mp4/<split>/<G>/<P>/<id>.mp4  ->  media/original/<split>/<G>/<P>/<id>.webm
    """
    rel = Path(clip["mp4"])
    if media == "original":
        parts = list(rel.parts)
        parts[parts.index("mp4")] = "original"
        rel = Path(*parts).with_suffix(".webm")
    return root / rel


def append_run(out_dir: Path, rec: dict) -> None:
    path = out_dir / "runs.csv"
    new = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=RUN_FIELDS)
        if new:
            w.writeheader()
        w.writerow({k: rec.get(k, "") for k in RUN_FIELDS})


def run_clip(clip: dict, root: Path, out_dir: Path, args) -> dict:
    cid = clip["clip_id"]
    src = source_path(root, clip, args.media)
    out = out_dir / f"{cid}.{args.format}"
    rec = {"clip_id": cid, "media": args.media}
    if out.exists() and meta_path(out).exists() and not args.overwrite:
        return rec | {"status": "skipped_exists"}
    if not src.exists():
        return rec | {"status": "missing_video", "error": str(src)}
    t0 = time.perf_counter()
    try:
        df = extract_video(src, out, models_dir=args.models,
                           extra_meta={"clip_id": cid, "media": args.media,
                                       "participant": clip.get("participant")})
    except Exception as exc:   # one bad clip must not stop the batch; the error is logged + recorded
        log.exception("clip %s failed", cid)
        return rec | {"status": "error", "error": repr(exc)}
    dur = float(df["frame_t_s"].max()) if len(df) else 0.0
    return rec | {"status": "ok", "rows": len(df), "duration_s": round(dur, 2),
                  "runtime_s": round(time.perf_counter() - t0, 1)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="research extractor v2: clip list -> feature tables")
    ap.add_argument("--clips", type=Path, default=REPO / "config" / "dev_clips_sc02.yaml")
    ap.add_argument("--root", type=Path, default=Path(os.environ.get("PROMPTPRES_SC02", DEFAULT_SC02)))
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--models", type=Path, default=MODELS_DIR)
    ap.add_argument("--media", choices=("mp4", "original"), default="mp4")
    ap.add_argument("--format", choices=("parquet", "csv"), default="parquet")
    ap.add_argument("--only", nargs="*", help="clip ids")
    ap.add_argument("--participants", nargs="*", help="e.g. P18 P19")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--overwrite", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    missing = provenance.missing_models(args.models)
    if missing:
        log.error("MediaPipe model files missing in %s: %s (not downloaded automatically)",
                  args.models, missing)
        return 2
    clips = collect_clips(yaml.safe_load(args.clips.read_text(encoding="utf-8")))
    clips = select(clips, args.only, args.participants, args.limit)
    args.out.mkdir(parents=True, exist_ok=True)
    failed = 0
    for clip in clips:
        rec = run_clip(clip, args.root, args.out, args)
        append_run(args.out, rec)
        failed += rec["status"] in {"error", "missing_video"}
        log.info("%s %s rows=%s dur=%s s run=%s s", rec["clip_id"], rec["status"],
                 rec.get("rows", "-"), rec.get("duration_s", "-"), rec.get("runtime_s", "-"))
    log.info("%d clips, %d failed -> %s", len(clips), failed, args.out)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
