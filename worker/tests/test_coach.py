"""AI coach (D-046): input holds results only, the Evidence Verification Guard rejects any unsupported claim."""
import json

import pytest

from promptpres_shared.contract import CoachItem
from promptpres_shared.settings import analysis_settings
from worker.llm import client, coach

SPEC = analysis_settings()["pipeline"]["coach"]


def card(code, level, evidence=(), status="ok"):
    return {"code": code, "skill": {"C": "content", "S": "speech", "N": "body", "T": "time"}[code[0]],
            "status": status, "level": level if status == "ok" else None, "values": {"x": 1.0},
            "evidence": [{"start_s": s, "end_s": e, "note": "n"} for s, e in evidence],
            "feedback_id": f"{code}_L{level}" if status == "ok" else None,
            "reason": None if status == "ok" else "เหตุผล"}


CARDS = [card("C1", 3), card("C2", 2, [(10.0, 20.0)]), card("S1", 4, [(30.0, 50.0)]),
         card("S2", 2, [(65.4, 69.0), (100.0, 103.0)]), card("S3", 1, [(120.2, 120.8)]),
         card("N1", 1, [(60.0, 95.0)]), card("N2", 4), card("T1", 3, [(3.0, 140.0)])]


def answer(**over):
    base = {"strengths": [{"code": "S1", "text": "พูดเร็วพอดีช่วง [0:30] ทำต่อไป"}],
            "focus": [{"code": "S2", "text": "หยุดเงียบที่ [1:05] เตรียมประโยคเชื่อมไว้"},
                      {"code": "S3", "text": "มีเสียงเอ่อที่ [02:00] ลองหยุดสั้น ๆ แทน"}],
            "plan": [{"code": None, "text": "ซ้อมช่วงเปลี่ยนหัวข้อ 2 รอบ"}]}
    return base | over


def test_clock_round_trip_accepts_with_and_without_leading_zero():
    assert coach.clock(65.9) == "[1:05]" and coach.clock(0) == "[0:00]"
    assert coach.parse_clocks("ที่ [1:05] และ [01:05] และ [12:00]") == [65.0, 65.0, 720.0]


def test_valid_answer_becomes_contract_items():
    items, hidden = coach.verify(answer(), CARDS, 150.0, SPEC)
    assert [i["kind"] for i in items] == ["strength", "focus", "focus", "plan"] and hidden == 0
    assert items[1]["cite_s"] == [65.0] and items[2]["cite_s"] == [120.0]    # [02:00] within 1 s of 120.2
    assert all(CoachItem.model_validate(i) for i in items)


def test_input_with_missing_transcript_has_empty_snippets():
    payload = coach.build_input(CARDS, [{"id": "H01", "order": 1, "title": "ที่มา", "coverage": "clear"}], 150.0, 900.0, SPEC)
    blob = json.dumps(payload, ensure_ascii=False)
    assert "words" not in blob
    assert payload["criteria"][3]["evidence"][0]["transcript"] == "ไม่มีข้อมูล"
    assert payload["topics"][0]["spoken_order"] == "ไม่มีข้อมูล" and payload["topics"][0]["quote"] == "ไม่มีข้อมูล"
    assert payload["criteria"][3]["evidence"][0]["at"] == "[1:05]" and payload["target_minutes"] == 15.0


@pytest.mark.parametrize("bad, rule", [
    (answer(focus=[{"code": "S2", "text": "หยุดที่ [9:59] นานไป"}]), "นอกความยาวคลิป"),
    (answer(focus=[{"code": "S2", "text": "หยุดที่ [1:40] นานไป"}]), None),                       # second S2 span 100-103
    (answer(focus=[{"code": "N1", "text": "หยุดที่ [1:05] มือนิ่ง"}]), None),                     # 65 s inside N1 60-95
    (answer(focus=[{"code": "S2", "text": "ช่วง [0:30] หยุดนาน"}]), "ไม่ตรงกับหลักฐาน"),        # S1 time used for S2
    (answer(focus=[{"code": "S2", "text": "หยุดที่ [1:07] นาน"}]), None),                         # inside 65.4-69.0
    (answer(focus=[{"code": "S2", "text": "หยุดที่ [1:11] นาน"}]), "ไม่ตรงกับหลักฐาน"),         # 71 > 69 + 1
    (answer(focus=[{"code": "S2", "text": "หยุดนานไปหน่อย"}]), "ไม่ได้อ้างเวลา"),
    (answer(focus=[{"code": "S2", "text": "หยุดที่ 1:05 นาน"}]), "นอกรูปแบบ"),
    (answer(focus=[]), "focus: ต้องมีอย่างน้อย 1"),
    (answer(strengths=[{"code": "S2", "text": "ดี"}]), "ไม่ได้อยู่ระดับ 3-4"),
    (answer(strengths=[{"code": "X9", "text": "ดี"}]), "รหัสเกณฑ์"),
    (answer(plan=[{"code": None, "text": "คะแนนรวมของคุณดีขึ้น"}]), "วลีต้องห้าม"),
    (answer(plan=[{"code": None, "text": "รอบนี้ไม่ผ่าน ต้องซ้อมใหม่"}]), "วลีต้องห้าม"),
    (answer(plan=[{"code": None, "text": "ลดความประหม่าด้วยการหายใจ"}]), "วลีต้องห้าม"),
    (answer(plan=[{"code": None, "text": "ก" * 400}]), "ยาวเกิน"),
    (answer(plan=[]), "plan: ต้องมีอย่างน้อย 1"),
])
def test_guard(bad, rule):
    if rule is None:
        assert coach.verify(bad, CARDS, 150.0, SPEC)
    else:
        with pytest.raises(coach.CoachRejected, match=rule):
            coach.verify(bad, CARDS, 150.0, SPEC)


def test_extra_items_are_dropped_and_counted_but_kept_ones_still_checked():
    """Live check 15 Nov: the model listed all six level-4 cards as strengths (limit 3)."""
    many = answer(strengths=[{"code": c, "text": "ทำได้ดี"} for c in ("S1", "N2", "T1", "C1")],
                  focus=answer()["focus"] + [{"code": "S2", "text": "อีกข้อ [1:40]"}])
    items, hidden = coach.verify(many, CARDS, 150.0, SPEC)
    assert hidden == 2 and [i["kind"] for i in items].count("strength") == 3
    assert [i["kind"] for i in items].count("focus") == 2
    bad_kept = answer(strengths=[{"code": "S2", "text": "ดี"}] + many["strengths"])      # a kept item is level 2
    with pytest.raises(coach.CoachRejected, match="ไม่ได้อยู่ระดับ 3-4"):
        coach.verify(bad_kept, CARDS, 150.0, SPEC)


def test_unanalyzable_card_cannot_be_a_focus():
    cards = [card(c["code"], 0, status="unanalyzable") if c["code"] == "S2" else c for c in CARDS]
    with pytest.raises(coach.CoachRejected, match="ต้องอ้างเกณฑ์ที่วิเคราะห์ได้"):
        coach.verify(answer(), cards, 150.0, SPEC)


def test_c2_brief_label_is_not_a_banned_phrase():
    ok = answer(plan=[{"code": None, "text": "หัวข้อที่พูดแบบผ่าน ๆ ให้เพิ่มตัวอย่าง 1 ข้อ"}])
    assert coach.verify(ok, CARDS, 150.0, SPEC)


def test_generate_caches_and_rejects(tmp_path, monkeypatch):
    calls = []

    def fake(system, user, *, purpose):
        calls.append(purpose)
        assert user.startswith("RESULT") and "coach" == purpose
        return answer(), {"model": "vendor/model-a"}
    monkeypatch.setattr(client, "model_name", lambda: "vendor/model-a")
    monkeypatch.setattr(client, "chat_json", fake)
    out = coach.generate(CARDS, [], 150.0, 900.0, tmp_path / "coach.json", SPEC)
    assert out["prompt"] == "coach-v2" and not out["cached"] and len(out["items"]) == 4 and out["hidden"] == 0
    again = coach.generate(CARDS, [], 150.0, 900.0, tmp_path / "coach.json", SPEC)
    assert again["cached"] and calls == ["coach"]
    with pytest.raises(coach.CoachRejected, match="ไม่มีเกณฑ์ที่วิเคราะห์ได้"):
        coach.generate([card(c["code"], 0, status="unanalyzable") for c in CARDS], [], 150.0, 900.0, None, SPEC)


def test_prompt_file_is_versioned_and_asks_for_json():
    text, version = client.load_prompt(coach.PROMPT)
    assert version == "coach-v2" and "JSON" in text and "[m:ss]" in text


def test_coach_prompt_never_spells_a_banned_phrase():
    """D-064: coach-v1 wrote the eye-contact word into its own rules and the model then used it ('...และสบตาผู้ฟัง',
    live run 18 Nov). coach-v2 describes gaze and feelings without those words and names what to write instead.
    The two words checked here are the banned phrases the model copied into answers in the v1 A/B on 29 local runs."""
    text, _ = client.load_prompt(coach.PROMPT)
    assert {"สบตา", "มั่นใจ"} <= set(SPEC["banned_phrases"])
    assert "สบตา" not in text and "มั่นใจ" not in text
    assert "หันหน้าเข้าหาผู้ฟัง" in text and '"until"' in text and "ไม่ได้กล่าวถึง" in text

def test_input_includes_verified_topics_and_bounded_evidence_context():
    topics = [{"id": "H02", "order": 2, "title": "ผลทดลอง", "coverage": "brief", "first_mention_s": 65.4,
               "evidence_quote": "พบผลลัพธ์บางส่วน"},
              {"id": "H01", "order": 1, "title": "ปัญหา", "coverage": "not_mentioned", "first_mention_s": None,
               "evidence_quote": None}]
    transcript = {"words": [{"word": "คำอธิบาย" * 30, "start_s": 65.4, "end_s": 68},
                            {"word": "ข้อความนอกหลักฐาน", "start_s": 145, "end_s": 146}]}
    out = coach.build_input(CARDS, topics, 150, 900, SPEC, transcript)
    assert out["topics"][0]["title"] == "ปัญหา" and out["topics"][0]["quote"] == "ไม่มีข้อมูล"
    assert out["topics"][0]["spoken_order"] == "ไม่มีข้อมูล" and out["topics"][0]["coverage_label"] == "ไม่ได้กล่าวถึง"
    assert (out["topics"][1]["planned_order"], out["topics"][1]["spoken_order"], out["topics"][1]["first_mention"]) == (2, 1, "[1:05]")
    assert all(len(c["evidence"]) <= SPEC["max_evidence_per_criterion"] for c in out["criteria"])
    assert out["topics"][1]["coverage_label"] == "กล่าวถึงบางส่วน"
    assert out["topics"][1]["quote"] == "พบผลลัพธ์บางส่วน"
    assert len(out["criteria"][3]["evidence"][0]["transcript"]) == 80
    assert "ข้อความนอกหลักฐาน" not in json.dumps(out, ensure_ascii=False)
    assert coach.cache_key("m", "p", SPEC, out) != coach.cache_key("m", "p", SPEC, coach.build_input(CARDS, topics, 150, 900, SPEC))


def test_snippet_length_and_missing_text_come_from_config():
    transcript = {"words": [{"word": "คำอธิบาย" * 30, "start_s": 65.4, "end_s": 68}]}
    topics = [{"id": "H01", "order": 1, "title": "ปัญหา", "coverage": None, "first_mention_s": None, "evidence_quote": None}]
    short = coach.build_input(CARDS, topics, 150, 900, SPEC | {"snippet_max_chars": 12, "missing_text": "ไม่ทราบ"}, transcript)
    assert len(short["criteria"][3]["evidence"][0]["transcript"]) == 12
    assert short["topics"][0]["coverage_label"] == "ไม่ทราบ" and short["topics"][0]["first_mention"] == "ไม่ทราบ"
    assert SPEC["snippet_max_chars"] == 80 and SPEC["max_evidence_per_criterion"] == 5


def test_prompt_names_the_d050_criteria_and_forbids_guessing_from_missing_data():
    system, _ = coach.client.load_prompt(coach.PROMPT)
    for text in ("เสียงเติมและคำติดปาก", "การใช้ท่าทางมือประกอบการพูด", "การหันหน้าสื่อสารกับผู้ฟัง",
                 "ห้ามอนุมานว่าผู้พูดไม่ได้กล่าวถึง", "spoken_order"):
        assert text in system
