"""Filler detection (text + acoustic) and S3 (no ASR model; synthetic audio)."""
import numpy as np
import pytest

from worker.criteria import s3
from promptpres_shared.settings import load_thresholds
from worker.extract import fillers
from worker.tests.helpers import session, tone, word, write_wav

S3 = load_thresholds()["criteria"]["S3"]


def pieces(text_times):
    return [word(t, a, b) for t, a, b in text_times]


# ------------------------------------------------------------------------------------- text path
def test_filler_split_into_pieces_is_one_event():
    w = pieces([("ในส่วนของ", 0.0, 1.0), ("เอ", 1.0, 1.2), ("่", 1.2, 1.3), ("อ", 1.3, 1.5), ("จะมี", 1.6, 2.0)])
    ev = fillers.text_fillers(w, S3)
    assert len(ev) == 1 and ev[0]["text"] == "เอ่อ" and ev[0]["words"] == [1, 2, 3]
    assert (ev[0]["start_s"], ev[0]["end_s"]) == (1.0, 1.5)


@pytest.mark.parametrize("text", ["ผมจะอ่านข้อความ", "เออใช่ครับ", "คือแบบว่าก็ทำได้"])
def test_meaningful_words_are_not_fillers(text):
    w = pieces([(text[i:i + 2], i * 0.1, i * 0.1 + 0.1) for i in range(0, len(text), 2)])
    assert fillers.text_fillers(w, S3) == []


def test_drawn_out_and_latin_fillers():
    w = pieces([("ระบบ", 0, 1), ("เอ่ออ", 2, 2.5), ("งาน", 3, 4), (" Umm", 5, 5.4), (" model", 6, 7)])
    ev = fillers.text_fillers(w, S3)
    assert len(ev) == 2 and ev[0]["text"].startswith("เอ่อ") and ev[1]["text"] == "Umm"


def test_fillers_close_together_are_one_event():
    w = pieces([("งาน", 0, 1), ("เอ่อ", 1.0, 1.3), ("อืม", 1.4, 1.7), ("ระบบ", 2, 2.5), ("อืม", 3.0, 3.4)])
    ev = fillers.text_fillers(w, S3)
    assert len(ev) == 2 and ev[0]["end_s"] == 1.7


def test_filler_length_is_capped():
    w = pieces([("งาน", 0, 1), ("เอ", 1.0, 1.1), ("่อ", 1.1, 4.0)])          # piece time stretched by Whisper
    assert fillers.text_fillers(w, S3)[0]["end_s"] == 1.0 + S3["max_filler_s"]


# ------------------------------------------------------------------------------------- acoustic path
def test_orphan_gaps_are_voiced_time_without_words():
    segs = [{"start_s": 0.0, "end_s": 3.0}, {"start_s": 5.0, "end_s": 6.0}]       # 3-5 s = silent pause
    w = pieces([("งาน", 0.0, 1.0), ("ระบบ", 1.6, 2.9), ("ข้อมูล", 5.0, 6.0)])
    assert fillers.orphan_gaps(segs, w, 0.2, 1.8) == [(1.0, 1.6)]                # the pause is never a gap
    assert fillers.orphan_gaps(segs, w, 0.7, 1.8) == []                            # shorter than min_s


def layer2_clip(gap_sound):
    """2 s of speech-level tone with words over 0-0.7 s and 1.3-2.0 s; `gap_sound` fills 0.7-1.3 s."""
    rate = 16000
    audio = tone(2.0, amp=0.3, hz=180)
    audio[int(0.7 * rate):int(1.3 * rate)] = gap_sound[: int(0.6 * rate)]
    segs = [{"start_s": 0.0, "end_s": 2.0}]
    w = pieces([("งาน", 0.0, 0.7), ("ระบบ", 1.3, 2.0)])
    return audio, rate, segs, w


def test_held_vowel_in_a_word_gap_is_a_candidate():
    audio, rate, segs, w = layer2_clip(tone(0.6, amp=0.3, hz=140))
    found = fillers.acoustic_candidates(audio, rate, segs, w, [], S3)
    assert len(found) == 1 and (found[0]["start_s"], found[0]["end_s"]) == (0.7, 1.3)
    assert found[0]["zcr"] <= S3["acoustic"]["max_zcr"] and found[0]["centroid_hz"] <= 800


@pytest.mark.parametrize("kind", ["noise", "quiet"])
def test_breath_noise_or_faint_sound_is_not_a_candidate(kind):
    rng = np.random.default_rng(0)
    sound = 0.3 * rng.standard_normal(9600) if kind == "noise" else tone(0.6, amp=0.005, hz=140)
    audio, rate, segs, w = layer2_clip(sound.astype(np.float32))
    assert fillers.acoustic_candidates(audio, rate, segs, w, [], S3) == []


def test_gap_next_to_a_text_filler_is_its_tail():
    audio, rate, segs, w = layer2_clip(tone(0.6, amp=0.3, hz=140))
    text = [{"start_s": 0.4, "end_s": 0.7, "text": "เอ่อ", "source": "text"}]
    assert fillers.acoustic_candidates(audio, rate, segs, w, text, S3) == []

def test_detect_writes_fillers_json(tmp_path):
    wav = write_wav(tmp_path / "a.wav", np.zeros(16000, np.float32))
    out = fillers.detect(wav, {"words": pieces([("เอ่อ", 0.1, 0.4)])}, {"segments": []}, tmp_path / "f.json", S3)
    assert len(out["text"]) == 1 and out["acoustic"] == [] and (tmp_path / "f.json").exists()


# ------------------------------------------------------------------------------------- S3
def test_s3_rate_per_minute_and_evidence():
    w = pieces([("งาน", 1, 2), ("เอ่อ", 5, 5.4), ("ระบบ", 6, 7), ("อืม", 20, 20.5), ("ข้อมูล", 21, 22),
                ("อ่า", 40, 40.3), ("จบ", 59, 60)])
    out = s3.run(session([(0.0, 60.0)], w), S3)
    assert out["values"]["fillers"] == 3 and out["values"]["fillers_per_min"] == pytest.approx(3.0)
    assert out["level"] == 4 and out["evidence"][1] == {"start_s": 20, 'end_s': 20.5, 'label': 'เสียงเติม "อืม"', "note": "เสียงเติม 'อืม'"}


def test_s3_acoustic_candidates_count_only_when_switched_on():
    found = {"text": [], "acoustic": [{"start_s": 3.0, "end_s": 3.4, "text": "", "source": "acoustic"}]}
    ses = session([(0.0, 60.0)], pieces([("งาน", 1, 2)]), fillers=found)
    out = s3.run(ses, S3)
    assert out["values"]["fillers"] == 0 and out["values"]["acoustic_candidates"] == 1
    on = S3 | {"acoustic": S3["acoustic"] | {"count_acoustic": True}}
    assert s3.run(ses, on)["values"]["fillers"] == 1


def test_s3_unanalyzable_cases():
    assert s3.run(session([(0.0, 10.0)], pieces([("งาน", 1, 2)])), S3)["status"] == "unanalyzable"
    assert s3.run(session([(0.0, 60.0)], []), S3)["reason"] == "ถอดข้อความจากเสียงไม่ได้"
    out = s3.run(session([(0.0, 60.0)], [], flags={"no_audio": "ไฟล์ไม่มีเสียง"}), S3)
    assert out["reason"] == "ไฟล์ไม่มีเสียง"

# D-050 context-sensitive lexical fillers: keep the nonlexical path used by S1 independent.
@pytest.mark.parametrize("phrase", ["แบบว่า", "ก็แบบ", "ก็แบบว่า", "คือแบบ", "คือแบบว่า", "แบบคือ", "อะไรอย่างนี้", "อะไรแบบนี้", "คือ คือ", "แบบ แบบ", "ก็คือ ก็คือ"])
def test_contextual_phrase_is_one_event(phrase):
    from promptpres_shared.settings import pipeline_config
    w = pieces([(phrase, 1, 1.8)])
    found = fillers.text_fillers(w, S3, pipeline_config()["fillers"])
    assert len(found) == 1 and found[0]["kind"] == "contextual"
    assert fillers.text_fillers(w, S3) == []  # S1's historical exclusion set


@pytest.mark.parametrize("phrase", ["การออกแบบระบบ", "แบบประเมิน", "แบบจำลอง", "กล่าวคือ", "คือ", "แบบ", "ก็คือ"])
def test_ordinary_context_does_not_count(phrase):
    from promptpres_shared.settings import pipeline_config
    assert fillers.text_fillers(pieces([(phrase, 1, 2)]), S3, pipeline_config()["fillers"]) == []


@pytest.mark.parametrize("gap, expected", [(0.49, 2), (0.5, 2), (0.51, 1)])
def test_adjacent_sound_boundary(gap, expected):
    from promptpres_shared.settings import pipeline_config
    w = pieces([("เอ่อ", 1, 1.5), ("แบบ", 1.5 + gap, 2.5 + gap)])
    found = fillers.text_fillers(w, S3, pipeline_config()["fillers"])
    assert len(found) == expected


@pytest.mark.parametrize("phrase", ["การออกแบบระบบ", "แบบประเมิน", "แบบจำลอง", "กล่าวคือ"])
def test_protected_words_next_to_filler_stay_lexical(phrase):
    from promptpres_shared.settings import pipeline_config
    found = fillers.text_fillers(pieces([("เอ่อ", 0, .3), (phrase, .4, 1)]), S3, pipeline_config()["fillers"])
    assert len(found) == 1 and found[0]["kind"] == "nonlexical"


def ctx():
    from promptpres_shared.settings import pipeline_config
    return pipeline_config()["fillers"]


def test_repeat_needs_to_be_immediate():
    # "คือ ... (5 s) ... คือ" is two ordinary words, not one hesitation repeat.
    assert fillers.text_fillers(pieces([("คือ", 1, 1.2), ("คือ", 6.2, 6.4)]), S3, ctx()) == []
    assert len(fillers.text_fillers(pieces([("คือ", 1, 1.2), ("คือ", 1.7, 1.9)]), S3, ctx())) == 1
    assert fillers.text_fillers(pieces([("คือ", 1, 1.2), ("คือ", 1.71, 1.9)]), S3, ctx()) == []


@pytest.mark.parametrize("second", ["แบบจำลอง", "แบบประเมิน"])
def test_repeat_does_not_swallow_a_protected_compound(second):
    assert fillers.text_fillers(pieces([("แบบ", 1, 1.3), (second, 1.4, 2.2)]), S3, ctx()) == []
    assert fillers.text_fillers(pieces([("แบบ", 1, 1.3), ("แบบ", 1.4, 1.6), ("จำลอง", 1.6, 2.2)]), S3, ctx()) == []


@pytest.mark.parametrize("sound", [" um", " uh"])
def test_latin_filler_sound_gives_hesitation_context(sound):
    found = fillers.text_fillers(pieces([(sound, 1, 1.3), ("แบบ", 1.4, 1.8), ("ระบบ", 3, 4)]), S3, ctx())
    assert [e["kind"] for e in found] == ["nonlexical", "contextual"]


def test_s3_labels_filler_sound_and_verbal_tic_separately():
    w = pieces([("งาน", 1, 2), ("เอ่อ", 5, 5.4), ("ระบบ", 6, 7), ("แบบว่า", 20, 20.6), ("จบ", 59, 60)])
    out = s3.run(session([(0.0, 60.0)], w), S3)
    assert [e["label"] for e in out["evidence"]] == ['เสียงเติม "เอ่อ"', 'คำติดปาก "แบบว่า"']
    assert out["evidence"][1]["note"] == "คำติดปาก 'แบบว่า'" and out["values"]["fillers"] == 2


S1_BEFORE = {"syllables_per_s": 0.15, "syllables": 9, "articulation_time_s": 59.7, "filler_words": 1}
S1_WORDS = [("ผม", 0, .2), ("คือ คือ แบบว่า", .3, 2), ("เอ่อ", 3, 3.3), ("ทดสอบระบบ", 4, 59)]


def test_s1_values_are_the_ones_from_before_the_contextual_rules():
    """Pinned from the pre-D-050 code (commit bb748bf) on the same words: S1 removes only filler sounds."""
    from worker.criteria import s1
    out = s1.run(session([(0, 60)], pieces(S1_WORDS)), load_thresholds()["criteria"]["S1"], S3)
    assert out["status"] == "ok" and out["values"] == S1_BEFORE
    assert len(fillers.text_fillers(pieces(S1_WORDS), S3, ctx())) == 3      # S3 sees the verbal tics too
