"""config/ sanity: every threshold filled, bands consistent, feedback ids and wording rules."""
import re
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]
CODES = ["C1", "C2", "S1", "S2", "S3", "N1", "N2", "T1"]
TH = yaml.safe_load((REPO / "config" / "thresholds-v0.yaml").read_text(encoding="utf-8"))["criteria"]
FB = yaml.safe_load((REPO / "config" / "feedback-v0.yaml").read_text(encoding="utf-8"))["feedback"]
# PROJECT_SCOPE: never claim eye contact, confidence, emotion, or pass/fail grades
BANNED_WORDS = ["สบตา", "มั่นใจ", "อารมณ์", "เกรด"]
# "ผ่าน" is an ordinary word ("ที่ผ่านมา", "ผ่านๆ", "ผ่านการ...") — only flag it when it is a verdict.
PASS_FAIL = re.compile(
    r"ไม่ผ่าน"                       # fail
    r"|สอบผ่าน"                      # passed an exam
    r"|ผ่าน\s*/\s*ไม่ผ่าน"           # pass/fail
    r"|ผ่านเกณฑ์(?!ขั้นต่ำ)"          # "meets the criterion" (but "ผ่านเกณฑ์ขั้นต่ำ" is allowed)
    r"|ผล\s*:?\s*ผ่าน"               # "result: pass"
    r"|(?:^|[\s(\"'“])ผ่าน(?=$|[\s.!)\"'”])"  # "ผ่าน" standing alone as a word
)


def judgement_words(text: str) -> list[str]:
    """Banned words / pass-fail verdicts found in one feedback text."""
    found = [w for w in BANNED_WORDS if w in text]
    found += [m.group(0).strip() for m in PASS_FAIL.finditer(text)]
    return found


def walk(node):
    """Yield every leaf value in a nested dict/list."""
    if isinstance(node, dict):
        for v in node.values():
            yield from walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk(v)
    else:
        yield node


def test_eight_criteria_no_null_left():
    assert sorted(TH) == sorted(CODES)
    for code, spec in TH.items():
        assert None not in list(walk(spec)), f"{code} still has null"


def test_band_keys_are_scored_values():
    for code, spec in TH.items():
        assert spec["direction"] in ("higher", "lower", "range"), code
        assert sorted(spec["levels"]) == [2, 3, 4], code
        for level, band in spec["levels"].items():
            assert sorted(band) == sorted(spec["scored_values"]), f"{code} L{level}"
    assert "hands_active_pct" not in TH["N1"]["scored_values"]


def test_bands_are_monotonic():
    """Level 4 must be the strictest band, then 3, then 2."""
    for code, spec in TH.items():
        lv = spec["levels"]
        for key in spec["scored_values"]:
            b4, b3, b2 = lv[4][key], lv[3][key], lv[2][key]
            if spec["direction"] == "higher":
                assert b4 > b3 > b2, f"{code}.{key}"
            elif spec["direction"] == "lower":
                assert b4 < b3 < b2, f"{code}.{key}"
            else:  # range: each lower band contains the band above it
                assert b2[0] < b3[0] < b4[0] < b4[1] < b3[1] < b2[1], f"{code}.{key}"


def test_feedback_ids_complete():
    expected = {f"{c}_L{lvl}" for c in CODES for lvl in range(1, 5)}
    assert expected <= set(FB)
    assert len(expected) == 32


def test_feedback_wording_rules():
    for fid, text in FB.items():
        assert not judgement_words(text), f"{fid} uses {judgement_words(text)}"


def test_feedback_texts_are_final_and_readable():
    """D-046: no draft placeholders; each text says what happened and what to change (2 sentences max)."""
    for fid, text in FB.items():
        assert "[ร่าง" not in text and "รูบริก v1.0" not in text, fid
        assert 40 <= len(text) <= 220, (fid, len(text))
    assert not any("การสบตา" in t or "มองผู้ฟัง" in t for t in FB.values())      # N2 = head direction only


def test_interpretation_covers_every_level_and_follows_wording_rules():
    interpret = yaml.safe_load((REPO / "config" / "feedback-v0.yaml").read_text(encoding="utf-8"))["interpret"]
    assert sorted(interpret) == sorted(CODES)
    for code, row in interpret.items():
        assert row["explain"] and sorted(row["levels"]) == [1, 2, 3, 4], code
        for text in walk(row):
            if isinstance(text, str):     # the N2 disclaimer "not eye contact" is the one allowed mention
                assert not judgement_words(text.replace("ไม่ใช่การสบตา", "")), (code, text)
    assert set(interpret["S1"]["range"]) == {"below", "within", "above"} and TH["S1"]["direction"] == "range"
    assert interpret["T1"]["sign"]["key"] == "diff_s"


def test_pass_fail_detector_itself():
    allowed = ["ในรอบที่ผ่านมาพูดเร็วขึ้น", "อ่านผ่านๆ แล้วข้ามไป", "ผ่านการซ้อมสองรอบ",
               "ค่าอยู่ในช่วงผ่านเกณฑ์ขั้นต่ำของการวิเคราะห์"]
    caught = ["รอบนี้ไม่ผ่าน", "สอบผ่าน", "ผล: ผ่าน", "ผ่าน/ไม่ผ่าน", "ผ่านเกณฑ์", "ผ่าน",
              "พูดได้ดี ผ่าน", "คุณมั่นใจมาก", "ระดับนี้คือเกรด A"]
    for text in allowed:
        assert not judgement_words(text), text
    for text in caught:
        assert judgement_words(text), text


def test_mock_results_follow_the_thresholds_and_real_value_keys():
    """contracts/mocks are what the result page shows without the worker: their levels must come from
    config/thresholds-v0.yaml and their value keys must be ones the real criteria emit (audit Nov 2026)."""
    import json
    from worker.criteria.base import level_from_bands
    from promptpres_shared.settings import load_thresholds
    th = load_thresholds()["criteria"]
    old_keys = {"topics_mentioned", "coverage_brief_pct", "coverage_missing_pct", "filler_count", "up_pct"}
    for path in sorted((REPO / "contracts" / "mocks").glob("*.json")):
        for c in json.loads(path.read_text(encoding="utf-8"))["criteria"]:
            assert not old_keys & set(c["values"]), (path.name, c["code"])
            if c["status"] == "ok":
                assert c["level"] == level_from_bands(c["values"], th[c["code"]]), (path.name, c["code"])
                assert c["feedback_id"] == f"{c['code']}_L{c['level']}"
