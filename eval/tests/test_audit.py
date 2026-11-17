"""Regression tests from the full-system audit (Nov 2026): no-variation cases, table formatting,
time bins at the clip end, CSV encodings from Excel on Windows."""
import math
import warnings

import numpy as np
import pandas as pd
import pytest

from eval import ioc, stats, tables


def test_ioc_rejects_duplicate_expert_and_item(tmp_path):
    path = tmp_path / "ratings.csv"
    item = next(row for row in ioc.load_items() if row["item_id"] == "C1-1")
    path.write_text(f"expert,item,score\nE1,C1-1,-1\nE1,{item['form_no']},1\n", encoding="utf-8")
    with pytest.raises(ValueError, match="แถว 3.*E1.*C1-1"):
        ioc.read_scores(path, ioc.load_items())


def test_alpha_with_no_raters_is_undefined():
    assert math.isnan(stats.krippendorff_alpha([]))


def test_no_variation_is_undefined_not_perfect():
    """Everyone gives the same level: κ, QWK and α are 0/0 -> NaN ('—'), never 1.0, and no crash."""
    same = [3, 3, 3, 3]
    assert math.isnan(stats.cohen_kappa(same, same, [1, 2, 3, 4]))
    assert math.isnan(stats.weighted_kappa(same, same, [1, 2, 3, 4]))
    assert math.isnan(stats.krippendorff_alpha([same, same, same], "ordinal"))
    assert math.isnan(stats.krippendorff_alpha([[2], [2]], "ordinal"))          # one unit, equal ratings
    assert stats.cohen_kappa([0, 0, 0, 0], [0, 0, 1, 1], [0, 1]) == 0.0           # one side varies: defined


def test_constant_or_near_constant_input_gives_nan_correlation_without_warnings():
    with warnings.catch_warnings():
        warnings.simplefilter("error")                       # a scipy ConstantInput warning would fail here
        e = stats.continuous_errors([5, 5, 5, 5], [1, 2, 3, 4])
        assert math.isnan(e["pearson_r"]) and e["mae"] == 2.5
        assert math.isnan(stats.continuous_errors([1, 1 + 1e-15, 1], [1, 2, 3])["pearson_r"])
        assert math.isnan(stats.spearman([2, 2, 2], [1, 2, 3]))


def test_mean_ci_with_zero_sd_is_a_point():
    assert stats.mean_ci([70, 70, 70]) == (70.0, 70.0)


def test_time_bins_keep_an_event_at_the_very_end():
    b = stats.time_bins([(4.0, 4.3)], 4.0, 0.5)              # starts exactly at the clip end
    assert b.tolist()[-1] == 1 and b.sum() == 1


def test_fmt_handles_numpy_and_infinity():
    assert tables.fmt(float("inf")) == "—" and tables.fmt(float("-inf")) == "—"
    assert tables.fmt(np.float32("nan")) == "—" and tables.fmt(np.float64("nan")) == "—"
    assert tables.fmt(np.int64(7)) == "7" and tables.fmt(np.float32(0.5)) == "0.50"
    assert tables.fmt(None) == "—"


def test_read_table_handles_excel_bom_and_thai_ansi(tmp_path):
    df = pd.DataFrame({"ผู้ประเมิน": ["ก", "ข"], "C1-1": ["+1", "0"]})
    bom = tmp_path / "bom.csv"
    bom.write_bytes(df.to_csv(index=False).encode("utf-8-sig"))
    ansi = tmp_path / "ansi.csv"
    ansi.write_bytes(df.to_csv(index=False).encode("cp874"))
    for path in (bom, ansi):
        got = tables.read_table(path)
        assert list(got.columns) == ["ผู้ประเมิน", "C1-1"] and got.iloc[0, 0] == "ก"
