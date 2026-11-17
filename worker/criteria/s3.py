"""S3: เสียงเติมและคำติดปาก (Filled pauses and contextual discourse fillers) — เสียงเติม เอ่อ/อ่า/อืม/เอิ่ม/uh/um และคำติดปากตามบริบท D-050; เออ (= ใช่) ไม่นับ

อ่าน: fillers.json (จาก worker/extract/fillers.py), vad.json
ค่าที่รายงาน: fillers_per_min (ใช้คิดระดับ) · fillers, text_fillers, acoustic_candidates (ข้อมูลประกอบ)
วิธีคิด:
  1. เสียงเติมจากข้อความที่ถอดได้ (ต่อชิ้นของ Whisper แล้วตัดคำ — ดู extract/fillers.py)
  2. ตัวเลือกจากสัญญาณเสียง (เสียงลากคงที่ติดช่วงเงียบ) นับรวมเฉพาะเมื่อ config acoustic.count_acoustic: true
  3. fillers_per_min = จำนวนครั้ง / นาทีของช่วงพูด (เริ่มพูดถึงหยุดพูดครั้งสุดท้าย)
  4. evidence = ทุกครั้งที่พบ พร้อมเวลา
วิเคราะห์ไม่ได้: เสียงใช้ไม่ได้, ช่วงพูดสั้นกว่า min_speech_s, หรือไม่มีข้อความที่ถอดได้
config: thresholds-v0.yaml criteria.S3
"""
from __future__ import annotations

from worker.criteria.base import Unanalyzable, safe_run
from worker.extract.fillers import text_fillers
from promptpres_shared.settings import pipeline_config

CODE = "S3"


def compute(session, spec: dict) -> dict:
    problem = session.audio_problem()
    if problem:
        raise Unanalyzable(problem)
    span = (session.vad or {}).get("speech_span_s") or 0.0
    if span < spec["unanalyzable"]["min_speech_s"]:
        raise Unanalyzable(f"ช่วงพูดสั้นเกินไป ({span:.0f} วินาที) จึงนับเสียงเติมต่อนาทีไม่ได้")
    words = (session.transcript or {}).get("words") or []
    if not words:
        raise Unanalyzable("ถอดข้อความจากเสียงไม่ได้")

    found = session.fillers or {"text": text_fillers(words, spec, session.extra.get("contextual_fillers", pipeline_config().get("fillers"))), "acoustic": []}
    text, acoustic = found["text"], found.get("acoustic", [])
    counted = text + (acoustic if spec["acoustic"]["count_acoustic"] else [])
    counted = sorted(counted, key=lambda e: e["start_s"])
    notes = {"text": "เสียงเติม '{}'", "acoustic": "เสียงลากคล้ายเสียงเติม{}"}
    return {
        "values": {"fillers_per_min": round(len(counted) / (span / 60), 2), "fillers": len(counted),
                   "text_fillers": len(text), "acoustic_candidates": len(acoustic)},
        "evidence": [{"start_s": e["start_s"], "end_s": e["end_s"],
                      "label": (f'คำติดปาก "{e["text"]}"' if e.get("kind") == "contextual" else f'เสียงเติม "{e["text"]}"'),
                      "note": ("คำติดปาก '{}'".format(e["text"]) if e.get("kind") == "contextual"
                               else notes[e["source"]].format(e["text"] if e["source"] == "text" else ""))}
                     for e in counted],
    }


def run(session, spec: dict) -> dict:
    """Contract `criterion` dict for S3 (never raises)."""
    return safe_run(CODE, lambda: compute(session, spec), spec)
