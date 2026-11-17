"""T1: เวลาเทียบเป้าหมาย (Total duration deviation)

อ่าน: vad.json (ช่วงเสียงพูด), target_duration_s ของรอบซ้อม (ผู้ใช้กรอก ถ้าไม่กรอกใช้ default_target_s)
ค่าที่รายงาน: deviation_pct (ใช้คิดระดับ), speech_span_s, target_s, diff_s (+ ยาวกว่าเป้า, − สั้นกว่าเป้า)
วิธีคิด: span = เริ่มพูดครั้งแรก ถึง จบพูดครั้งสุดท้าย (ไม่นับเงียบก่อนเริ่มและหลังจบ)
         deviation_pct = |span − target| / target × 100  — สั้นหรือยาวใช้ขอบเดียวกัน
config: thresholds-v0.yaml criteria.T1 (levels, default_target_s)
"""
from __future__ import annotations

from worker.criteria.base import Unanalyzable, safe_run

CODE = "T1"


def target_seconds(session, spec: dict) -> float:
    target = session.target_duration_s or spec.get("default_target_s")
    if not target or target <= 0:
        raise Unanalyzable("ไม่มีเวลาเป้าหมายของรอบซ้อม")
    return float(target)


def compute(session, spec: dict) -> dict:
    problem = session.audio_problem()
    if problem:
        raise Unanalyzable(problem)
    vad = session.vad or {}
    if not vad.get("segments"):
        raise Unanalyzable("ไม่พบช่วงเสียงพูดในคลิป")
    target = target_seconds(session, spec)
    span = vad["speech_span_s"]
    deviation = abs(span - target) / target * 100
    return {
        "values": {"deviation_pct": round(deviation, 2), "speech_span_s": round(span, 2),
                   "target_s": target, "diff_s": round(span - target, 2)},
        "evidence": [
            {"start_s": vad["first_start_s"], "end_s": vad["first_start_s"], "note": "เริ่มพูด"},
            {"start_s": vad["last_end_s"], "end_s": vad["last_end_s"], "note": "จบการพูด"},
        ],
    }


def run(session, spec: dict) -> dict:
    """Contract `criterion` dict for T1 (never raises)."""
    return safe_run(CODE, lambda: compute(session, spec), spec)
