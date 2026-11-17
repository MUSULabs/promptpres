"""C2 coverage: transcript lines, the quote verifier (LLM never trusted), cache, the C2 card."""
import pytest

from worker.criteria import c2
from promptpres_shared.settings import load_thresholds
from worker.llm import client, coverage
from worker.tests.helpers import checked, session, topic_list, word

TH = load_thresholds()["criteria"]
C2 = TH["C2"]
LLM_CFG = {"transcript_line_gap_s": 0.6, "transcript_line_max_s": 15}

# Whisper-style pieces: "ระบบตรวจจับการหกล้ม" 0-2.2 s, pause, "ส่งแจ้งเตือนไปยังผู้ดูแล" 5-7 s, "ระบุตําแหน่ง" (ํ+า)
WORDS = [word(t, a, b) for t, a, b in [
    ("ระบบ", 0.0, 0.5), ("ตรวจ", 0.5, 1.0), ("จับ", 1.0, 1.3), ("การ", 1.3, 1.6), ("หก", 1.6, 1.9), ("ล้ม", 1.9, 2.2),
    ("ส่ง", 5.0, 5.3), ("แจ้ง", 5.3, 5.6), ("เตือน", 5.6, 6.0), ("ไปยัง", 6.0, 6.4), ("ผู้", 6.4, 6.6), ("ดูแล", 6.6, 7.0),
    ("ระบุ", 9.0, 9.4), ("ตํา", 9.4, 9.7), ("แหน่ง", 9.7, 10.0), ("ป้าย", 10.0, 10.4),
]]
LINES = coverage.transcript_lines(WORDS, 0.6, 15)


def check(answer):
    return coverage.verify(answer, WORDS, LINES, 60.0, C2)


def test_lines_break_at_pauses():
    assert [ln["id"] for ln in LINES] == ["L001", "L002", "L003"]
    assert LINES[0]["text"] == "ระบบตรวจจับการหกล้ม" and (LINES[1]["start_s"], LINES[1]["end_s"]) == (5.0, 7.0)


def test_exact_quote_across_pieces_takes_times_from_the_pieces():
    v = check({"label": "clear", "evidence_quote": "ตรวจจับการหกล้ม", "line_id": "L001", "start_s": 40.0})
    assert v["label"] == "clear" and v["match"] == "exact" and (v["start_s"], v["end_s"]) == (0.5, 2.2)


def test_spacing_and_sara_am_spelling_do_not_matter():
    assert check({"label": "brief", "evidence_quote": "ส่ง แจ้งเตือน ไปยัง ผู้ดูแล", "start_s": 5})["label"] == "brief"
    v = check({"label": "clear", "evidence_quote": "ระบุตำแหน่งป้าย", "line_id": "L003"})      # LLM writes ำ
    assert v["label"] == "clear" and v["start_s"] == 9.0


def test_invented_quote_is_downgraded_to_not_mentioned():
    v = check({"label": "clear", "evidence_quote": "ระบบใช้ปัญญาประดิษฐ์ขั้นสูง", "line_id": "L001", "start_s": 0})
    assert v["label"] == "not_mentioned" and v["llm_label"] == "clear" and v["rejected"] == "quote_not_found"
    assert v["start_s"] is None and v["evidence_quote"] is None


@pytest.mark.parametrize("answer, reason", [
    ({"label": "clear", "evidence_quote": "ตรวจจับการหกล้ม", "start_s": 300.0}, "time_outside_clip"),
    ({"label": "brief", "evidence_quote": ""}, "no_quote"),
    ({"label": "brief", "evidence_quote": "ระบบ"}, "quote_too_short"),
])
def test_other_rejections(answer, reason):
    v = check(answer)
    assert v["label"] == "not_mentioned" and v["rejected"] == reason


def test_small_asr_difference_matches_fuzzily_near_the_given_line():
    v = check({"label": "clear", "evidence_quote": "ส่งแจ้งเตือนไปยังผู้ดูแร", "line_id": "L002"})   # ล -> ร
    assert v["label"] == "clear" and v["match"].startswith("fuzzy") and v["start_s"] == 5.0
    assert check({"label": "clear", "evidence_quote": "ส่งแจ้งเตือนไปยังผู้ดูแร"})["rejected"] == "quote_not_found"


def test_missing_alias_and_absent_answer_are_not_mentioned():
    assert check({"label": "missing"})["label"] == "not_mentioned"
    assert check({"label": "nonsense", "evidence_quote": "ตรวจจับการหกล้ม"})["label"] == "not_mentioned"


def test_analyse_verifies_every_topic_and_uses_the_cache(tmp_path, monkeypatch):
    calls = []

    def fake_chat(system, user, *, purpose):
        calls.append(user)
        if purpose == "requote":      # second chance only for H01 (H03's line has nothing about YOLO)
            return {"topics": [{"id": "H01", "evidence_quote": "ระบบตรวจจับการหกล้ม", "line_id": "L001"},
                               {"id": "H03", "evidence_quote": "YOLO ตรวจท่าทาง", "line_id": "L003"}]}, {}
        return {"topics": [
            {"id": "H01", "label": "clear", "evidence_quote": "ระบบตรวจจับการล้มของผู้สูงอายุ", "line_id": "L001", "start_s": 0.0},
            {"id": "H02", "label": "brief", "evidence_quote": "แจ้งเตือนไปยังผู้ดูแล", "line_id": "L002", "start_s": 5.0},
            {"id": "H03", "label": "clear", "evidence_quote": "ใช้ YOLO ตรวจท่าทาง", "line_id": "L003", "start_s": 9.0},
            {"id": "H04", "label": "not_mentioned"},
            {"id": "H99", "label": "clear", "evidence_quote": "ไม่มีหัวข้อนี้"}]}, {"model": "vendor/model-a"}
    monkeypatch.setattr(client, "chat_json", fake_chat)
    monkeypatch.setattr(client, "model_name", lambda: "vendor/model-a")
    out = tmp_path / "coverage.json"
    res = coverage.analyse(topic_list(4), {"words": WORDS}, 60.0, out, LLM_CFG, C2)
    labels = {t["id"]: (t["label"], t["rejected"], t["requoted"]) for t in res["topics"]}
    assert labels == {"H01": ("clear", None, True), "H02": ("brief", None, False),
                      "H03": ("not_mentioned", "quote_not_found", True), "H04": ("not_mentioned", None, False)}
    assert "[L002 5.0-7.0]" in calls[0] and "L002" not in calls[1].split("LINES")[0]
    assert res["prompt"] == f"{coverage.PROMPT} + requote-v1" and not res["cached"] and len(calls) == 2
    again = coverage.analyse(topic_list(4), {"words": WORDS}, 60.0, out, LLM_CFG, C2)
    assert again["cached"] and len(calls) == 2
    coverage.analyse(topic_list(3), {"words": WORDS}, 60.0, out, LLM_CFG, C2 | {"requote_rounds": 0})
    assert len(calls) == 3                                                          # topics changed -> new call


def test_analyse_with_another_prompt_version(tmp_path, monkeypatch):
    systems = []

    def fake_chat(system, user, *, purpose):
        systems.append(system)
        return {"topics": [{"id": "H01", "label": "brief", "evidence_quote": "ระบบตรวจจับการล้มของผู้สูงอายุ",
                            "line_id": "L001", "start_s": 0.0}]}, {}
    monkeypatch.setattr(client, "chat_json", fake_chat)
    monkeypatch.setattr(client, "model_name", lambda: "vendor/model-a")
    out = tmp_path / "coverage.json"
    res = coverage.analyse(topic_list(1), {"words": WORDS}, 60.0, out, LLM_CFG, C2 | {"requote_rounds": 0}, prompt="coverage-v2")
    assert res["prompt"] == "coverage-v2" and systems[0] == client.load_prompt("coverage-v2")[0]
    coverage.analyse(topic_list(1), {"words": WORDS}, 60.0, out, LLM_CFG, C2 | {"requote_rounds": 0}, prompt="coverage-v1")
    assert len(systems) == 2                                                        # prompt changed -> new call


# ------------------------------------------------------------------------------------- C2 card
SPEECH = [(0.0, 60.0)]
TEXT = [word("การ", 0.0, 60.0)]


def card(cov, topics=None, **kw):
    return c2.run(session(SPEECH, TEXT, topics=topic_list(4) if topics is None else topics, coverage=cov, **kw), C2)


def test_rubric_example_3_clear_1_brief_is_87_5_level_3():
    out = card(checked({"H01": "clear", "H02": "clear", "H03": "clear", "H04": "brief"}))
    assert out["values"]["coverage_clear_pct"] == 87.5 and out["level"] == 3
    assert out["values"]["brief"] == 1 and len(out["evidence"]) == 4
    assert out["evidence"][3]["note"].startswith("H04 แผนทดสอบ — กล่าวถึงบางส่วน")


def test_s11_like_partial_name_only_skipped_full_is_50_level_2():
    out = card(checked({"H01": "brief", "H02": "brief", "H04": "clear"}))
    assert out["values"]["coverage_clear_pct"] == 50.0 and out["level"] == 2 and out["values"]["not_mentioned"] == 1


def test_contract_topics_follow_the_confirmed_order():
    ses = session(SPEECH, TEXT, topics=topic_list(4), coverage=checked({"H01": "clear", "H03": "brief"}))
    tops = c2.contract_topics(ses)
    assert [t["coverage"] for t in tops] == ["clear", "not_mentioned", "brief", "not_mentioned"]
    assert tops[1]["first_mention_s"] is None and tops[0]["evidence_quote"] and tops[0]["order"] == 1


@pytest.mark.parametrize("kwargs, reason", [
    ({"topics": []}, "ยังไม่มีรายการหัวข้อ"),
    ({"topics": topic_list(2)}, "ต้องอย่างน้อย 3"),
    ({"extra_error": True}, "เรียกแบบจำลองภาษา"),
])
def test_c2_unanalyzable_cases(kwargs, reason):
    ses = session(SPEECH, TEXT, topics=kwargs.get("topics", topic_list(4)), coverage=checked({"H01": "clear"}))
    if kwargs.get("extra_error"):
        ses.extra["coverage_error"] = "LLMError"
    out = c2.run(ses, C2)
    assert out["status"] == "unanalyzable" and reason in out["reason"] and out["level"] is None


def test_c2_needs_enough_speech():
    out = c2.run(session([(0.0, 10.0)], [word("การ", 0.0, 10.0)], topics=topic_list(4),
                         coverage=checked({"H01": "clear"})), C2)
    assert out["status"] == "unanalyzable" and "สั้นเกิน" in out["reason"]
