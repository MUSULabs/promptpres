"""The four command-line tools on the synthetic files in eval/examples (and small temp files)."""
import json
from pathlib import Path

import pandas as pd
import pytest

from eval import agreement_and_sus, calibrate, ioc, measurement_eval
from eval.tables import load_results, parse_number, scenario_of

EX = Path(__file__).resolve().parents[1] / "examples"
RUNS = str(EX / "runs")


def _md(paths):
    return Path(paths[0]).read_text(encoding="utf-8")


# ----------------------------------------------------------------------------- shared parsing
def test_parse_number_variants():
    assert parse_number("+1 (สอดคล้อง)") == 1
    assert parse_number("−1 (ไม่สอดคล้อง)") == -1          # unicode minus from Google Forms options
    assert parse_number("5 - เห็นด้วยอย่างยิ่ง") == 5
    assert parse_number("0") == 0
    assert parse_number("") is None and parse_number("วิเคราะห์ไม่ได้") is None


def test_scenario_of():
    assert scenario_of("sc02_G07_P05_S05_T01") == "S05"
    assert scenario_of("smoke_G01_P02_S04") == "S04"
    assert scenario_of("s_8befcae961") == "web"
    assert scenario_of("demo_A") == "other"


# ----------------------------------------------------------------------------- IOC
def test_ioc_wide_example(tmp_path):
    out = ioc.main([str(EX / "ioc_answers_wide.csv"), "--out", str(tmp_path)])
    items = pd.read_csv(tmp_path / "ioc_items.csv", encoding="utf-8-sig")
    by_id = items.set_index("item_id")
    assert by_id.loc["C1-2", "ioc"] == pytest.approx(0.20) and by_id.loc["C1-2", "result"] == "ต้องปรับปรุง"
    assert by_id.loc["S1-2", "ioc"] == pytest.approx(0.40) and not by_id.loc["S1-2", "pass_alt"]
    assert by_id.loc["N1-2", "ioc"] == pytest.approx(0.60) and by_id.loc["N1-2", "result"] == "ผ่าน"
    md = _md(out)
    assert "ผ่าน 14 จาก 16 ข้อ" in md and "ขอบระดับ 0.80 สูงไป" in md
    assert "ตัวอย่าง 1" not in md                              # expert names never reach the tables


def test_ioc_long_equals_wide(tmp_path):
    wide = pd.read_csv(EX / "ioc_answers_wide.csv", encoding="utf-8-sig", dtype=str)
    rows = []
    for k, r in wide.iterrows():
        for col in wide.columns:
            if col[:2] in ("C1", "C2", "S1", "S2", "S3", "N1", "N2", "T1") and col[2] == "-":
                rows.append({"expert": f"คนที่ {k + 1}", "item": col.split()[0], "score": r[col]})
    long_csv = tmp_path / "long.csv"
    pd.DataFrame(rows).to_csv(long_csv, index=False, encoding="utf-8-sig")
    ioc.main([str(long_csv), "--out", str(tmp_path / "l")])
    ioc.main([str(EX / "ioc_answers_wide.csv"), "--out", str(tmp_path / "w")])
    a = pd.read_csv(tmp_path / "l" / "ioc_items.csv", encoding="utf-8-sig")
    b = pd.read_csv(tmp_path / "w" / "ioc_items.csv", encoding="utf-8-sig")
    assert a["ioc"].tolist() == b["ioc"].tolist()
    assert "คนที่ 1" not in _md([tmp_path / "l" / "ioc.md"])


def test_ioc_missing_score_raises(tmp_path):
    f = tmp_path / "m.csv"
    f.write_text("expert,item,score\nE1,C1-1,+1\nE2,C1-1,\n", encoding="utf-8")
    with pytest.raises(ValueError, match="ไม่มีคะแนน"):
        ioc.main([str(f), "--out", str(tmp_path / "o")])
    ioc.main([str(f), "--out", str(tmp_path / "o"), "--allow-missing"])   # 15 items have no score at all: n = 0


# ----------------------------------------------------------------------------- calibrate
def _fake_run(root: Path, sid: str, values: dict, level=3, status="ok"):
    crits = [{"code": code, "status": status, "level": level if status == "ok" else None, "values": v, "evidence": []}
             for code, v in values.items()]
    (root / sid).mkdir(parents=True)
    (root / sid / "result.json").write_text(json.dumps({"session_id": sid, "criteria": crits, "topics": [],
                                                        "versions": {"config": "thresholds-v0 + pipeline-v0"}}),
                                            encoding="utf-8")


def test_calibrate_stats_and_checks(tmp_path):
    runs = tmp_path / "runs"
    for k, v in enumerate([4.0, 4.5, 5.0]):
        _fake_run(runs, f"sc02_G01_P0{k}_S01_T01", {"S1": {"syllables_per_s": v}, "N2": {"front_pct": 80.0 + k}})
    _fake_run(runs, "sc02_G01_P01_S02_T01", {"S1": {"syllables_per_s": 6.0}})
    (runs / "notes.json").write_text("{}", encoding="utf-8")            # stray files are skipped
    (runs / "empty_dir").mkdir()
    out = calibrate.main(["--runs", str(runs), "--out", str(tmp_path / "o")])
    st = pd.read_csv(tmp_path / "o" / "calibrate_stats.csv", encoding="utf-8-sig")
    s01 = st[(st.criterion == "S1") & (st.value == "syllables_per_s") & (st.scenario == "S01")].iloc[0]
    assert s01["n"] == 3 and s01["median"] == pytest.approx(4.5) and s01["min"] == 4.0
    checks = pd.read_csv(tmp_path / "o" / "calibrate_checks.csv", encoding="utf-8-sig")
    assert checks[checks.scenario == "S02"].iloc[0]["result"] == "✓"   # faster than S01
    assert "n < 10" in _md(out)
    assert (tmp_path / "o" / "thresholds-v1-suggested.yaml").is_file()


def test_suggest_follows_direction():
    recs = [{"code": c, "scenario": "S01", "status": "ok", "level": 3, "values": {k: float(v)}}
            for v in range(1, 11) for c, k in [("N2", "front_pct"), ("S3", "fillers_per_min"), ("S1", "syllables_per_s")]]
    th = {"criteria": {"N2": {"direction": "higher", "scored_values": ["front_pct"], "levels": {4: {}, 3: {}, 2: {}}},
                       "S3": {"direction": "lower", "scored_values": ["fillers_per_min"], "levels": {4: {}, 3: {}, 2: {}}},
                       "S1": {"direction": "range", "scored_values": ["syllables_per_s"], "levels": {4: {}, 3: {}, 2: {}}}}}
    q = {"higher": {4: 75, 3: 50, 2: 25}, "lower": {4: 25, 3: 50, 2: 75}, "range": {4: [25, 75], 3: [10, 90], 2: [5, 95]}}
    rows = {r["criterion"]: r for r in calibrate.suggest(recs, th, ["S01"], q, min_n=10)}
    assert rows["N2"]["L4"] == pytest.approx(7.75) and rows["N2"]["L2"] == pytest.approx(3.25)   # higher: L4 > L2
    assert rows["S3"]["L4"] == pytest.approx(3.25) and rows["S3"]["L2"] == pytest.approx(7.75)   # lower: L4 < L2
    assert rows["S1"]["L4"] == [3.25, 7.75] and rows["S1"]["L2"] == [1.45, 9.55]                  # range widens
    assert rows["N2"]["warning"] == ""                                                         # n = 10
    few = calibrate.suggest(recs[:9], th, ["S01"], q, min_n=10)
    assert all(r["warning"] for r in few)


# ----------------------------------------------------------------------------- measurement
def test_measurement_examples(tmp_path):
    out = measurement_eval.main(["--values", str(EX / "gt_values.csv"), "--events", str(EX / "gt_events.csv"),
                                 "--topics", str(EX / "gt_topics.csv"), "--runs", RUNS, "--out", str(tmp_path)])
    ev = pd.read_csv(tmp_path / "measurement_events.csv", encoding="utf-8-sig").set_index("criterion")
    # fillers: demo_A misses 55.0 (FN); demo_B 16.2 is extra (FP) and misses 58.0 (FN)
    assert (ev.loc["S3", "tp"], ev.loc["S3", "fp"], ev.loc["S3", "fn"]) == (7, 1, 2)
    assert ev.loc["S2", "f1"] == 1.0 and ev.loc["N1", "f1"] == 1.0
    vals = pd.read_csv(tmp_path / "measurement_values.csv", encoding="utf-8-sig")
    t1 = vals[vals.value == "speech_span_s"].iloc[0]
    assert t1["mae"] == pytest.approx((1.0 + 0.5 + 1.5) / 3)
    top = pd.read_csv(tmp_path / "measurement_topics.csv", encoding="utf-8-sig").set_index("label")
    assert top.loc["ALL", "accuracy"] == pytest.approx(9 / 12)
    assert "ตารางความสับสน" in _md(out)


def test_measurement_skips_unanalyzable(tmp_path):
    runs = tmp_path / "runs"
    _fake_run(runs, "clip1", {"S3": {"fillers": 2}}, status="unanalyzable")
    gt = tmp_path / "gt.csv"
    gt.write_text("clip_id,rater,S3.fillers\nclip1,x,3\nmissing_clip,x,1\n", encoding="utf-8")
    out = measurement_eval.main(["--values", str(gt), "--runs", str(runs), "--out", str(tmp_path / "o")])
    md = _md(out)
    assert "วิเคราะห์ไม่ได้" in md and "missing_clip" in md


# ----------------------------------------------------------------------------- agreement and SUS
def test_levels_example(tmp_path):
    out = agreement_and_sus.main(["levels", str(EX / "ratings_wide.csv"), "--runs", RUNS, "--out", str(tmp_path)])
    ag = pd.read_csv(tmp_path / "levels_agreement.csv", encoding="utf-8-sig").set_index("criterion")
    assert ag.loc["C1", "alpha_raters"] == pytest.approx(1.0)          # all three raters identical on C1
    assert ag.loc["C1", "exact_pct"] == 100.0 and ag.loc["C1", "qwk_consensus"] == pytest.approx(1.0)
    assert ag.loc["รวมทุกเกณฑ์", "units"] == 24
    md = _md(out)
    assert "อาจารย์ ก" not in md


def test_levels_long_with_system_column(tmp_path):
    f = tmp_path / "r.csv"
    rows = ["clip_id,criterion,rater,level"]
    for clip, lv in [("a", 4), ("b", 2), ("c", 3)]:
        for rater in ("R1", "R2", "R3", "System"):
            rows.append(f"{clip},S2,{rater},{lv}")
    rows.append("d,S2,R1,3")
    rows.append("d,S2,System,วิเคราะห์ไม่ได้")
    f.write_text("\n".join(rows) + "\n", encoding="utf-8")
    agreement_and_sus.main(["levels", str(f), "--out", str(tmp_path / "o")])
    ag = pd.read_csv(tmp_path / "o" / "levels_agreement.csv", encoding="utf-8-sig").set_index("criterion")
    assert ag.loc["S2", "system_missing"] == 1 and ag.loc["S2", "system_n"] == 3
    assert ag.loc["S2", "exact_pct"] == 100.0


def test_sus_example(tmp_path):
    out = agreement_and_sus.main(["sus", str(EX / "sus_answers.csv"), "--out", str(tmp_path)])
    people = pd.read_csv(tmp_path / "sus_people.csv", encoding="utf-8-sig")
    assert people["sus"].tolist() == [85.0, 50.0, 100.0, 70.0]
    summary = pd.read_csv(tmp_path / "sus_summary.csv", encoding="utf-8-sig").iloc[0]
    assert summary["mean"] == pytest.approx(76.25) and summary["excluded"] == 1
    assert summary["ci95_high"] == 100.0 and 0.0 <= summary["ci95_low"] < 76.25   # raw t interval would end at ~110
    md = _md(out)
    assert "R5" in md and "example.com" not in md


def test_sus_items_option(tmp_path):
    f = tmp_path / "s.csv"
    f.write_text("name," + ",".join(f"a{k}" for k in range(10)) + "\nx," + ",".join(["3"] * 10) + "\n", encoding="utf-8")
    agreement_and_sus.main(["sus", str(f), "--items", *[f"a{k}" for k in range(10)], "--out", str(tmp_path / "o")])
    assert pd.read_csv(tmp_path / "o" / "sus_people.csv", encoding="utf-8-sig")["sus"].tolist() == [50.0]


def test_example_runs_load():
    assert set(load_results([RUNS])) == {"demo_A", "demo_B", "demo_C"}


# ----------------------------------------------------------------------------- templates and the rater clip list (D-051)
TEMPLATES = EX.parent / "templates"
REPO = EX.parents[1]


def test_templates_match_rubric_v09_and_can_be_read(tmp_path):
    items = pd.read_csv(TEMPLATES / "ioc_items.csv", encoding="utf-8-sig")
    assert len(items) == 16 and items["criterion"].value_counts().eq(2).all()
    names = dict(zip(items["criterion"], items["criterion_name"]))
    assert names["S3"].startswith("เสียงเติมและคำติดปาก") and names["N1"].startswith("การใช้ท่าทางมือประกอบการพูด")
    assert names["N2"].startswith("การหันหน้าสื่อสารกับผู้ฟัง")
    values = pd.read_csv(TEMPLATES / "gt_values.csv", encoding="utf-8-sig")
    assert all(measurement_eval.VALUE_COL.match(c) for c in values.columns if "." in c) and "S3.fillers" in values.columns
    # a filled SUS sheet with the template's header is scored (the EXAMPLE row is not a real answer format issue)
    sus = (TEMPLATES / "sus_responses.csv").read_text(encoding="utf-8-sig").splitlines()[0]
    f = tmp_path / "sus.csv"
    f.write_text(sus + "\nP1,5,1,5,1,5,1,5,1,5,1\n", encoding="utf-8")
    agreement_and_sus.main(["sus", str(f), "--out", str(tmp_path / "o")])
    assert pd.read_csv(tmp_path / "o" / "sus_people.csv", encoding="utf-8-sig")["sus"].tolist() == [100.0]
    ratings = pd.read_csv(TEMPLATES / "ratings.csv", encoding="utf-8-sig")
    assert list(ratings.columns) == ["clip_id", "criterion", "rater", "level"]


def test_rater_clip_list_is_5_to_10_short_clips_from_different_presenters():
    import yaml
    doc = yaml.safe_load((REPO / "config" / "eval_clips_sc02.yaml").read_text(encoding="utf-8"))
    clips = doc["clips"]
    assert doc["rubric"] == "v0.9" and 5 <= len(clips) <= 10
    assert all(60 <= c["duration_s"] <= 180 for c in clips)                       # about 1-3 minutes each
    assert len({c["participant"] for c in clips}) == len(clips)
    assert {"S01", "S04", "S05", "S08", "S09", "S10"} <= {c["scenario"] for c in clips}
    ids = (TEMPLATES / "eval_clip_ids.txt").read_text(encoding="utf-8").split()
    assert ids == [f"sc02_{c['clip_id']}" for c in clips]
    dev = yaml.safe_load((REPO / "config" / "dev_clips_sc02.yaml").read_text(encoding="utf-8"))
    dev_ids = {e["clip_id"] for e in dev["primary_baseline"]} | {e["clip_id"] for v in dev["criterion_test_cases"].values() for e in v}
    assert all(c["in_dev_set"] == (c["clip_id"] in dev_ids) for c in clips)       # overlap with development is declared
