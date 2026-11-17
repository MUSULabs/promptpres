"""C1: ลำดับหัวข้อเทียบกับแผน (Topic sequence, Kendall's tau-b)

อ่าน: ผลของ C2 (หัวข้อที่ตรวจแล้ว + เวลาที่เริ่มอธิบายสาระครั้งแรก = เวลาของ quote ที่ตรวจแล้ว)
ค่าที่รายงาน: kendall_tau (ใช้คิดระดับ) · topics_ordered, concordant_pairs, swapped_pairs (ข้อมูลประกอบ)
วิธีคิด (รูบริก v0.9):
  1. ใช้เฉพาะหัวข้อที่ป้ายอยู่ใน counted_labels (ค่าเริ่ม: clear เท่านั้น) และมีเวลาที่ตรวจแล้ว
  2. เรียงหัวข้อตามเวลาที่เริ่มอธิบาย -> ลำดับที่พูดจริง
  3. จับคู่หัวข้อทุกคู่: คู่ที่เรียงเหมือนแผน = n_c, คู่ที่สลับกับแผน = n_d
  4. tau-b = (n_c - n_d) / sqrt((n0 - t_plan) (n0 - t_spoken)),  n0 = n(n-1)/2
     t = จำนวนคู่ที่เสมอกัน (ปกติเป็น 0 จึงเท่ากับ (n_c - n_d) / n0 ตามสูตรในรูบริก)
  5. ไม่หักคะแนนหัวข้อที่ขาด (แสดงใน C2 แล้ว)
วิเคราะห์ไม่ได้: C2 วิเคราะห์ไม่ได้; หัวข้อที่นับได้น้อยกว่า min_topics_mentioned;
  มีพอดี min_topics_mentioned..(min_topics_for_level - 1) หัวข้อ -> แสดง tau และคู่ที่สลับ แต่ไม่ให้ระดับ
config: thresholds-v0.yaml criteria.C1 (levels, counted_labels, unanalyzable.*)
ต้นแบบเดิม (ลบแล้ว D-060) ใช้ LCS; ระบบนี้ใช้ Kendall's tau-b ตามรูบริก v0.9
"""
from __future__ import annotations

import math

from worker.criteria import c2
from worker.criteria.base import Unanalyzable, safe_run

CODE = "C1"


def pair_counts(plan: list[float], spoken: list[float]) -> dict:
    """Count every pair (i, j): concordant, discordant, tied in plan, tied in spoken."""
    out = {"concordant": 0, "discordant": 0, "tie_plan": 0, "tie_spoken": 0, "swapped": []}
    for i in range(len(plan)):
        for j in range(i + 1, len(plan)):
            a, b = plan[i] - plan[j], spoken[i] - spoken[j]
            if a == 0:
                out["tie_plan"] += 1
            if b == 0:
                out["tie_spoken"] += 1
            if a == 0 or b == 0:
                continue
            if (a > 0) == (b > 0):
                out["concordant"] += 1
            else:
                out["discordant"] += 1
                out["swapped"].append((i, j))
    return out


def kendall_tau_b(plan: list[float], spoken: list[float]) -> float:
    """Kendall's tau-b of two rankings of the same items (-1 .. 1)."""
    n = len(plan)
    n0 = n * (n - 1) / 2
    p = pair_counts(plan, spoken)
    denom = math.sqrt((n0 - p["tie_plan"]) * (n0 - p["tie_spoken"]))
    return (p["concordant"] - p["discordant"]) / denom if denom else 0.0


def compute(session, spec: dict, c2_spec: dict) -> dict:
    try:
        checked = c2.checked_topics(session, c2_spec)
    except Unanalyzable as e:
        raise Unanalyzable(f"ตรวจลำดับไม่ได้เพราะเกณฑ์ความครอบคลุมวิเคราะห์ไม่ได้: {e}") from None
    counted = [t for t in checked if t["label"] in spec["counted_labels"] and t.get("start_s") is not None]
    counted.sort(key=lambda t: t["start_s"])
    n = len(counted)
    need_show, need_level = spec["unanalyzable"]["min_topics_mentioned"], spec["unanalyzable"]["min_topics_for_level"]
    if n < need_show:
        raise Unanalyzable(f"อธิบายชัดเจนเพียง {n} หัวข้อ (ต้องอย่างน้อย {need_show} หัวข้อจึงดูลำดับได้)")

    plan = [float(t["order"]) for t in counted]           # planned position of each topic, in spoken order
    spoken = [float(i) for i in range(1, n + 1)]
    pairs = pair_counts(plan, spoken)
    tau = round(kendall_tau_b(plan, spoken), 3)
    evidence = []
    for k, t in enumerate(counted, start=1):
        with_ = [f"{counted[i]['id']}-{counted[j]['id']}" for i, j in pairs["swapped"] if k - 1 in (i, j)]
        note = f"ลำดับที่พูด {k}: {t['id']} {t['title']} (ในแผนเป็นข้อ {t['order']})"
        if with_:
            note += " · สลับกับแผน: " + ", ".join(with_)
        evidence.append({"start_s": t["start_s"], "end_s": max(t.get("end_s") or t["start_s"], t["start_s"]),
                         "note": note})
    values = {"kendall_tau": tau, "topics_ordered": n, "concordant_pairs": pairs["concordant"],
              "swapped_pairs": pairs["discordant"]}
    if n < need_level:
        raise Unanalyzable(f"อธิบายชัดเจน {n} หัวข้อ: τ = {tau:.2f} แสดงเพื่อดูเท่านั้น ยังไม่ให้ระดับ "
                           f"(ต้องอย่างน้อย {need_level} หัวข้อ)", values=values, evidence=evidence)
    return {"values": values, "evidence": evidence}


def run(session, spec: dict, c2_spec: dict) -> dict:
    """Contract `criterion` dict for C1 (never raises)."""
    return safe_run(CODE, lambda: compute(session, spec, c2_spec), spec)
