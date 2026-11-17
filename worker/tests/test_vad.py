"""vad.py: summary math, and Silero on a synthetic file (speech-like noise / silence)."""
import importlib.util

import numpy as np
import pytest

from worker.extract.vad import summarize
from worker.tests.helpers import write_wav


def test_summarize_numbers():
    s = summarize([{"start_s": 1.0, "end_s": 3.0}, {"start_s": 6.0, "end_s": 7.5}])
    assert s == {"first_start_s": 1.0, "last_end_s": 7.5, "speech_span_s": 6.5, "articulation_time_s": 3.5}


def test_summarize_empty():
    assert summarize([])["speech_span_s"] == 0.0


@pytest.mark.skipif(importlib.util.find_spec("faster_whisper") is None, reason="faster-whisper not installed")
def test_silero_runs_and_reports_seconds(tmp_path):
    from worker.extract.vad import detect_speech
    from worker.settings import pipeline_config

    audio = np.zeros(16000 * 6, dtype=np.float32)          # 6 s of silence -> no speech expected
    out = detect_speech(write_wav(tmp_path / "s.wav", audio), tmp_path / "vad.json", pipeline_config()["vad"])
    assert out["duration_s"] == pytest.approx(6.0)
    assert out["segments"] == [] and out["speech_span_s"] == 0.0
    assert (tmp_path / "vad.json").exists()
