"""Tests for research/make_masked_media.py (D-067 Phase 2 custodian tool).

Run from the repository root:  python -m pytest research/tests -q
Rows and media here are invented (ffmpeg lavfi test pattern + sine tone); no real clip, speaker or path.
The cut tests are skipped when ffmpeg/ffprobe are not installed.
"""
import json
import shutil
import subprocess

import pandas as pd
import pytest

from research import make_masked_media as mm

SPEECH = mm.SPEECH_WINDOW
ROW = {
    "blind_id": "ZZ00-01", "clip_id": "EXAMPLE_CLIP_001", "participant_id": "EXAMPLE_SPEAKER",
    "is_team_member": "false", "mp4_path": "example/EXAMPLE_CLIP_001.mp4", "clip_duration_s": "5.00",
    "window_rule": "full_clip", "layers": "N1;N2", "audit_observation_for_selection": "invented observation",
    "expected_difficulty": "easy",
}


def has_ffmpeg() -> bool:
    try:
        return bool(mm._tool("ffmpeg")) and bool(mm._tool("ffprobe"))
    except Exception:   # noqa: BLE001 - any lookup failure means "not installed"
        return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


needs_ffmpeg = pytest.mark.skipif(not has_ffmpeg(), reason="ffmpeg/ffprobe not installed")


# ---------------------------------------------------------------- offsets

def test_full_clip_window_is_whole_clip():
    assert mm.window_for("full_clip", 63.8) == (0.0, 63.8)


def test_speech_window_is_onset_plus_30_for_60_s():
    assert mm.window_for(SPEECH, 152.46, onset_s=1.234) == (31.234, 91.234)


def test_speech_window_is_capped_at_clip_end():
    assert mm.window_for(SPEECH, 100.0, onset_s=12.5) == (42.5, 100.0)


def test_speech_window_rounds_to_milliseconds():
    offset, end = mm.window_for(SPEECH, 200.0, onset_s=0.1 + 0.2)   # 0.30000000000000004
    assert (offset, end) == (30.3, 90.3)


@pytest.mark.parametrize(("rule", "duration", "onset"), [
    (SPEECH, 100.0, None),         # no speech found
    (SPEECH, 40.0, 10.0),          # onset + 30 s is past the end
    (SPEECH, 40.0, 15.0),
    ("first_minute", 100.0, 0.0),  # unknown rule
    ("full_clip", 0.0, None),      # empty clip
])
def test_window_refuses_impossible_cases(rule, duration, onset):
    with pytest.raises(mm.MaskingError):
        mm.window_for(rule, duration, onset)


# ---------------------------------------------------------------- manifest writer + order

def test_manifest_row_has_template_columns_and_onset_note():
    row = mm.manifest_row({**ROW, "window_rule": SPEECH}, 31.234, 91.234, 60.021, 1.234)
    assert list(row) == mm.TEMPLATE_COLUMNS
    assert row["source_clip_id"] == "EXAMPLE_CLIP_001"
    assert row["source_media_path"] == "example/EXAMPLE_CLIP_001.mp4"
    assert (row["source_offset_s"], row["source_end_s"], row["masked_media_duration_s"]) == \
        ("31.234", "91.234", "60.021")
    assert row["is_team_member"] == "false"
    assert row["selection_reason"] == "invented observation"
    assert "speech_onset_s=1.234" in row["custodian_note"]
    assert "expected_difficulty=easy" in row["custodian_note"]


def test_manifest_row_without_onset_has_no_onset_note():
    row = mm.manifest_row(ROW, 0.0, 5.0, 5.0, None)
    assert "speech_onset_s" not in row["custodian_note"]


def test_template_columns_match_repository_template():
    template = pd.read_csv(mm.REPO / "research" / "manifests" / "pilot_manifest_TEMPLATE.csv", comment="#")
    assert list(template.columns) == mm.TEMPLATE_COLUMNS


def test_write_csv_round_trips_with_comment_header(tmp_path):
    rows = [mm.manifest_row(ROW, 0.0, 5.0, 5.0, None),
            mm.manifest_row({**ROW, "blind_id": "ZZ00-02", "audit_observation_for_selection": "a, b; c"},
                            31.0, 91.0, 60.0, 1.0)]
    path = tmp_path / "manifest.csv"
    mm.write_csv(path, ["doc: invented | decisions: D-067", "second line"], mm.TEMPLATE_COLUMNS, rows)
    text = path.read_text(encoding="utf-8")
    assert text.startswith("# doc: invented | decisions: D-067\n# second line\nblind_id,")
    back = pd.read_csv(path, comment="#", dtype=str)
    assert list(back.columns) == mm.TEMPLATE_COLUMNS
    assert back["selection_reason"].tolist() == ["invented observation", "a, b; c"]
    assert back["source_offset_s"].tolist() == ["0.000", "31.000"]


def test_annotator_orders_are_reproducible_shuffles():
    ids = [f"ZZ00-{i:02d}" for i in range(1, 16)]
    first = mm.annotator_orders(ids, seed=7)
    assert first == mm.annotator_orders(list(reversed(ids)), seed=7)   # input order does not matter
    assert first != mm.annotator_orders(ids, seed=8)
    per = {a: [r["blind_id"] for r in first if r["annotator_id"] == a] for a in mm.ANNOTATORS}
    assert set(per) == {"A1", "A2", "A3"}
    for order in per.values():
        assert sorted(order) == ids
    assert len({tuple(o) for o in per.values()}) == 3                  # each annotator gets their own order
    assert [r["position"] for r in first if r["annotator_id"] == "A1"] == list(range(1, 16))


def test_headers_record_seed_and_custodian_warning():
    head = mm.manifest_header("2026-11-22", "invented.csv", 7, {"threshold": 0.5})
    assert any("seed 7" in line for line in head)
    assert any("must NOT be given to annotators" in line for line in head)
    assert any("comment=" in line for line in head)
    assert any("seed: 7" in line for line in mm.order_header("2026-11-22", 7))


# ---------------------------------------------------------------- real cut (lavfi)

def make_clip(path, seconds=5.0, title="EXAMPLE_CLIP_001_S99"):
    subprocess.run([mm._tool("ffmpeg"), "-y", "-v", "error",
                    "-f", "lavfi", "-i", f"testsrc=duration={seconds}:size=320x240:rate=30",
                    "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
                    "-metadata", f"title={title}", "-metadata", "comment=scenario S99",
                    str(path)], check=True, capture_output=True)


def probe(path):
    out = subprocess.run([mm._tool("ffprobe"), "-v", "error", "-show_format", "-show_streams", "-of", "json",
                          str(path)], check=True, capture_output=True, text=True).stdout
    return json.loads(out)


@needs_ffmpeg
def test_cut_is_exact_keeps_audio_and_strips_metadata(tmp_path):
    src = tmp_path / "EXAMPLE_CLIP_001_S99.mp4"
    make_clip(src)
    assert "EXAMPLE_CLIP_001_S99" in json.dumps(probe(src))          # the source does carry it
    dst = tmp_path / "masked" / "ZZ00-01.mp4"
    measured = mm.cut_masked(src, dst, 1.0, 3.5)
    assert abs(measured - 2.5) <= mm.DURATION_TOLERANCE_S
    info = probe(dst)
    assert {s["codec_type"] for s in info["streams"]} == {"video", "audio"}
    dump = json.dumps(info)
    assert "EXAMPLE_CLIP_001" not in dump and "S99" not in dump
    assert not {"title", "comment", "encoder"} & set(info["format"].get("tags", {}))
    assert not list(dst.parent.glob("*.part.mp4"))


@needs_ffmpeg
def test_process_writes_manifest_order_and_masked_files(tmp_path, monkeypatch):
    root, out = tmp_path / "sc02", tmp_path / "private"
    (root / "example").mkdir(parents=True)
    make_clip(root / "example" / "EXAMPLE_CLIP_001.mp4", seconds=4.0)
    make_clip(root / "example" / "EXAMPLE_CLIP_002.mp4", seconds=3.0)
    rows = [{**ROW, "clip_duration_s": "4.00"},
            {**ROW, "blind_id": "ZZ00-02", "clip_id": "EXAMPLE_CLIP_002",
             "mp4_path": "example/EXAMPLE_CLIP_002.mp4", "clip_duration_s": "3.00"}]
    manifest = tmp_path / "pilot_in.csv"
    mm.write_csv(manifest, ["invented input"], list(ROW), rows)
    monkeypatch.setattr(mm, "speech_onset", lambda *a, **k: pytest.fail("full_clip rows need no VAD"))

    mm.process(manifest, root, out, seed=7)

    v2 = pd.read_csv(out / "pilot_v2.csv", comment="#", dtype=str)
    assert list(v2.columns) == mm.TEMPLATE_COLUMNS
    assert v2["source_offset_s"].tolist() == ["0.000", "0.000"]
    for _, r in v2.iterrows():
        media = out / "masked" / f"{r['blind_id']}.mp4"
        assert float(r["masked_media_duration_s"]) == mm.probe_duration(media)
        assert abs(float(r["masked_media_duration_s"]) - float(r["source_end_s"])) <= mm.DURATION_TOLERANCE_S
    order = pd.read_csv(out / "pilot_v2_annotator_order.csv", comment="#", dtype=str)
    assert list(order.columns) == mm.ORDER_COLUMNS and len(order) == 6
    assert "seed: 7" in (out / "pilot_v2_annotator_order.csv").read_text(encoding="utf-8")


def test_process_refuses_output_inside_dataset(tmp_path):
    manifest = tmp_path / "pilot_in.csv"
    mm.write_csv(manifest, ["invented input"], list(ROW), [ROW])
    with pytest.raises(mm.MaskingError):
        mm.process(manifest, tmp_path, tmp_path / "masked_here", seed=7)
