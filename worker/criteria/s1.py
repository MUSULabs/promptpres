"""S1: อัตราการพูด (Articulation rate)

อ่าน: transcript.json (คำพร้อมเวลา), vad.json (ช่วงเสียงพูด)
ค่าที่รายงาน: syllables_per_s (ใช้คิดระดับ), syllables, articulation_time_s, filler_words
วิธีคิด:
  1. ตัดคำเสียงเติมออก (หาบนข้อความที่ต่อชิ้นแล้ว ด้วย extract/fillers.text_fillers และ filler_tokens ของ S3)
  2. นับพยางค์: ภาษาไทยใช้ PyThaiNLP syllable_tokenize; คำอังกฤษตัวพิมพ์ใหญ่ล้วน (ตัวย่อ เช่น API)
     นับตัวละ 1 พยางค์; คำอังกฤษอื่นนับกลุ่มสระ (อย่างน้อย 1); ตัวเลขนับหลักละ 1 (ประมาณ)
  3. เวลาเปล่งเสียง = ผลรวมช่วงพูดจาก VAD (ไม่รวมช่วงหยุด) − เวลาของคำเสียงเติม
  4. syllables_per_s = พยางค์ / เวลาเปล่งเสียง — ขอบระดับแบบช่วง (เร็วไปหรือช้าไปลดระดับทั้งคู่)
  5. ชี้ช่วงที่เร็วที่สุดและช้าที่สุด (หน้าต่าง window_s วินาที) เป็น evidence
config: thresholds-v0.yaml criteria.S1 (levels, syllable_engine, window_s, window_min_voiced_ratio,
        unanalyzable.min_speech_s) และ criteria.S3 (filler_tokens, max_filler_s, merge_gap_s)
"""
from __future__ import annotations

import re

from pythainlp.tokenize import syllable_tokenize

from worker.criteria.base import Unanalyzable, safe_run
from worker.extract.fillers import joined_text, text_fillers

CODE = "S1"
THAI = re.compile(r"[฀-๿]+")
LATIN = re.compile(r"[A-Za-z]+")
DIGITS = re.compile(r"[0-9]")
VOWEL_GROUP = re.compile(r"[aeiouy]+", re.IGNORECASE)


def latin_syllables(word: str) -> int:
    if word.isupper() and len(word) > 1:          # acronym read letter by letter: API = 3
        return len(word)
    return max(1, len(VOWEL_GROUP.findall(word)))


def count_syllables(text: str, engine: str) -> int:
    thai = sum(len([s for s in syllable_tokenize(run, engine=engine, keep_whitespace=False) if s.strip()])
               for run in THAI.findall(text))
    latin = sum(latin_syllables(w) for w in LATIN.findall(text))
    return thai + latin + len(DIGITS.findall(text))


def join_words(words: list[dict]) -> str:
    """Whisper splits Thai into pieces: glue Thai to Thai directly, put a space elsewhere.

    Same gluing as S3 / C2 use (worker.extract.fillers.joined_text), kept in one place.
    """
    return joined_text(words)[0]


def overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def windows(words, segments, spec, engine) -> list[dict]:
    """Rate in each window_s window (half-window steps) that has enough voiced time."""
    if not segments:
        return []
    size = spec["window_s"]
    start, end = segments[0]["start_s"], segments[-1]["end_s"]
    out, t = [], start
    while t + size <= end + 1e-6:
        voiced = sum(overlap(t, t + size, s["start_s"], s["end_s"]) for s in segments)
        inside = [w for w in words if t <= (w["start_s"] + w["end_s"]) / 2 < t + size]
        if voiced >= size * spec["window_min_voiced_ratio"] and inside:
            rate = count_syllables(join_words(inside), engine) / voiced
            out.append({"start_s": round(t, 2), "end_s": round(t + size, 2), "rate": round(rate, 2)})
        t += size / 2
    return out


def compute(session, spec: dict, s3_spec: dict) -> dict:
    problem = session.audio_problem()
    if problem:
        raise Unanalyzable(problem)
    vad, transcript = session.vad or {}, session.transcript or {}
    span = vad.get("speech_span_s") or 0.0
    if span < spec["unanalyzable"]["min_speech_s"]:
        raise Unanalyzable(f"ช่วงพูดสั้นเกินไป ({span:.0f} วินาที) จึงคิดอัตราการพูดไม่ได้")
    words = transcript.get("words") or []
    if not words:
        raise Unanalyzable("ถอดข้อความจากเสียงไม่ได้")

    # fillers are found on the joined text (Whisper splits Thai into pieces) — extract/fillers.py
    events = text_fillers(words, s3_spec)
    in_filler = {i for e in events for i in e["words"]}
    spoken = [w for i, w in enumerate(words) if i not in in_filler]
    filler_s = sum(e["end_s"] - e["start_s"] for e in events)
    articulation = vad["articulation_time_s"] - filler_s
    if articulation <= 0:
        raise Unanalyzable("ไม่พบช่วงที่เปล่งเสียงพูด")

    engine = spec["syllable_engine"]
    syllables = count_syllables(join_words(spoken), engine)
    if syllables == 0:
        raise Unanalyzable("นับพยางค์จากข้อความที่ถอดได้ไม่ได้")
    rates = windows(spoken, vad["segments"], spec, engine)
    evidence = []
    if len(rates) >= 2:
        fast, slow = max(rates, key=lambda r: r["rate"]), min(rates, key=lambda r: r["rate"])
        evidence = [{"start_s": fast["start_s"], "end_s": fast["end_s"],
                     "note": f"ช่วงที่เร็วที่สุด {fast['rate']:.1f} พยางค์/วินาที"},
                    {"start_s": slow["start_s"], "end_s": slow["end_s"],
                     "note": f"ช่วงที่ช้าที่สุด {slow['rate']:.1f} พยางค์/วินาที"}]
    return {
        "values": {"syllables_per_s": round(syllables / articulation, 2), "syllables": syllables,
                   "articulation_time_s": round(articulation, 2),
                   "filler_words": len(events)},
        "evidence": evidence,
    }


def run(session, spec: dict, s3_spec: dict) -> dict:
    """Contract `criterion` dict for S1 (never raises)."""
    return safe_run(CODE, lambda: compute(session, spec, s3_spec), spec)
