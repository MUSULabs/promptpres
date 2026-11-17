"""pipeline.py with the slow stages replaced by fakes: 8 schema-valid cards, failures stay contained."""
import json
import os

import pytest

from worker import pipeline
from worker.llm import client
from worker.prep import MediaError, fingerprint
from worker.tests.helpers import dump, lm_table, topic_list, vad_from, word

OPENINGS = ("หัวข้อหนึ่ง", "หัวข้อสอง", "หัวข้อสาม", "หัวข้อสี่")


def fake_prep(audio=True, flags=None):
    def prepare(video, run_dir, cfg):
        out = {"probe": {"duration_s": 70.0, "has_audio": audio}, "flags": flags or {},
               "source_fingerprint": fingerprint(video),
               "media": "media.mp4", "audio": "audio.wav" if audio else None}
        dump(run_dir / "prep.json", out)
        return out
    return prepare


def fake_landmarks(video, out_parquet, cfg):
    df = lm_table(70.0)                       # hands still, head front, face seen the whole time
    df.to_parquet(out_parquet, index=False)
    return df


@pytest.fixture
def fakes(monkeypatch):
    def detect(wav, out_json, cfg):
        v = vad_from([(2.0, 30.0), (33.0, 64.0)])
        dump(out_json, v)
        return v

    def transcribe(wav, out_json, cfg):
        t = {"model": "fake", "device": "cpu", "compute_type": "int8",
             "params": {"chunk_length": 10, "initial_prompt": ""},
             "words": [word(OPENINGS[0] + "การ" * 70, 2.0, 15.0), word(OPENINGS[1] + "การ" * 70, 15.5, 30.0),
                       word(OPENINGS[2] + "การ" * 70, 33.0, 48.0), word(OPENINGS[3] + "การ" * 70, 48.5, 64.0)]}
        dump(out_json, t)
        return t

    monkeypatch.setattr(pipeline.prep_mod, "prepare", fake_prep())
    monkeypatch.setattr(pipeline.vad, "detect_speech", detect)
    monkeypatch.setattr(pipeline.asr, "transcribe", transcribe)
    monkeypatch.setattr(pipeline.landmarks, "extract", fake_landmarks)
    monkeypatch.setattr(client, "model_name", lambda: "vendor/model-a")
    monkeypatch.setattr(client, "chat_json", fake_llm)


LLM_CALLS = []


def fake_coach(user):
    """A coach answer that follows coach-v2: strength from a level 3-4 card, focus cites its first evidence."""
    cards = [c for c in json.loads(user.removeprefix("RESULT"))["criteria"] if c["status"] == "ok"]
    strong = [c for c in cards if c["level"] >= 3][:1]
    weak = min((c for c in cards if c["evidence"]), key=lambda c: c["level"])
    return {"strengths": [{"code": c["code"], "text": "ทำได้ดี"} for c in strong],
            "focus": [{"code": weak["code"], "text": f"ดูช่วง {weak['evidence'][0]['at']} แล้วปรับ"}],
            "plan": [{"code": None, "text": "ซ้อมอีก 2 รอบ"}]}, {"model": "vendor/model-a"}


def fake_llm(system, user, *, purpose):
    """Coverage: every topic clear, quoting the opening words of its own piece. Coach: see fake_coach."""
    LLM_CALLS.append(purpose)
    if purpose == "coach":
        return fake_coach(user)
    return {"topics": [{"id": f"H{i:02d}", "label": "clear", "evidence_quote": text + "การ", "line_id": None}
                       for i, text in enumerate(OPENINGS, start=1)]}, {"model": "vendor/model-a"}


def test_done_result_has_8_real_cards(tmp_path, fakes):
    res = pipeline.run_session("x.mp4", "s1", target_duration_s=60, run_root=tmp_path, topics=topic_list(4))
    assert res["status"] == "done" and len(res["criteria"]) == 8
    by = {c["code"]: c for c in res["criteria"]}
    assert all(c["status"] == "ok" for c in res["criteria"]), [(c["code"], c["reason"]) for c in res["criteria"]]
    assert by["C2"]["values"]["coverage_clear_pct"] == 100.0 and by["C1"]["values"]["kendall_tau"] == 1.0
    assert [t["first_mention_s"] for t in res["topics"]] == [2.0, 15.5, 33.0, 48.5]
    assert res["versions"]["llm"] == "vendor/model-a" and res["versions"]["prompt"] == "coverage-v1 + coach-v2"
    assert res["coach"]["status"] == "ok" and {i["kind"] for i in res["coach"]["items"]} == {"strength", "focus", "plan"}
    assert by["N1"]["values"]["max_still_s"] > 60 and by["N2"]["values"]["front_pct"] == 100.0
    assert by["S3"]["values"]["fillers"] == 0 and (tmp_path / "s1" / "fillers.json").exists()
    assert by["S2"]["values"]["long_pauses"] == 1                   # 3 s gap at 30-33 s
    assert res["versions"]["asr"].startswith("faster-whisper fake")
    assert (tmp_path / "s1" / "result.json").exists() and (tmp_path / "s1" / "timing.json").exists()


def test_without_topics_content_cards_are_unanalyzable_and_no_content_llm_call(tmp_path, fakes):
    LLM_CALLS.clear()
    res = pipeline.run_session("x.mp4", "s7", target_duration_s=60, run_root=tmp_path)
    by = {c["code"]: c for c in res["criteria"]}
    assert all(by[c]["status"] == "unanalyzable" for c in ("C1", "C2")) and "หัวข้อ" in by["C2"]["reason"]
    assert res["topics"] == [] and LLM_CALLS == ["coach"]           # the coach reads the other 6 cards
    assert res["versions"]["prompt"] == "coach-v2" and res["coach"]["status"] == "ok"


def test_coach_off_when_llm_not_approved_in_pilot(tmp_path, fakes, monkeypatch):
    monkeypatch.setenv("PROMPTPRES_MODE", "pilot")
    monkeypatch.delenv("PROMPTPRES_PILOT_LLM", raising=False)
    LLM_CALLS.clear()
    res = pipeline.run_session("x.mp4", "s9", target_duration_s=60, run_root=tmp_path, topics=topic_list(4))
    assert LLM_CALLS == [] and res["coach"] is None and res["status"] == "done"


def test_coach_rejected_answer_leaves_coach_null_and_cards_unchanged(tmp_path, fakes, monkeypatch):
    def lying_coach(system, user, *, purpose):
        if purpose != "coach":
            return fake_llm(system, user, purpose=purpose)
        answer, meta = fake_coach(user)
        answer["focus"][0]["text"] = "ดูช่วง [9:59] แล้วปรับ"           # a time with no evidence
        return answer, meta
    monkeypatch.setattr(client, "chat_json", lying_coach)
    res = pipeline.run_session("x.mp4", "s10", target_duration_s=60, run_root=tmp_path, topics=topic_list(4))
    timing = json.loads((tmp_path / "s10" / "timing.json").read_text(encoding="utf-8"))
    assert res["coach"] is None and res["status"] == "done" and "นอกความยาวคลิป" in timing["coach_error"]
    assert res["versions"]["prompt"] == "coverage-v1" and all(c["status"] == "ok" for c in res["criteria"])


def test_llm_crash_only_affects_c1_c2(tmp_path, fakes, monkeypatch):
    def boom(*a, **k):
        raise client.LLMError("เรียกแบบจำลองภาษาไม่สำเร็จ")
    monkeypatch.setattr(client, "chat_json", boom)
    res = pipeline.run_session("x.mp4", "s8", target_duration_s=60, run_root=tmp_path, topics=topic_list(4))
    by = {c["code"]: c for c in res["criteria"]}
    assert by["C2"]["reason"] == "เรียกแบบจำลองภาษาเพื่อตรวจเนื้อหาไม่สำเร็จ" and by["C1"]["status"] == "unanalyzable"
    assert all(by[c]["status"] == "ok" for c in ("T1", "S1", "S2", "S3", "N1", "N2"))
    assert res["topics"] == [] and res["versions"]["llm"] is None


def test_asr_crash_only_affects_s1_s3(tmp_path, fakes, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("no model")
    monkeypatch.setattr(pipeline.asr, "transcribe", boom)
    res = pipeline.run_session("x.mp4", "s2", target_duration_s=60, run_root=tmp_path)
    by = {c["code"]: c for c in res["criteria"]}
    assert by["S1"]["status"] == "unanalyzable" and by["S3"]["status"] == "unanalyzable"
    assert all(by[c]["status"] == "ok" for c in ("T1", "S2", "N1", "N2"))


def test_landmarks_crash_only_affects_n1_n2(tmp_path, fakes, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("no mediapipe")
    monkeypatch.setattr(pipeline.landmarks, "extract", boom)
    res = pipeline.run_session("x.mp4", "s5", target_duration_s=60, run_root=tmp_path)
    by = {c["code"]: c for c in res["criteria"]}
    assert by["N1"]["status"] == "unanalyzable" and by["N2"]["status"] == "unanalyzable"
    assert all(by[c]["status"] == "ok" for c in ("T1", "S1", "S2", "S3"))


def test_reuse_skips_stages_that_already_ran(tmp_path, fakes, monkeypatch):
    video = tmp_path / "source.mp4"
    video.write_bytes(b"video")
    pipeline.run_session(video, "s6", target_duration_s=60, run_root=tmp_path)
    def boom(*a, **k):
        raise AssertionError("should have been reused")
    for mod, name in ((pipeline.prep_mod, "prepare"), (pipeline.landmarks, "extract"),
                      (pipeline.vad, "detect_speech"), (pipeline.asr, "transcribe")):
        monkeypatch.setattr(mod, name, boom)
    res = pipeline.run_session(video, "s6", target_duration_s=60, run_root=tmp_path, reuse=True)
    assert sum(c["status"] == "ok" for c in res["criteria"]) == 6        # no topics given -> C1 C2 off


def test_reuse_only_when_the_video_is_the_same_file(tmp_path, fakes):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"first")
    pipeline.run_session(video, "s10", target_duration_s=60, run_root=tmp_path, topics=topic_list(4))
    LLM_CALLS.clear()
    res = pipeline.run_session(video, "s10", target_duration_s=60, run_root=tmp_path, reuse=True, topics=topic_list(4))
    timing = (tmp_path / "s10" / "timing.json").read_text(encoding="utf-8")
    assert '"prep": "reused"' in timing and '"coverage": "cached"' in timing and LLM_CALLS == []
    assert sum(c["status"] == "ok" for c in res["criteria"]) == 8
    before = video.stat()
    video.write_bytes(b"after")   # Same name, byte count and timestamp; different recording.
    os.utime(video, ns=(before.st_atime_ns, before.st_mtime_ns))
    pipeline.run_session(video, "s10", target_duration_s=60, run_root=tmp_path, reuse=True, topics=topic_list(4))
    timing = (tmp_path / "s10" / "timing.json").read_text(encoding="utf-8")
    assert '"prep": "reused"' not in timing and "source changed" in timing
    assert LLM_CALLS == ["coverage"]


def test_fresh_run_bypasses_coverage_and_other_stage_caches(tmp_path, fakes):
    video = tmp_path / "source.mp4"
    video.write_bytes(b"rehearsal")
    options = {"run_root": tmp_path, "topics": topic_list(4)}
    pipeline.run_session(video, "fresh", **options)
    LLM_CALLS.clear()
    pipeline.run_session(video, "fresh", reuse=False, **options)
    timing = json.loads((tmp_path / "fresh" / "timing.json").read_text())
    assert LLM_CALLS == ["coverage", "coach"] and isinstance(timing["coverage"], (float, int))
    assert isinstance(timing["coach"], (float, int))
    assert isinstance(timing["prep"], (float, int))


def test_invalid_cached_output_is_rebuilt(tmp_path, fakes):
    video = tmp_path / "source.mp4"
    video.write_bytes(b"rehearsal")
    options = {"run_root": tmp_path, "topics": topic_list(4)}
    pipeline.run_session(video, "invalid-cache", **options)
    folder = tmp_path / "invalid-cache"
    (folder / "vad.json").write_text("[]", encoding="utf-8")
    (folder / "coverage.json").write_text("[]", encoding="utf-8")
    LLM_CALLS.clear()
    result = pipeline.run_session(video, "invalid-cache", reuse=True, **options)
    assert all(card["status"] == "ok" for card in result["criteria"])
    assert LLM_CALLS == ["coverage"]
    assert isinstance(json.loads((folder / "vad.json").read_text())["segments"], list)


def test_no_audio_makes_audio_cards_unanalyzable(tmp_path, monkeypatch):
    monkeypatch.setattr(pipeline.prep_mod, "prepare", fake_prep(audio=False, flags={"no_audio": "ไฟล์ไม่มีเสียง"}))
    monkeypatch.setattr(pipeline.landmarks, "extract", fake_landmarks)
    res = pipeline.run_session("x.mp4", "s3", run_root=tmp_path)
    by = {c["code"]: c for c in res["criteria"]}
    assert res["status"] == "done"
    assert all(by[c]["reason"] == "ไฟล์ไม่มีเสียง" for c in ("T1", "S1", "S2", "S3"))
    assert by["N2"]["status"] == "ok"                                 # picture still works (whole clip)


def test_unreadable_video_is_failed_not_crash(tmp_path, monkeypatch):
    def bad(*a, **k):
        raise MediaError("อ่านไฟล์วิดีโอไม่ได้")
    monkeypatch.setattr(pipeline.prep_mod, "prepare", bad)
    res = pipeline.run_session("x.mp4", "s4", run_root=tmp_path)
    assert res["status"] == "failed" and res["criteria"] == [] and res["error"]


def test_vad_failure_does_not_restore_stale_data_or_fail_vision(tmp_path, fakes, monkeypatch):
    source = tmp_path / "clip.webm"
    source.write_bytes(b"video")
    first = pipeline.run_session(source, "s12", run_root=tmp_path, topics=topic_list(4))
    assert next(c for c in first["criteria"] if c["code"] == "T1")["status"] == "ok"

    def boom(*args):
        raise RuntimeError("fake VAD failure")
    monkeypatch.setattr(pipeline.vad, "detect_speech", boom)
    from promptpres_shared.settings import analysis_settings
    config = analysis_settings()
    config["pipeline"]["vad"]["threshold"] = 0.6
    second = pipeline.run_session(source, "s12", run_root=tmp_path, reuse=True, settings=config)
    cards = {c["code"]: c for c in second["criteria"]}
    assert cards["T1"]["status"] == "unanalyzable"
    assert cards["N2"]["status"] == "ok"
    timing = (tmp_path / "s12" / "timing.json").read_text(encoding="utf-8")
    assert '"vad_error": "RuntimeError"' in timing and '"prep": "reused"' in timing
