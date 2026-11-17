"""LLM topic-coverage labels + quote verifier -> coverage.json (feeds C2 and C1).

ขั้นตอน
1. transcript_lines(): ต่อชิ้นคำของ Whisper เป็นบรรทัด L001, L002, ... (ขึ้นบรรทัดใหม่เมื่อเว้นเงียบ
   >= transcript_line_gap_s หรือบรรทัดยาวเกิน transcript_line_max_s) แต่ละบรรทัดมีเวลาเริ่ม-จบ
2. ส่งรายการหัวข้อที่ยืนยัน + บรรทัดพร้อมเวลา ให้ LLM (prompt coverage-v1) ติดป้ายต่อหัวข้อ
   clear / brief / not_mentioned พร้อม evidence_quote (คัดลอกตรงตัว), line_id, start_s
3. verify() — ไม่เชื่อ LLM: ต้องหา evidence_quote เจอจริงใน transcript
   - ทำให้ข้อความทั้งสองฝั่งเป็นรูปเดียวกัน (normalise): NFKC, ตัวพิมพ์เล็ก, ตัดช่องว่าง/เครื่องหมาย/อักขระล่องหน
     (Whisper เขียน "ำ" เป็น "ํ"+"า" บ่อย NFKC ทำให้ตรงกัน)
   - เจอแบบตรงตัว (substring) = ผ่าน; ถ้าเจอหลายที่เลือกที่ใกล้ start_s ของ LLM ที่สุด
   - ไม่เจอตรงตัว: เลื่อนหน้าต่างยาวเท่า quote ไปบนข้อความช่วงบรรทัดที่ LLM อ้าง (±1 บรรทัด)
     ยอมรับเมื่อความคล้าย (difflib ratio) >= quote_min_ratio
   - เวลาของหลักฐานเอามาจาก "ชิ้นคำที่ quote ไปตรง" ไม่ใช้เวลาที่ LLM บอก
   - ตีตก: ไม่มี quote, quote สั้นกว่า quote_min_chars, หาไม่เจอ, หรือ start_s ของ LLM อยู่นอกความยาวคลิป
   - กฎเหล็ก: หัวข้อที่ LLM บอก clear/brief แต่ตีตก -> ปัดเป็น not_mentioned (rejected = เหตุผล)
   - ถามซ้ำ (requote_rounds ใน config, prompt requote-v1): หัวข้อที่ตกเพราะ "หา quote ไม่พบ" ถาม LLM
     อีกครั้งโดยให้เฉพาะบรรทัดใกล้ line_id ที่อ้าง ให้คัดลอกใหม่ ป้ายเดิมคงไว้ แล้วตรวจด้วย verify() เหมือนเดิม
     (พบจริงใน P11 S01: LLM คัดข้อความจาก key_point ของหัวข้อแทน transcript)
4. cache: coverage.json เก็บ cache_key = sha256(model, ข้อความ prompt, topics, transcript) ถ้า key เดิมใช้ผลเดิม ไม่เรียกซ้ำ
config: pipeline-v0.yaml llm.* (บรรทัด) · thresholds-v0.yaml criteria.C2 (quote_min_ratio, quote_min_chars)
ต้นแบบเดิม (ลบแล้ว D-060) เทียบ substring ตรงตัวในแต่ละ segment; ที่นี่เทียบหลังตัดช่องว่าง/NFKC และยอมคล้าย ≥ quote_min_ratio
"""
from __future__ import annotations

import hashlib
import json
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

from promptpres_shared import llm_client as client
from promptpres_shared.json_files import atomic_json, read_json
from worker.extract.fillers import joined_text

PROMPT = "coverage-v1"
REQUOTE_PROMPT = "requote-v1"
REQUOTE_CONTEXT_LINES = 2       # the re-ask shows the line the LLM named and this many lines either side
LABELS = ("clear", "brief", "not_mentioned")
ALIASES = {"missing": "not_mentioned", "none": "not_mentioned", "partial": "brief", "mention": "brief"}


# --------------------------------------------------------------------------- transcript lines
def transcript_lines(words: list[dict], gap_s: float, max_s: float) -> list[dict]:
    """Group Whisper pieces into numbered lines: [{id, start_s, end_s, text, first, last}] (piece indices)."""
    groups, cur = [], []
    for i, w in enumerate(words):
        if cur and (w["start_s"] - words[cur[-1]]["end_s"] >= gap_s or w["end_s"] - words[cur[0]]["start_s"] > max_s):
            groups.append(cur)
            cur = []
        cur.append(i)
    if cur:
        groups.append(cur)
    lines = []
    for n, idx in enumerate(groups, start=1):
        text = joined_text([words[i] for i in idx])[0].strip()
        lines.append({"id": f"L{n:03d}", "start_s": round(words[idx[0]]["start_s"], 2),
                      "end_s": round(words[idx[-1]]["end_s"], 2), "text": text, "first": idx[0], "last": idx[-1]})
    return lines


# --------------------------------------------------------------------------- normalise + find
def _keep(ch: str) -> bool:
    """Drop spaces, punctuation and invisible format characters (zero-width etc.)."""
    cat = unicodedata.category(ch)
    return not (ch.isspace() or cat[0] in "PZC")


def normalise(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKC", text or "").lower() if _keep(c))


def normalised_with_owner(words: list[dict]) -> tuple[str, list[int]]:
    """Normalised transcript text + for every character the index of the Whisper piece it came from."""
    text, owner = joined_text(words)
    out, own = [], []
    for ch, o in zip(text, owner):
        for c in unicodedata.normalize("NFKC", ch).lower():
            if _keep(c):
                out.append(c)
                own.append(o)
    return "".join(out), own


def _all_exact(hay: str, needle: str) -> list[int]:
    hits, k = [], hay.find(needle)
    while k >= 0:
        hits.append(k)
        k = hay.find(needle, k + 1)
    return hits


def _best_fuzzy(hay: str, needle: str, lo: int, hi: int) -> tuple[float, int]:
    """Best SequenceMatcher ratio of a window as long as `needle` starting in hay[lo:hi].

    Windows shifted by one character can score the same; then the one whose first / last character
    equals the quote's wins (so the time starts where the quote starts).
    """
    n, best, best_key = len(needle), (0.0, -1), (0.0, False, False)
    for k in range(max(lo, 0), max(min(hi, len(hay) - n) + 1, 0)):
        sm = SequenceMatcher(None, hay[k:k + n], needle, autojunk=False)
        if sm.quick_ratio() < best[0]:
            continue
        r = sm.ratio()
        key = (round(r, 6), hay[k] == needle[0], hay[k + n - 1] == needle[-1])
        if key > best_key:
            best, best_key = (r, k), key
    return best


def verify(answer: dict, words: list[dict], lines: list[dict], duration_s: float, spec: dict,
           norm: tuple[str, list[int]] | None = None) -> dict:
    """Check one LLM answer against the transcript.

    Returns {label, llm_label, evidence_quote, start_s, end_s, match, rejected}; a clear/brief answer
    that fails becomes not_mentioned with `rejected` = reason. Times come from the matched pieces.
    """
    label = str(answer.get("label", "")).strip().lower()
    llm_label = ALIASES.get(label, label)
    if llm_label not in LABELS:
        llm_label = "not_mentioned"
    out = {"label": "not_mentioned", "llm_label": llm_label, "evidence_quote": None,
           "start_s": None, "end_s": None, "match": None, "rejected": None}
    if llm_label == "not_mentioned":
        return out

    def reject(reason):
        return out | {"rejected": reason}

    quote = str(answer.get("evidence_quote") or "").strip()
    q = normalise(quote)
    if not q:
        return reject("no_quote")
    if len(q) < spec["quote_min_chars"]:
        return reject("quote_too_short")
    llm_t = answer.get("start_s")
    llm_t = float(llm_t) if isinstance(llm_t, (int, float)) and not isinstance(llm_t, bool) else None
    if llm_t is not None and not 0 <= llm_t <= duration_s:
        return reject("time_outside_clip")

    hay, owner = norm or normalised_with_owner(words)
    found = _match_quote(hay, q, owner, words, lines, answer.get("line_id"), llm_t, spec["quote_min_ratio"])
    if found is None:
        return reject("quote_not_found")
    k, match = found
    a, b = owner[k], owner[min(k + len(q) - 1, len(owner) - 1)]
    return out | {"label": llm_label, "evidence_quote": quote, "start_s": round(words[a]["start_s"], 2),
                  "end_s": round(words[b]["end_s"], 2), "match": match}


def _match_quote(hay, q, owner, words, lines, line_id, llm_t, min_ratio):
    hits = _all_exact(hay, q)
    if hits:
        k = hits[0] if llm_t is None else min(hits, key=lambda h: abs(words[owner[h]]["start_s"] - llm_t))
        return k, "exact"
    # Fuzzy matching is limited to the cited line and its two neighbours.
    by_id = {line["id"]: index for index, line in enumerate(lines)}
    index = by_id.get(str(line_id or "").strip())
    if index is None:
        return None
    first = lines[max(index - 1, 0)]["first"]
    last = lines[min(index + 1, len(lines) - 1)]["last"]
    chars = [i for i, word_index in enumerate(owner) if first <= word_index <= last]
    if not chars:
        return None
    ratio, k = _best_fuzzy(hay, q, chars[0], chars[-1])
    return (k, f"fuzzy {ratio:.2f}") if k >= 0 and ratio >= min_ratio else None


# --------------------------------------------------------------------------- LLM call + cache
def prompt_input(topics: list[dict], lines: list[dict]) -> str:
    tl = [{"id": t["id"], "title": t["title"], "order": t["order"], "key_point": t.get("key_point", "")}
          for t in topics]
    body = "\n".join(f"[{ln['id']} {ln['start_s']:.1f}-{ln['end_s']:.1f}] {ln['text']}" for ln in lines)
    return ("TOPICS\n" + json.dumps(tl, ensure_ascii=False, indent=1)
            + "\n\nTRANSCRIPT (รหัสบรรทัด เวลาเริ่ม-จบเป็นวินาที แล้วข้อความ)\n<<<TRANSCRIPT\n" + body + "\nTRANSCRIPT>>>")


def requote_input(rejected: list[dict], answers: dict, topics: list[dict], lines: list[dict]) -> str:
    """Re-ask message: the rejected topics and only the lines near the line each one named."""
    by_id = {ln["id"]: n for n, ln in enumerate(lines)}
    keep = set()
    for r in rejected:
        n = by_id.get(str(answers.get(r["id"], {}).get("line_id") or "").strip())
        span = range(len(lines)) if n is None else range(max(n - REQUOTE_CONTEXT_LINES, 0),
                                                           min(n + REQUOTE_CONTEXT_LINES + 1, len(lines)))
        keep.update(span)
    titles = {t["id"]: t["title"] for t in topics}
    tl = [{"id": r["id"], "title": titles[r["id"]], "label": r["llm_label"]} for r in rejected]
    body = "\n".join(f"[{lines[i]['id']} {lines[i]['start_s']:.1f}-{lines[i]['end_s']:.1f}] {lines[i]['text']}"
                     for i in sorted(keep))
    return "TOPICS\n" + json.dumps(tl, ensure_ascii=False) + "\n\nLINES\n<<<LINES\n" + body + "\nLINES>>>"


def cache_key(model: str, prompt: str, topics: list[dict], words: list[dict]) -> str:
    """Same model + same prompt text + same topics + same transcript = same answer (temperature 0)."""
    blob = json.dumps({"model": model, "prompt": prompt, "topics": topics,
                       "words": [[w["start_s"], w["end_s"], w["word"]] for w in words]}, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def analyse(topics: list[dict], transcript: dict, duration_s: float | None, out_json: Path | None,
            llm_cfg: dict, spec: dict, prompt: str = PROMPT, *, reuse: bool = True,
            source: dict | None = None) -> dict:
    """Label every confirmed topic (LLM) and verify the quotes; write/reuse coverage.json.

    prompt: prompt version to use (worker/prompts/<prompt>.txt); worker.dev_coverage compares versions.
    """
    words = (transcript or {}).get("words") or []
    if not words:
        raise ValueError("no transcript words")
    model = client.model_name()
    system, version = client.load_prompt(prompt)
    requote_system, requote_version = client.load_prompt(REQUOTE_PROMPT)
    policy = json.dumps({"version": 3, "source": source, "duration": duration_s, "criterion": spec,
                         "line_gap": llm_cfg["transcript_line_gap_s"],
                         "line_max": llm_cfg["transcript_line_max_s"],
                         "provider": llm_cfg.get("base_url"), "temperature": llm_cfg.get("temperature"),
                         "max_tokens": llm_cfg.get("max_tokens")}, sort_keys=True)
    key = cache_key(model, system + requote_system + policy, topics, words)
    if reuse and out_json is not None:
        old = _read_cache(Path(out_json), key)
        if old is not None:
            return old

    lines = transcript_lines(words, llm_cfg["transcript_line_gap_s"], llm_cfg["transcript_line_max_s"])
    payload, meta = client.chat_json(system, prompt_input(topics, lines), purpose="coverage")
    answers = _answers_by_id(payload)
    if any(not answers.get(topic["id"], {}).get("label") for topic in topics):
        raise client.LLMError("แบบจำลองภาษาตอบไม่ครบทุกหัวข้อ")
    duration = float(duration_s) if duration_s else words[-1]["end_s"]
    norm = normalised_with_owner(words)
    def verify_answer(answer):
        return verify(answer, words, lines, duration, spec, norm)

    checked = [{"id": t["id"], "title": t["title"], "order": t["order"], "requoted": False}
               | verify_answer(answers[t["id"]]) for t in topics]
    usage, raws, prompts = [meta], [payload], [version]

    for payload, meta in _requote(checked, answers, topics, lines, requote_system, spec["requote_rounds"], verify_answer):
        usage.append(meta)
        raws.append(payload)
        if requote_version not in prompts:
            prompts.append(requote_version)
    result = {"model": model, "prompt": " + ".join(prompts), "cache_key": key, "usage": usage,
              "raw": raws, "topics": checked, "cached": False}
    if out_json is not None:
        atomic_json(Path(out_json), result)
    return result


def _answers_by_id(payload, *, first_wins=True):
    answers = {}
    for answer in payload.get("topics") or []:
        if isinstance(answer, dict):
            topic_id = str(answer.get("id", "")).strip()
            if not first_wins or topic_id not in answers:
                answers[topic_id] = answer
    return answers


def _requote(checked, answers, topics, lines, system, rounds, verify_answer):
    for _ in range(int(rounds)):
        rejected = [c for c in checked if c["rejected"] == "quote_not_found"]
        if not rejected:
            break
        payload, meta = client.chat_json(system, requote_input(rejected, answers, topics, lines), purpose="requote")
        new = _answers_by_id(payload, first_wins=False)
        for c in rejected:
            if c["id"] not in new:
                continue
            answers[c["id"]] = new[c["id"]] | {"label": c["llm_label"]}      # label stays the first answer's
            c.update(verify_answer(answers[c["id"]]) | {"requoted": True})
        yield payload, meta


def _read_cache(path: Path, key: str) -> dict | None:
    try:
        old = read_json(path)
    except (OSError, ValueError):
        return None
    if (isinstance(old, dict) and old.get("cache_key") == key and isinstance(old.get("topics"), list)
            and isinstance(old.get("model"), str) and isinstance(old.get("prompt"), str)):
        return old | {"cached": True}
    return None
