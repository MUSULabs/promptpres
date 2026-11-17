"""One analysis run: the folder data/runs/<session_id>/ and the files the extract stage wrote.

Criteria read prep.json, vad.json, transcript.json, fillers.json, landmarks.parquet, topics.json
(confirmed topic list) and coverage.json (verified LLM labels) through this
object instead of opening files themselves, so tests can build a Session straight from dicts / tables.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd


@dataclass
class Session:
    session_id: str
    run_dir: Path | None = None
    target_duration_s: float | None = None     # what the user typed; None = not given
    prep: dict | None = None
    vad: dict | None = None
    transcript: dict | None = None
    fillers: dict | None = None
    landmarks: pd.DataFrame | None = None
    topics: list[dict] | None = None           # confirmed topics [{id, title, order, key_point}]
    coverage: dict | None = None               # worker/llm/coverage.py result (labels already verified)
    extra: dict = field(default_factory=dict)

    @classmethod
    def from_dir(cls, run_dir: Path, session_id: str, target_duration_s: float | None = None) -> "Session":
        def read(name):
            p = Path(run_dir) / name
            return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
        lm = Path(run_dir) / "landmarks.parquet"
        topics = read("topics.json")
        return cls(session_id, Path(run_dir), target_duration_s,
                   read("prep.json"), read("vad.json"), read("transcript.json"), read("fillers.json"),
                   pd.read_parquet(lm) if lm.exists() else None,
                   topics.get("topics") if isinstance(topics, dict) else topics, read("coverage.json"))

    def audio_problem(self) -> str | None:
        """Thai reason if prep found the audio unusable (no audio / too quiet / too short), else None."""
        flags = (self.prep or {}).get("flags") or {}
        return next(iter(flags.values()), None)

    def speech_window(self) -> tuple[float, float] | None:
        """(first speech start, last speech end) from VAD; None when there is no speech or no audio.

        N1 and N2 look only inside this window: before the first word the presenter is just standing
        there, and that should not count as hands still or head direction.
        """
        segs = (self.vad or {}).get("segments") or []
        if not segs:
            return None
        return segs[0]["start_s"], segs[-1]["end_s"]
