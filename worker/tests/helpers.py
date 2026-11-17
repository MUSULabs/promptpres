"""Small builders shared by worker tests (no models, no real media)."""
import json
import wave
from pathlib import Path

import numpy as np

from worker.extract.vad import summarize
from worker.session import Session


def write_wav(path: Path, samples: np.ndarray, rate: int = 16000) -> Path:
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return path


def tone(seconds: float, amp: float = 0.3, rate: int = 16000, hz: float = 220.0) -> np.ndarray:
    t = np.arange(int(seconds * rate)) / rate
    return (amp * np.sin(2 * np.pi * hz * t)).astype(np.float32)


def vad_from(segments: list[tuple[float, float]]) -> dict:
    segs = [{"start_s": a, "end_s": b} for a, b in segments]
    return {"segments": segs} | summarize(segs)


def session(segments=(), words=None, target=None, flags=None, landmarks=None, fillers=None,
            topics=None, coverage=None) -> Session:
    return Session("test", None, target,
                   prep={"flags": flags or {}},
                   vad=vad_from(list(segments)),
                   transcript=None if words is None else {"words": words},
                   fillers=fillers, landmarks=landmarks, topics=topics, coverage=coverage)


TITLES = ("ปัญหาและผู้ใช้", "วัตถุประสงค์", "วิธีที่เสนอ", "แผนทดสอบ", "ผลที่คาด", "สรุป")


def topic_list(n: int = 4) -> list[dict]:
    return [{"id": f"H{i:02d}", "title": TITLES[i - 1], "order": i, "key_point": f"สาระข้อ {i}"}
            for i in range(1, n + 1)]


def checked(labels: dict[str, str], times: dict[str, float] | None = None, n: int = 4) -> dict:
    """A coverage.json-like dict: labels {id: clear|brief|not_mentioned}, times {id: start_s}."""
    out = []
    for t in topic_list(n):
        lab = labels.get(t["id"], "not_mentioned")
        start = (times or {}).get(t["id"], 10.0 * t["order"]) if lab != "not_mentioned" else None
        out.append({"id": t["id"], "title": t["title"], "order": t["order"], "label": lab, "llm_label": lab,
                    "evidence_quote": None if start is None else f"ข้อความหัวข้อ {t['id']}",
                    "start_s": start, "end_s": None if start is None else start + 3, "rejected": None})
    return {"model": "vendor/model-1", "prompt": "coverage-v1", "topics": out}


def lm_table(seconds: float, fps: float = 10.0, hands=None, head=None, face=None):
    """Synthetic landmarks.parquet table: shoulders fixed at (400,300)-(600,300) -> shoulder width 200 px.

    hands(t) -> ((dx, dy) or None, (dx, dy) or None): offset of the left / right wrist from its rest spot
                (None = that hand not seen). Default: both hands seen and still.
    head(t)  -> (yaw, pitch) in degrees (default 0, 0).   face(t) -> bool (default True).
    """
    import pandas as pd
    from worker.extract.landmarks import COLUMNS, empty_row

    rows = []
    for k in range(int(round(seconds * fps))):
        t = round(k / fps, 3)
        r = empty_row(t, k, 1280, 720)
        r |= {"pose_ok": True, "nose_x": 500.0, "nose_y": 200.0,
              "l_sh_x": 400.0, "l_sh_y": 300.0, "l_sh_vis": 1.0, "r_sh_x": 600.0, "r_sh_y": 300.0, "r_sh_vis": 1.0}
        left, right = hands(t) if hands else ((0, 0), (0, 0))
        for side, off, rest_x in (("l", left, 380.0), ("r", right, 620.0)):
            if off is not None:
                r |= {f"{side}_hand_ok": True, f"{side}_hand_x": rest_x + off[0], f"{side}_hand_y": 500.0 + off[1]}
        if face is None or face(t):
            yaw, pitch = head(t) if head else (0.0, 0.0)
            r |= {"face_ok": True, "yaw": yaw, "pitch": pitch, "roll": 0.0}
        rows.append(r)
    return pd.DataFrame(rows, columns=COLUMNS)


def word(text: str, start: float, end: float) -> dict:
    return {"word": text, "start_s": start, "end_s": end, "probability": 0.9}


def dump(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
