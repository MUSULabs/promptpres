"""Silero VAD -> vad.json (speech segments in seconds).

ใช้กับ T1 (ช่วงพูดแรกถึงสุดท้าย), S1 (เวลาเปล่งเสียง), S2 (ช่วงเงียบ >= pause_min_s)
Model: Silero VAD bundled with faster-whisper (ONNX via onnxruntime) — same model as the silero-vad
package, without needing torch on the GPU machine. Parameters: config/pipeline-v0.yaml `vad`.
The earlier prototype used audio energy; this pipeline uses Silero instead.
"""
from __future__ import annotations

import json
from pathlib import Path

from faster_whisper.vad import VadOptions, get_speech_timestamps

from worker.prep import load_wav


def summarize(segments: list[dict]) -> dict:
    """Summary numbers from speech segments [{"start_s", "end_s"}] (sorted by time).

    speech_span_s       = last end - first start (pauses inside count; silence before/after does not)
    articulation_time_s = sum of segment lengths (pauses excluded)
    """
    if not segments:
        return {"first_start_s": None, "last_end_s": None, "speech_span_s": 0.0, "articulation_time_s": 0.0}
    first, last = segments[0]["start_s"], segments[-1]["end_s"]
    voiced = sum(s["end_s"] - s["start_s"] for s in segments)
    return {"first_start_s": round(first, 3), "last_end_s": round(last, 3),
            "speech_span_s": round(last - first, 3), "articulation_time_s": round(voiced, 3)}


def detect_speech(audio_wav: Path, out_json: Path, cfg: dict) -> dict:
    """Write vad.json: {"segments": [{"start_s", "end_s"}], summary numbers, "duration_s", "params"}."""
    samples, rate = load_wav(audio_wav)
    opts = VadOptions(threshold=cfg["threshold"], min_speech_duration_ms=cfg["min_speech_ms"],
                      min_silence_duration_ms=cfg["min_silence_ms"], speech_pad_ms=cfg["speech_pad_ms"])
    raw = get_speech_timestamps(samples, opts, sampling_rate=rate)        # sample indices
    segments = [{"start_s": round(s["start"] / rate, 3), "end_s": round(s["end"] / rate, 3)} for s in raw]
    out = {"model": "silero-vad (faster-whisper bundled)", "params": cfg,
           "duration_s": round(len(samples) / rate, 3), "segments": segments} | summarize(segments)
    Path(out_json).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return out
