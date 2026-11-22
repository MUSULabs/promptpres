"""Tests for research/keylog_to_records.py (D-069). Every key log here is invented (no real clip or label)."""
import json

import pytest

from research import keylog_to_records as kl
from research import validate_labels as vl

MANIFEST = {"ZZ00-01": {"masked_media_duration_s": 20.0, "source_offset_s": 30.0, "source_end_s": 50.0}}


def keylog(**over):
    data = {"format": kl.FORMAT, "annotator_id": "A2", "blind_id": "ZZ00-01", "media_duration_s": 20.02,
            "manual_version": "ANNOTATION_MANUAL_N1_N2_V1.0", "created_at": "2026-11-24T10:00:00+07:00",
            "work_seconds": 120,
            "layers": {"N1_function": [{"t": 0.0, "label": "REST_OR_HOLD"}, {"t": 5.0, "label": "GESTURE"},
                                       {"t": 9.0, "label": "ADAPTOR_MANIPULATION", "ambiguous": True}],
                       "N2_direction": [{"t": 0.05, "label": "NOTES"}, {"t": 8.0, "label": "CAMERA_REGION"}]},
            "holding_notes": [[0.0, 7.5]]}
    data.update(over)
    return data


def write(tmp_path, data, name="A2_ZZ00-01.json"):
    p = tmp_path / name
    p.write_text(json.dumps(data), encoding="utf-8")
    return p


def test_valid_keylog_gives_records_that_pass_the_validator(tmp_path):
    recs = kl.keylog_to_records(write(tmp_path, keylog()), MANIFEST)
    assert vl.validate(recs, manifest=MANIFEST) == []
    n1 = [r for r in recs if r["layer"] == "N1_function"]
    assert [(r["start_s"], r["end_s"], r["final_label"]) for r in n1] == [
        (0.0, 5.0, "REST_OR_HOLD"), (5.0, 9.0, "GESTURE"), (9.0, 20.0, "ADAPTOR_MANIPULATION")]
    assert n1[-1]["ambiguous"] is True and n1[0]["ambiguous"] is False
    assert all(r["tier"] == "GOLD_MANUAL" and r["record_role"] == "independent" for r in recs)
    flags = [r for r in recs if r["layer"] == "N1_flags"]
    assert [(r["start_s"], r["end_s"], r["flags"]) for r in flags] == [(0.0, 7.5, ["holding_notes"])]


def test_first_change_point_near_zero_starts_at_zero(tmp_path):
    recs = kl.keylog_to_records(write(tmp_path, keylog()), MANIFEST)
    assert min(r["start_s"] for r in recs if r["layer"] == "N2_direction") == 0.0


def test_without_manifest_the_last_span_ends_at_the_player_duration(tmp_path):
    recs = kl.keylog_to_records(write(tmp_path, keylog()))
    assert max(r["end_s"] for r in recs if r["layer"] == "N1_function") == 20.02


def test_short_span_is_merged_into_the_longer_neighbour():
    pts = [{"t": 0.0, "label": "REST_OR_HOLD"}, {"t": 4.0, "label": "GESTURE"},
           {"t": 4.3, "label": "OTHER"}, {"t": 6.0, "label": "GESTURE"}]
    spans = kl.change_points_to_spans(pts, 10.0, 0.5)
    assert [(s["start_s"], s["end_s"], s["label"]) for s in spans] == [
        (0.0, 4.3, "REST_OR_HOLD"), (4.3, 6.0, "OTHER"), (6.0, 10.0, "GESTURE")]


def test_same_labels_in_a_row_are_joined():
    pts = [{"t": 0.0, "label": "NOTES"}, {"t": 3.0, "label": "NOTES"}, {"t": 6.0, "label": "OTHER"}]
    spans = kl.change_points_to_spans(pts, 10.0, 0.3)
    assert [(s["start_s"], s["end_s"], s["label"]) for s in spans] == [(0.0, 6.0, "NOTES"), (6.0, 10.0, "OTHER")]


def test_points_after_the_end_are_ignored_and_order_does_not_matter():
    pts = [{"t": 8.0, "label": "OTHER"}, {"t": 0.0, "label": "NOTES"}, {"t": 12.0, "label": "CAMERA_REGION"}]
    spans = kl.change_points_to_spans(pts, 10.0, 0.3)
    assert [(s["start_s"], s["end_s"], s["label"]) for s in spans] == [(0.0, 8.0, "NOTES"), (8.0, 10.0, "OTHER")]


def test_missing_label_at_zero_is_an_error(tmp_path):
    data = keylog()
    data["layers"]["N2_direction"] = [{"t": 2.0, "label": "NOTES"}]
    with pytest.raises(ValueError, match="not at 0"):
        kl.keylog_to_records(write(tmp_path, data))


def test_unknown_label_and_wrong_file_name_are_errors(tmp_path):
    data = keylog()
    data["layers"]["N1_function"][0]["label"] = "NOTES"
    with pytest.raises(ValueError, match="unknown labels"):
        kl.keylog_to_records(write(tmp_path, data))
    with pytest.raises(ValueError, match="do not match"):
        kl.keylog_to_records(write(tmp_path, keylog(), name="A3_ZZ00-01.json"))
    with pytest.raises(ValueError, match="file name"):
        kl.keylog_to_records(write(tmp_path, keylog(), name="labels.json"))


def test_missing_layer_is_an_error(tmp_path):
    data = keylog()
    del data["layers"]["N2_direction"]
    with pytest.raises(ValueError, match="missing"):
        kl.keylog_to_records(write(tmp_path, data))


def test_flag_spans_are_clipped_joined_and_short_ones_dropped():
    assert kl.flag_spans([[-1, 2], [1.5, 3], [5, 5.2], [9, 30]], 10.0) == [(0.0, 3), (9, 10.0)]


def test_cli_writes_records_and_work_times(tmp_path):
    p = write(tmp_path, keylog())
    out, times = tmp_path / "labels.jsonl", tmp_path / "times.csv"
    assert kl.main([str(p), "-o", str(out), "--times", str(times)]) == 0
    recs = vl.load_records([out])
    assert vl.validate(recs) == []           # no manifest given: the last span ends at the player duration
    assert "A2,ZZ00-01,2.0" in times.read_text(encoding="utf-8")
