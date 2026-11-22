"""Semantic validator for N1/N2 label records (D-067, research/LABEL_PROVENANCE_V1.md section 6).

JSON Schema checks one record at a time. This file checks what the schema cannot: comparing fields and looking
across records. It must pass before any pilot label is accepted.

Usage (repository root):
    python -m research.validate_labels LABELS.jsonl [MORE.jsonl ...]
        [--manifest PRIVATE_MANIFEST.csv] [--hashes PRIVATE_HASHES.json [--record-hashes]] [--proposals PROPOSALS.jsonl]

Exit code 0 = no problems, 1 = problems printed one per line (annotation_id, rule, message).
`--record-hashes` stores the SHA-256 of every independent record not yet in the hash file, only when there are no
problems. After that, any edit to a stored independent record is reported as `edited_after_submit`.

Real labels, manifests and hash files are private research data outside git.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path

import jsonschema

SCHEMA_PATH = Path(__file__).resolve().parent / "schemas" / "n1_n2_labels_v1.schema.json"
TIME_TOL_S = 0.001      # source time = source_offset_s + masked time, LABEL_PROVENANCE_V1 section 6
EDGE_TOL_S = 0.1        # ELAN resolution in the manual (section 0): first/last span may miss the file edge by < 0.1 s
PRIMARY_LAYERS = ("N1_function", "N2_direction")
COVERAGE_ROLES = ("independent", "reviewed", "audit")   # one person's work on one clip; consensus records are partial


@dataclass(frozen=True)
class Problem:
    annotation_id: str
    rule: str
    message: str

    def __str__(self) -> str:
        return f"{self.annotation_id}\t{self.rule}\t{self.message}"


# ---------------------------------------------------------------- loading

def load_records(paths) -> list[dict]:
    records = []
    for path in paths:
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            if line.strip():
                records.append(json.loads(line))
    return records


def load_manifest(path) -> dict[str, dict]:
    """blind_id -> {masked_media_duration_s, source_offset_s, source_end_s} as floats. Lines starting with # are skipped."""
    lines = [ln for ln in Path(path).read_text(encoding="utf-8").splitlines() if ln.strip() and not ln.startswith("#")]
    manifest = {}
    for row in csv.DictReader(lines):
        manifest[row["blind_id"]] = {
            "masked_media_duration_s": float(row["masked_media_duration_s"]),
            "source_offset_s": float(row["source_offset_s"]),
            "source_end_s": float(row["source_end_s"]),
        }
    return manifest


def load_proposals(path) -> dict[str, dict]:
    """annotation_id -> {start_s, end_s, proposed_label} of the AI proposal before review."""
    return {r["annotation_id"]: r for r in load_records([path])}


# ---------------------------------------------------------------- hashes (independent records are immutable)

def record_hash(rec: dict) -> str:
    text = json.dumps(rec, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def record_hashes(records: list[dict], existing: dict[str, str]) -> dict[str, str]:
    """Add the hash of each independent record not stored yet; a stored hash is never replaced."""
    out = dict(existing)
    for rec in records:
        if rec.get("record_role") == "independent" and rec["annotation_id"] not in out:
            out[rec["annotation_id"]] = record_hash(rec)
    return out


# ---------------------------------------------------------------- checks

def overlaps(a: dict, b: dict) -> bool:
    return a["start_s"] < b["end_s"] and b["start_s"] < a["end_s"]


def check_times(rec: dict, manifest: dict | None) -> list[Problem]:
    aid, out = rec["annotation_id"], []
    if rec["end_s"] <= rec["start_s"]:
        out.append(Problem(aid, "time_order", f"end_s {rec['end_s']} must be greater than start_s {rec['start_s']}"))
    if manifest is None:
        return out
    clip = manifest.get(rec["blind_id"])
    if clip is None:
        out.append(Problem(aid, "unknown_blind_id", f"blind_id {rec['blind_id']} is not in the manifest"))
        return out
    if rec["end_s"] > clip["masked_media_duration_s"] + TIME_TOL_S:
        out.append(Problem(aid, "beyond_media",
                           f"end_s {rec['end_s']} is beyond the masked media duration {clip['masked_media_duration_s']}"))
    if rec.get("source_start_s") is not None:
        want_start = clip["source_offset_s"] + rec["start_s"]
        want_end = clip["source_offset_s"] + rec["end_s"]
        if abs(rec["source_start_s"] - want_start) > TIME_TOL_S or abs(rec["source_end_s"] - want_end) > TIME_TOL_S:
            out.append(Problem(aid, "source_time",
                               f"source times {rec['source_start_s']}-{rec['source_end_s']} should be {want_start:.3f}-{want_end:.3f}"))
        # re-encoding a masked file can make it a few ms longer than the source window, so the edge allowance is used
        if want_end > clip["source_end_s"] + EDGE_TOL_S:
            out.append(Problem(aid, "beyond_source",
                               f"source end {want_end:.3f} is beyond the manifest source_end_s {clip['source_end_s']}"))
    return out


def check_accepted(rec: dict, proposals: dict | None) -> list[Problem]:
    if rec.get("review_action") != "accepted":
        return []
    aid, out = rec["annotation_id"], []
    if rec["final_label"] != rec["proposed_label"]:
        out.append(Problem(aid, "accepted_changed",
                           f"accepted but final_label {rec['final_label']} differs from proposed_label {rec['proposed_label']}"))
    prop = (proposals or {}).get(aid)
    if prop is not None and (abs(prop["start_s"] - rec["start_s"]) > TIME_TOL_S or abs(prop["end_s"] - rec["end_s"]) > TIME_TOL_S):
        out.append(Problem(aid, "accepted_changed",
                           f"accepted but boundaries {rec['start_s']}-{rec['end_s']} differ from the proposal {prop['start_s']}-{prop['end_s']}"))
    return out


def check_consensus(rec: dict, by_id: dict[str, dict]) -> list[Problem]:
    aid, out = rec["annotation_id"], []
    sources = []
    for sid in rec["source_annotation_ids"]:
        src = by_id.get(sid)
        if src is None:
            out.append(Problem(aid, "consensus_source_missing", f"source {sid} does not exist"))
            continue
        if src["record_role"] != "independent" or src["tier"] != "GOLD_MANUAL":
            out.append(Problem(aid, "consensus_source_role", f"source {sid} is {src['tier']} {src['record_role']}, not GOLD independent"))
            continue
        if src["blind_id"] != rec["blind_id"] or src["layer"] != rec["layer"]:
            out.append(Problem(aid, "consensus_source_mismatch", f"source {sid} is from another clip or layer"))
            continue
        if not overlaps(src, rec):
            out.append(Problem(aid, "consensus_overlap", f"source {sid} does not overlap the consensus span"))
        sources.append(src)
    if len({s["reviewer_id"] for s in sources}) < 2:
        out.append(Problem(aid, "consensus_annotators", "valid sources come from fewer than two different annotators"))
    if rec["consensus_basis"] == "agreed" and sources:
        if any(s["final_label"] != rec["final_label"] for s in sources):
            out.append(Problem(aid, "agreed_label", "agreed consensus label differs from a source label"))
        lo = max(s["start_s"] for s in sources)
        hi = min(s["end_s"] for s in sources)
        if rec["start_s"] < lo - TIME_TOL_S or rec["end_s"] > hi + TIME_TOL_S:
            out.append(Problem(aid, "agreed_span", f"agreed consensus span is not inside the source overlap {lo}-{hi}"))
    return out


def check_hash(rec: dict, hashes: dict[str, str] | None) -> list[Problem]:
    if not hashes or rec.get("record_role") != "independent" or rec["annotation_id"] not in hashes:
        return []
    if record_hash(rec) != hashes[rec["annotation_id"]]:
        return [Problem(rec["annotation_id"], "edited_after_submit", "independent record changed after it was submitted")]
    return []


def coverage_groups(records: list[dict]) -> dict[tuple, list[dict]]:
    """Primary-layer spans of one person's work on one clip: (tier, role, reviewer, blind_id, layer) -> spans."""
    groups: dict[tuple, list[dict]] = {}
    for rec in records:
        if rec["layer"] not in PRIMARY_LAYERS or rec["record_role"] not in COVERAGE_ROLES:
            continue
        if rec.get("review_action") == "rejected" or rec["end_s"] <= rec["start_s"]:
            continue
        key = (rec["tier"], rec["record_role"], rec["reviewer_id"], rec["blind_id"], rec["layer"])
        groups.setdefault(key, []).append(rec)
    return groups


def check_coverage(records: list[dict], manifest: dict | None) -> list[Problem]:
    """Manual section 0: inside one person's work on one clip and one primary layer, spans touch with no gap or overlap."""
    out = []
    for (_tier, _role, reviewer, blind, layer), spans in sorted(coverage_groups(records).items()):
        spans.sort(key=lambda r: (r["start_s"], r["end_s"]))
        where = f"{reviewer} {blind} {layer}"
        for prev, nxt in pairwise(spans):
            if nxt["start_s"] < prev["end_s"] - TIME_TOL_S:
                out.append(Problem(nxt["annotation_id"], "coverage_overlap",
                                   f"{where}: overlaps {prev['annotation_id']} ({nxt['start_s']} < {prev['end_s']})"))
            elif nxt["start_s"] > prev["end_s"] + TIME_TOL_S:
                out.append(Problem(nxt["annotation_id"], "coverage_gap",
                                   f"{where}: gap {prev['end_s']}-{nxt['start_s']} after {prev['annotation_id']}"))
        clip = (manifest or {}).get(blind)
        if clip is None:
            continue
        if spans[0]["start_s"] > EDGE_TOL_S:
            out.append(Problem(spans[0]["annotation_id"], "coverage_gap", f"{where}: 0-{spans[0]['start_s']} has no label"))
        last_end = max(r["end_s"] for r in spans)
        if last_end < clip["masked_media_duration_s"] - EDGE_TOL_S:
            out.append(Problem(spans[-1]["annotation_id"], "coverage_gap",
                               f"{where}: {last_end}-{clip['masked_media_duration_s']} has no label"))
    return out


def audit_pairs(records: list[dict]) -> list[tuple[str, str]]:
    """(audit id, reviewed id) pairs that may be compared: same blind_id and layer, overlapping time, different reviewer."""
    reviewed = [r for r in records if r.get("record_role") == "reviewed" and r.get("review_action") != "rejected"]
    pairs = []
    for a in records:
        if a.get("record_role") != "audit":
            continue
        for r in reviewed:
            if (r["blind_id"], r["layer"]) == (a["blind_id"], a["layer"]) and overlaps(a, r) and r["reviewer_id"] != a["reviewer_id"]:
                pairs.append((a["annotation_id"], r["annotation_id"]))
    return pairs


def check_audits(records: list[dict]) -> list[Problem]:
    paired = {a for a, _ in audit_pairs(records)}
    reviewed = [r for r in records if r.get("record_role") == "reviewed" and r.get("review_action") != "rejected"]
    out = []
    for a in records:
        if a.get("record_role") != "audit" or a["annotation_id"] in paired:
            continue
        same_place = [r for r in reviewed if (r["blind_id"], r["layer"]) == (a["blind_id"], a["layer"]) and overlaps(a, r)]
        if same_place:
            out.append(Problem(a["annotation_id"], "audit_same_reviewer",
                               "the only overlapping reviewed records are by the same reviewer, so it is not a blind re-label"))
        else:
            out.append(Problem(a["annotation_id"], "audit_no_partner", "no overlapping reviewed record on the same clip and layer"))
    return out


# ---------------------------------------------------------------- all rules

def validate(records: list[dict], manifest: dict | None = None, hashes: dict | None = None,
             proposals: dict | None = None) -> list[Problem]:
    validator = jsonschema.Draft202012Validator(json.loads(SCHEMA_PATH.read_text(encoding="utf-8")),
                                                format_checker=jsonschema.FormatChecker())
    problems, ok, by_id = [], [], {}
    for rec in records:
        aid = str(rec.get("annotation_id", "?"))
        errors = [e.message for e in validator.iter_errors(rec)]
        if errors:
            problems.append(Problem(aid, "schema", "; ".join(errors)))
            continue                                   # later rules need a well-formed record
        if aid in by_id:
            problems.append(Problem(aid, "duplicate_id", "annotation_id is used more than once"))
            continue
        by_id[aid] = rec
        ok.append(rec)

    for rec in ok:
        problems += check_times(rec, manifest)
        problems += check_accepted(rec, proposals)
        problems += check_hash(rec, hashes)
        if rec["record_role"] == "consensus":
            problems += check_consensus(rec, by_id)
    problems += check_coverage(ok, manifest)
    problems += check_audits(ok)
    return problems


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Semantic validator for N1/N2 label records (D-067).")
    ap.add_argument("labels", nargs="+", help="JSONL files, one record per line")
    ap.add_argument("--manifest", help="private manifest CSV with blind_id, source_offset_s, source_end_s, masked_media_duration_s")
    ap.add_argument("--hashes", help="private JSON file of submitted independent-record hashes")
    ap.add_argument("--record-hashes", action="store_true", help="store hashes of new independent records when all checks pass")
    ap.add_argument("--proposals", help="JSONL of AI proposals (annotation_id, start_s, end_s) to check accepted boundaries")
    args = ap.parse_args(argv)

    records = load_records(args.labels)
    manifest = load_manifest(args.manifest) if args.manifest else None
    hash_path = Path(args.hashes) if args.hashes else None
    hashes = json.loads(hash_path.read_text(encoding="utf-8")) if hash_path and hash_path.exists() else {}
    proposals = load_proposals(args.proposals) if args.proposals else None

    problems = validate(records, manifest, hashes, proposals)
    for p in problems:
        print(p)
    if problems:
        print(f"{len(problems)} problem(s) in {len(records)} record(s)")
        return 1
    if args.record_hashes:
        if hash_path is None:
            ap.error("--record-hashes needs --hashes")
        new = record_hashes(records, hashes)
        hash_path.write_text(json.dumps(new, indent=1, sort_keys=True), encoding="utf-8")
        print(f"stored {len(new) - len(hashes)} new independent-record hash(es)")
    print(f"OK: {len(records)} record(s), no problems")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
