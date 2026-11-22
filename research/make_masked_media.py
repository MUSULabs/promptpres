"""Cut the masked pilot media and write the private manifest with real offsets (D-067 Phase 2, custodian tool).

Input  : the private pilot manifest (default Data/Research_Private/D067/pilot_v1.csv, read-only).
Media  : SC02 clips, read-only, under the dataset root (env PROMPTPRES_SC02; see config/dev_clips_sc02.yaml).
Output : all private, outside git (default Data/Research_Private/D067/):
         masked/<blind_id>.mp4            exact re-encoded cut, audio kept, metadata stripped
         pilot_v2.csv                     template columns + real source_offset_s / source_end_s
         pilot_v2_annotator_order.csv     shuffled clip order per annotator (A1-A3), seed in the header

Windows (EXPERIMENT_PROTOCOL_V1 §4.4, §5):
  full_clip              offset 0, end = clip duration
  speech_onset+30s;60s   offset = speech onset + 30 s, end = min(offset + 60 s, clip duration);
                         speech onset = first segment of worker.extract.vad.detect_speech with the
                         pipeline's own prep/vad config (config/pipeline-v0.yaml), run locally.

    python -m research.make_masked_media                 # from the repository root
    python -m research.make_masked_media --force --seed 20261122

Everything runs locally (ffmpeg, Silero VAD); nothing is sent to a cloud service.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import os
import random
import subprocess
import sys
import tempfile
from pathlib import Path

import pandas as pd

REPO = Path(__file__).resolve().parents[1]
VAULT = REPO.parents[1]
DEFAULT_SC02 = VAULT / "Data" / "Collector" / "SC02_dataset_20261022" / "DEV_train_validation"
DEFAULT_PRIVATE = VAULT / "Data" / "Research_Private" / "D067"

FULL_CLIP = "full_clip"
SPEECH_WINDOW = "speech_onset+30s;60s"
ONSET_LEAD_S = 30.0
WINDOW_S = 60.0
DURATION_TOLERANCE_S = 0.1          # measured masked duration vs planned end - offset
SOURCE_DURATION_TOLERANCE_S = 0.1   # probed source duration vs clip_duration_s in the input manifest
ANNOTATORS = ("A1", "A2", "A3")
DEFAULT_SEED = 20261122
BANGKOK = dt.timezone(dt.timedelta(hours=7))

TEMPLATE_COLUMNS = ["blind_id", "source_clip_id", "participant_id", "is_team_member", "source_media_path",
                    "source_offset_s", "source_end_s", "masked_media_duration_s", "layers",
                    "selection_reason", "custodian_note"]
ORDER_COLUMNS = ["annotator_id", "position", "blind_id"]


class MaskingError(Exception):
    """A clip cannot be cut as the protocol requires; the manifest is not written."""


# ---------------------------------------------------------------- windows

def window_for(rule: str, duration_s: float, onset_s: float | None = None) -> tuple[float, float]:
    """(source_offset_s, source_end_s) for one clip, rounded to milliseconds."""
    if duration_s is None or duration_s <= 0:
        raise MaskingError("clip duration must be positive")
    if rule == FULL_CLIP:
        return 0.0, round(duration_s, 3)
    if rule == SPEECH_WINDOW:
        if onset_s is None:
            raise MaskingError("no speech found; cannot place the speech-onset window")
        offset = round(onset_s + ONSET_LEAD_S, 3)
        end = round(min(offset + WINDOW_S, duration_s), 3)
        if end <= offset:
            raise MaskingError("speech onset + 30 s is beyond the end of the clip")
        return offset, end
    raise MaskingError(f"unknown window_rule: {rule!r}")


# ---------------------------------------------------------------- local media tools

def _tool(name: str) -> str:
    from promptpres_shared.settings import tool  # same ffmpeg lookup as the pipeline
    return tool(name)


def _run(args: list[str]) -> subprocess.CompletedProcess:
    proc = subprocess.run(args, check=False, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=3600)
    if proc.returncode != 0:
        raise MaskingError(f"{Path(args[0]).stem} failed: {proc.stderr.strip()[-400:]}")
    return proc


def probe_duration(path: Path) -> float:
    """Container duration in seconds (ffprobe format=duration)."""
    out = _run([_tool("ffprobe"), "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(path)]).stdout.strip()
    try:
        return round(float(out), 3)
    except ValueError as exc:
        raise MaskingError(f"ffprobe gave no duration for {path.name}") from exc


def speech_onset(media: Path, pipeline_cfg: dict) -> float | None:
    """First speech start (s) by the pipeline's own VAD on a temporary mono wav (deleted afterwards)."""
    from worker.extract.vad import detect_speech
    with tempfile.TemporaryDirectory(prefix="d067_vad_") as tmp:
        wav, out_json = Path(tmp) / "audio.wav", Path(tmp) / "vad.json"
        _run([_tool("ffmpeg"), "-y", "-v", "error", "-i", str(media), "-vn", "-ac", "1",
              "-ar", str(pipeline_cfg["prep"]["audio_rate_hz"]), "-c:a", "pcm_s16le", str(wav)])
        return detect_speech(wav, out_json, pipeline_cfg["vad"])["first_start_s"]


def cut_masked(src: Path, dst: Path, offset_s: float, end_s: float) -> float:
    """Exact re-encoded cut [offset_s, end_s) with audio and no metadata; returns the measured duration."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.stem + ".part.mp4")
    try:
        _run([_tool("ffmpeg"), "-y", "-v", "error",
              "-ss", f"{offset_s:.3f}", "-i", str(src), "-t", f"{end_s - offset_s:.3f}",
              "-map", "0:v:0", "-map", "0:a:0",
              "-map_metadata", "-1", "-map_metadata:s:v", "-1", "-map_metadata:s:a", "-1", "-map_chapters", "-1",
              "-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact",
              "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
              "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(tmp)])
        os.replace(tmp, dst)
    finally:
        tmp.unlink(missing_ok=True)
    return probe_duration(dst)


# ---------------------------------------------------------------- manifest + order

def manifest_row(src: dict, offset_s: float, end_s: float, masked_s: float, onset_s: float | None) -> dict:
    """One pilot_v2 row (template columns) from one pilot_v1 row and the measured cut."""
    note = [f"window_rule={src['window_rule']}", f"expected_difficulty={src.get('expected_difficulty', '')}"]
    if onset_s is not None:
        note.append(f"speech_onset_s={onset_s:.3f}")
    return {
        "blind_id": src["blind_id"], "source_clip_id": src["clip_id"], "participant_id": src["participant_id"],
        "is_team_member": str(src["is_team_member"]).strip().lower(),
        "source_media_path": src["mp4_path"],
        "source_offset_s": f"{offset_s:.3f}", "source_end_s": f"{end_s:.3f}",
        "masked_media_duration_s": f"{masked_s:.3f}", "layers": src["layers"],
        "selection_reason": src.get("audit_observation_for_selection", ""), "custodian_note": "; ".join(note),
    }


def write_csv(path: Path, header: list[str], columns: list[str], rows: list[dict]) -> None:
    """CSV with '#' metadata lines first (read with pandas.read_csv(path, comment='#'))."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.writelines(f"# {line}\n" for line in header)
        writer = csv.DictWriter(f, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def annotator_orders(blind_ids: list[str], seed: int, annotators: tuple[str, ...] = ANNOTATORS) -> list[dict]:
    """An independent shuffled order of all blind ids for each annotator, reproducible from the seed."""
    rng = random.Random(seed)
    rows = []
    for annotator in annotators:
        order = sorted(blind_ids)
        rng.shuffle(order)
        rows += [{"annotator_id": annotator, "position": i, "blind_id": b} for i, b in enumerate(order, start=1)]
    return rows


def manifest_header(today: str, input_name: str, seed: int, vad_cfg: dict) -> list[str]:
    return [
        (f"doc: Data/Research_Private/D067/pilot_v2.csv (PRIVATE - outside git) | version: v2.0 | date: {today} "
         "| status: OWNER_APPROVED / ADVISOR_APPROVED | decisions: D-067"),
        (f"implementation: Phase 2 - masked media cut by research/make_masked_media.py from {input_name}; "
         "no labels exist yet | advisor_approval: approved 2026-11-22"),
        ("CUSTODIAN KEY: this file maps blind ids to clip ids and must NOT be given to annotators "
         "(clip ids contain the scenario code)."),
        ("Annotators receive masked/<blind_id>.mp4 only (exact re-encode, audio kept, metadata stripped) "
         f"in the shuffled order of pilot_v2_annotator_order.csv (seed {seed}). Scenario IDs are never labels."),
        ("Time: annotators label seconds from 0 of the masked file; source_start_s = source_offset_s + start_s "
         "(EXPERIMENT_PROTOCOL_V1 §4.4). masked_media_duration_s = ffprobe format duration of the masked file."),
        ("Window: full_clip = offset 0 to clip duration; speech_onset+30s;60s = offset speech onset + 30 s, "
         "end min(offset + 60 s, duration) (PILOT SAMPLING PROPOSAL - NOT FINAL, EXPERIMENT_PROTOCOL_V1 §5)."),
        ("Speech onset = first segment of worker.extract.vad.detect_speech (Silero, local) with the pipeline-v0 "
         f"vad config {vad_cfg}; recorded per clip in custodian_note."),
        ("selection_reason = audit observation from the read-only thumbnail audit of 22 Nov 2026 "
         "(unverified, not labels)."),
        ("Read with pandas.read_csv(path, comment=\"#\"). source_media_path is relative to "
         "Data/Collector/SC02_dataset_20261022/DEV_train_validation (env PROMPTPRES_SC02)."),
    ]


def order_header(today: str, seed: int) -> list[str]:
    return [
        (f"doc: Data/Research_Private/D067/pilot_v2_annotator_order.csv (PRIVATE - outside git) | date: {today} "
         "| decisions: D-067"),
        (f"Shuffled clip order per annotator. seed: {seed} (random.Random(seed); one shuffle of the sorted "
         "blind ids per annotator, in the order A1, A2, A3)."),
        "Holds blind ids only (no clip id, scenario or participant); each annotator may receive their own rows.",
        "Read with pandas.read_csv(path, comment=\"#\").",
    ]


# ---------------------------------------------------------------- main

def process(src_manifest: Path, sc02_root: Path, out_dir: Path, seed: int) -> list[dict]:
    from promptpres_shared.settings import pipeline_config
    cfg = pipeline_config()
    rows_in = pd.read_csv(src_manifest, comment="#", dtype=str, keep_default_na=False).to_dict("records")
    sc02_root, out_dir = sc02_root.resolve(), out_dir.resolve()
    if out_dir.is_relative_to(sc02_root):
        raise MaskingError("output folder must not be inside the SC02 dataset (originals are read-only)")
    rows_out = []
    for r in rows_in:
        src = sc02_root / r["mp4_path"]
        if not src.is_file():
            raise MaskingError(f"{r['blind_id']}: source media not found")
        duration = probe_duration(src)
        listed = float(r["clip_duration_s"])
        if abs(duration - listed) > SOURCE_DURATION_TOLERANCE_S:
            raise MaskingError(f"{r['blind_id']}: probed duration {duration} differs from manifest {listed}")
        onset = speech_onset(src, cfg) if r["window_rule"] == SPEECH_WINDOW else None
        offset, end = window_for(r["window_rule"], duration, onset)
        masked = cut_masked(src, out_dir / "masked" / f"{r['blind_id']}.mp4", offset, end)
        if abs(masked - (end - offset)) > DURATION_TOLERANCE_S:
            raise MaskingError(f"{r['blind_id']}: masked duration {masked} vs planned {end - offset:.3f}")
        rows_out.append(manifest_row(r, offset, end, masked, onset))
        print(f"{r['blind_id']}  offset {offset:8.3f}  end {end:8.3f}  masked {masked:7.3f}", flush=True)

    today = dt.datetime.now(BANGKOK).date().isoformat()
    write_csv(out_dir / "pilot_v2.csv", manifest_header(today, src_manifest.name, seed, cfg["vad"]),
              TEMPLATE_COLUMNS, rows_out)
    write_csv(out_dir / "pilot_v2_annotator_order.csv", order_header(today, seed), ORDER_COLUMNS,
              annotator_orders([r["blind_id"] for r in rows_out], seed))
    return rows_out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--manifest", type=Path, default=DEFAULT_PRIVATE / "pilot_v1.csv")
    parser.add_argument("--sc02-root", type=Path, default=Path(os.environ.get("PROMPTPRES_SC02", DEFAULT_SC02)))
    parser.add_argument("--out", type=Path, default=DEFAULT_PRIVATE)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--force", action="store_true", help="overwrite an existing pilot_v2.csv")
    args = parser.parse_args(argv)
    if (args.out / "pilot_v2.csv").exists() and not args.force:
        print("pilot_v2.csv already exists; pass --force to rebuild it", file=sys.stderr)
        return 1
    try:
        process(args.manifest, args.sc02_root, args.out, args.seed)
    except MaskingError as exc:
        print(f"stopped: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
