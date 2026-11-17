"""Topics from a PDF with a mocked LLM: PDF text, validation, renumbering."""
import pytest

from worker.llm import client, topics


def make_pdf(path, pages):
    import pymupdf
    doc = pymupdf.open()
    for text in pages:
        page = doc.new_page()
        y = 72
        for line in text.split("\n"):
            page.insert_text((72, y), line)
            y += 14
    doc.save(str(path))
    doc.close()
    return path


def lines(text, n):
    """n short lines (one long line would run off the page and be clipped)."""
    return "\n".join([text] * n)


def reply(n, **extra):
    return {"topics": [{"id": f"X{9 - i}", "title": f"Topic {i}", "expected_order": 7, "key_point": f"point {i}"}
                       for i in range(n)]} | extra


def test_pdf_text_is_paged_and_cut(tmp_path):
    pdf = make_pdf(tmp_path / "r.pdf", [lines("Problem statement of users", 20), lines("Method and test plan", 20)])
    text, pages = topics.pdf_text(pdf, max_pages=1, max_chars=10_000)
    assert pages == 2 and text.startswith("PAGE 1") and "PAGE 2" not in text
    short = topics.pdf_text(pdf, 5, 100)[0]
    assert len(short) <= 100 and "PAGE 1" in short and "PAGE 2" in short   # cut evenly, not at the end


def test_empty_pdf_asks_user_to_type_topics(tmp_path):
    pdf = make_pdf(tmp_path / "e.pdf", [""])
    with pytest.raises(ValueError, match="กรอกหัวข้อเอง"):
        topics.pdf_text(pdf, 10, 10_000)


def test_suggest_topics_renumbers_and_dedupes(tmp_path, monkeypatch):
    pdf = make_pdf(tmp_path / "r.pdf", [lines("Background and problem of the users", 15)])
    payload = reply(5)
    payload["topics"].append({"title": " topic 0 ", "key_point": "duplicate"})
    seen = {}

    def fake_chat(system, user, *, purpose, **kw):
        seen["user"] = user
        return payload, {"model": "vendor/model-a", "purpose": purpose}
    monkeypatch.setattr(client, "chat_json", fake_chat)
    res = topics.suggest_topics(pdf)
    assert [t["id"] for t in res["topics"]] == ["H01", "H02", "H03", "H04", "H05"]
    assert [t["expected_order"] for t in res["topics"]] == [1, 2, 3, 4, 5]
    assert res["model"] == "vendor/model-a" and res["prompt"] == "topics-v2"
    assert res["note"] is None
    assert "PAGE 1" in seen["user"]


def test_three_topic_draft_is_kept():
    """Confirm accepts 3 topics (thresholds C2 min_topics), so a 3-topic LLM draft is not thrown away."""
    assert len(topics.clean_topics(reply(3))[0]) == 3


def test_too_few_topics_is_an_error():
    with pytest.raises(ValueError, match="อย่างน้อย 3"):
        topics.clean_topics(reply(2))


def test_normal_report_draft_has_no_note():
    """A merged 5-8 topic draft (what topics-v2 asks for) comes back as is."""
    got, note = topics.clean_topics(reply(6, is_valid_document=True, rejection_reason=""))
    assert len(got) == 6 and note is None


def test_twelve_topics_are_kept_with_a_note():
    """The Solar Rooftop case: 12 topics used to throw the whole draft away (limit 3-10)."""
    got, note = topics.clean_topics(reply(12, is_valid_document=True))
    assert [t["id"] for t in got] == [f"H{i:02d}" for i in range(1, 13)]
    assert [t["title"] for t in got] == [f"Topic {i}" for i in range(12)]
    assert "12 หัวข้อ" in note and "5–8" in note and "แสดง" not in note


@pytest.mark.parametrize("n", [16, 18])
def test_more_than_the_editor_limit_keeps_the_first_15(n):
    got, note = topics.clean_topics(reply(n))
    assert len(got) == topics.MAX_DRAFT_TOPICS == 15
    assert got[-1]["title"] == "Topic 14" and got[-1]["id"] == "H15"
    assert f"{n} หัวข้อ" in note and "แสดง 15 หัวข้อแรก" in note


def test_limits_can_come_from_config():
    """suggest_topics passes thresholds C2 min_topics / max_topics; clean_topics honours other values too."""
    got, note = topics.clean_topics(reply(12), min_topics=3, max_topics=11)
    assert len(got) == 11 and "แสดง 11 หัวข้อแรก" in note
    with pytest.raises(ValueError, match="อย่างน้อย 4"):
        topics.clean_topics(reply(3), min_topics=4)


@pytest.mark.parametrize("flag", [False, "false", " False "])
def test_non_report_document_is_rejected_in_thai(flag):
    payload = {"is_valid_document": flag, "rejection_reason": "ไฟล์นี้เป็น\nใบเสร็จรับเงิน", "topics": []}
    with pytest.raises(ValueError) as e:
        topics.clean_topics(payload)
    msg = str(e.value)
    assert msg.startswith("ไฟล์ที่แนบไม่ใช่รายงานโครงงานหรือสไลด์นำเสนอ (ไฟล์นี้เป็น ใบเสร็จรับเงิน)")
    assert "กรุณาแนบไฟล์รายงานหรือสไลด์" in msg


def test_rejection_wins_over_topics_and_long_reasons_are_cut():
    payload = reply(6, is_valid_document=False, rejection_reason="ก" * 500)
    with pytest.raises(ValueError) as e:
        topics.clean_topics(payload)
    assert "ก" * topics.REASON_MAX_CHARS in str(e.value) and "ก" * (topics.REASON_MAX_CHARS + 1) not in str(e.value)


def test_missing_gate_field_counts_as_a_report():
    """Old-format replies (topics-v1 shape) are still accepted."""
    assert len(topics.clean_topics(reply(4))[0]) == 4


def test_key_points_list_is_joined():
    payload = {"topics": [{"title": f"T{i}", "key_points": ["Use Case", " ER Diagram ", ""]} for i in range(3)]}
    got, _ = topics.clean_topics(payload)
    assert got[0]["key_point"] == "Use Case · ER Diagram"


@pytest.mark.parametrize("lengths, budget, cap", [
    ([100, 200, 300], 1000, 300),       # fits: nothing is cut
    ([100, 200, 300], 450, 175),        # 100 + 175 + 175 = 450
    ([1000, 10, 10], 120, 100),
    ([5, 5], 0, 0),
    ([], 100, 0),
])
def test_page_cap(lengths, budget, cap):
    assert topics.page_cap(lengths, budget) == cap
    assert sum(min(n, cap) for n in lengths) <= budget


def test_long_pdf_keeps_every_page_instead_of_cutting_the_end(tmp_path):
    """An 80-page report used to lose its last chapters at the character limit; now every page is represented."""
    pages = [lines(f"Chapter content page {i}", 30) for i in range(30)]
    pdf = make_pdf(tmp_path / "long.pdf", pages)
    text, n = topics.pdf_text(pdf, max_pages=100, max_chars=6000)
    assert n == 30 and len(text) <= 6000
    for i in range(30):
        assert f"PAGE {i + 1}\n" in text
    assert "Chapter content page 29" in text


def test_password_and_corrupt_pdfs_give_thai_value_errors(tmp_path):
    import pymupdf
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "Problem statement")
    locked = tmp_path / "locked.pdf"
    doc.save(str(locked), encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="pw", owner_pw="pw2")
    doc.close()
    with pytest.raises(ValueError, match="รหัสผ่าน"):
        topics.pdf_text(locked, 10, 10_000)
    broken = tmp_path / "broken.pdf"
    broken.write_bytes(b"%PDF-1.7" + bytes([10]) + bytes([0]) * 400)
    with pytest.raises(ValueError, match="กรอกหัวข้อเอง"):
        topics.pdf_text(broken, 10, 10_000)
