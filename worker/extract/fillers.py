"""Filled pauses (เอ่อ / อ่า / อืม / เอิ่ม / uh / um) -> fillers.json; used by S3 (count) and S1 (excluded).

ทางที่ 1 — จากข้อความ (text):
  Whisper ถอดภาษาไทยออกมาเป็นชิ้นละ 1-3 ตัวอักษร เช่น เอ่อ = 'เอ' + '่' + 'อ' จึงเทียบทีละชิ้นไม่ได้
  (สาเหตุที่เฟส 1 นับได้ 0) -> ต่อชิ้นทั้งหมดเป็นข้อความเดียว ตัดคำด้วย PyThaiNLP (newmm) แล้วเทียบ "ทั้งคำ"
  กับ filler_tokens: คำว่า อ่าน / คือ / แบบ / ก็ จึงไม่ถูกนับ และ เออ (= ใช่) ไม่อยู่ในรายการ
  เสียงลากซ้ำตัวท้าย (เอ่ออ, อืมม, umm) ถือเป็นคำเดียวกัน; เสียงเติมที่ห่างกันไม่ถึง merge_gap_s นับเป็นครั้งเดียว
  เวลาของคำ = เริ่มชิ้นแรกถึงจบชิ้นสุดท้าย แต่ไม่เกิน max_filler_s (เวลาของชิ้นจาก Whisper ยืดได้)

ทางที่ 2 — ช่วงเสียงที่ไม่มีคำ + ตัวกรองสัญญาณ (สำหรับเสียงเติมที่ Whisper ไม่ถอดออกมา):
  1. หา "ช่วงเสียงกำพร้า" (orphan): อยู่ในช่วงพูดของ VAD แต่ไม่มีคำใดใน transcript ทับเลย ยาว min_s-max_s
     (ช่วงเงียบระหว่างช่วงพูดไม่ถูกดูเลย -> การหยุดเงียบเฉย ๆ แบบฉาก S04 ไม่มีทางถูกนับเป็นเสียงเติม)
  2. ข้ามช่วงที่อยู่ห่างเสียงเติมจากทางที่ 1 ไม่ถึง text_margin_s (เป็นหางของคำที่นับไปแล้ว)
  3. กรองด้วยค่ามัธยฐานของเฟรม 25 ms: ดังพอเมื่อเทียบระดับพูดปกติของคลิป (min_rel_db),
     ZCR ต่ำ, spectral flatness ต่ำ, spectral centroid ต่ำ = เสียงสระ/นาสิกลากยาว ไม่ใช่เสียงหายใจ/ไอ/เสียงซ่า
  ผลทางนี้เป็น "ตัวเลือก" (acoustic_candidates) นับรวมในคะแนนเฉพาะเมื่อ config count_acoustic: true
  ผลทดลอง 14 พ.ย. (tools/explore_s3.py): ช่วงกำพร้าแบบเสียงสระพบพอ ๆ กันทุกฉาก (S01 S02 S03 S04 S05)
  เพราะส่วนใหญ่คือท้ายพยางค์ปกติที่เวลาคำของ Whisper ตัดก่อนจบ -> ยังไม่นับ (count_acoustic: false)
config: thresholds-v0.yaml criteria.S3 (filler_tokens, max_filler_s, merge_gap_s, acoustic.*)
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np

THAI = re.compile(r"[฀-๿]")
REPEAT_END = re.compile(r"(.)\1+$")


# --------------------------------------------------------------------------- path 1: text
def joined_text(words: list[dict]) -> tuple[str, list[int]]:
    """Glue Whisper pieces into one text (Thai to Thai directly, a space elsewhere).

    Returns the text and, for every character, the index of the piece it came from (-1 for added spaces).
    """
    text, owner = "", []
    for i, w in enumerate(words):
        piece = w["word"]
        if text and not (THAI.match(text[-1]) and THAI.match(piece[:1] or " ")):
            text += " "
            owner.append(-1)
        text += piece
        owner += [i] * len(piece)
    return text, owner


def normalise(token: str) -> str:
    """'เอ่ออ' -> 'เอ่อ', 'Umm' -> 'um': lower case, drop punctuation, collapse a repeated last letter."""
    t = token.strip(" .,!?…\"'").lower()
    return REPEAT_END.sub(r"\1", t)


def nonlexical_fillers(words: list[dict], spec: dict) -> list[dict]:
    """Filler events found in the transcript: [{start_s, end_s, text, words: [piece indices], source}]."""
    from pythainlp.tokenize import word_tokenize   # noqa: PLC0415 — heavy import

    if not words:
        return []
    tokens = {normalise(t) for t in spec["filler_tokens"]}
    text, owner = joined_text(words)
    events, pos = [], 0
    for tok in word_tokenize(text, engine="newmm", keep_whitespace=True):
        start, pos = pos, pos + len(tok)
        if not tok.strip() or normalise(tok) not in tokens:
            continue
        idx = sorted({o for o in owner[start:pos] if o >= 0})
        if not idx:
            continue
        t0 = words[idx[0]]["start_s"]
        t1 = min(words[idx[-1]]["end_s"], t0 + spec["max_filler_s"])
        events.append({"start_s": round(t0, 2), "end_s": round(max(t1, t0), 2), "text": tok.strip(),
                       "words": idx, "source": "text"})
    return merge(events, spec["merge_gap_s"])


def _context_tokens(words):
    """Token offsets map back to the original Whisper pieces."""
    from pythainlp.tokenize import word_tokenize

    text, owner = joined_text(words)
    tokens, pos = [], 0
    for token in word_tokenize(text, engine="newmm", keep_whitespace=True):
        start, pos = pos, pos + len(token)
        indices = sorted({i for i in owner[start:pos] if i >= 0})
        if token.strip() and indices:
            tokens.append({"text": token.strip(), "start": start, "end": pos, "indices": indices})
    return text, tokens


def contextual_fillers(words: list[dict], cfg: dict) -> list[dict]:
    """Longest token sequence first; lexical words need repetition or adjacent hesitation."""
    text, tokens = _context_tokens(words)
    # Protected compounds may be split by the tokenizer: block their complete character spans.
    protected = []
    for term in cfg["protected_words"]:
        protected.extend((m.start(), m.end()) for m in re.finditer(re.escape(term), text))
    phrases = sorted(cfg["phrases"], key=len, reverse=True)
    singles = set(cfg["hesitation_words"])
    sounds = set(cfg["adjacent_sounds"])
    gap = float(cfg["hesitation_gap_s"])
    events, i = [], 0
    while i < len(tokens):
        match = _match_phrase(tokens, i, phrases + sorted(singles, key=len, reverse=True))
        if not match:
            i += 1
            continue
        phrase, stop = match
        spans = tokens[i:stop]
        if _protected(spans, protected):
            i = stop
            continue
        # Do not glue a multiword phrase across a long ASR pause.
        indices = sorted({k for t in spans for k in t["indices"]})
        if any(words[b]["start_s"] - words[a]["end_s"] > gap for a, b in zip(indices, indices[1:])):
            i = stop
            continue
        if phrase in singles:
            stop, repeats = _repeat_span(tokens, stop, phrase, words, protected, gap)
            if repeats:
                spans = tokens[i:stop]
            elif not _adjacent_sound(tokens, i, stop, words, sounds, gap):
                i = stop
                continue
        indices = sorted({k for t in spans for k in t["indices"]})
        events.append({"start_s": round(words[indices[0]]["start_s"], 2),
                       "end_s": round(words[indices[-1]]["end_s"], 2),
                       "text": "".join(t["text"] for t in spans), "words": indices,
                       "source": "text", "kind": "contextual"})
        i = stop
    return events


def _protected(spans, protected) -> bool:
    return any(a < spans[-1]["end"] and b > spans[0]["start"] for a, b in protected)


def _repeat_span(tokens, stop, phrase, words, protected, gap):
    """Extend over immediate repeats of `phrase` ("คือ คือ"). A repeat must start within `gap` seconds
    of the previous one and must not be part of a protected compound ("แบบ แบบจำลอง")."""
    repeats = 0
    while True:
        repeated = _match_phrase(tokens, stop, [phrase])
        if not repeated:
            break
        nxt = tokens[stop:repeated[1]]
        pause = words[nxt[0]["indices"][0]]["start_s"] - words[tokens[stop - 1]["indices"][-1]]["end_s"]
        if _protected(nxt, protected) or pause > gap:
            break
        stop, repeats = repeated[1], repeats + 1
    return stop, repeats


def _match_phrase(tokens, start, phrases):
    for phrase in phrases:
        joined = ""
        for j in range(start, len(tokens)):
            joined += tokens[j]["text"]
            if joined == phrase:
                return phrase, j + 1
            if not phrase.startswith(joined):
                break
    return None


def _adjacent_sound(tokens, start, stop, words, sounds, gap):
    for neighbour, edge in ((start - 1, start), (stop, stop - 1)):
        if not 0 <= neighbour < len(tokens) or normalise(tokens[neighbour]["text"]) not in sounds:
            continue
        left, right = sorted((neighbour, edge))
        end = words[tokens[left]["indices"][-1]]["end_s"]
        begin = words[tokens[right]["indices"][0]]["start_s"]
        if max(0, begin - end) <= gap:
            return True
    return False


def text_fillers(words: list[dict], spec: dict, contextual: dict | None = None) -> list[dict]:
    events = [e | {"kind": "nonlexical"} for e in nonlexical_fillers(words, spec)]
    if contextual and words:
        events.extend(contextual_fillers(words, contextual))
    return sorted(events, key=lambda e: e["start_s"])


def merge(events: list[dict], gap: float) -> list[dict]:
    """One continuous filler = one event: join events less than `gap` seconds apart."""
    out = []
    for e in sorted(events, key=lambda e: e["start_s"]):
        if out and e["start_s"] - out[-1]["end_s"] < gap:
            out[-1]["end_s"] = max(out[-1]["end_s"], e["end_s"])
            out[-1]["text"] += " " + e["text"]
            out[-1]["words"] = out[-1].get("words", []) + e.get("words", [])
        else:
            out.append(dict(e))
    return out


# --------------------------------------------------------------------------- path 2: acoustic
def orphan_gaps(segments: list[dict], words: list[dict], min_s: float, max_s: float) -> list[tuple[float, float]]:
    """Stretches inside VAD speech that no transcript word covers, min_s..max_s seconds long.

    Silence between VAD segments is never looked at, so an ordinary pause (S2, scenario S04) cannot
    become a filler here.
    """
    spans = sorted((w["start_s"], w["end_s"]) for w in words)
    out = []
    for seg in segments:
        a, b = seg["start_s"], seg["end_s"]
        t = a                                         # first time in this segment not yet covered
        for ws, we in spans:
            if we <= t or ws >= b:
                continue
            if ws - t >= min_s:
                out.append((t, ws))
            t = max(t, we)
            if t >= b:
                break
        if b - t >= min_s:
            out.append((t, b))
    return [(round(s, 2), round(e, 2)) for s, e in out if e - s <= max_s]


def frame_features(x: np.ndarray, rate: int, frame_s: float = 0.025, hop_s: float = 0.010) -> np.ndarray:
    """Per 25-ms frame (10-ms steps): level dB, zero-crossing rate, spectral flatness, spectral centroid Hz.

    - level      = 20 log10(RMS)
    - ZCR        = share of neighbouring samples that change sign (vowels/nasals low, s/sh/breath high)
    - flatness   = geometric mean / arithmetic mean of the power spectrum (tone-like ~0, noise-like ~1)
    - centroid   = power-weighted mean frequency (vowels/nasals low, breath/cough/fricatives high)
    """
    n, hop = int(frame_s * rate), int(hop_s * rate)
    window, freqs = np.hanning(n), np.fft.rfftfreq(n, 1 / rate)
    rows = []
    for k in range(0, len(x) - n + 1, hop):
        f = x[k:k + n].astype(float)
        rms = np.sqrt(np.mean(f * f)) + 1e-12
        zcr = np.mean(np.signbit(f[1:]) != np.signbit(f[:-1]))
        power = np.abs(np.fft.rfft(f * window)) ** 2 + 1e-12
        flatness = np.exp(np.mean(np.log(power))) / np.mean(power)
        centroid = np.sum(freqs * power) / np.sum(power)
        rows.append((20 * np.log10(rms), zcr, flatness, centroid))
    return np.array(rows).reshape(-1, 4)


def speech_level_db(x: np.ndarray, rate: int, segments: list[dict]) -> float:
    """Median 25-ms frame level (dB) over all VAD speech — 'normal speaking loudness' of this clip."""
    n = int(0.025 * rate)
    levels = []
    for s in segments:
        part = x[int(s["start_s"] * rate):int(s["end_s"] * rate)].astype(float)
        frames = part[: len(part) // n * n].reshape(-1, n)
        levels.extend(20 * np.log10(np.sqrt(np.mean(frames * frames, axis=1)) + 1e-12))
    return float(np.median(levels)) if levels else -120.0


def acoustic_candidates(samples: np.ndarray, rate: int, segments: list[dict], words: list[dict],
                        text_events: list[dict], spec: dict) -> list[dict]:
    """Layer 2: orphan voiced gaps that sound like a held vowel / nasal (เอ่อ, อืม) -> candidates."""
    cfg = spec["acoustic"]
    ref = speech_level_db(samples, rate, segments)
    out = []
    for s, e in orphan_gaps(segments, words, cfg["min_s"], cfg["max_s"]):
        near_text = any(t["start_s"] - cfg["text_margin_s"] < e and s < t["end_s"] + cfg["text_margin_s"]
                        for t in text_events)
        if near_text:                                  # the tail of a filler layer 1 already counted
            continue
        feats = frame_features(samples[int(s * rate):int(e * rate)], rate)
        if len(feats) == 0:
            continue
        level, zcr, flat, cent = np.median(feats, axis=0)
        if (level - ref >= cfg["min_rel_db"] and zcr <= cfg["max_zcr"]
                and flat <= cfg["max_flatness"] and cent <= cfg["max_centroid_hz"]):
            out.append({"start_s": s, "end_s": e, "text": "", "source": "acoustic",
                        "rel_db": round(float(level - ref), 1), "zcr": round(float(zcr), 3),
                        "flatness": round(float(flat), 4), "centroid_hz": round(float(cent))})
    return out


# --------------------------------------------------------------------------- stage entry
def detect(wav: Path, transcript: dict | None, vad: dict | None, out_json: Path, spec: dict, contextual: dict | None = None) -> dict:
    """Write fillers.json: {"text": [...], "acoustic": [...], "count_acoustic": bool}."""
    from worker.prep import load_wav   # noqa: PLC0415

    words = (transcript or {}).get("words") or []
    text = text_fillers(words, spec, contextual)
    acoustic = []
    if wav and Path(wav).exists() and vad and vad.get("segments"):
        samples, rate = load_wav(wav)
        acoustic = acoustic_candidates(samples, rate, vad["segments"], words, text, spec)
    out = {"text": text, "acoustic": acoustic, "count_acoustic": bool(spec["acoustic"]["count_acoustic"])}
    Path(out_json).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return out
