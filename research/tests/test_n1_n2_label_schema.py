"""Schema test matrix for research/schemas/n1_n2_labels_v1.schema.json (D-067, target design).

Run from the repository root:  python -m pytest research/tests -q
Needs jsonschema (+ rfc3339-validator for date-time), already in api/requirements.txt.
Records here are invented examples; no real clip, speaker or label.
"""
import json
from pathlib import Path

import jsonschema
import pytest

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schemas" / "n1_n2_labels_v1.schema.json"
SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
VALIDATOR = jsonschema.Draft202012Validator(SCHEMA, format_checker=jsonschema.FormatChecker())

BASE = dict(
    annotation_id="T1", blind_id="ZZ00-01", tier="GOLD_MANUAL", record_role="independent",
    layer="N1_function", start_s=10.0, end_s=12.5, final_label="GESTURE", label_source="manual",
    reviewer_id="A1", manual_version="ANNOTATION_MANUAL_N1_N2_V1.0",
    created_at="2026-11-22T10:00:00+07:00", ambiguous=False,
)
AI = dict(proposal_model="rule-proposer", proposal_model_version="0.1", proposal_prompt_or_rule_version="rules-v1")
SILVER = dict(BASE, tier="SILVER_ASSISTED", record_role="reviewed", label_source="ai_assisted", **AI)
AUDIT = dict(BASE, tier="SILVER_ASSISTED", record_role="audit", reviewer_id="A2")


def rec(**kw):
    return {**BASE, **kw}


def silver_manual(**kw):
    """SILVER reviewed record entered by hand (only valid as review_action = added)."""
    return {**BASE, "tier": "SILVER_ASSISTED", "record_role": "reviewed", **kw}


def audit(**kw):
    return {**AUDIT, **kw}


VALID = {
    "GOLD independent N1_function": rec(),
    "GOLD independent N2_direction NOTES": rec(layer="N2_direction", final_label="NOTES"),
    "GOLD N1_intensity": rec(layer="N1_intensity", final_label="MODERATE"),
    "GOLD N1_exploratory (manual)": rec(layer="N1_exploratory", final_label="UNCERTAIN"),
    "GOLD N1_flags record": rec(layer="N1_flags", final_label=None, flags=["holding_notes", "repetitive"]),
    "GOLD ambiguous span (top-level field)": rec(ambiguous=True),
    "GOLD with explicit null AI fields": rec(proposal_model=None, proposal_model_version=None,
                                             proposal_prompt_or_rule_version=None, proposed_label=None, review_action=None),
    "GOLD consensus, agreed": rec(record_role="consensus", reviewer_id="A3", consensus_basis="agreed",
                                  source_annotation_ids=["a1-001", "a2-001"]),
    "GOLD consensus, adjudicated": rec(record_role="consensus", reviewer_id="A3", consensus_basis="adjudicated",
                                       adjudicator_id="A3", source_annotation_ids=["a1-002", "a2-002"]),
    "custodian copy with source times": rec(clip_id="EXAMPLE_CLIP_000", source_start_s=40.0, source_end_s=42.5),
    "SILVER reviewed accepted": {**SILVER, "proposed_label": "GESTURE", "review_action": "accepted"},
    "SILVER reviewed modified": {**SILVER, "proposed_label": "GESTURE", "final_label": "REST_OR_HOLD",
                                 "review_action": "modified"},
    "SILVER reviewed rejected (final null)": {**SILVER, "proposed_label": "GESTURE", "final_label": None,
                                              "review_action": "rejected"},
    "SILVER reviewed added by reviewer (manual)": silver_manual(review_action="added", proposed_label=None),
    "SILVER reviewed N2 accepted": {**SILVER, "layer": "N2_direction", "final_label": "OTHER", "proposed_label": "OTHER",
                                    "review_action": "accepted"},
    "SILVER audit N1 (blind re-label, QA only)": audit(),
    "SILVER audit N2 with explicit null AI fields": audit(layer="N2_direction", final_label="NOTES", review_action=None,
                                                          proposal_model=None, proposal_model_version=None,
                                                          proposal_prompt_or_rule_version=None, proposed_label=None),
}

INVALID = {
    # Phase 1.2 review list (section 6)
    "R1 GOLD N1_function with final_label null": rec(final_label=None),
    "R2 flags on an N1_function record": rec(flags=["holding_notes"]),
    "R4 GOLD keeps proposal_model_version": rec(proposal_model_version="0.1"),
    "R5 AI-assisted N1_intensity": {**SILVER, "layer": "N1_intensity", "final_label": "LOW", "proposed_label": "LOW",
                                    "review_action": "accepted"},
    "R6 SILVER manual without review_action added": silver_manual(review_action="accepted", proposed_label="GESTURE"),
    "R6b SILVER manual with no review_action": silver_manual(),
    "R7 accepted with proposed_label null": {**SILVER, "proposed_label": None, "review_action": "accepted"},
    # earlier and additional cases
    "GOLD with label_source ai_assisted": rec(label_source="ai_assisted", proposed_label="GESTURE", review_action="accepted", **AI),
    "GOLD storing proposed_label": rec(proposed_label="GESTURE"),
    "GOLD storing review_action": rec(review_action="accepted"),
    "AI-proposed N1_exploratory": {**SILVER, "layer": "N1_exploratory", "final_label": "UNCERTAIN",
                                   "proposed_label": "UNCERTAIN", "review_action": "accepted"},
    "ai_assisted missing provenance": silver_manual(label_source="ai_assisted", proposed_label="GESTURE",
                                                    review_action="accepted"),
    "ai_assisted with review_action added": {**SILVER, "proposed_label": None, "review_action": "added"},
    "rejected with a final label": {**SILVER, "proposed_label": "GESTURE", "final_label": "GESTURE", "review_action": "rejected"},
    "added with a proposed label": silver_manual(review_action="added", proposed_label="GESTURE"),
    "added with final_label null": silver_manual(review_action="added", proposed_label=None, final_label=None),
    "proposed label from the wrong layer": {**SILVER, "proposed_label": "NOTES", "review_action": "modified"},
    "N1 label on N2 layer": rec(layer="N2_direction", final_label="GESTURE"),
    "N1_flags with a final label": rec(layer="N1_flags", final_label="GESTURE", flags=["repetitive"]),
    "N1_flags without flags": rec(layer="N1_flags", final_label=None),
    "ambiguous used as a flag": rec(layer="N1_flags", final_label=None, flags=["ambiguous"]),
    "N2_flags layer (removed)": rec(layer="N2_flags", final_label=None, flags=["repetitive"]),
    "ambiguous field missing": {k: v for k, v in BASE.items() if k != "ambiguous"},
    "consensus without source_annotation_ids": rec(record_role="consensus", consensus_basis="agreed"),
    "consensus with one source": rec(record_role="consensus", consensus_basis="agreed", source_annotation_ids=["a1-001"]),
    "adjudicated consensus without adjudicator": rec(record_role="consensus", consensus_basis="adjudicated",
                                                     source_annotation_ids=["a1-001", "a2-001"]),
    "SILVER consensus record": {**SILVER, "proposed_label": "GESTURE", "review_action": "accepted",
                                "record_role": "consensus", "consensus_basis": "agreed",
                                "source_annotation_ids": ["s-1", "s-2"]},
    "independent record carrying source ids": rec(source_annotation_ids=["a1-001", "a2-001"]),
    "record_role missing": {k: v for k, v in BASE.items() if k != "record_role"},
    "blind_id that looks like a clip id": rec(blind_id="G99_P99_S99_T99"),
    "reviewer_id is a name": rec(reviewer_id="Somchai"),
    "extra field (scenario)": rec(scenario="S01"),
    "negative start_s": rec(start_s=-0.1),
    "end_s equal to 0": rec(start_s=0.0, end_s=0.0),
    # Phase 1.2a: record roles per tier, audit records, agreed consensus, paired source times
    "SILVER ai_assisted with record_role independent": {**SILVER, "record_role": "independent", "proposed_label": "GESTURE",
                                                        "review_action": "accepted"},
    "SILVER added with record_role independent": silver_manual(record_role="independent", review_action="added",
                                                               proposed_label=None),
    "GOLD with record_role reviewed": rec(record_role="reviewed"),
    "GOLD with record_role audit": rec(record_role="audit"),
    "audit with review_action": audit(review_action="accepted"),
    "audit with AI provenance (proposal_model)": audit(proposal_model="rule-proposer"),
    "audit with proposed_label": audit(proposed_label="GESTURE"),
    "audit with final_label null": audit(final_label=None),
    "audit with label_source ai_assisted": audit(label_source="ai_assisted", **AI),
    "audit on N1_intensity": audit(layer="N1_intensity", final_label="LOW"),
    "agreed consensus with adjudicator_id": rec(record_role="consensus", reviewer_id="A3", consensus_basis="agreed",
                                                adjudicator_id="A3", source_annotation_ids=["a1-001", "a2-001"]),
    "source_start_s without source_end_s": rec(source_start_s=40.0),
    "source_end_s without source_start_s": rec(source_end_s=42.5),
    "source_start_s with source_end_s null": rec(source_start_s=40.0, source_end_s=None),
}

# Cross-field and cross-record rules cannot be expressed in JSON Schema; LABEL_PROVENANCE_V1 section 6 delegates them to the
# semantic validator that must exist before the first pilot labels are accepted.
DELEGATED = {
    "R3 end_s < start_s": rec(start_s=12.0, end_s=10.0),
    "R3 end_s == start_s": rec(start_s=12.0, end_s=12.0),
    "accepted but final_label differs from proposed_label": {**SILVER, "proposed_label": "GESTURE",
                                                             "final_label": "REST_OR_HOLD", "review_action": "accepted"},
    "source times not equal to source_offset_s + masked times": rec(source_start_s=40.0, source_end_s=43.0),
}


def test_schema_is_valid_draft_2020_12():
    assert SCHEMA["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    jsonschema.Draft202012Validator.check_schema(SCHEMA)


@pytest.mark.parametrize("name", sorted(VALID))
def test_valid_records_pass(name):
    errors = [e.message for e in VALIDATOR.iter_errors(VALID[name])]
    assert errors == [], errors


@pytest.mark.parametrize("name", sorted(INVALID))
def test_invalid_records_rejected(name):
    assert list(VALIDATOR.iter_errors(INVALID[name])), f"schema accepted: {name}"


@pytest.mark.parametrize("name", sorted(DELEGATED))
def test_delegated_rules_are_not_claimed_by_schema(name):
    # Documents honestly that the schema alone accepts these; the semantic validator must reject them.
    assert not list(VALIDATOR.iter_errors(DELEGATED[name]))
