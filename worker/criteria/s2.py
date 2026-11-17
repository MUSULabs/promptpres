"""S2: การหยุดพูดยาว (Long pauses)

อ่าน: vad.json (ช่วงเสียงพูดเรียงตามเวลา)
ค่าที่รายงาน: long_pauses_per_min, max_pause_s (ทั้งสองค่าใช้คิดระดับ — ใช้ระดับที่ต่ำกว่า), long_pauses
วิธีคิด: ช่วงเงียบ = ช่องว่างระหว่างช่วงพูดสองช่วงที่ติดกัน (จึงอยู่ภายในช่วงนำเสนอเสมอ ไม่นับเงียบก่อนเริ่ม/หลังจบ)
         หยุดยาว = ช่วงเงียบที่ยาวตั้งแต่ pause_min_s; เสียงเติมเป็นเสียง จึงแบ่งช่วงเงียบเป็นสองช่วงเอง
         long_pauses_per_min = จำนวนหยุดยาว / (speech_span_s / 60)
         max_pause_s = ช่วงเงียบที่ยาวที่สุด (ทุกช่วง ไม่ใช่เฉพาะที่ถึงเกณฑ์) — 0 ถ้าพูดเป็นช่วงเดียว
config: thresholds-v0.yaml criteria.S2 (pause_min_s, levels, unanalyzable.min_speech_s)
"""
from __future__ import annotations

from worker.criteria.base import Unanalyzable, safe_run

CODE = "S2"


def pauses(segments: list[dict]) -> list[dict]:
    """Every silence between two consecutive speech segments."""
    return [{"start_s": a["end_s"], "end_s": b["start_s"], "length_s": round(b["start_s"] - a["end_s"], 3)}
            for a, b in zip(segments, segments[1:]) if b["start_s"] > a["end_s"]]


def compute(session, spec: dict) -> dict:
    problem = session.audio_problem()
    if problem:
        raise Unanalyzable(problem)
    vad = session.vad or {}
    span = vad.get("speech_span_s") or 0.0
    if span < spec["unanalyzable"]["min_speech_s"]:
        raise Unanalyzable(f"ช่วงพูดสั้นเกินไป ({span:.0f} วินาที) จึงคิดความถี่ของการหยุดไม่ได้")
    gaps = pauses(vad["segments"])
    long = [g for g in gaps if g["length_s"] >= spec["pause_min_s"]]
    return {
        "values": {"long_pauses_per_min": round(len(long) / (span / 60), 2),
                   "max_pause_s": round(max((g["length_s"] for g in gaps), default=0.0), 2),
                   "long_pauses": len(long)},
        "evidence": [{"start_s": g["start_s"], "end_s": g["end_s"], "note": f"เงียบ {g['length_s']:.1f} วินาที"}
                     for g in long],
    }


def run(session, spec: dict) -> dict:
    """Contract `criterion` dict for S2 (never raises)."""
    return safe_run(CODE, lambda: compute(session, spec), spec)
