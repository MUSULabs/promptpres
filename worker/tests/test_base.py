"""Level mapper and safe_run, checked against the worked examples in rubric v0.9."""
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from worker.criteria.base import Unanalyzable, level_from_bands, safe_run
from promptpres_shared.settings import load_thresholds

TH = load_thresholds()["criteria"]
REPO = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((REPO / "contracts" / "result.schema.json").read_text(encoding="utf-8"))


def criterion_validator():
    """Validator for one `criterion` object, resolving refs inside the full schema."""
    sub = {"$schema": SCHEMA["$schema"], "$defs": SCHEMA["$defs"], "$ref": "#/$defs/criterion"}
    return Draft202012Validator(sub)


# --- rubric v0.9 examples -------------------------------------------------------------

def test_t1_lower_inclusive():
    assert level_from_bands({"deviation_pct": 5.0}, TH["T1"]) == 4          # "ไม่เกิน 5%"
    assert level_from_bands({"deviation_pct": 45 / 900 * 100}, TH["T1"]) == 4  # 855 s vs 900 s
    assert level_from_bands({"deviation_pct": 5.01}, TH["T1"]) == 3
    assert level_from_bands({"deviation_pct": 15.0}, TH["T1"]) == 2
    assert level_from_bands({"deviation_pct": 20.0}, TH["T1"]) == 1


def test_s2_takes_lowest_of_two_values():
    # 12 long pauses in 15 min (0.8/min -> L4) but the longest is 6 s (-> L2) => L2
    assert level_from_bands({"long_pauses_per_min": 0.8, "max_pause_s": 6.0}, TH["S2"]) == 2


def test_n1_example():
    # 9 still spans in 15 min (0.6/min) and longest 18 s -> both L3
    assert level_from_bands({"long_still_per_min": 0.6, "max_still_s": 18.0}, TH["N1"]) == 3


def test_c1_and_c2_higher():
    assert level_from_bands({"kendall_tau": 0.67}, TH["C1"]) == 3
    assert level_from_bands({"kendall_tau": -0.2}, TH["C1"]) == 1
    assert level_from_bands({"coverage_clear_pct": 87.5}, TH["C2"]) == 3
    assert level_from_bands({"coverage_clear_pct": 90.0}, TH["C2"]) == 4


def test_n2_example():
    assert level_from_bands({"front_pct": 70.0}, TH["N2"]) == 3     # 630 / 900 s


@pytest.mark.parametrize("rate, level", [
    (5.0, 4), (4.0, 4), (6.0, 4),          # middle band
    (3.7, 3), (6.3, 3),                    # slightly slow / fast
    (3.2, 2), (6.8, 2),                    # clearly slow / fast
    (2.5, 1), (7.5, 1),                    # extreme
])
def test_s1_two_sided_range(rate, level):
    assert level_from_bands({"syllables_per_s": rate}, TH["S1"]) == level


def test_supporting_values_never_change_level():
    a = level_from_bands({"long_still_per_min": 0.6, "max_still_s": 18.0, "hands_active_pct": 1.0}, TH["N1"])
    b = level_from_bands({"long_still_per_min": 0.6, "max_still_s": 18.0, "hands_active_pct": 99.0}, TH["N1"])
    assert a == b == 3


def test_missing_scored_value_is_unanalyzable():
    with pytest.raises(Unanalyzable):
        level_from_bands({"long_pauses_per_min": 0.5}, TH["S2"])


# --- safe_run -> always a valid contract criterion ------------------------------------

def test_safe_run_ok():
    out = safe_run("T1", lambda: {"values": {"deviation_pct": 7.0}, "evidence": []}, TH["T1"])
    assert out["status"] == "ok" and out["level"] == 3 and out["feedback_id"] == "T1_L3"
    assert out["skill"] == "time"
    criterion_validator().validate(out)


def test_safe_run_unanalyzable_reason():
    def bad():
        raise Unanalyzable("เห็นมือน้อยกว่า 70% ของเวลา")
    out = safe_run("N1", bad, TH["N1"])
    assert out["status"] == "unanalyzable" and out["level"] is None
    assert out["reason"] == "เห็นมือน้อยกว่า 70% ของเวลา"
    criterion_validator().validate(out)


def test_safe_run_crash_is_not_level_1():
    out = safe_run("S3", lambda: 1 / 0, TH["S3"])
    assert out["status"] == "unanalyzable" and out["level"] is None and out["feedback_id"] is None
    assert out["reason"]
    criterion_validator().validate(out)


# --- audit: NaN / infinity never become a level, evidence stays inside the clip -------------

@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_non_finite_scored_value_is_unanalyzable_never_level_1(bad):
    card = safe_run("S2", lambda: {"values": {"long_pauses_per_min": bad, "max_pause_s": 2.0}, "evidence": []},
                    TH["S2"])
    assert card["status"] == "unanalyzable" and card["level"] is None
    assert card["values"]["long_pauses_per_min"] is None and "ตัวเลข" in card["reason"]
    json.dumps(card, allow_nan=False)                    # no bare NaN in result.json


def test_non_finite_supporting_value_becomes_null():
    card = safe_run("T1", lambda: {"values": {"deviation_pct": 3.0, "speech_span_s": float("nan")}, "evidence": []},
                    TH["T1"])
    assert card["status"] == "ok" and card["level"] == 4 and card["values"]["speech_span_s"] is None


def test_missing_scored_value_reason_is_thai():
    with pytest.raises(Unanalyzable, match="ไม่มีค่าที่ใช้คิดระดับ"):
        level_from_bands({}, TH["T1"])


def test_clamp_evidence_keeps_spans_inside_the_clip():
    from worker.criteria.base import clamp_evidence
    ev = [{"start_s": 60.4, "end_s": 62.0, "note": "N2 last second"},
          {"start_s": -0.2, "end_s": 1.0, "note": None},
          {"start_s": 5.0, "end_s": 4.0, "note": "reversed"},
          {"start_s": float("nan"), "end_s": 3.0, "note": "dropped"},
          {"start_s": 10.0, "end_s": None, "note": "dropped"}]
    out = clamp_evidence(ev, 61.25)
    assert [(e["start_s"], e["end_s"]) for e in out] == [(60.4, 61.25), (0.0, 1.0), (5.0, 5.0)]
    assert all(0 <= e["start_s"] <= e["end_s"] <= 61.25 for e in out)
    assert clamp_evidence([{"start_s": 70.0, "end_s": 75.0, "note": None}], None)[0]["end_s"] == 75.0
