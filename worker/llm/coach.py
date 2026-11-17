"""Evidence-grounded AI coach (D-046, Layer 3) -> result.coach (Result Contract 1.3).

ขั้นตอน
1. build_input(): ส่งเฉพาะ "ผลที่คำนวณแล้ว" ของ 8 เกณฑ์ (code, status, level, values, evidence, reason)
   + หัวข้อ/ลำดับตามแผนและที่พูด/C2/quote และบทพูดเฉพาะช่วงหลักฐาน (ยาวไม่เกิน snippet_max_chars, D-050)
   ไม่ส่งวิดีโอและไม่ส่งบทพูดทั้งหมด; ข้อมูลที่ไม่มีส่งเป็น missing_text
   หลักฐานแต่ละช่วงเขียนเป็น [m:ss] (ปัดเศษวินาทีลง) ให้ LLM คัดลอกตรงตัว
2. LLM (prompt coach-v2, temperature 0, JSON) ตอบ 3 ส่วน: strengths / focus / plan
3. verify() — Evidence Verification Guard: ไม่เชื่อ LLM ข้อใดไม่ผ่าน = ทิ้งโค้ชทั้งก้อน (coach = null)
   - จำนวนข้อ: น้อยกว่าขั้นต่ำ = ไม่ผ่าน; เกินจำนวนสูงสุด = ตัดข้อท้าย ๆ ออกและนับใน hidden_count
     (พบจริง 15 พ.ย.: gemini-2.5-flash-lite ตอบจุดแข็ง 6 ข้อเมื่อมี 6 เกณฑ์ระดับ 4) ข้อที่เหลือยังตรวจครบทุกกฎ
   - code ต้องเป็น 1 ใน 8 เกณฑ์; strength ต้องเป็นเกณฑ์ที่ ok และระดับ 3-4; focus เกณฑ์ที่ ok
   - focus ทุกข้อต้องอ้างเวลา [m:ss] อย่างน้อย 1 จุด
   - ทุกเวลา [m:ss] / [mm:ss] ต้องอยู่ใน [0, duration_s] และห่างจากช่วงหลักฐาน (start_s-end_s)
     ของเกณฑ์เดียวกับ code ไม่เกิน match_tolerance_s (plan ที่ไม่มี code เทียบหลักฐานของเกณฑ์ใดก็ได้)
   - เวลาที่เขียนแบบไม่มีวงเล็บ (เช่น 1:05) ตรวจย้อนไม่ได้ -> ไม่ผ่าน
   - ห้ามมีวลีใน banned_phrases (คะแนนรวม เกรด ไม่ผ่าน ... อารมณ์ สบตา) และข้อความยาวไม่เกิน max_text_chars
   - โค้ชไม่เปลี่ยนระดับของการ์ดใด ๆ
4. cache: coach.json เก็บ cache_key = sha256(model, prompt, ค่าตั้ง, ข้อมูลที่ส่ง) ถ้า key เดิมใช้ผลเดิม
config: pipeline-v0.yaml coach.* · ใช้ llm.* เดียวกับ C2
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from promptpres_shared import llm_client as client
from promptpres_shared.contract import ALL_CODES
from promptpres_shared.json_files import atomic_json, read_json

PROMPT = "coach-v2"   # D-064: v1 named the banned word itself and let the model cite targets as [m:ss]
CLOCK = re.compile(r"\[(\d{1,2}):([0-5]\d)\]")            # [1:05] and [01:05]
BARE_CLOCK = re.compile(r"(?<![\[\d])\d{1,2}:[0-5]\d(?![\]\d])")   # 1:05 written without brackets
LIMITS = {"strengths": (0, 3), "focus": (1, 2), "plan": (1, 3)}
KIND = {"strengths": "strength", "focus": "focus", "plan": "plan"}


class CoachRejected(ValueError):
    """The LLM answer failed the Evidence Verification Guard; the message says which rule."""


def clock(seconds: float) -> str:
    """Seconds -> [m:ss], rounded down so the shown time never lies after the evidence start."""
    s = int(max(seconds, 0))
    return f"[{s // 60}:{s % 60:02d}]"


def parse_clocks(text: str) -> list[float]:
    """Every [m:ss] / [mm:ss] in the text -> seconds, in order of appearance."""
    return [float(int(m) * 60 + int(s)) for m, s in CLOCK.findall(text)]


def build_input(criteria: list[dict], topics: list[dict], duration_s: float, target_s: float | None,
                spec: dict, transcript: dict | None = None) -> dict:
    """Measured results, verified topics and bounded evidence transcript snippets; no video.

    Anything the run does not have is sent as spec["missing_text"], so the LLM cannot read an empty
    field as "was not said" (D-050)."""
    keep, missing = int(spec["max_evidence_per_criterion"]), spec["missing_text"]
    cards = []
    for c in criteria:
        cards.append({
            "code": c["code"], "status": c["status"], "level": c["level"], "values": c["values"],
            "evidence": [{"at": clock(e["start_s"]), "until": clock(e["end_s"]), "note": e.get("label") or e.get("note"),
                          "transcript": snippet(transcript, e, int(spec["snippet_max_chars"])) or missing}
                         for e in c["evidence"][:keep]],
            "reason": c["reason"]})
    # Spoken order = rank of the verified first mention; topics without one have no spoken position.
    heard = sorted((t for t in topics if t.get("first_mention_s") is not None), key=lambda t: t["first_mention_s"])
    spoken = {t["id"]: i for i, t in enumerate(heard, 1)}
    labels = spec["coverage_labels"]
    return {"duration": clock(duration_s), "target_minutes": round(target_s / 60, 1) if target_s else None,
            "criteria": cards,
            "topics": [{"id": t["id"], "title": t["title"], "planned_order": t["order"],
                        "spoken_order": spoken.get(t["id"], missing),
                        "coverage": t.get("coverage") or missing,
                        "coverage_label": labels.get(t.get("coverage"), missing),
                        "first_mention": clock(t["first_mention_s"]) if t["id"] in spoken else missing,
                        "quote": (t.get("evidence_quote") or "")[:int(spec["topic_quote_max_chars"])] or missing}
                       for t in sorted(topics, key=lambda t: t["order"])]}


def snippet(transcript: dict | None, evidence: dict, limit: int) -> str:
    """Transcript text overlapping one evidence span, cut to `limit` characters (config coach.snippet_max_chars)."""
    from worker.extract.fillers import joined_text  # noqa: PLC0415
    words = [w for w in (transcript or {}).get("words", [])
             if w["end_s"] >= evidence["start_s"] and w["start_s"] <= evidence["end_s"]]
    return joined_text(words)[0].strip()[:max(0, limit)]


def _evidence_spans(criteria: list[dict], keep: int) -> dict[str, list[tuple[float, float]]]:
    """Evidence the LLM was shown, per criterion (seconds)."""
    return {c["code"]: [(float(e["start_s"]), float(e["end_s"])) for e in c["evidence"][:keep]] for c in criteria}


def _near(t: float, spans: list[tuple[float, float]], tol: float) -> bool:
    return any(start - tol <= t <= end + tol for start, end in spans)


def verify(answer: dict, criteria: list[dict], duration_s: float, spec: dict) -> tuple[list[dict], int]:
    """Evidence Verification Guard -> (contract coach items, items dropped for exceeding the count), or raise."""
    if not isinstance(answer, dict):
        raise CoachRejected("คำตอบไม่ใช่ JSON object")
    by_code = {c["code"]: c for c in criteria}
    spans = _evidence_spans(criteria, int(spec["max_evidence_per_criterion"]))
    all_spans = [s for v in spans.values() for s in v]
    tol, max_chars = float(spec["match_tolerance_s"]), int(spec["max_text_chars"])
    banned = [p.lower() for p in spec["banned_phrases"]]
    items, dropped = [], 0
    for section, (low, high) in LIMITS.items():
        entries = answer.get(section) or []
        if not isinstance(entries, list) or len(entries) < low:
            raise CoachRejected(f"{section}: ต้องมีอย่างน้อย {low} ข้อ")
        dropped += max(len(entries) - high, 0)
        for entry in entries[:high]:
            items.append(_check_item(entry, section, by_code, spans, all_spans, duration_s, tol, max_chars, banned))
    return items, dropped


def _check_text(text: str, section: str, max_chars: int, banned: list[str]) -> None:
    """Wording rules: not empty, not too long, no banned phrase, every time written as [m:ss]."""
    if not text or len(text) > max_chars:
        raise CoachRejected(f"{section}: ข้อความว่างหรือยาวเกิน {max_chars} ตัวอักษร")
    lowered = text.lower()
    hit = next((p for p in banned if p in lowered), None)
    if hit:
        raise CoachRejected(f"{section}: มีวลีต้องห้าม '{hit}'")
    if BARE_CLOCK.search(CLOCK.sub("", text)):
        raise CoachRejected(f"{section}: เขียนเวลานอกรูปแบบ [m:ss]")


def _check_code(code, section: str, by_code: dict) -> None:
    """strength / focus must name an analysable card; a strength must be level 3-4."""
    if code is not None and code not in ALL_CODES:
        raise CoachRejected(f"{section}: รหัสเกณฑ์ไม่ถูกต้อง {code!r}")
    if section == "plan":
        return
    card = by_code.get(code) if code else None
    if card is None or card["status"] != "ok":
        raise CoachRejected(f"{section}: ต้องอ้างเกณฑ์ที่วิเคราะห์ได้")
    if section == "strengths" and card["level"] not in (3, 4):
        raise CoachRejected(f"{section}: {code} ไม่ได้อยู่ระดับ 3-4")


def _check_item(entry, section, by_code, spans, all_spans, duration_s, tol, max_chars, banned) -> dict:
    if not isinstance(entry, dict):
        raise CoachRejected(f"{section}: รายการไม่ใช่ object")
    text = str(entry.get("text") or "").strip()
    code = entry.get("code") or None
    _check_text(text, section, max_chars, banned)
    _check_code(code, section, by_code)
    cites = parse_clocks(text)
    if section == "focus" and not cites:
        raise CoachRejected(f"focus {code}: ไม่ได้อ้างเวลาจากหลักฐาน")
    allowed = spans.get(code, []) if code else all_spans
    for t in cites:
        if not 0 <= t <= duration_s:
            raise CoachRejected(f"{section} {code}: เวลา {t:.0f} วินาทีอยู่นอกความยาวคลิป")
        if not _near(t, allowed, tol):
            raise CoachRejected(f"{section} {code}: เวลา {t:.0f} วินาทีไม่ตรงกับหลักฐานของเกณฑ์นี้")
    return {"kind": KIND[section], "code": code, "text": text, "cite_s": cites}


def cache_key(model: str, system: str, spec: dict, payload: dict) -> str:
    blob = json.dumps({"model": model, "prompt": system, "spec": spec, "input": payload},
                      ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def generate(criteria: list[dict], topics: list[dict], duration_s: float | None, target_s: float | None,
             out_json: Path | None, spec: dict, *, reuse: bool = True, transcript: dict | None = None) -> dict:
    """Ask the LLM, verify, write coach.json -> {model, prompt, items, hidden, cached}. Raises on any failure."""
    if not duration_s:
        raise CoachRejected("ไม่ทราบความยาวคลิป")
    if not any(c["status"] == "ok" for c in criteria):
        raise CoachRejected("ไม่มีเกณฑ์ที่วิเคราะห์ได้")
    payload = build_input(criteria, topics, duration_s, target_s, spec, transcript)
    model = client.model_name()
    system, version = client.load_prompt(PROMPT)
    version = spec.get("prompt_revision", version)
    key = cache_key(model, system, spec, payload)
    if reuse and out_json is not None:
        old = _read_cache(Path(out_json), key)
        if old is not None:
            return old
    answer, meta = client.chat_json(system, "RESULT\n" + json.dumps(payload, ensure_ascii=False), purpose="coach")
    items, hidden = verify(answer, criteria, float(duration_s), spec)
    result = {"model": model, "prompt": version, "cache_key": key, "usage": [meta], "raw": answer,
              "items": items, "hidden": hidden, "cached": False}
    if out_json is not None:
        atomic_json(Path(out_json), result)
    return result


def _read_cache(path: Path, key: str) -> dict | None:
    try:
        old = read_json(path)
    except (OSError, ValueError):
        return None
    if (isinstance(old, dict) and old.get("cache_key") == key and isinstance(old.get("items"), list)
            and isinstance(old.get("model"), str) and isinstance(old.get("prompt"), str)):
        return old | {"cached": True}
    return None
