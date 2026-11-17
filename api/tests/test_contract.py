import copy
import json
from pathlib import Path

import jsonschema
import pytest
from pydantic import ValidationError

from app.contract import ALL_CODES, Result

REPO = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((REPO / "contracts" / "result.schema.json").read_text(encoding="utf-8"))
MOCKS = sorted((REPO / "contracts" / "mocks").glob("*.json"))
VALIDATOR = jsonschema.Draft202012Validator(SCHEMA, format_checker=jsonschema.FormatChecker())


def load(name: str) -> dict:
    return json.loads((REPO / "contracts" / "mocks" / name).read_text(encoding="utf-8"))


def test_three_mocks_exist():
    assert {m.name for m in MOCKS} == {"result_ok.json", "result_partial_unanalyzable.json", "result_failed.json"}


@pytest.mark.parametrize("path", MOCKS, ids=lambda p: p.name)
def test_mock_valid_in_schema_and_pydantic(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    VALIDATOR.validate(data)
    Result.model_validate(data)


def _crit(d, code):
    return next(c for c in d["criteria"] if c["code"] == code)


def bad_level_on_unanalyzable(d):
    _crit(d, "N1")["level"] = 2


def bad_missing_reason(d):
    _crit(d, "N1")["reason"] = None


def bad_ok_without_level(d):
    _crit(d, "S1")["level"] = None


def bad_level_out_of_range(d):
    _crit(d, "S1")["level"] = 5


def bad_wrong_skill(d):
    _crit(d, "S1")["skill"] = "body"


def bad_missing_criterion(d):
    d["criteria"] = [c for c in d["criteria"] if c["code"] != "T1"]


def bad_error_on_done(d):
    d["error"] = "oops"


def bad_old_v2_code(d):
    _crit(d, "N1")["code"] = "B2"


def bad_n_code_wrong_skill(d):
    _crit(d, "N2")["skill"] = "speech"


def bad_extra_field(d):
    d["total_score"] = 87


def bad_unknown_coverage(d):
    d["topics"] = [{"id": "t1", "title": "x", "order": 1, "coverage": "partial", "first_mention_s": None, "evidence_quote": None}]


def bad_coach_focus_without_time(d):
    d["coach"] = {"status": "ok", "hidden_count": 0,
                  "items": [{"kind": "focus", "code": "S2", "text": "หยุดนาน", "cite_s": []}]}


def bad_coach_strength_without_code(d):
    d["coach"] = {"status": "ok", "hidden_count": 0,
                  "items": [{"kind": "strength", "code": None, "text": "ดี", "cite_s": []}]}


def bad_coach_item_without_kind(d):
    d["coach"] = {"status": "ok", "hidden_count": 0, "items": [{"code": "S2", "text": "หยุดนาน", "cite_s": [1.0]}]}


def bad_coach_score(d):
    d["coach"] = {"status": "ok", "hidden_count": 0, "total_score": 3, "items": []}


def bad_old_contract_version(d):
    d["contract_version"] = "1.0"


@pytest.mark.parametrize("mutate", [
    bad_level_on_unanalyzable, bad_missing_reason, bad_ok_without_level, bad_level_out_of_range,
    bad_wrong_skill, bad_missing_criterion, bad_error_on_done, bad_extra_field, bad_unknown_coverage,
    bad_old_v2_code, bad_n_code_wrong_skill, bad_coach_focus_without_time, bad_coach_strength_without_code,
    bad_coach_item_without_kind, bad_coach_score, bad_old_contract_version,
])
def test_invalid_variants_rejected_by_both(mutate):
    d = copy.deepcopy(load("result_partial_unanalyzable.json"))
    mutate(d)
    assert not VALIDATOR.is_valid(d), "schema accepted invalid data"
    with pytest.raises(ValidationError):
        Result.model_validate(d)


def test_created_at_must_be_a_real_date_time():
    """Needs rfc3339-validator; without it FormatChecker silently skips date-time."""
    assert "date-time" in jsonschema.FormatChecker().checkers
    d = copy.deepcopy(load("result_ok.json"))
    d["created_at"] = "not a date"
    assert not VALIDATOR.is_valid(d)


def pydantic_only_duplicate_code(d):
    d["criteria"][1] = copy.deepcopy(d["criteria"][0])          # still 8 cards, one code twice


def pydantic_only_evidence_reversed(d):
    c = next(c for c in d["criteria"] if c["evidence"])
    c["evidence"][0]["start_s"], c["evidence"][0]["end_s"] = 10.0, 5.0


@pytest.mark.parametrize("mutate", [pydantic_only_duplicate_code, pydantic_only_evidence_reversed])
def test_rules_json_schema_cannot_express_are_caught_by_pydantic(mutate):
    """JSON Schema cannot say "8 different codes" or "end_s >= start_s"; worker/pipeline.validate() and the API
    run the Pydantic model too, so such a result is still rejected before it is saved or served."""
    d = copy.deepcopy(load("result_ok.json"))
    mutate(d)
    assert VALIDATOR.is_valid(d)                                 # documented asymmetry (contracts/README.md)
    with pytest.raises(ValidationError):
        Result.model_validate(d)


def test_failed_requires_error_and_no_criteria():
    d = load("result_failed.json")
    d1 = copy.deepcopy(d); d1["error"] = None
    d2 = copy.deepcopy(d); d2["criteria"] = load("result_ok.json")["criteria"]
    for bad in (d1, d2):
        assert not VALIDATOR.is_valid(bad)
        with pytest.raises(ValidationError):
            Result.model_validate(bad)


def test_feedback_ids_exist_in_config():
    import yaml
    fb = yaml.safe_load((REPO / "config" / "feedback-v0.yaml").read_text(encoding="utf-8"))["feedback"]
    for code in ALL_CODES:
        for lvl in range(1, 5):
            assert f"{code}_L{lvl}" in fb
    for path in MOCKS:
        for c in json.loads(path.read_text(encoding="utf-8"))["criteria"]:
            if c["feedback_id"]:
                assert c["feedback_id"] in fb


def test_eight_criteria_in_done_mocks():
    for name in ("result_ok.json", "result_partial_unanalyzable.json"):
        assert sorted(c["code"] for c in load(name)["criteria"]) == sorted(ALL_CODES)
    assert len(ALL_CODES) == 8
    assert "N3" not in ALL_CODES


def test_scored_values_config_matches_ok_mock():
    import yaml
    th = yaml.safe_load((REPO / "config" / "thresholds-v0.yaml").read_text(encoding="utf-8"))["criteria"]
    assert sorted(th) == sorted(ALL_CODES)
    ok = {c["code"]: c for c in load("result_ok.json")["criteria"]}
    for code, spec in th.items():
        assert spec["scored_values"], f"{code} has no scored_values"
        for key in spec["scored_values"]:
            assert key in ok[code]["values"], f"{code}.{key} missing from ok mock"
    # hand activity is supporting info only (D-028): never a scored value of N1
    assert "hands_active_pct" not in th["N1"]["scored_values"]


def test_stored_1_1_result_is_upgraded_on_read():
    """Results saved before D-046 (contract 1.1) still load: version renamed, old coach items become focus."""
    from app.contract import validate_result
    old = copy.deepcopy(load("result_ok.json"))
    old["contract_version"] = "1.1"
    old["coach"] = {"status": "ok", "hidden_count": 1, "items": [{"code": "S2", "text": "หยุดนาน", "cite_s": [183.2]}]}
    assert not VALIDATOR.is_valid(old)                       # the 1.2 schema alone rejects it
    upgraded = validate_result(old)
    assert upgraded.contract_version == "1.3" and upgraded.coach.items[0].kind == "focus"
    assert old["contract_version"] == "1.1"                  # the stored dict is not modified
    null_coach = copy.deepcopy(old) | {"coach": None}
    assert validate_result(null_coach).coach is None


def test_stored_1_2_result_is_upgraded_and_evidence_label_is_optional():
    from app.contract import CONTRACT_VERSION, validate_result
    old = load("result_ok.json")
    old["contract_version"] = "1.2"
    for c in old["criteria"]:
        for e in c["evidence"]:
            e.pop("label", None)                      # a 1.2 result never had labels
    kinds = [i["kind"] for i in (old["coach"] or {}).get("items", [])]
    new = validate_result(old)
    assert CONTRACT_VERSION == "1.3" and new.contract_version == "1.3"
    assert [i.kind for i in (new.coach.items if new.coach else [])] == kinds     # 1.2 kinds are kept
    labelled = validate_result(load("result_ok.json"))
    s3 = next(c for c in labelled.criteria if c.code == "S3")
    assert [e.label for e in s3.evidence] == ['เสียงเติม "เอ่อ"', 'คำติดปาก "แบบว่า"']
    bad = load("result_ok.json")
    _crit(bad, "S3")["evidence"][0]["label"] = 5
    with pytest.raises((jsonschema.ValidationError, ValidationError)):
        validate_result(bad)
