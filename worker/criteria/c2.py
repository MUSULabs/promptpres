"""C2: ความครอบคลุมเชิงความหมาย (Semantic topic coverage)

อ่าน: หัวข้อที่ผู้ใช้ยืนยัน (topics.json) + ผลตรวจของ worker/llm/coverage.py (coverage.json)
      ป้ายของแต่ละหัวข้อผ่านการตรวจ quote กับ transcript แล้ว: quote ไม่พบ -> not_mentioned
ค่าที่รายงาน: coverage_clear_pct (ใช้คิดระดับ)
              clear, brief, not_mentioned, topics_total, quotes_rejected (ข้อมูลประกอบ)
วิธีคิด (รูบริก v0.9):  coverage_clear_pct = (clear + brief_weight x brief) / จำนวนหัวข้อในแผน x 100
evidence: หัวข้อที่ clear / brief แต่ละหัวข้อ ที่เวลาของ quote ที่ตรวจแล้ว
วิเคราะห์ไม่ได้: ไม่มีหัวข้อที่ยืนยัน, หัวข้อน้อยกว่า min_topics, ช่วงพูดสั้นกว่า min_transcript_s,
                ไม่มี transcript, หรือเรียก LLM ไม่สำเร็จ
ไม่ตัดสินว่าเนื้อหาถูกต้องทางวิชาการ — วัดเพียงว่าพูดครบตามแผนของผู้ใช้เองหรือไม่
config: thresholds-v0.yaml criteria.C2
"""
from __future__ import annotations

from worker.criteria.base import Unanalyzable, safe_run

CODE = "C2"
LABEL_TH = {"clear": "อธิบายชัดเจน", "brief": "กล่าวถึงบางส่วน", "not_mentioned": "ไม่ได้กล่าวถึง"}
QUOTE_SHOWN = 80


def speech_span_s(session) -> float:
    window = session.speech_window()
    if window:
        return window[1] - window[0]
    words = (session.transcript or {}).get("words") or []
    return words[-1]["end_s"] - words[0]["start_s"] if words else 0.0


def checked_topics(session, spec: dict) -> list[dict]:
    """Verified per-topic results (coverage.json) after the input checks; raises Unanalyzable."""
    topics = session.topics or []
    if not topics:
        raise Unanalyzable("ยังไม่มีรายการหัวข้อที่ผู้ใช้ยืนยัน")
    need = spec["unanalyzable"]["min_topics"]
    if len(topics) < need:
        raise Unanalyzable(f"รายการหัวข้อมี {len(topics)} หัวข้อ (ต้องอย่างน้อย {need} หัวข้อ)")
    problem = session.audio_problem()
    if problem:
        raise Unanalyzable(problem)
    if not (session.transcript or {}).get("words"):
        raise Unanalyzable("ถอดข้อความจากเสียงไม่ได้")
    span, min_s = speech_span_s(session), spec["unanalyzable"]["min_transcript_s"]
    if span < min_s:
        raise Unanalyzable(f"ช่วงพูดยาว {span:.0f} วินาที สั้นเกินกว่าจะวัดความครอบคลุม (ต้องอย่างน้อย {min_s} วินาที)")
    if session.extra.get("coverage_error"):
        raise Unanalyzable("เรียกแบบจำลองภาษาเพื่อตรวจเนื้อหาไม่สำเร็จ")
    if not session.coverage:
        raise Unanalyzable("ยังไม่ได้ตรวจเนื้อหากับรายการหัวข้อ")
    by_id = {t["id"]: t for t in session.coverage["topics"]}
    missing = [t["id"] for t in topics if t["id"] not in by_id]
    if missing:
        raise Unanalyzable("ผลตรวจเนื้อหาไม่ตรงกับรายการหัวข้อที่ยืนยัน")
    return [by_id[t["id"]] for t in sorted(topics, key=lambda t: t["order"])]


def compute(session, spec: dict) -> dict:
    checked = checked_topics(session, spec)
    n = len(checked)
    count = {lab: sum(1 for t in checked if t["label"] == lab) for lab in LABEL_TH}
    pct = 100 * (count["clear"] + spec["brief_weight"] * count["brief"]) / n
    evidence = []
    for t in sorted((t for t in checked if t["label"] != "not_mentioned"), key=lambda t: t["start_s"]):
        quote = t["evidence_quote"]
        quote = quote if len(quote) <= QUOTE_SHOWN else quote[:QUOTE_SHOWN] + "…"
        evidence.append({"start_s": t["start_s"], "end_s": max(t["end_s"], t["start_s"]),
                         "note": f"{t['id']} {t['title']} — {LABEL_TH[t['label']]}: '{quote}'"})
    return {"values": {"coverage_clear_pct": round(pct, 1), "clear": count["clear"], "brief": count["brief"],
                       "not_mentioned": count["not_mentioned"], "topics_total": n,
                       "quotes_rejected": sum(1 for t in checked if t.get("rejected"))},
            "evidence": evidence}


def contract_topics(session) -> list[dict]:
    """Top-level `topics` of result.json (Result Contract 1.3) in the confirmed order."""
    by_id = {t["id"]: t for t in (session.coverage or {}).get("topics", [])}
    out = []
    for t in sorted(session.topics or [], key=lambda t: t["order"]):
        c = by_id.get(t["id"], {})
        label = c.get("label", "not_mentioned")
        out.append({"id": t["id"], "title": t["title"], "order": int(t["order"]), "coverage": label,
                    "first_mention_s": c.get("start_s") if label != "not_mentioned" else None,
                    "evidence_quote": c.get("evidence_quote") if label != "not_mentioned" else None})
    return out


def run(session, spec: dict) -> dict:
    """Contract `criterion` dict for C2 (never raises)."""
    return safe_run(CODE, lambda: compute(session, spec), spec)
