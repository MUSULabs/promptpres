"""T1, S2, S1 from hand-made VAD / transcript data (no models)."""
import pytest

from worker.criteria import s1, s2, t1
from worker.criteria.base import Unanalyzable
from promptpres_shared.settings import load_thresholds
from worker.tests.helpers import session, word

TH = load_thresholds()["criteria"]
S3 = TH["S3"]


# ------------------------------------------------------------------------------------- T1
def test_t1_span_vs_target():
    # speech from 5 s to 860 s = 855 s against 900 s -> 5% short -> level 4
    out = t1.run(session([(5.0, 400.0), (410.0, 860.0)], target=900), TH["T1"])
    assert out["status"] == "ok" and out["level"] == 4
    assert out["values"]["deviation_pct"] == pytest.approx(5.0)
    assert out["values"]["diff_s"] == pytest.approx(-45.0)
    assert [e["start_s"] for e in out["evidence"]] == [5.0, 860.0]


def test_t1_uses_default_target_when_empty():
    out = t1.run(session([(0.0, 990.0)]), TH["T1"])        # 990 vs default 900 -> 10% -> level 3
    assert out["values"]["target_s"] == TH["T1"]["default_target_s"] and out["level"] == 3


def test_t1_no_speech_or_bad_audio_is_unanalyzable():
    assert t1.run(session([]), TH["T1"])["status"] == "unanalyzable"
    out = t1.run(session([(0, 60)], flags={"no_audio": "ไฟล์ไม่มีเสียง"}), TH["T1"])
    assert out["status"] == "unanalyzable" and out["reason"] == "ไฟล์ไม่มีเสียง" and out["level"] is None


# ------------------------------------------------------------------------------------- S2
def test_s2_counts_only_gaps_of_at_least_pause_min():
    # span 0..60 s; gaps: 1.9 s (not long), 2.0 s (long, boundary inclusive), 4.5 s (long)
    segs = [(0.0, 10.0), (11.9, 20.0), (22.0, 30.0), (34.5, 60.0)]
    out = s2.run(session(segs), TH["S2"])
    assert out["values"]["long_pauses"] == 2
    assert out["values"]["long_pauses_per_min"] == pytest.approx(2.0)
    assert out["values"]["max_pause_s"] == pytest.approx(4.5)
    assert out["level"] == 3                     # 2/min -> L3, 4.5 s -> L3
    assert len(out["evidence"]) == 2 and out["evidence"][1]["start_s"] == 30.0


def test_s2_silence_before_and_after_is_not_a_pause():
    out = s2.run(session([(10.0, 50.0)]), TH["S2"])      # one segment: nothing between segments
    assert out["values"]["long_pauses"] == 0 and out["values"]["max_pause_s"] == 0 and out["level"] == 4


def test_s2_short_span_is_unanalyzable():
    out = s2.run(session([(0.0, 10.0)]), TH["S2"])
    assert out["status"] == "unanalyzable" and "สั้นเกินไป" in out["reason"]


# ------------------------------------------------------------------------------------- S1
def test_syllable_counting():
    eng = TH["S1"]["syllable_engine"]
    assert s1.count_syllables("ระบบตรวจจับการหกล้ม", eng) == 7       # ระ-บบ ตรวจ จับ การ หก ล้ม
    assert s1.count_syllables("API", eng) == 3                       # acronym read letter by letter
    assert s1.count_syllables("model", eng) == 2
    assert s1.join_words([word("ระบบ", 0, 1), word("ตรวจ", 1, 2), word("API", 2, 3)]) == "ระบบตรวจ API"


def test_s1_rate_excludes_fillers_and_pauses():
    # 40 s of voice in two segments (pause in between is not counted); filler "เอ่อ" lasts 1 s
    segs = [(0.0, 20.0), (25.0, 45.0)]
    words = [word("ระบบตรวจจับการหกล้ม", 1.0, 19.0), word("เอ่อ", 26.0, 27.0), word("API", 30.0, 44.0)]
    out = s1.run(session(segs, words), TH["S1"], S3)
    assert out["values"]["syllables"] == 10                          # 7 Thai + 3 for API, filler not counted
    assert out["values"]["articulation_time_s"] == pytest.approx(39.0)
    assert out["values"]["filler_words"] == 1
    assert out["values"]["syllables_per_s"] == pytest.approx(10 / 39, abs=0.01)
    assert out["level"] == 1                                         # far below the dummy range


def test_s1_excludes_a_filler_whisper_split_into_pieces():
    # Whisper writes เอ่อ as 'เอ' '่' 'อ' — the old per-piece check never matched (fillers were always 0)
    segs = [(0.0, 40.0)]
    words = [word("ระบบตรวจจับ", 0.0, 10.0), word("เอ", 10.0, 10.2), word("่", 10.2, 10.3), word("อ", 10.3, 10.5),
             word("การหกล้ม", 11.0, 39.0)]
    out = s1.run(session(segs, words), TH["S1"], S3)
    assert out["values"]["filler_words"] == 1
    assert out["values"]["syllables"] == 7                           # ระ-บบ ตรวจ จับ การ หก ล้ม, no เอ่อ
    assert out["values"]["articulation_time_s"] == pytest.approx(39.5)


def test_s1_two_sided_level_comes_from_range():
    segs = [(0.0, 40.0)]
    # 200 syllables in 40 s = 5 per second -> inside the L4 range
    words = [word("การ" * 200, 0.0, 40.0)]
    out = s1.run(session(segs, words), TH["S1"], S3)
    assert out["values"]["syllables_per_s"] == pytest.approx(5.0) and out["level"] == 4


def test_s1_unanalyzable_cases():
    assert s1.run(session([(0, 40)], words=[]), TH["S1"], S3)["reason"] == "ถอดข้อความจากเสียงไม่ได้"
    assert s1.run(session([(0, 10)], [word("การ", 0, 1)]), TH["S1"], S3)["status"] == "unanalyzable"
    with pytest.raises(Unanalyzable):
        s1.compute(session([(0, 40)], [word("เอ่อ", 0, 40)]), TH["S1"], S3)


def test_s1_points_out_fastest_and_slowest_window():
    segs = [(0.0, 60.0)]
    # one word per second: 6 syllables/s, then 2 syllables/s from 20 to 40 s, then 6 again
    words = [word("การ" * (2 if 20 <= t < 40 else 6), t, t + 1.0) for t in range(60)]
    out = s1.run(session(segs, words), TH["S1"], S3)
    notes = [e["note"] for e in out["evidence"]]
    assert len(notes) == 2 and "เร็วที่สุด" in notes[0] and "ช้าที่สุด" in notes[1]
    assert out["evidence"][1]["start_s"] == 20.0
