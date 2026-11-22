"""Tests for research/elan_to_records.py: the ELAN template and the .eaf -> record converter (D-067).

The fixture A1_ZZ00-01.eaf is invented (no real clip, speaker or label).
"""
import json
import shutil
from pathlib import Path

import pytest

from research import elan_to_records as el
from research import validate_labels as vl

HERE = Path(__file__).resolve().parent
FIXTURE = HERE / "fixtures" / "A1_ZZ00-01.eaf"
TEMPLATE = HERE.parent / "elan" / "n1_n2_template_v1.etf"
SCHEMA = json.loads((HERE.parent / "schemas" / "n1_n2_labels_v1.schema.json").read_text(encoding="utf-8"))
MANIFEST = {"ZZ00-01": {"masked_media_duration_s": 20.0, "source_offset_s": 30.0, "source_end_s": 50.0}}


def schema_enum(layer):
    for rule in SCHEMA["allOf"]:
        if rule.get("if", {}).get("properties", {}).get("layer", {}).get("const") == layer:
            return [v for v in rule["then"]["properties"]["final_label"]["enum"] if v is not None]
    raise KeyError(layer)


def test_template_labels_match_the_schema():
    for layer, values in el.LABEL_TIERS.items():
        assert values == schema_enum(layer), layer
    assert el.FLAGS == SCHEMA["properties"]["flags"]["items"]["enum"]


def test_committed_template_is_the_generated_one():
    assert TEMPLATE.read_text(encoding="utf-8") == el.build_template()


def test_fixture_converts_to_valid_records():
    recs = el.eaf_to_records(FIXTURE)
    assert vl.validate(recs, manifest=MANIFEST) == []
    by_layer = {}
    for r in recs:
        by_layer.setdefault(r["layer"], []).append(r)
    n1 = by_layer["N1_function"]
    assert [(r["start_s"], r["end_s"], r["final_label"]) for r in n1] == [
        (0.0, 7.4, "GESTURE"), (7.4, 12.0, "REST_OR_HOLD"), (12.0, 20.0, "ADAPTOR_MANIPULATION")]
    assert [r["ambiguous"] for r in n1] == [False, True, False]
    assert n1[0]["confidence"] == 3 and n1[2]["evidence_note"] == "turns the pen"
    assert all(r["reviewer_id"] == "A1" and r["blind_id"] == "ZZ00-01" for r in recs)
    assert all(r["tier"] == "GOLD_MANUAL" and r["record_role"] == "independent" for r in recs)
    assert n1[0]["annotation_id"] == "ZZ00-01-A1-a1"
    assert n1[0]["created_at"] == "2026-11-23T09:30:00+07:00"


def test_flags_on_the_same_span_become_one_record():
    flags = [r for r in el.eaf_to_records(FIXTURE) if r["layer"] == "N1_flags"]
    assert len(flags) == 1
    assert flags[0]["flags"] == ["holding_notes", "repetitive"] and flags[0]["final_label"] is None


def test_file_name_must_carry_annotator_and_blind_id(tmp_path):
    bad = tmp_path / "ZZ00-01.eaf"
    shutil.copy(FIXTURE, bad)
    with pytest.raises(ValueError, match="file name"):
        el.eaf_to_records(bad)


def test_linked_media_must_be_the_same_blind_id(tmp_path):
    other = tmp_path / "A1_ZZ00-02.eaf"
    shutil.copy(FIXTURE, other)
    with pytest.raises(ValueError, match="linked media"):
        el.eaf_to_records(other)


def test_unknown_tier_is_refused(tmp_path):
    p = tmp_path / "A1_ZZ00-01.eaf"
    p.write_text(FIXTURE.read_text(encoding="utf-8").replace('TIER_ID="N2_direction"', 'TIER_ID="N2_flags"'), encoding="utf-8")
    with pytest.raises(ValueError, match="N2_flags"):
        el.eaf_to_records(p)


def test_end_to_end_cli_passes_then_catches_a_gap(tmp_path, capsys):
    manifest = tmp_path / "manifest.csv"
    manifest.write_text("blind_id,source_offset_s,source_end_s,masked_media_duration_s\nZZ00-01,30.0,50.0,20.0\n", encoding="utf-8")
    eaf = tmp_path / "A1_ZZ00-01.eaf"
    shutil.copy(FIXTURE, eaf)
    out = tmp_path / "labels.jsonl"
    assert el.main([str(eaf), "-o", str(out), "--manifest", str(manifest)]) == 0
    assert len(out.read_text(encoding="utf-8").splitlines()) == 7

    # move the start of the second N1 span from 7.4 s to 7.9 s: a 0.5 s gap the annotator left unlabelled
    text = FIXTURE.read_text(encoding="utf-8").replace(
        'ANNOTATION_ID="a2" TIME_SLOT_REF1="ts2"', 'ANNOTATION_ID="a2" TIME_SLOT_REF1="tsX"').replace(
        '<TIME_SLOT TIME_SLOT_ID="ts13" TIME_VALUE="19000"/>',
        '<TIME_SLOT TIME_SLOT_ID="ts13" TIME_VALUE="19000"/>\n        <TIME_SLOT TIME_SLOT_ID="tsX" TIME_VALUE="7900"/>')
    eaf.write_text(text, encoding="utf-8")
    assert el.main([str(eaf), "-o", str(out), "--manifest", str(manifest)]) == 1
    assert "coverage_gap" in capsys.readouterr().out


def test_write_template_cli(tmp_path):
    out = tmp_path / "t.etf"
    assert el.main(["--write-template", str(out)]) == 0
    assert out.read_text(encoding="utf-8") == el.build_template()
