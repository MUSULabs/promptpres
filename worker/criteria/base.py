"""Shared helpers for every criterion: map values to a level and fail safely.

ตัวช่วยที่ทุกเกณฑ์ใช้ร่วมกัน
- level_from_bands(): แปลงค่าที่วัดได้เป็นระดับ 1–4 ตามขอบใน config
- safe_run(): ครอบการคำนวณของแต่ละเกณฑ์ด้วย try/except ถ้าพังให้เป็น "วิเคราะห์ไม่ได้" พร้อมเหตุผล
  (วิเคราะห์ไม่ได้ไม่ใช่ระดับ 1) · ค่าที่ไม่ใช่ตัวเลขจริง (NaN / อนันต์) ไม่ถูกนำไปคิดระดับ:
  ถ้าเป็นค่าที่ใช้คิดระดับ -> วิเคราะห์ไม่ได้, ถ้าเป็นข้อมูลประกอบ -> null
- clamp_evidence(): ช่วงเวลาหลักฐานทุกอันอยู่ใน 0 <= start_s <= end_s <= ความยาวคลิป

Output of safe_run() is one `criterion` object of Result Contract 1.3
(contracts/result.schema.json, $defs/criterion).
"""
from __future__ import annotations

import math
from numbers import Real
from typing import Callable



SKILL_BY_PREFIX = {"C": "content", "S": "speech", "N": "body", "T": "time"}
LEVEL_ORDER = (4, 3, 2)                              # checked in this order; no match = level 1


class Unanalyzable(Exception):
    """Raise inside a criterion when the input is not good enough to give a level.

    The message must be a Thai sentence the user can read, e.g. "เห็นมือน้อยกว่า 70% ของเวลา".
    `values` / `evidence` (optional) are still shown on the card, e.g. C1 with only 3 clear topics shows
    tau without a level (rubric v0.9). They never produce a level.
    """

    def __init__(self, reason: str, values: dict | None = None, evidence: list | None = None):
        super().__init__(reason)
        self.values = values or {}
        self.evidence = evidence or []


def _fits(value: float, bound, direction: str) -> bool:
    """Does one measured value fit inside one band? Bounds are inclusive."""
    if direction == "higher":            # bigger is better: value must reach the bound
        return value >= bound
    if direction == "lower":             # smaller is better: value must not exceed the bound
        return value <= bound
    if direction == "range":             # a middle band is best: lo <= value <= hi
        lo, hi = bound
        return lo <= value <= hi
    raise ValueError(f"unknown direction: {direction}")


def is_finite_number(value) -> bool:
    """A real number that is not NaN or infinite (bool is not a number here)."""
    return isinstance(value, Real) and not isinstance(value, bool) and math.isfinite(float(value))


def finite_values(values: dict) -> dict:
    """Same dict with NaN / infinite numbers replaced by None (JSON has no NaN; the web shows '—')."""
    return {k: (None if isinstance(v, Real) and not isinstance(v, bool) and not math.isfinite(float(v)) else v)
            for k, v in values.items()}


def clamp_evidence(evidence: list[dict], duration_s: float | None) -> list[dict]:
    """Keep every evidence span inside the clip: 0 <= start_s <= end_s <= duration_s.

    Times come from VAD / Whisper / landmarks and can overshoot the container length a little
    (e.g. N2 marks whole seconds, so the last second can end after the video). Spans with a
    missing or non-finite time are dropped. Without a known duration only the lower bound is used.
    """
    out = []
    for e in evidence or []:
        start, end = e.get("start_s"), e.get("end_s")
        if not (is_finite_number(start) and is_finite_number(end)):
            continue
        start, end = max(0.0, float(start)), float(end)
        if is_finite_number(duration_s) and duration_s > 0:
            start, end = min(start, float(duration_s)), min(end, float(duration_s))
        out.append(e | {"start_s": start, "end_s": max(start, end)})
    return out


def level_for_value(key: str, value: float, spec: dict) -> int:
    """Level 4..1 for one scored value, checking the bands of level 4, then 3, then 2."""
    for level in LEVEL_ORDER:
        if _fits(value, spec["levels"][level][key], spec["direction"]):
            return level
    return 1


def level_from_bands(values: dict, spec: dict) -> int:
    """Level of a whole card = the lowest level across its scored_values.

    `spec` is one criterion block of the thresholds file, e.g. load_thresholds()["criteria"]["S2"].
    Only keys in spec["scored_values"] are looked at; other keys in `values` are supporting info.
    """
    levels = []
    for key in spec["scored_values"]:
        value = values.get(key)
        if value is None:
            raise Unanalyzable(f"ไม่มีค่าที่ใช้คิดระดับ ({key})")
        if not is_finite_number(value):          # NaN would fit no band and silently become level 1
            raise Unanalyzable(f"ค่าที่วัดได้ไม่ใช่ตัวเลขที่ใช้ได้ ({key})")
        levels.append(level_for_value(key, float(value), spec))
    return min(levels)


def safe_run(code: str, compute: Callable[[], dict], spec: dict) -> dict:
    """Run one criterion and always return a valid contract `criterion` dict.

    `compute()` returns {"values": {...}, "evidence": [{"start_s", "end_s", "note"}, ...]}.
    It may raise Unanalyzable (expected, reason shown as is) or any other error (bug or bad input).
    """
    skill = SKILL_BY_PREFIX[code[0]]
    out = None
    try:
        out = compute()
        values = out["values"]
        level = level_from_bands(values, spec)
        return {"code": code, "skill": skill, "status": "ok", "level": level,
                "values": finite_values(values), "evidence": out.get("evidence", []),
                "feedback_id": f"{code}_L{level}", "reason": None}
    except Unanalyzable as e:
        reason, values, evidence = str(e), e.values, e.evidence
        if out is not None and not values:      # raised by level_from_bands: keep what was measured
            values, evidence = out.get("values", {}), out.get("evidence", [])
    except Exception as e:  # noqa: BLE001 — every criterion must fail on its own (CLAUDE.md rule 4)
        reason, values, evidence = f"เกิดข้อผิดพลาดระหว่างวิเคราะห์ ({type(e).__name__})", {}, []
    return {"code": code, "skill": skill, "status": "unanalyzable", "level": None,
            "values": finite_values(values), "evidence": evidence, "feedback_id": None, "reason": reason}
