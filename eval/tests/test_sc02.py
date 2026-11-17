"""Keep the SC02 run and its blank evaluator inputs aligned."""
import csv
from dataclasses import replace

import pytest

from eval import run_sc02
from eval.tables import CONFIG
from promptpres_shared.json_files import read_json


def test_templates_match_selected_clips():
    ids = [f"sc02_{e['clip_id']}" for e in run_sc02.selected_entries()]
    templates = CONFIG.parent / "eval" / "templates"
    assert (templates / "eval_clip_ids.txt").read_text(encoding="utf-8").split() == ids
    with (templates / "ratings.csv").open(encoding="utf-8", newline="") as file:
        rows = list(csv.DictReader(file))
    assert len(rows) == 192
    assert [(r["clip_id"], r["criterion"], r["rater"], r["level"]) for r in rows] == list(run_sc02.rating_rows(ids))
    with (templates / "gt_values.csv").open(encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        assert tuple(reader.fieldnames) == run_sc02.GT_FIELDS
        counts = list(reader)
    assert [r["clip_id"] for r in counts] == ids
    assert not any(v for row in counts for k, v in row.items() if k != "clip_id")


def test_summary_does_not_replace_missing_count_with_zero(tmp_path):
    result = read_json(CONFIG.parent / "contracts" / "mocks" / "result_ok.json")
    result["versions"].update(rubric="v0.9", asr="faster-whisper large-v3 cuda/int8_float16")
    clip = run_sc02.Clip(result["session_id"], tmp_path / "sample.mp4", 90, 60, [], "unused", False)
    cards = {c["code"]: c for c in result["criteria"]}
    cards["S2"]["values"]["long_pauses"] = 0
    cards["S3"].update(status="unanalyzable", level=None, reason="เสียงขาด", values={})
    row, reasons = run_sc02.summary_row(clip, result, {"total": 51.6})
    assert row["S2.long_pauses"] == 0 and row["S3.fillers"] is None
    assert row["S3"] == "วิเคราะห์ไม่ได้"
    assert row["processing_s"] == 51.6
    assert reasons == [{"clip_id": clip.session_id, "criterion": "S3", "reason": "เสียงขาด"}]
    with pytest.raises(ValueError, match="ผลไม่ครบ"):
        run_sc02.summary_row(replace(clip, session_id="other"), result, {"total": 51.6})
    result["versions"]["asr"] = "faster-whisper large-v3 cpu/int8"
    with pytest.raises(ValueError, match="CUDA"):
        run_sc02.summary_row(clip, result, {"total": 51.6})


def test_preflight_cli_never_runs_pipeline(monkeypatch):
    called = []
    monkeypatch.setattr("sys.argv", ["run_sc02", "--preflight"])
    monkeypatch.setattr(run_sc02, "preflight", lambda root: [])
    monkeypatch.setattr(run_sc02, "run_batch", lambda clips: called.append(clips))
    run_sc02.main()
    assert called == []
    monkeypatch.setattr("sys.argv", ["run_sc02", "--allow-openrouter"])
    run_sc02.main()
    assert called == [[]]
