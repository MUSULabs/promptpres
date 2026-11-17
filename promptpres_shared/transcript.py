"""Interactive transcript for the result page (D-046 layer 2): Whisper pieces -> short timed phrases.

Inputs are files the worker already wrote (nothing is re-analysed):
- transcript.json words: Whisper pieces, often single Thai characters, each with start_s / end_s
- fillers.json text events: the piece indices of each counted filler (S3), shown highlighted
- vad.json segments: speech spans; a gap >= S2 pause_min_s is a long pause (same rule as worker/criteria/s2.py)

A phrase may only end where a Thai word ends (PyThaiNLP newmm, the tokenizer S3 already uses), so a cut never
splits a word. It ends there when the next piece starts after a gap >= gap_s, the phrase is longer than max_s,
a long pause lies between, or a filler starts/ends (so a filler is its own item). Without PyThaiNLP the cut
falls back to "not before a Thai vowel/tone mark and not after a leading vowel".
Times are seconds from the video start.
"""
from __future__ import annotations

import re

THAI = re.compile(r"[฀-๿]")
# Thai marks that never start a word (vowels/tones written after a consonant) and leading vowels (before it).
FOLLOWING = set("ะัาำิีึืฺุูๅ็่้๊๋์ํ๎")
LEADING = set("เแโใไ")


def glue(pieces: list[str]) -> tuple[str, list[int]]:
    """Join pieces (Thai to Thai directly, a space elsewhere; as worker/extract/fillers.joined_text).

    Returns the text and, for every character, the position in `pieces` it came from (-1 for added spaces).
    """
    text, owner = "", []
    for n, piece in enumerate(pieces):
        if text and not (THAI.match(text[-1]) and THAI.match(piece[:1] or " ")):
            text += " "
            owner.append(-1)
        text += piece
        owner += [n] * len(piece)
    return text, owner


def word_starts(pieces: list[str]) -> set[int]:
    """Positions in `pieces` where a word begins (a phrase may only be cut before these)."""
    text, owner = glue(pieces)
    try:
        from pythainlp.tokenize import word_tokenize  # noqa: PLC0415 — heavy import, only when a transcript is opened
    except ImportError:
        return {n for n, piece in enumerate(pieces)
                if n == 0 or (piece[:1] not in FOLLOWING and pieces[n - 1][-1:] not in LEADING)}
    starts, offset = {0}, 0
    for token in word_tokenize(text, engine="newmm", keep_whitespace=True):
        if offset < len(owner) and owner[offset] >= 0:
            starts.add(owner[offset])
        offset += len(token)
    return starts


def long_pauses(segments: list[dict], pause_min_s: float) -> list[tuple[float, float]]:
    """Gaps between consecutive VAD speech segments that are at least pause_min_s long."""
    spans = sorted((float(s["start_s"]), float(s["end_s"])) for s in segments)
    return [(a_end, b_start) for (_, a_end), (b_start, _) in zip(spans, spans[1:]) if b_start - a_end >= pause_min_s]


def _filler_owner(fillers: dict | None) -> dict[int, int]:
    owner = {}
    for n, event in enumerate((fillers or {}).get("text") or []):
        for index in event.get("words") or []:
            owner[int(index)] = n
    return owner


def _groups(words, order, owner, starts, pauses, gap_s, max_s):
    """Runs of piece indices (time order) that form one phrase; cuts only at word starts."""
    groups, current = [], []
    for pos, i in enumerate(order):
        w = words[i]
        if current:
            prev, first = words[current[-1]], words[current[0]]
            filler_edge = owner.get(i) != owner.get(current[-1])
            wanted = (w["start_s"] - prev["end_s"] >= gap_s or w["end_s"] - first["start_s"] > max_s
                      or any(prev["start_s"] <= start < w["start_s"] for start, _ in pauses))
            if filler_edge or (wanted and pos in starts):
                groups.append(current)
                current = []
        current.append(i)
    if current:
        groups.append(current)
    return groups


def build_transcript(words: list[dict], fillers: dict | None, vad_segments: list[dict], pause_min_s: float,
                     gap_s: float, max_s: float) -> list[dict]:
    """-> [{start_s, end_s, text, is_filler, pause_after_s}] in time order."""
    words = words or []
    order = sorted((i for i, w in enumerate(words) if str(w.get("word", "")).strip()),
                   key=lambda i: words[i]["start_s"])
    owner = _filler_owner(fillers)              # indices refer to transcript.json words, as fillers.json does
    starts = word_starts([words[i]["word"] for i in order])
    pauses = long_pauses(vad_segments or [], pause_min_s)
    items = []
    for group in _groups(words, order, owner, starts, pauses, gap_s, max_s):
        text = re.sub(r"\s+", " ", glue([words[i]["word"] for i in group])[0]).strip()
        if text:
            items.append({"start_s": round(float(words[group[0]]["start_s"]), 2),
                          "end_s": round(float(words[group[-1]]["end_s"]), 2), "text": text,
                          "is_filler": owner.get(group[0]) is not None, "pause_after_s": None})
    for start, end in pauses:                   # the pause belongs to the last phrase that began before it
        before = [item for item in items if item["start_s"] <= start]
        if before:
            last = before[-1]
            last["pause_after_s"] = round(max(end - start, last["pause_after_s"] or 0), 1)
    return items
