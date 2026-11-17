"""Every statistic in eval/stats.py against values worked out by hand or published."""
import math

import numpy as np
import pytest

from eval import stats


def test_ioc_values_and_pass_rule():
    assert stats.ioc([1, 1, 1, 0, -1]) == pytest.approx(0.40)      # below 0.60 and below 0.50
    assert stats.ioc([1, 1, 1, 0, 0]) == pytest.approx(0.60)       # exactly 3 of 5 -> passes 0.60
    assert stats.ioc([1, 1, 1, 1, 1]) == 1.0
    assert stats.ioc([-1] * 5) == -1.0
    assert math.isnan(stats.ioc([]))


def test_describe_on_1_to_10():
    d = stats.describe(range(1, 11))
    assert d["n"] == 10 and d["min"] == 1 and d["max"] == 10
    assert d["median"] == pytest.approx(5.5)
    assert d["mean"] == pytest.approx(5.5)
    assert d["p25"] == pytest.approx(3.25)          # numpy linear: 1 + 0.25 * 9
    assert d["p90"] == pytest.approx(9.1)
    assert d["sd"] == pytest.approx(np.std(range(1, 11), ddof=1))
    assert stats.describe([None, float("nan")])["n"] == 0


def test_continuous_errors_hand_example():
    e = stats.continuous_errors([2, 4, 6, 9], [1, 4, 8, 0])
    # errors 1, 0, -2, 9 -> MAE 3, RMSE sqrt(86/4), bias 2; MAPE over h != 0: (1/1 + 0 + 2/8) / 3
    assert e["n"] == 4
    assert e["mae"] == pytest.approx(3.0)
    assert e["rmse"] == pytest.approx(math.sqrt(86 / 4))
    assert e["bias"] == pytest.approx(2.0)
    assert e["n_mape"] == 3
    assert e["mape"] == pytest.approx((1 + 0 + 0.25) / 3 * 100)


def test_identical_values_correlate_perfectly_and_missing_pairs_dropped():
    e = stats.continuous_errors([1, 2, 3, None], [1, 2, 3, 7])
    assert e["n"] == 3 and e["mae"] == 0
    assert e["pearson_r"] == pytest.approx(1.0) and e["spearman_rho"] == pytest.approx(1.0)
    assert math.isnan(stats.continuous_errors([1, 2], [1, 2])["pearson_r"])   # fewer than 3 pairs


def test_prf():
    r = stats.prf(8, 2, 4)
    assert r["precision"] == pytest.approx(0.8)
    assert r["recall"] == pytest.approx(8 / 12)
    assert r["f1"] == pytest.approx(2 * 0.8 * (8 / 12) / (0.8 + 8 / 12))
    assert stats.prf(0, 3, 2)["f1"] == 0.0
    assert math.isnan(stats.prf(0, 0, 0)["f1"])


def test_match_events_exact_and_tolerance():
    assert stats.match_events([1.0, 5.0], [1.0, 5.0], 0.5)[:3] == (2, 0, 0)
    tp, fp, fn, _ = stats.match_events([1.0], [1.6], 0.5)       # just outside tolerance
    assert (tp, fp, fn) == (0, 1, 1)
    tp, fp, fn, pairs = stats.match_events([1.0], [1.5], 0.5)   # on the edge counts
    assert (tp, fp, fn) == (1, 0, 0)


def test_match_events_one_to_one_takes_closest():
    tp, fp, fn, pairs = stats.match_events([9.8, 10.1], [10.0], 0.5)
    assert (tp, fp, fn) == (1, 1, 0)
    assert pairs[0][0] == 1                                      # 10.1 is closer than 9.8


def test_time_bins():
    b = stats.time_bins([(1.0, 2.0)], 4.0, 0.5)                  # bins [1,1.5) [1.5,2)
    assert b.tolist() == [0, 0, 1, 1, 0, 0, 0, 0]
    assert stats.time_bins([(1.2, 1.2)], 2.0, 0.5).tolist() == [0, 0, 1, 0]   # zero-length event
    same = stats.time_bins([(0.3, 0.9), (2.0, 3.1)], 4.0, 0.5)
    assert stats.cohen_kappa(same.tolist(), same.tolist(), [0, 1]) == 1.0


def test_cohen_kappa_hand_2x2():
    # [[20, 5], [10, 15]]: po = 0.70, pe = (25*30 + 25*20) / 2500 = 0.50 -> kappa 0.40
    a = [1] * 25 + [0] * 25
    b = [1] * 20 + [0] * 5 + [1] * 10 + [0] * 15
    assert stats.cohen_kappa(a, b, [1, 0]) == pytest.approx(0.40)
    assert stats.cohen_kappa([1, 2, 3, 2], [1, 2, 3, 2], [1, 2, 3]) == 1.0


def test_qwk_perfect_hand_and_disagreement():
    assert stats.weighted_kappa([1, 2, 3, 4], [1, 2, 3, 4], [1, 2, 3, 4]) == pytest.approx(1.0)
    # one pair off by 1 on a 4-level scale: sum(w*O) = 1/9, sum(w*E) = 12/9 -> 1 - 1/12
    assert stats.weighted_kappa([1, 2, 3, 4], [1, 2, 4, 4], [1, 2, 3, 4]) == pytest.approx(1 - 1 / 12)
    assert stats.weighted_kappa([1, 1, 4, 4], [4, 4, 1, 1], [1, 2, 3, 4]) < 0


def test_exact_adjacent():
    r = stats.exact_adjacent([1, 2, 3, 4, None], [1, 3, 1, 4, 2])
    assert r["n"] == 4
    assert r["exact_pct"] == pytest.approx(50.0)
    assert r["adjacent_pct"] == pytest.approx(75.0)


# Krippendorff (2011) "Computing Krippendorff's alpha-reliability", 4 observers x 12 units, missing data
KRIPP = [
    [1, 2, 3, 3, 2, 1, 4, 1, 2, None, None, None],
    [1, 2, 3, 3, 2, 2, 4, 1, 2, 5, None, 3],
    [None, 3, 3, 3, 2, 3, 4, 2, 2, 5, 1, None],
    [1, 2, 3, 3, 2, 4, 4, 1, 2, 5, 1, None],
]


def test_krippendorff_published_example():
    assert stats.krippendorff_alpha(KRIPP, "nominal") == pytest.approx(0.743, abs=0.001)
    assert stats.krippendorff_alpha(KRIPP, "ordinal") == pytest.approx(0.815, abs=0.001)
    assert stats.krippendorff_alpha(KRIPP, "interval") == pytest.approx(0.849, abs=0.001)


def test_krippendorff_perfect():
    assert stats.krippendorff_alpha([[1, 2, 3, 4], [1, 2, 3, 4], [1, 2, 3, 4]], "ordinal") == pytest.approx(1.0)


def test_classification_report_c2():
    labels = ["not_mentioned", "brief", "clear"]
    truth = ["clear", "clear", "brief", "not_mentioned", "brief", "clear"]
    pred = ["clear", "clear", "clear", "not_mentioned", "brief", "brief"]
    r = stats.classification_report(truth, pred, labels)
    assert r["confusion"] == [[1, 0, 0], [0, 1, 1], [0, 1, 2]]
    assert r["accuracy"] == pytest.approx(4 / 6)
    assert r["per_label"]["clear"]["precision"] == pytest.approx(2 / 3)
    assert r["per_label"]["clear"]["recall"] == pytest.approx(2 / 3)
    assert r["macro_f1"] == pytest.approx((1.0 + 0.5 + 2 / 3) / 3)
    perfect = stats.classification_report(truth, truth, labels)
    assert perfect["kappa"] == 1.0 and perfect["qwk"] == pytest.approx(1.0)


def test_median_level_rounds_half_up():
    assert stats.median_level([2, 3, 4]) == 3
    assert stats.median_level([2, 3]) == 3
    assert stats.median_level([3, None, 4]) == 4
    assert math.isnan(stats.median_level([None]))


def test_sus_scoring():
    assert stats.sus_score([3] * 10) == 50.0
    assert stats.sus_score([5, 1] * 5) == 100.0
    assert stats.sus_score([1, 5] * 5) == 0.0
    # odd: 4,5,4,5,4 -> 3+4+3+4+3 = 17; even: 2,1,2,1,2 -> 3+4+3+4+3 = 17; (17+17)*2.5
    assert stats.sus_score([4, 2, 5, 1, 4, 2, 5, 1, 4, 2]) == 85.0
    with pytest.raises(ValueError):
        stats.sus_score([3] * 9)
    with pytest.raises(ValueError):
        stats.sus_score([3] * 9 + [6])


def test_band_and_ci():
    bands = [{"min": 70, "label": "ok"}, {"min": 50, "label": "marginal"}, {"min": 0, "label": "no"}]
    assert stats.band(85, bands) == "ok"
    assert stats.band(70, bands) == "ok"
    assert stats.band(69.9, bands) == "marginal"
    assert stats.band(10, bands) == "no"
    lo, hi = stats.mean_ci([60, 70, 80])
    assert lo < 70 < hi and hi - 70 == pytest.approx(70 - lo)


def test_mean_ci_clipped_to_scale():
    raw_lo, raw_hi = stats.mean_ci([90, 100, 100])
    assert raw_hi > 100                                      # small n: the t interval runs past the scale
    lo, hi = stats.mean_ci([90, 100, 100], bounds=(0, 100))
    assert hi == 100 and lo == pytest.approx(raw_lo)
    lo, hi = stats.mean_ci([0, 0, 10], bounds=(0, 100))
    assert lo == 0
    assert all(math.isnan(v) for v in stats.mean_ci([80], bounds=(0, 100)))   # n < 2 stays NaN
