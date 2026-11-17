"""N1 (hand-still spans) and N2 (head direction) from synthetic landmark tables (no models)."""
import math

import pytest

from worker.criteria import n1, n2
from promptpres_shared.settings import load_thresholds
from worker.tests.helpers import lm_table, session

TH = load_thresholds()["criteria"]


def moving(t):
    """Both wrists swing 100 px left-right once per second (peak speed ~3 shoulder widths/s)."""
    dx = 100 * math.sin(2 * math.pi * t)
    return (dx, 0), (-dx, 0)


# ------------------------------------------------------------------------------------- N1
def test_n1_continuous_motion_has_no_still_span():
    out = n1.run(session(landmarks=lm_table(60, hands=moving)), TH["N1"])
    assert out["status"] == "ok"
    assert out["values"]["long_still_spans"] == 0 and out["values"]["max_still_s"] < TH["N1"]["long_still_s"]
    assert out["values"]["hands_active_pct"] > 80 and out["level"] == 4


def test_n1_finds_one_12_second_still_span():
    hands = lambda t: moving(t) if t < 5 or t >= 17 else ((0, 0), (0, 0))   # noqa: E731
    out = n1.run(session(landmarks=lm_table(30, hands=hands)), TH["N1"])
    assert out["values"]["long_still_spans"] == 1
    assert out["values"]["max_still_s"] == pytest.approx(12, abs=1.0)
    assert out["values"]["long_still_per_min"] == pytest.approx(2.0)          # 1 span in 0.5 min
    ev = out["evidence"][0]
    assert ev["start_s"] == pytest.approx(5, abs=0.6) and "มือนิ่งต่อเนื่อง" in ev["note"]


def test_n1_hidden_hands_are_unanalyzable_not_still():
    out = n1.run(session(landmarks=lm_table(60, hands=lambda t: (None, None))), TH["N1"])
    assert out["status"] == "unanalyzable" and out["level"] is None
    assert "ไม่นับว่านิ่ง" in out["reason"]


def test_n1_a_hidden_second_breaks_the_still_span():
    hands = lambda t: (None, None) if 14 <= t < 15 else ((0, 0), (0, 0))      # noqa: E731
    out = n1.run(session(landmarks=lm_table(30, hands=hands)), TH["N1"])
    assert out["status"] == "ok" and out["values"]["hands_visible_pct"] == pytest.approx(96.7, abs=0.1)
    assert out["values"]["long_still_spans"] == 2                             # 0-14 s and 15-30 s, never 30 s
    assert out["values"]["max_still_s"] < 16


def test_n1_one_hand_hidden_is_never_still():
    hands = lambda t: ((0, 0), None) if t < 20 else moving(t)                 # noqa: E731
    out = n1.run(session(landmarks=lm_table(80, hands=hands)), TH["N1"])
    assert out["status"] == "ok" and out["values"]["long_still_spans"] == 0


def test_n1_looks_only_inside_the_speech_window():
    hands = lambda t: ((0, 0), (0, 0)) if t < 20 else moving(t)               # noqa: E731
    lm = lm_table(60, hands=hands)
    assert n1.run(session(landmarks=lm), TH["N1"])["values"]["long_still_spans"] == 1     # no audio: whole clip
    out = n1.run(session([(20.0, 60.0)], landmarks=lm), TH["N1"])                        # speech 20-60 s
    assert out["values"]["long_still_spans"] == 0


def test_n1_no_landmarks():
    assert n1.run(session(), TH["N1"])["reason"] == "ไม่มีข้อมูลจุดสำคัญของร่างกายจากวิดีโอ"


# ------------------------------------------------------------------------------------- N2
@pytest.mark.parametrize("yaw,pitch,label", [(40, -20, "down"), (30, 0, "side"), (-30, 0, "side"),
                                             (0, 20, "up_other"), (10, -10, "front")])
def test_n2_classify_order(yaw, pitch, label):
    assert n2.classify(yaw, pitch, TH["N2"]) == label


def test_n2_front_pct_and_down_evidence():
    head = lambda t: (0.0, -25.0) if 20 <= t < 35 else (0.0, 0.0)             # noqa: E731
    out = n2.run(session(landmarks=lm_table(60, head=head)), TH["N2"])
    v = out["values"]
    assert (v["front_pct"], v["down_pct"], v["face_visible_pct"]) == (75.0, 25.0, 100.0)
    assert out["level"] == 3                                                  # 75 >= 65
    assert out["evidence"] == [{"start_s": 20.0, "end_s": 35.0, "note": "ก้มต่อเนื่อง 15 วินาที"}]


def test_n2_second_uses_the_median_angle():
    head = lambda t: (0.0, -30.0) if round(t * 10) % 10 < 4 else (0.0, 0.0)   # 4 of 10 frames down
    out = n2.run(session(landmarks=lm_table(30, head=head)), TH["N2"])
    assert out["values"]["front_pct"] == 100.0


def test_n2_unseen_face_is_not_front():
    face = lambda t: t >= 20                                                  # noqa: E731
    out = n2.run(session(landmarks=lm_table(60, face=face)), TH["N2"])
    assert out["status"] == "unanalyzable" and "เห็นใบหน้าเพียง 67%" in out["reason"]
    face = lambda t: not (10 <= t < 25)                                       # noqa: E731
    out = n2.run(session(landmarks=lm_table(60, face=face)), TH["N2"])
    assert out["values"]["face_visible_pct"] == 75.0 and out["values"]["front_pct"] == 100.0


def test_n2_second_with_few_face_frames_is_not_counted():
    face = lambda t: round(t * 10) % 10 < 3                                   # 3 of 10 frames each second
    out = n2.run(session(landmarks=lm_table(30, face=face)), TH["N2"])
    assert out["status"] == "unanalyzable"


def test_n2_speech_window():
    head = lambda t: (0.0, -25.0) if t < 10 else (0.0, 0.0)                   # noqa: E731
    out = n2.run(session([(10.0, 60.0)], landmarks=lm_table(60, head=head)), TH["N2"])
    assert out["values"]["front_pct"] == 100.0 and out["values"]["analysed_s"] == 50.0


def test_n2_classify_rejects_nan_angles():
    """NaN fails every comparison and would otherwise count as 'front'."""
    import math
    from worker.criteria import n2
    from promptpres_shared.settings import load_thresholds
    spec = load_thresholds()["criteria"]["N2"]
    with pytest.raises(ValueError):
        n2.classify(math.nan, 0.0, spec)
    assert n2.classify(0.0, 0.0, spec) == "front"
