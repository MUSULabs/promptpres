"""Compare filler detection across dev runs: text path vs acoustic candidates, per clip.

Reads data/runs/sc02_<clip>/ (transcript.json, vad.json, audio.wav) and recomputes both paths in memory
with the current config (nothing is written). S05 asks for 5-8 เอ่อ/เอิ่ม in ~60 s; other scenarios
are the comparison: acoustic candidates that show up just as often there are probably not fillers.

    python tools/explore_s3.py                 # every sc02_* run that has a transcript
    python tools/explore_s3.py --show          # also list each event with its time and text around it
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from promptpres_shared.settings import load_thresholds  # noqa: E402
from worker.criteria.s1 import join_words  # noqa: E402
from worker.extract import fillers  # noqa: E402
from worker.prep import load_wav  # noqa: E402
from worker.settings import RUNS_DIR  # noqa: E402


def context(words, t0, t1, pad=1.5):
    return join_words([w for w in words if t0 - pad <= w["start_s"] <= t1 + pad])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--show", action="store_true")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    spec = load_thresholds()["criteria"]["S3"]
    print(f"{'clip':<18} {'span_s':>6} {'text':>4} {'/min':>5} {'acoust':>6} {'/min':>5}")
    for run in sorted(RUNS_DIR.glob("sc02_*")):
        if not (run / "transcript.json").exists():
            continue
        words = json.loads((run / "transcript.json").read_text(encoding="utf-8"))["words"]
        vad = json.loads((run / "vad.json").read_text(encoding="utf-8"))
        text = fillers.text_fillers(words, spec)
        samples, rate = load_wav(run / "audio.wav")
        acoustic = fillers.acoustic_candidates(samples, rate, vad["segments"], words, text, spec)
        minutes = vad["speech_span_s"] / 60
        print(f"{run.name[5:]:<18} {vad['speech_span_s']:>6.0f} {len(text):>4} {len(text) / minutes:>5.1f} "
              f"{len(acoustic):>6} {len(acoustic) / minutes:>5.1f}")
        if args.show:
            for e in text + acoustic:
                print(f"    {e['source']:<8} {e['start_s']:>6.1f}-{e['end_s']:<6.1f} [{e['text']}]  "
                      f"... {context(words, e['start_s'], e['end_s'])}")


if __name__ == "__main__":
    main()
