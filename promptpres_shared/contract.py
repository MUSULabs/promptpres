"""Pydantic model of the Result Contract v1.3 (Spec v2.3, D-046 + D-050: 8 criteria in 4 skills, thesis codes).

1.2 = 1.1 + coach item `kind` (strength / focus / plan); results stored as 1.1 are upgraded on read
(`upgrade_result`). 1.3 = 1.2 + optional evidence `label` (S3: the sound or verbal tic that was found).
No total score or grade exists in any version.

Mirrors contracts/result.schema.json. Both must change together; tests/test_contract.py
checks that every mock passes both and that invalid variants fail both.
"""
from __future__ import annotations

from datetime import datetime
from functools import lru_cache
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

CONTRACT_VERSION = "1.3"

CriterionCode = Literal["C1", "C2", "S1", "S2", "S3", "N1", "N2", "T1"]
Skill = Literal["content", "speech", "body", "time"]
ALL_CODES: tuple[str, ...] = ("C1", "C2", "S1", "S2", "S3", "N1", "N2", "T1")
SKILL_OF: dict[str, str] = {"C": "content", "S": "speech", "N": "body", "T": "time"}


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Versions(_Strict):
    rubric: Optional[str]
    asr: Optional[str]
    llm: Optional[str]
    prompt: Optional[str]
    config: Optional[str]


class Evidence(_Strict):
    start_s: float = Field(ge=0)
    end_s: float = Field(ge=0)
    note: Optional[str]
    label: Optional[str] = None

    @model_validator(mode="after")
    def _ordered(self) -> "Evidence":
        if self.end_s < self.start_s:
            raise ValueError("end_s must be >= start_s")
        return self


class Criterion(_Strict):
    code: CriterionCode
    skill: Skill
    status: Literal["ok", "unanalyzable"]
    level: Optional[int] = Field(ge=1, le=4)
    values: dict[str, Optional[float]]
    evidence: list[Evidence]
    feedback_id: Optional[str]
    reason: Optional[str]

    @model_validator(mode="after")
    def _rules(self) -> "Criterion":
        if self.skill != SKILL_OF[self.code[0]]:
            raise ValueError(f"{self.code} must have skill {SKILL_OF[self.code[0]]}")
        if self.status == "ok":
            if self.level is None or not self.feedback_id:
                raise ValueError("status ok requires level 1-4 and feedback_id")
        else:
            if self.level is not None or self.feedback_id is not None:
                raise ValueError("unanalyzable must have level and feedback_id null")
            if not self.reason:
                raise ValueError("unanalyzable requires a reason")
        return self


class Topic(_Strict):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    order: int = Field(ge=1)
    coverage: Literal["clear", "brief", "not_mentioned"]
    first_mention_s: Optional[float] = Field(ge=0)
    evidence_quote: Optional[str]


class CoachItem(_Strict):
    kind: Literal["strength", "focus", "plan"]
    code: Optional[CriterionCode]
    text: str = Field(min_length=1)
    cite_s: list[float]

    @model_validator(mode="after")
    def _rules(self) -> "CoachItem":
        if any(t < 0 for t in self.cite_s):
            raise ValueError("cite_s must be >= 0")
        if self.kind in ("strength", "focus") and self.code is None:
            raise ValueError(f"{self.kind} item requires a criterion code")
        if self.kind == "focus" and not self.cite_s:
            raise ValueError("focus item must cite at least one evidence time")
        return self


class Coach(_Strict):
    status: Literal["ok", "skipped", "failed"]
    items: list[CoachItem]
    hidden_count: int = Field(ge=0)


class Result(_Strict):
    contract_version: Literal["1.3"]
    session_id: str = Field(min_length=1)
    status: Literal["queued", "processing", "done", "failed"]
    created_at: datetime
    duration_s: Optional[float] = Field(ge=0)
    target_duration_s: Optional[float] = Field(gt=0)
    video_url: Optional[str]
    versions: Versions
    criteria: list[Criterion]
    topics: list[Topic]
    coach: Optional[Coach]
    error: Optional[str]

    @model_validator(mode="after")
    def _rules(self) -> "Result":
        if self.status == "failed":
            if not self.error:
                raise ValueError("failed session requires error")
        elif self.error is not None:
            raise ValueError("error must be null unless status is failed")
        codes = [c.code for c in self.criteria]
        if self.status == "done":
            if sorted(codes) != sorted(ALL_CODES):
                raise ValueError("done session must contain each of the 8 criteria exactly once")
        elif codes:
            raise ValueError("criteria must be empty unless status is done")
        return self

@lru_cache(maxsize=1)
def _schema_validator():
    import json
    from pathlib import Path

    from jsonschema import Draft202012Validator

    schema = Path(__file__).resolve().parents[1] / "contracts" / "result.schema.json"
    return Draft202012Validator(json.loads(schema.read_text(encoding="utf-8")),
                                format_checker=Draft202012Validator.FORMAT_CHECKER)


def upgrade_result(data: dict) -> dict:
    """Return a copy of a stored result in the current contract version (1.1 / 1.2 -> 1.3).

    1.1 coach items had no `kind`; every one cited times, so they become `focus`.
    Real 1.1 results always carried coach = null (coach cut in D-040), so this only renames the version.
    1.3 only adds the optional evidence `label` (D-050), so 1.2 results need no change beyond the version.
    """
    if data.get("contract_version") not in {"1.1", "1.2"}:
        return data
    import copy

    out = copy.deepcopy(data)
    out["contract_version"] = CONTRACT_VERSION
    coach = out.get("coach")
    if isinstance(coach, dict):
        coach["items"] = [{"kind": "focus", **item} for item in coach.get("items", [])]
    return out


def validate_result(data: dict) -> Result:
    """Check a result against the JSON schema and the Pydantic model (older versions upgraded first)."""
    data = upgrade_result(data)
    _schema_validator().validate(data)
    return Result.model_validate(data)
