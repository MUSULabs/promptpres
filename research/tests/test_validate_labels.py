"""Tests for research/validate_labels.py, the semantic validator of LABEL_PROVENANCE_V1 section 6 (D-067).

Run from the repository root:  python -m pytest research/tests -q
Every record and manifest row here is invented; no real clip, speaker or label.
"""
import json

import pytest

from research import validate_labels as vl

MANIFEST = {
    "ZZ00-01": {"masked_media_duration_s": 20.0, "source_offset_s": 30.0, "source_end_s": 50.0},
    "ZZ00-02": {"masked_media_duration_s": 10.0, "source_offset_s": 0.0, "source_end_s": 10.0},
}
AI = {"proposal_model": "rule-proposer", "proposal_model_version": "0.1", "proposal_prompt_or_rule_version": "rules-v1"}


def gold(aid, start, end, label="GESTURE", reviewer="A1", layer="N1_function", blind="ZZ00-01", **kw):
    rec = {"annotation_id": aid, "blind_id": blind, "tier": "GOLD_MANUAL", "record_role": "independent", "layer": layer,
           "start_s": start, "end_s": end, "final_label": label, "label_source": "manual", "reviewer_id": reviewer,
           "manual_version": "ANNOTATION_MANUAL_N1_N2_V1.0", "created_at": "2026-11-22T10:00:00+07:00", "ambiguous": False}
    rec.update(kw)
    return rec


def consensus(aid, start, end, sources, label="GESTURE", basis="agreed", **kw):
    extra = {"adjudicator_id": "A3"} if basis == "adjudicated" else {}
    return gold(aid, start, end, label, reviewer="A3", record_role="consensus", consensus_basis=basis,
                source_annotation_ids=sources, **extra, **kw)


def reviewed(aid, start, end, proposed="GESTURE", final="GESTURE", action="accepted", reviewer="A1", **kw):
    return gold(aid, start, end, final, reviewer=reviewer, tier="SILVER_ASSISTED", record_role="reviewed",
                label_source="ai_assisted", proposed_label=proposed, review_action=action, **AI, **kw)


def audit(aid, start, end, label="GESTURE", reviewer="A2", **kw):
    return gold(aid, start, end, label, reviewer=reviewer, tier="SILVER_ASSISTED", record_role="audit", **kw)


def full_cover(prefix, reviewer, blind="ZZ00-01", layer="N1_function", label="GESTURE"):
    """Two adjacent spans covering the whole 20 s masked file of ZZ00-01."""
    return [gold(f"{prefix}-1", 0.0, 12.0, label, reviewer, layer, blind),
            gold(f"{prefix}-2", 12.0, 20.0, "REST_OR_HOLD" if layer == "N1_function" else "NOTES", reviewer, layer, blind)]


def rules(problems):
    return sorted({p.rule for p in problems})


# ---------------------------------------------------------------- clean data passes

def test_clean_pilot_set_passes():
    recs = full_cover("a1", "A1") + full_cover("a2", "A2") + [consensus("c-1", 2.0, 10.0, ["a1-1", "a2-1"])]
    assert vl.validate(recs, manifest=MANIFEST) == []


def test_without_manifest_only_record_and_cross_record_rules_run():
    assert vl.validate([gold("g1", 1.0, 2.0)]) == []


# ---------------------------------------------------------------- schema and ids

def test_schema_errors_are_reported():
    assert rules(vl.validate([gold("g1", 1.0, 2.0, label=None)])) == ["schema"]


def test_duplicate_annotation_id():
    assert "duplicate_id" in rules(vl.validate([gold("g1", 1.0, 2.0), gold("g1", 3.0, 4.0)]))


# ---------------------------------------------------------------- times (previously DELEGATED in the schema tests)

@pytest.mark.parametrize("start,end", [(12.0, 10.0), (12.0, 12.0)])
def test_end_not_after_start(start, end):
    assert rules(vl.validate([gold("g1", start, end)])) == ["time_order"]


def test_end_beyond_masked_media():
    probs = vl.validate([gold("g1", 0.0, 12.0), gold("g2", 12.0, 20.5)], manifest=MANIFEST)
    assert "beyond_media" in rules(probs)


def test_unknown_blind_id_with_manifest():
    assert "unknown_blind_id" in rules(vl.validate([gold("g1", 0.0, 5.0, blind="ZZ99-01")], manifest=MANIFEST))


def test_source_times_must_equal_offset_plus_masked_times():
    good = gold("g1", 0.0, 20.0, source_start_s=30.0, source_end_s=50.0)
    bad = gold("g1", 0.0, 20.0, source_start_s=30.0, source_end_s=51.0)
    assert vl.validate([good], manifest=MANIFEST) == []
    assert rules(vl.validate([bad], manifest=MANIFEST)) == ["source_time"]


def test_source_time_tolerance_is_one_millisecond():
    near = gold("g1", 0.0, 20.0, source_start_s=30.0004, source_end_s=50.0004)
    assert vl.validate([near], manifest=MANIFEST) == []


def test_source_times_beyond_manifest_source_end():
    # masked end inside the file but the manifest says the source window stops earlier
    manifest = {"ZZ00-01": dict(MANIFEST["ZZ00-01"], source_end_s=45.0)}
    rec = gold("g1", 0.0, 20.0, source_start_s=30.0, source_end_s=50.0)
    assert "beyond_source" in rules(vl.validate([rec], manifest=manifest))


def test_re_encoded_file_a_few_ms_longer_than_the_source_window_is_allowed():
    # full-clip copy: masked file 63.230 s, source clip ends at 63.221 s (re-encode adds 9 ms)
    manifest = {"ZZ00-02": {"masked_media_duration_s": 63.230, "source_offset_s": 0.0, "source_end_s": 63.221}}
    rec = gold("g1", 0.0, 63.23, blind="ZZ00-02", source_start_s=0.0, source_end_s=63.23)
    assert vl.validate([rec], manifest=manifest) == []


# ---------------------------------------------------------------- accepted proposals

def test_accepted_with_changed_label():
    rec = reviewed("s1", 1.0, 2.0, proposed="GESTURE", final="REST_OR_HOLD", action="accepted")
    assert rules(vl.validate([rec])) == ["accepted_changed"]


def test_accepted_with_changed_boundaries_when_proposals_given():
    rec = reviewed("s1", 1.0, 2.5)
    proposals = {"s1": {"start_s": 1.0, "end_s": 2.0, "proposed_label": "GESTURE"}}
    assert rules(vl.validate([rec], proposals=proposals)) == ["accepted_changed"]
    assert vl.validate([reviewed("s1", 1.0, 2.0)], proposals=proposals) == []


def test_modified_may_change_label():
    assert vl.validate([reviewed("s1", 1.0, 2.0, final="REST_OR_HOLD", action="modified")]) == []


# ---------------------------------------------------------------- consensus

def test_consensus_source_missing():
    recs = [gold("a1-1", 0.0, 5.0), consensus("c-1", 1.0, 4.0, ["a1-1", "nope"])]
    assert "consensus_source_missing" in rules(vl.validate(recs))


def test_consensus_source_not_independent():
    recs = [gold("a1-1", 0.0, 5.0), audit("s-1", 0.0, 5.0), consensus("c-1", 1.0, 4.0, ["a1-1", "s-1"])]
    assert "consensus_source_role" in rules(vl.validate(recs))


def test_consensus_sources_from_one_annotator():
    recs = [gold("a1-1", 0.0, 5.0), gold("a1-2", 5.0, 9.0), consensus("c-1", 4.0, 6.0, ["a1-1", "a1-2"], basis="adjudicated")]
    assert "consensus_annotators" in rules(vl.validate(recs))


def test_consensus_source_on_other_clip_or_layer():
    recs = [gold("a1-1", 0.0, 5.0), gold("a2-1", 0.0, 5.0, reviewer="A2", layer="N2_direction", label="NOTES"),
            consensus("c-1", 1.0, 4.0, ["a1-1", "a2-1"], basis="adjudicated")]
    assert "consensus_source_mismatch" in rules(vl.validate(recs))


def test_consensus_source_not_overlapping():
    recs = [gold("a1-1", 0.0, 5.0), gold("a2-1", 8.0, 10.0, reviewer="A2"),
            consensus("c-1", 1.0, 4.0, ["a1-1", "a2-1"], basis="adjudicated")]
    assert "consensus_overlap" in rules(vl.validate(recs))


def test_agreed_consensus_label_must_match_every_source():
    recs = [gold("a1-1", 0.0, 5.0), gold("a2-1", 0.0, 5.0, "REST_OR_HOLD", reviewer="A2"),
            consensus("c-1", 1.0, 4.0, ["a1-1", "a2-1"])]
    assert "agreed_label" in rules(vl.validate(recs))


def test_agreed_consensus_span_inside_source_overlap():
    recs = [gold("a1-1", 0.0, 5.0), gold("a2-1", 2.0, 6.0, reviewer="A2"), consensus("c-1", 1.0, 4.0, ["a1-1", "a2-1"])]
    assert rules(vl.validate(recs)) == ["agreed_span"]


def test_adjudicated_consensus_may_differ_from_sources():
    recs = [gold("a1-1", 0.0, 5.0), gold("a2-1", 0.0, 5.0, "REST_OR_HOLD", reviewer="A2"),
            consensus("c-1", 1.0, 4.0, ["a1-1", "a2-1"], label="REST_OR_HOLD", basis="adjudicated")]
    assert vl.validate(recs) == []


# ---------------------------------------------------------------- immutability of independent records

def test_hash_store_detects_edit_after_submission():
    rec = gold("g1", 1.0, 2.0)
    hashes = vl.record_hashes([rec], {})
    assert vl.validate([rec], hashes=hashes) == []
    edited = dict(rec, final_label="REST_OR_HOLD")
    assert rules(vl.validate([edited], hashes=hashes)) == ["edited_after_submit"]


def test_record_hashes_keeps_first_hash_and_skips_non_independent():
    rec = gold("g1", 1.0, 2.0)
    first = vl.record_hashes([rec], {})
    again = vl.record_hashes([dict(rec, final_label="REST_OR_HOLD"), audit("s1", 1.0, 2.0)], first)
    assert again == first


def test_record_hash_ignores_key_order():
    rec = gold("g1", 1.0, 2.0)
    assert vl.record_hash(rec) == vl.record_hash(dict(reversed(list(rec.items()))))


# ---------------------------------------------------------------- coverage (manual section 0)

def test_gap_between_primary_spans():
    recs = [gold("g1", 0.0, 10.0), gold("g2", 10.5, 20.0)]
    assert rules(vl.validate(recs, manifest=MANIFEST)) == ["coverage_gap"]


def test_overlap_between_primary_spans():
    recs = [gold("g1", 0.0, 11.0), gold("g2", 10.0, 20.0)]
    assert rules(vl.validate(recs, manifest=MANIFEST)) == ["coverage_overlap"]


def test_uncovered_start_or_end_of_masked_file():
    assert rules(vl.validate([gold("g1", 1.0, 20.0)], manifest=MANIFEST)) == ["coverage_gap"]
    assert rules(vl.validate([gold("g1", 0.0, 19.0)], manifest=MANIFEST)) == ["coverage_gap"]


def test_edges_allow_the_manual_resolution():
    # ELAN snaps to 0.1 s; a file of 20.04 s labelled to 20.0 s is complete
    manifest = {"ZZ00-01": dict(MANIFEST["ZZ00-01"], masked_media_duration_s=20.04)}
    assert vl.validate([gold("g1", 0.0, 20.0)], manifest=manifest) == []


def test_coverage_is_per_annotator_and_layer():
    recs = full_cover("a1", "A1") + full_cover("a2", "A2") + full_cover("n2", "A1", layer="N2_direction", label="CAMERA_REGION")
    assert vl.validate(recs, manifest=MANIFEST) == []


def test_flags_layer_may_overlap_and_leave_gaps():
    recs = full_cover("a1", "A1") + [gold("f1", 2.0, 4.0, None, layer="N1_flags", flags=["holding_notes"]),
                                     gold("f2", 3.0, 5.0, None, layer="N1_flags", flags=["repetitive"])]
    assert vl.validate(recs, manifest=MANIFEST) == []


def test_rejected_proposals_do_not_count_for_coverage():
    recs = [reviewed("s1", 0.0, 20.0), reviewed("s2", 5.0, 8.0, final=None, action="rejected")]
    assert vl.validate(recs, manifest=MANIFEST) == []


# ---------------------------------------------------------------- audit / reviewed pairs

def test_audit_with_a_reviewed_partner_by_another_person():
    recs = [reviewed("s1", 0.0, 20.0, reviewer="A1"), audit("q1", 0.0, 20.0, reviewer="A2")]
    assert vl.validate(recs, manifest=MANIFEST) == []
    assert vl.audit_pairs(recs) == [("q1", "s1")]


def test_audit_by_the_same_reviewer_is_not_a_pair():
    recs = [reviewed("s1", 0.0, 20.0, reviewer="A1"), audit("q1", 0.0, 20.0, reviewer="A1")]
    assert "audit_same_reviewer" in rules(vl.validate(recs, manifest=MANIFEST))
    assert vl.audit_pairs(recs) == []


def test_audit_without_any_reviewed_record():
    assert "audit_no_partner" in rules(vl.validate([audit("q1", 0.0, 20.0)], manifest=MANIFEST))


def test_audit_pair_needs_same_layer_and_overlap():
    recs = [reviewed("s1", 0.0, 5.0, reviewer="A1"), audit("q1", 10.0, 12.0, reviewer="A2"),
            reviewed("s2", 10.0, 12.0, reviewer="A1", layer="N2_direction", proposed="NOTES", final="NOTES")]
    assert "audit_no_partner" in rules(vl.validate(recs))


# ---------------------------------------------------------------- command line

def test_cli_exit_codes_and_hash_recording(tmp_path, capsys):
    labels = tmp_path / "labels.jsonl"
    labels.write_text("\n".join(json.dumps(r) for r in full_cover("a1", "A1")) + "\n", encoding="utf-8")
    manifest = tmp_path / "manifest.csv"
    manifest.write_text("# invented\nblind_id,source_offset_s,source_end_s,masked_media_duration_s\nZZ00-01,30.0,50.0,20.0\n",
                        encoding="utf-8")
    hashes = tmp_path / "hashes.json"
    assert vl.main([str(labels), "--manifest", str(manifest), "--hashes", str(hashes), "--record-hashes"]) == 0
    assert set(json.loads(hashes.read_text(encoding="utf-8"))) == {"a1-1", "a1-2"}

    bad = [dict(r, final_label="ADAPTOR_MANIPULATION") if r["annotation_id"] == "a1-1" else r for r in full_cover("a1", "A1")]
    labels.write_text("\n".join(json.dumps(r) for r in bad) + "\n", encoding="utf-8")
    assert vl.main([str(labels), "--manifest", str(manifest), "--hashes", str(hashes)]) == 1
    assert "edited_after_submit" in capsys.readouterr().out
