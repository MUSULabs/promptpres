"""Interactive transcript (D-046): phrases cut at word boundaries, fillers flagged, long pauses attached."""
import json

from fastapi.testclient import TestClient

import app.main as main
from promptpres_shared.transcript import build_transcript, glue, long_pauses

client = TestClient(main.app)


def piece(text, start, end):
    return {"word": text, "start_s": start, "end_s": end, "probability": 0.9}


# "สวัสดี" (pieces) / "เอ่อ" (filler) / "ครับ" then a 3 s silence, then "ต่อไป"
WORDS = [piece("ส", 1.0, 1.1), piece("วัส", 1.1, 1.3), piece("ดี", 1.3, 1.5),
         piece("เอ่อ", 2.0, 2.4),
         piece("ครับ", 2.5, 2.8),
         piece("ต่อ", 6.0, 6.2), piece("ไป", 6.2, 6.4)]
FILLERS = {"text": [{"start_s": 2.0, "end_s": 2.4, "text": "เอ่อ", "words": [3], "source": "text"}],
           "acoustic": [], "count_acoustic": False}
VAD = {"segments": [{"start_s": 0.9, "end_s": 2.9}, {"start_s": 5.9, "end_s": 6.5}]}


def test_glue_keeps_thai_together_and_spaces_other_text():
    assert glue(["ส", "วัส", "ดี", "AI", "coach"])[0] == "สวัสดี AI coach"
    assert long_pauses(VAD["segments"], 2.0) == [(2.9, 5.9)]


def test_phrases_fillers_and_pause():
    items = build_transcript(WORDS, FILLERS, VAD["segments"], pause_min_s=2.0, gap_s=0.25, max_s=6)
    assert [i["text"] for i in items] == ["สวัสดี", "เอ่อ", "ครับ", "ต่อไป"]
    assert [i["is_filler"] for i in items] == [False, True, False, False]
    assert items[2]["pause_after_s"] == 3.0 and items[0]["pause_after_s"] is None
    assert items[0]["start_s"] == 1.0 and items[0]["end_s"] == 1.5


def test_a_long_phrase_is_never_cut_inside_a_word():
    words = [piece(c, n * 0.5, n * 0.5 + 0.5) for n, c in enumerate("การนำเสนอ")]    # 4.5 s, one gap-free run
    items = build_transcript(words, None, [], 2.0, gap_s=0.25, max_s=1.0)
    assert "".join(i["text"] for i in items) == "การนำเสนอ"
    assert all(i["text"] in ("การ", "นำเสนอ", "นำ", "เสนอ", "การนำเสนอ") for i in items), items


def write_run(sid, **files):
    folder = main.RUNS_DIR / sid
    folder.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (folder / f"{name}.json").write_text(data if isinstance(data, str) else json.dumps(data, ensure_ascii=False),
                                             encoding="utf-8")


def test_endpoint_reads_the_run_folder():
    sid = client.post("/api/sessions").json()["session_id"]
    assert client.get(f"/api/sessions/{sid}/transcript").json() == []           # nothing analysed yet
    write_run(sid, transcript={"words": WORDS}, fillers=FILLERS, vad=VAD)
    items = client.get(f"/api/sessions/{sid}/transcript").json()
    assert [i["text"] for i in items] == ["สวัสดี", "เอ่อ", "ครับ", "ต่อไป"] and items[1]["is_filler"]


def test_endpoint_is_safe_without_or_with_broken_files():
    sid = client.post("/api/sessions").json()["session_id"]
    write_run(sid, transcript="{not json")
    assert client.get(f"/api/sessions/{sid}/transcript").json() == []
    write_run(sid, transcript={"words": WORDS}, fillers="[]", vad="oops")        # transcript alone still works
    assert [i["is_filler"] for i in client.get(f"/api/sessions/{sid}/transcript").json()] == [False] * 3
    assert client.get("/api/sessions/s_mock_ok/transcript").json() == []
    assert client.get("/api/sessions/s_nope/transcript").status_code == 404
