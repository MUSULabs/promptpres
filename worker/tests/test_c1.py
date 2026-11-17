"""C1 topic order: Kendall's tau-b on clearly explained topics only (rubric v0.9)."""
import pytest

from worker.criteria import c1
from promptpres_shared.settings import load_thresholds
from worker.tests.helpers import checked, session, topic_list, word

TH = load_thresholds()["criteria"]


def run(labels, times=None, n=4):
    ses = session([(0.0, 60.0)], [word("การ", 0.0, 60.0)], topics=topic_list(n), coverage=checked(labels, times, n))
    return c1.run(ses, TH["C1"], TH["C2"])


ALL_CLEAR = {"H01": "clear", "H02": "clear", "H03": "clear", "H04": "clear"}


def test_tau_b_basics():
    assert c1.kendall_tau_b([1, 2, 3, 4], [1, 2, 3, 4]) == 1.0
    assert c1.kendall_tau_b([1, 2, 3, 4], [4, 3, 2, 1]) == -1.0
    assert c1.kendall_tau_b([1, 2, 3], [1, 1, 2]) == pytest.approx(2 / (3 * 2) ** 0.5)      # one tie


def test_plan_order_is_tau_1_level_4():
    out = run(ALL_CLEAR)
    assert out["values"]["kendall_tau"] == 1.0 and out["level"] == 4 and out["values"]["swapped_pairs"] == 0
    assert out["evidence"][0]["note"].startswith("ลำดับที่พูด 1: H01")


def test_s10_order_h03_h01_h04_h02_is_tau_0_level_2():
    out = run(ALL_CLEAR, {"H03": 5.0, "H01": 15.0, "H04": 25.0, "H02": 35.0})
    assert out["values"]["kendall_tau"] == 0.0 and out["level"] == 2 and out["values"]["swapped_pairs"] == 3
    assert [e["start_s"] for e in out["evidence"]] == [5.0, 15.0, 25.0, 35.0]
    assert "สลับกับแผน" in out["evidence"][0]["note"]


def test_rubric_example_one_swap_is_0_67_level_3():
    out = run(ALL_CLEAR, {"H01": 1.0, "H03": 2.0, "H02": 3.0, "H04": 4.0})
    assert out["values"]["kendall_tau"] == pytest.approx(0.667, abs=1e-3) and out["level"] == 3


def test_brief_topics_are_not_ordered():
    out = run(ALL_CLEAR | {"H02": "brief"}, n=4)
    assert out["status"] == "unanalyzable" and out["values"]["topics_ordered"] == 3


def test_three_clear_topics_show_tau_without_a_level():
    out = run({"H01": "clear", "H02": "clear", "H03": "clear"}, {"H01": 1.0, "H03": 2.0, "H02": 3.0})
    assert out["status"] == "unanalyzable" and out["level"] is None and out["feedback_id"] is None
    assert out["values"]["kendall_tau"] == pytest.approx(0.333, abs=1e-3) and len(out["evidence"]) == 3
    assert "τ = 0.33" in out["reason"] and "อย่างน้อย 4" in out["reason"]


def test_fewer_than_three_clear_topics_has_no_value():
    out = run({"H01": "clear", "H04": "clear"})
    assert out["status"] == "unanalyzable" and out["values"] == {} and "เพียง 2 หัวข้อ" in out["reason"]


def test_c2_unanalyzable_makes_c1_unanalyzable():
    ses = session([(0.0, 60.0)], [word("การ", 0.0, 60.0)], topics=[], coverage=None)
    out = c1.run(ses, TH["C1"], TH["C2"])
    assert out["status"] == "unanalyzable" and "ความครอบคลุม" in out["reason"]


def test_counted_labels_come_from_config():
    spec = TH["C1"] | {"counted_labels": ["clear", "brief"]}
    ses = session([(0.0, 60.0)], [word("การ", 0.0, 60.0)], topics=topic_list(4),
                  coverage=checked(ALL_CLEAR | {"H02": "brief"}))
    assert c1.run(ses, spec, TH["C2"])["values"]["topics_ordered"] == 4
