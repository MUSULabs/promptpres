"""Candidate topics from the project-report / slide PDF (PyMuPDF text + LLM); the user edits and confirms them.

ขั้นตอน
1. pdf_text(): อ่านข้อความด้วย PyMuPDF ทีละหน้า ("PAGE n" นำหน้า) ไม่เกิน pdf_max_pages หน้า
   ถ้ารวมเกิน pdf_max_chars ตัวอักษร (งบโทเคน) ทุกหน้าถูกตัดเหลือ c ตัวอักษรแรกเท่ากัน (page_cap)
   เพื่อให้แบบจำลองเห็นครบทุกบท ไม่ใช่ตัดท้ายเล่มทิ้ง
   ข้อความน้อยกว่า MIN_PDF_CHARS = PDF ภาพสแกน -> ให้ผู้ใช้กรอกเอง
2. ส่งข้อความกับ prompt worker/prompts/topics-v2.txt ไปที่ client.chat_json (OpenRouter, temperature 0, JSON)
3. clean_topics():
   - is_valid_document = false (ใบเสร็จ เมนู แบบฟอร์ม ฯลฯ) -> ValueError ข้อความไทย (API ตอบ 422)
   - ตัดชื่อซ้ำ ต้องได้อย่างน้อย min_topics หัวข้อ (thresholds C2.unanalyzable.min_topics)
   - ได้เกิน PROMPT_MAX_TOPICS ไม่ทิ้งร่าง: เก็บไม่เกิน max_topics ข้อแรก (thresholds C2.max_topics) พร้อม note บอกผู้ใช้ให้รวม/ลบเอง
   - ตั้งรหัสและลำดับใหม่ H01, H02, ... ตามลำดับในคำตอบ (ไม่เชื่อเลขที่ LLM ให้มา)
ผล: {"topics": [{"id", "title", "expected_order", "key_point"}], "note", "model", "prompt", "usage"}
รายการนี้เป็นเพียง "ร่าง" — ระบบวิเคราะห์ใช้เฉพาะรายการที่ผู้ใช้ยืนยันแล้ว (topics.json ของ session)

CLI:  python -m worker.llm.topics <report.pdf> [--out topics.json]
แนวคิดจากต้นแบบเดิม (ต.ค. 2569, ลบแล้ว D-060) ซึ่งใช้ pypdf + Gemini ตรงและบังคับ 4 หัวข้อ; ที่นี่ผ่าน OpenRouter และให้ผู้ใช้ยืนยัน
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from promptpres_shared import llm_client as client
from promptpres_shared.settings import load_thresholds, pipeline_config

PROMPT = "topics-v2"
MIN_PDF_CHARS = 200          # fewer readable characters = scanned / image-only PDF
# list limits live in config/thresholds-v0.yaml (C2.unanalyzable.min_topics, C2.max_topics); these are only the
# defaults for tests and must match it (api/tests/test_topics_draft.py checks yaml = here = web TopicEditor.tsx)
MIN_TOPICS = 3
PROMPT_MAX_TOPICS = 10       # the prompt asks for 5-8, never more than 10; more than this -> a note to the user
MAX_DRAFT_TOPICS = 15        # editor / API limit; a longer draft keeps the first 15
REASON_MAX_CHARS = 200       # the LLM's rejection reason is shown to the user, so it is cut short


def page_cap(lengths: list[int], budget: int) -> int:
    """Largest per-page cap c with sum(min(length, c)) <= budget (every page then keeps its first c chars)."""
    if sum(lengths) <= budget:
        return max(lengths, default=0)
    lo, hi = 0, max(lengths)
    while lo < hi:                       # binary search on c
        mid = (lo + hi + 1) // 2
        if sum(min(n, mid) for n in lengths) <= budget:
            lo = mid
        else:
            hi = mid - 1
    return lo


def pdf_text(pdf: Path, max_pages: int, max_chars: int) -> tuple[str, int]:
    """Text of the first `max_pages` pages as 'PAGE n' blocks, about `max_chars` long; (text, pages in file).

    Every problem with the file itself is a ValueError with a Thai message (the API answers 422).
    """
    import pymupdf   # noqa: PLC0415

    try:
        doc = pymupdf.open(stream=pdf.read_bytes(), filetype="pdf")
    except (pymupdf.FileDataError, RuntimeError):
        raise ValueError("ไฟล์ PDF เสียหายหรือเปิดไม่ได้ กรุณากรอกหัวข้อเอง") from None
    with doc:
        if doc.needs_pass:
            raise ValueError("PDF นี้ตั้งรหัสผ่านไว้ ระบบอ่านข้อความไม่ได้ กรุณากรอกหัวข้อเอง")
        pages = doc.page_count
        # Thai PDFs often store sara am as nikhahit + sara aa ("ํา"); join it back to "ำ" so titles read normally
        texts = [doc[i].get_text().strip().replace("ํา", "ำ") for i in range(min(pages, max_pages))]
    readable = sum(1 for t in texts for ch in t if not ch.isspace())
    if readable < MIN_PDF_CHARS:
        raise ValueError("PDF นี้ไม่มีข้อความที่อ่านได้ (อาจเป็นภาพสแกน) กรุณากรอกหัวข้อเอง")
    headers = [f"PAGE {i + 1}\n" for i in range(len(texts))]
    budget = max_chars - sum(len(h) + 2 for h in headers)         # room left for page text
    cap = page_cap([len(t) for t in texts], max(budget, 0))
    text = "\n\n".join(h + t[:cap] for h, t in zip(headers, texts))
    return text[:max_chars], pages                                  # safety net (many tiny pages)


def _is_rejected(payload: dict) -> bool:
    flag = payload.get("is_valid_document", True)          # missing field (old format) = a usable document
    return flag is False or str(flag).strip().lower() == "false"


def _key_point(t: dict) -> str:
    kp = t.get("key_point")
    if not kp and isinstance(t.get("key_points"), list):   # the model sometimes sends a list instead
        kp = " · ".join(str(x).strip() for x in t["key_points"] if str(x).strip())
    return str(kp or "").strip()


def clean_topics(payload: dict, min_topics: int = MIN_TOPICS,
                 max_topics: int = MAX_DRAFT_TOPICS) -> tuple[list[dict], str | None]:
    """Validate the LLM reply and renumber: ids H01.., expected_order 1..n in the reply's order; (topics, note)."""
    if not isinstance(payload, dict):
        raise ValueError("คำตอบไม่มีรายการ topics")
    if _is_rejected(payload):
        reason = " ".join(str(payload.get("rejection_reason") or "").split())[:REASON_MAX_CHARS]
        raise ValueError("ไฟล์ที่แนบไม่ใช่รายงานโครงงานหรือสไลด์นำเสนอ" + (f" ({reason})" if reason else "")
                         + " กรุณาแนบไฟล์รายงานหรือสไลด์ที่ต้องการใช้นำเสนอ หรือกรอกหัวข้อเอง")
    raw = payload.get("topics")
    if not isinstance(raw, list):
        raise ValueError("คำตอบไม่มีรายการ topics")
    out, seen = [], set()
    for t in raw:
        if not isinstance(t, dict):
            continue
        title = str(t.get("title") or "").strip()
        key = "".join(title.split()).lower()
        if not title or key in seen:
            continue
        seen.add(key)
        out.append({"title": title, "key_point": _key_point(t)})
    if len(out) < min_topics:
        raise ValueError(f"ได้หัวข้อ {len(out)} หัวข้อ (ต้องอย่างน้อย {min_topics}) กรุณากรอกหรือแก้หัวข้อเอง")
    note = None
    if len(out) > min(PROMPT_MAX_TOPICS, max_topics):   # too many is never an error: the user merges or deletes in the editor
        note = (f"ระบบเสนอ {len(out)} หัวข้อ ซึ่งมากกว่าที่ควรพูดในการนำเสนอหนึ่งครั้ง (แนะนำ 5–8) "
                "ลองรวมหัวข้อในหมวดเดียวกันหรือลบหัวข้อย่อย")
        if len(out) > max_topics:
            note += f" — แสดง {max_topics} หัวข้อแรก"
            out = out[:max_topics]
    topics = [{"id": f"H{i:02d}", "title": t["title"], "expected_order": i, "key_point": t["key_point"]}
              for i, t in enumerate(out, start=1)]
    return topics, note


def suggest_topics(pdf: Path) -> dict:
    """Draft topic list from one PDF (one LLM call)."""
    cfg = pipeline_config()["llm"]
    deadline = time.monotonic() + cfg.get("topics_deadline_s", 50)
    text, pages = pdf_text(Path(pdf), cfg["pdf_max_pages"], cfg["pdf_max_chars"])
    system, version = client.load_prompt(PROMPT)
    user = f"เอกสาร ({pages} หน้า; ใช้ได้ไม่เกิน {cfg['pdf_max_pages']} หน้าแรก)\n<<<เอกสาร\n{text}\nเอกสาร>>>"
    payload, meta = client.chat_json(system, user, purpose="topics", timeout_s=cfg["topics_timeout_s"], max_retries=0, deadline=deadline)
    c2 = load_thresholds()["criteria"]["C2"]
    topics, note = clean_topics(payload, c2["unanalyzable"]["min_topics"], c2["max_topics"])
    return {"topics": topics, "note": note, "model": meta["model"], "prompt": version, "usage": meta}


def main() -> None:
    ap = argparse.ArgumentParser(description="Draft topic list from a project PDF (user must confirm)")
    ap.add_argument("pdf")
    ap.add_argument("--out", help="write the draft list as JSON here")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    res = suggest_topics(Path(args.pdf))
    text = json.dumps(res, ensure_ascii=False, indent=1)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
