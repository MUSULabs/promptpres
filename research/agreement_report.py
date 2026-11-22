"""N1/N2 pilot agreement and class coverage report (D-067).

Rules: research/EXPERIMENT_PROTOCOL_V1.md §4.1 (pilot gate), §4.3 (spans to 0.5 s bins), §4.5 (class coverage),
research/LABEL_PROVENANCE_V1.md (only pre-adjudication GOLD `independent` records count for agreement).

Run from the repository root (labels and manifest are PRIVATE research data kept outside git):

    python -m research.agreement_report A1.jsonl A2.jsonl A3.jsonl --manifest PRIVATE/pilot_manifest.csv
    python -m research.agreement_report labels/*.jsonl --manifest m.csv --out data/research/agreement_pilot_2

Input
- JSONL: one record per span (research/schemas/n1_n2_labels_v1.schema.json). Only records with
  tier = GOLD_MANUAL, record_role = independent and layer N1_function / N2_direction are used; any other record is
  skipped and counted in the report. Run the semantic validator first: this script only re-checks what it needs
  (times inside the masked media, no overlapping spans of one rater, labels from the layer's class list).
- Manifest CSV (lines starting with # are comments): blind_id, masked_media_duration_s; optional participant_id
  (speaker for the coverage table), is_team_member (team speakers are counted apart from the primary pool) and
  layers ("N1;N2"; a clip is binned only for the layers it lists).

Bin rule (§4.3), one rater, one clip, one layer
- The masked media [0, masked_media_duration_s) is cut into bins [0.5k, 0.5(k+1)). A last partial bin shorter
  than 0.25 s is dropped; one of 0.25 s or longer is kept (and judged over its own, shorter length).
- Spans are half-open [start_s, end_s). A bin takes the label covering the largest share of the bin.
- Uncovered time (a gap in the rater's spans) competes like a label: if the gap covers the largest share, the bin
  is "uncovered" for that rater (no label). The manual forbids gaps, so this should be rare; counts are reported.
- Tie (equal largest share): the bin takes the label of whatever contains the bin's midpoint (a span, or the gap).
  If the midpoint's label is not one of the tied ones, the earliest-starting tied label wins. Ties are counted.
- A bin is ambiguous for a rater if any span that carries the assigned label and overlaps the bin has
  ambiguous = true.

Which bins each measure uses
- Fleiss κ, per-class Fleiss κ, "all raters agree" and mean pairwise agreement (Fleiss P̄): bins where every rater
  has a label (bins uncovered for any rater are left out and counted).
- Pairwise Cohen κ, percent agreement and confusion matrix: bins where both raters of the pair have a label.
- Primary results use all those bins. The sensitivity results also drop bins ambiguous for any rater in the
  comparison (all raters for Fleiss, the two raters for a pair).
- UNOBSERVABLE is an ordinary class in κ; its bin count per rater is reported.

Class coverage (§4.5), from spans, per class: seconds labelled by each rater and their mean, and the number of
distinct speakers with at least one span of the class by any rater / by a majority of raters. The 5-speaker gate
uses the majority count of primary-pool speakers. Without participant_id, each blind_id counts as one speaker
(an upper bound, said in the report).

Output (default under data/research/, which .gitignore keeps out of git): agreement_report.md,
agreement_summary.csv, agreement_confusion.csv, class_coverage.csv. Only counts and rater codes are written,
never participant ids.

Not covered here (protocol §4.1 also lists them): boundary agreement (onset within ±0.5 s / ±1.0 s) and the
pairwise quadratic-weighted κ for N1_intensity.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from collections import Counter, defaultdict
from itertools import combinations, pairwise
from pathlib import Path
from typing import NamedTuple

import numpy as np

from eval.stats import cohen_kappa, confusion

BIN_S = 0.5
MIN_LAST_BIN_S = 0.25
EPS = 1e-9                      # seconds; float tolerance when comparing covered time
GATE_PASS = 0.70                # §4.1: ≥ 0.70 pass · 0.60–0.69 revise manual · < 0.60 merge/simplify/drop
GATE_REVISE = 0.60
MIN_SPEAKERS = 5                # §4.5 pilot gate: < 5 speakers per class → merge or descriptive only
DEFAULT_OUT = Path("data/research/agreement_pilot")

# Class lists in schema order (research/tests checks they match the schema enums).
LAYERS = {
    "N1_function": ["GESTURE", "REST_OR_HOLD", "ADAPTOR_MANIPULATION", "UNOBSERVABLE"],
    "N2_direction": ["CAMERA_REGION", "NOTES", "OTHER", "UNOBSERVABLE"],
}
MANIFEST_LAYER = {"N1": "N1_function", "N2": "N2_direction"}
UNCOVERED = "-"                 # bin label when the rater's gap covers the largest share
NAN = float("nan")


class Span(NamedTuple):
    start: float
    end: float
    label: str
    ambiguous: bool


class Clip(NamedTuple):
    duration: float
    speaker: str
    team: bool
    layers: tuple[str, ...]


# ---------------------------------------------------------------- reading

def read_manifest(path) -> tuple[dict[str, Clip], bool]:
    """{blind_id: Clip} and whether participant_id was available for every clip."""
    with open(path, encoding="utf-8", newline="") as f:
        lines = [line for line in f if not line.lstrip().startswith("#")]
    rows = list(csv.DictReader(lines))
    if not rows:
        raise ValueError(f"{path}: manifest has no rows")
    for col in ("blind_id", "masked_media_duration_s"):
        if col not in rows[0]:
            raise ValueError(f"{path}: manifest needs column {col}")
    clips: dict[str, Clip] = {}
    have_speakers = True
    for row in rows:
        blind_id = row["blind_id"].strip()
        if blind_id in clips:
            raise ValueError(f"{path}: blind_id {blind_id} listed twice")
        duration = float(row["masked_media_duration_s"])
        if not duration > 0:
            raise ValueError(f"{path}: {blind_id} masked_media_duration_s must be > 0")
        speaker = (row.get("participant_id") or "").strip()
        if not speaker:
            have_speakers = False
            speaker = blind_id
        team = (row.get("is_team_member") or "").strip().lower() in ("true", "1", "yes")
        layer_codes = [code.strip() for code in (row.get("layers") or "").split(";") if code.strip()]
        unknown = [code for code in layer_codes if code not in MANIFEST_LAYER]
        if unknown:
            raise ValueError(f"{path}: {blind_id} has unknown layer code(s) {unknown}; use N1 / N2")
        layers = tuple(MANIFEST_LAYER[code] for code in layer_codes) if layer_codes else tuple(LAYERS)
        clips[blind_id] = Clip(duration, speaker, team, layers)
    return clips, have_speakers


def read_records(paths) -> tuple[list[dict], Counter]:
    """GOLD independent N1_function / N2_direction records, plus a count of every record skipped (by kind)."""
    kept: list[dict] = []
    skipped: Counter = Counter()
    for path in paths:
        with open(path, encoding="utf-8") as f:
            for line_no, line in enumerate(f, start=1):
                if not line.strip():
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError as err:
                    raise ValueError(f"{path}:{line_no}: not valid JSON ({err})") from err
                kind = (rec.get("tier"), rec.get("record_role"), rec.get("layer"))
                if kind[0] == "GOLD_MANUAL" and kind[1] == "independent" and kind[2] in LAYERS:
                    rec["_where"] = f"{Path(path).name}:{line_no}"
                    kept.append(rec)
                else:
                    skipped[" / ".join(str(k) for k in kind)] += 1
    return kept, skipped


def group_spans(records: list[dict], clips: dict[str, Clip], layer: str) -> tuple[list[str], dict]:
    """Raters of one layer (A1, A2, ... in number order) and {(blind_id, rater): [Span, ...] sorted by start}."""
    classes = LAYERS[layer]
    spans: dict[tuple[str, str], list[Span]] = defaultdict(list)
    for rec in records:
        if rec["layer"] != layer:
            continue
        where = rec.get("_where") or rec.get("annotation_id", "?")      # file:line when read from JSONL
        try:
            blind_id, rater, label = rec["blind_id"], rec["reviewer_id"], rec["final_label"]
            span = Span(float(rec["start_s"]), float(rec["end_s"]), label, bool(rec["ambiguous"]))
        except KeyError as err:
            raise ValueError(f"{where}: missing field {err}") from err
        if blind_id not in clips:
            raise ValueError(f"{where}: blind_id {blind_id} is not in the manifest")
        if layer not in clips[blind_id].layers:
            raise ValueError(f"{where}: {blind_id} is not assigned {layer} in the manifest")
        if label not in classes:
            raise ValueError(f"{where}: {label!r} is not a {layer} class")
        spans[(blind_id, rater)].append(span)
    for (blind_id, rater), items in spans.items():
        items.sort()
        check_spans(items, clips[blind_id].duration, f"{layer} {blind_id} {rater}")
    raters = sorted({rater for _, rater in spans}, key=lambda r: int(r[1:]))
    return raters, dict(spans)


def check_spans(spans: list[Span], duration: float, who: str) -> None:
    """Spans (sorted by start) must sit inside [0, duration] and must not overlap each other."""
    for s in spans:
        if not 0 <= s.start < s.end:
            raise ValueError(f"{who}: span {s.start}-{s.end} needs 0 <= start_s < end_s")
        if s.end > duration + EPS:
            raise ValueError(f"{who}: span ends at {s.end} s, after the masked media ({duration} s)")
    for prev, nxt in pairwise(spans):
        if nxt.start < prev.end - EPS:
            raise ValueError(f"{who}: spans {prev.start}-{prev.end} and {nxt.start}-{nxt.end} overlap")


# ---------------------------------------------------------------- spans → bins (§4.3)

def bin_edges(duration: float) -> list[tuple[float, float]]:
    """[(lo, hi), ...]: full 0.5 s bins, plus a last partial bin when it is at least 0.25 s long."""
    n_full = math.floor(duration / BIN_S + EPS)
    edges = [(k * BIN_S, (k + 1) * BIN_S) for k in range(n_full)]
    rest = duration - n_full * BIN_S
    if rest >= MIN_LAST_BIN_S - EPS:
        edges.append((n_full * BIN_S, duration))
    return edges


def assign_bin(spans: list[Span], lo: float, hi: float) -> tuple[str | None, bool, bool]:
    """(label or None if uncovered, ambiguous?, decided by the tie rule?) for one bin [lo, hi)."""
    cover: dict[str | None, float] = {}             # label → seconds of the bin it covers; None = gap
    for s in spans:
        overlap = min(hi, s.end) - max(lo, s.start)
        if overlap > EPS:
            cover[s.label] = cover.get(s.label, 0.0) + overlap
    gap = (hi - lo) - sum(cover.values())
    if gap > EPS:
        cover[None] = gap
    best = max(cover.values())
    tied = [label for label, seconds in cover.items() if best - seconds <= EPS]
    label = tied[0]                                 # spans are sorted, so this is the earliest-starting label
    if len(tied) > 1:
        mid = (lo + hi) / 2
        at_mid = next((s.label for s in spans if s.start <= mid < s.end), None)   # None: midpoint is in a gap
        if at_mid in tied:
            label = at_mid
    if label is None:
        return None, False, len(tied) > 1
    ambiguous = any(s.ambiguous for s in spans if s.label == label and min(hi, s.end) - max(lo, s.start) > EPS)
    return label, ambiguous, len(tied) > 1


class BinTable(NamedTuple):
    raters: list[str]
    labels: np.ndarray      # (bins, raters), object: class name or UNCOVERED
    ambiguous: np.ndarray   # (bins, raters), bool
    ties: int               # rater-bins decided by the tie rule
    clips: int


def bin_table(spans: dict, raters: list[str], clips: dict[str, Clip], layer: str) -> BinTable:
    """Every bin of every clip assigned this layer, one column per rater."""
    label_rows, amb_rows = [], []
    ties = n_clips = 0
    for blind_id, clip in clips.items():
        if layer not in clip.layers:
            continue
        n_clips += 1
        for lo, hi in bin_edges(clip.duration):
            labels, ambs = [], []
            for rater in raters:
                label, amb, tie = assign_bin(spans.get((blind_id, rater), []), lo, hi)
                labels.append(UNCOVERED if label is None else label)
                ambs.append(amb)
                ties += tie
            label_rows.append(labels)
            amb_rows.append(ambs)
    labels = np.empty((len(label_rows), len(raters)), dtype=object)
    for i, row in enumerate(label_rows):
        labels[i, :] = row
    ambiguous = np.array(amb_rows, dtype=bool).reshape(len(amb_rows), len(raters))
    return BinTable(raters, labels, ambiguous, ties, n_clips)


# ---------------------------------------------------------------- agreement

def rating_counts(labels: np.ndarray, classes: list[str]) -> np.ndarray:
    """(bins, classes) matrix: how many raters gave each class to each bin (rows must have no UNCOVERED)."""
    counts = np.zeros((labels.shape[0], len(classes)), dtype=int)
    for j, cls in enumerate(classes):
        counts[:, j] = (labels == cls).sum(axis=1)
    return counts


def fleiss_kappa(counts) -> float:
    """Fleiss' κ (Fleiss, 1971) from an (items, classes) count matrix, every item rated by the same m ≥ 2 raters.

    P_i  = (Σ_j n_ij² − m) / (m(m − 1))     share of agreeing rater pairs on item i
    P̄    = mean of P_i                      observed agreement
    p_j  = Σ_i n_ij / (N m)                 share of all ratings that are class j
    P̄e   = Σ_j p_j²                         agreement expected by chance
    κ    = (P̄ − P̄e) / (1 − P̄e)             NaN when P̄e = 1 (everyone used one class: no variation)
    """
    counts = np.asarray(counts, dtype=float)
    n_items = counts.shape[0]
    if n_items == 0:
        return NAN
    m = counts.sum(axis=1)
    if not np.all(m == m[0]) or m[0] < 2:
        raise ValueError("Fleiss κ needs the same number (≥ 2) of ratings on every item")
    m = m[0]
    p_bar = mean_pairwise_agreement(counts)
    p_j = counts.sum(axis=0) / (n_items * m)
    p_e = float((p_j ** 2).sum())
    if p_e >= 1 - EPS:
        return NAN
    return float((p_bar - p_e) / (1 - p_e))


def mean_pairwise_agreement(counts) -> float:
    """Fleiss P̄: share of agreeing rater pairs, averaged over items (raw percent agreement for m raters)."""
    counts = np.asarray(counts, dtype=float)
    if counts.shape[0] == 0:
        return NAN
    m = counts[0].sum()
    p_i = ((counts ** 2).sum(axis=1) - m) / (m * (m - 1))
    return float(p_i.mean())


def fleiss_kappa_per_class(counts) -> np.ndarray:
    """κ_j for each class j (Fleiss, 1971): agreement on "class j vs the rest".

    κ_j = 1 − Σ_i n_ij (m − n_ij) / (N m (m − 1) p_j (1 − p_j))      NaN when p_j is 0 or 1
    """
    counts = np.asarray(counts, dtype=float)
    n_items = counts.shape[0]
    out = np.full(counts.shape[1], NAN)
    if n_items == 0:
        return out
    m = counts[0].sum()
    p_j = counts.sum(axis=0) / (n_items * m)
    disagree = (counts * (m - counts)).sum(axis=0)
    denom = n_items * m * (m - 1) * p_j * (1 - p_j)
    ok = denom > EPS
    out[ok] = 1 - disagree[ok] / denom[ok]
    return out


def layer_agreement(table: BinTable, classes: list[str], drop_ambiguous: bool) -> dict:
    """Fleiss κ (all raters), per-class κ, raw agreement, and per pair Cohen κ, % agreement and confusion."""
    labels, amb = table.labels, table.ambiguous
    covered = labels != UNCOVERED
    rows = covered.all(axis=1)
    if drop_ambiguous:
        rows &= ~amb.any(axis=1)
    counts = rating_counts(labels[rows], classes)
    enough = len(table.raters) >= 2
    result = {
        "n_bins": int(rows.sum()) if enough else 0,
        "fleiss_kappa": fleiss_kappa(counts) if enough else NAN,
        "fleiss_kappa_class": fleiss_kappa_per_class(counts) if enough else np.full(len(classes), NAN),
        "mean_pairwise_agreement": mean_pairwise_agreement(counts) if enough else NAN,
        "all_agree": float((counts.max(axis=1) == len(table.raters)).mean()) if enough and rows.any() else NAN,
        "pairs": [],
    }
    for i, j in combinations(range(len(table.raters)), 2):
        keep = covered[:, i] & covered[:, j]
        if drop_ambiguous:
            keep &= ~(amb[:, i] | amb[:, j])
        a, b = list(labels[keep, i]), list(labels[keep, j])
        result["pairs"].append({
            "rater_a": table.raters[i],
            "rater_b": table.raters[j],
            "n_bins": int(keep.sum()),
            "cohen_kappa": cohen_kappa(a, b, classes),
            "percent_agreement": float(np.mean([x == y for x, y in zip(a, b)])) if a else NAN,
            "confusion": confusion(a, b, classes).astype(int),
        })
    return result


def gate_verdict(kappa: float) -> str:
    if math.isnan(kappa):
        return "undefined (no variation or no bins)"
    if kappa >= GATE_PASS:
        return "pass (≥ 0.70)"
    if kappa >= GATE_REVISE:
        return "revise manual, repeat pilot on new items (0.60–0.69)"
    return "merge / simplify / drop optional label (< 0.60)"


# ---------------------------------------------------------------- class coverage (§4.5)

def class_coverage(spans: dict, raters: list[str], clips: dict[str, Clip], classes: list[str]) -> list[dict]:
    """Per class: seconds per rater and their mean; distinct speakers with ≥ 1 span (any rater / majority)."""
    seconds = {cls: {r: 0.0 for r in raters} for cls in classes}
    raters_per_speaker: dict[str, dict[str, set]] = {cls: defaultdict(set) for cls in classes}
    for (blind_id, rater), items in spans.items():
        speaker = clips[blind_id].speaker
        for s in items:
            seconds[s.label][rater] += s.end - s.start
            raters_per_speaker[s.label][speaker].add(rater)
    team = {clip.speaker for clip in clips.values() if clip.team}
    majority = len(raters) // 2 + 1
    rows = []
    for cls in classes:
        by_speaker = raters_per_speaker[cls]
        primary = [sp for sp in by_speaker if sp not in team]
        primary_majority = sum(len(by_speaker[sp]) >= majority for sp in primary)
        row = {"class": cls}
        row.update({f"seconds_{r}": round(seconds[cls][r], 3) for r in raters})
        row["seconds_mean"] = round(float(np.mean(list(seconds[cls].values()))), 3) if raters else 0.0
        row["primary_speakers_any"] = len(primary)
        row["primary_speakers_majority"] = primary_majority
        row["team_speakers_any"] = sum(sp in team for sp in by_speaker)
        row["meets_5_speaker_gate"] = primary_majority >= MIN_SPEAKERS
        rows.append(row)
    return rows


# ---------------------------------------------------------------- whole report

def build_report(records: list[dict], clips: dict[str, Clip]) -> dict:
    """Everything the writers need, per layer."""
    layers = {}
    for layer, classes in LAYERS.items():
        raters, spans = group_spans(records, clips, layer)
        table = bin_table(spans, raters, clips, layer)
        layers[layer] = {
            "classes": classes,
            "table": table,
            "primary": layer_agreement(table, classes, drop_ambiguous=False),
            "sensitivity": layer_agreement(table, classes, drop_ambiguous=True),
            "coverage": class_coverage(spans, raters, clips, classes),
            "uncovered": {r: int((table.labels[:, k] == UNCOVERED).sum()) for k, r in enumerate(raters)},
            "ambiguous": {r: int(table.ambiguous[:, k].sum()) for k, r in enumerate(raters)},
            "unobservable": {r: int((table.labels[:, k] == "UNOBSERVABLE").sum()) for k, r in enumerate(raters)},
        }
    return layers


def fmt(x) -> str:
    if isinstance(x, (float, np.floating)):
        return "—" if math.isnan(x) else f"{x:.3f}"
    return str(x)


def pct(x: float) -> str:
    return "—" if math.isnan(x) else f"{100 * x:.1f}%"


def md_table(header: list[str], rows: list[list]) -> list[str]:
    out = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    out += ["| " + " | ".join(fmt(v) for v in row) + " |" for row in rows]
    return out


BIN_SETS = {"primary": "all_bins", "sensitivity": "ambiguous_excluded"}


def summary_rows(layers: dict) -> list[dict]:
    rows = []
    for layer, res in layers.items():
        for key, bin_set in BIN_SETS.items():
            agr = res[key]
            base = {"layer": layer, "bin_set": bin_set, "rater_a": "", "rater_b": "", "class": ""}
            for measure in ("fleiss_kappa", "mean_pairwise_agreement", "all_agree"):
                rows.append({**base, "measure": measure, "value": agr[measure], "n_bins": agr["n_bins"]})
            for cls, kappa in zip(res["classes"], agr["fleiss_kappa_class"]):
                rows.append({**base, "class": cls, "measure": "fleiss_kappa_class", "value": float(kappa),
                             "n_bins": agr["n_bins"]})
            for pair in agr["pairs"]:
                who = {"rater_a": pair["rater_a"], "rater_b": pair["rater_b"]}
                for measure in ("cohen_kappa", "percent_agreement"):
                    rows.append({**base, **who, "measure": measure, "value": pair[measure], "n_bins": pair["n_bins"]})
    return rows


def confusion_rows(layers: dict) -> list[dict]:
    rows = []
    for layer, res in layers.items():
        for key, bin_set in BIN_SETS.items():
            for pair in res[key]["pairs"]:
                for i, label_a in enumerate(res["classes"]):
                    for j, label_b in enumerate(res["classes"]):
                        rows.append({"layer": layer, "bin_set": bin_set, "rater_a": pair["rater_a"],
                                     "rater_b": pair["rater_b"], "label_a": label_a, "label_b": label_b,
                                     "bins": int(pair["confusion"][i, j])})
    return rows


def csv_value(v):
    if isinstance(v, float):
        return "" if math.isnan(v) else f"{v:.6f}"
    return v


def write_csv(path: Path, rows: list[dict]) -> None:
    fields: list[str] = []
    for row in rows:
        fields += [k for k in row if k not in fields]
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: csv_value(v) for k, v in row.items()})


def markdown(layers: dict, inputs: list[str], skipped: Counter, have_speakers: bool, n_clips: int) -> str:
    lines = [
        "# N1/N2 pilot agreement and class coverage",
        "",
        "Pilot κ is used only to refine the manual (EXPERIMENT_PROTOCOL_V1 §4.1); it is not the dataset's reliability.",
        "Items were chosen for codebook coverage, so κ is not a population estimate.",
        "",
        f"- Inputs: {', '.join(inputs)}; {n_clips} clips in the manifest.",
        (f"- Bins: {BIN_S} s over the masked media, majority-overlap label, midpoint tie rule, last partial bin "
         f"kept if ≥ {MIN_LAST_BIN_S} s (§4.3; full rule in research/agreement_report.py)."),
        "- Fleiss κ uses bins every rater labelled; each pair uses bins both raters labelled.",
        "- Sensitivity: the same, minus bins ambiguous for any rater in the comparison.",
    ]
    if skipped:
        lines.append("- Skipped records (not GOLD independent N1_function / N2_direction): "
                     + ", ".join(f"{kind}: {n}" for kind, n in sorted(skipped.items())))
    if not have_speakers:
        lines.append("- **No participant_id for every clip: each blind_id was counted as one speaker** "
                     "(speaker counts are an upper bound).")
    for layer, res in layers.items():
        table: BinTable = res["table"]
        prim, sens = res["primary"], res["sensitivity"]
        lines += ["", f"## {layer}", ""]
        if len(table.raters) != 3:
            lines += [(f"**Note: {len(table.raters)} raters found ({', '.join(table.raters) or 'none'}), "
                       "the pilot plans 3.**"), ""]
        lines += [(f"{table.clips} clips, {len(table.labels)} bins, raters {', '.join(table.raters)}; "
                   f"{table.ties} rater-bins decided by the tie rule."), ""]
        lines += md_table(["Rater", "Uncovered bins", "Ambiguous bins", "UNOBSERVABLE bins"],
                          [[r, res["uncovered"][r], res["ambiguous"][r], res["unobservable"][r]] for r in table.raters])
        lines += ["", "### Agreement", ""]
        lines += md_table(
            ["Measure", "All bins", "Ambiguous excluded"],
            [["Fleiss κ", prim["fleiss_kappa"], sens["fleiss_kappa"]],
             ["Pilot gate (Fleiss κ, all bins)", gate_verdict(prim["fleiss_kappa"]), ""],
             ["Mean pairwise agreement (Fleiss P̄)", pct(prim["mean_pairwise_agreement"]),
              pct(sens["mean_pairwise_agreement"])],
             ["All raters agree", pct(prim["all_agree"]), pct(sens["all_agree"])],
             ["Bins used", prim["n_bins"], sens["n_bins"]]])
        lines += ["", "Per-class Fleiss κ (class vs rest):", ""]
        lines += md_table(["Class", "All bins", "Ambiguous excluded"],
                          [[cls, float(a), float(b)] for cls, a, b in
                           zip(res["classes"], prim["fleiss_kappa_class"], sens["fleiss_kappa_class"])])
        lines += ["", "Pairwise:", ""]
        lines += md_table(["Pair", "Cohen κ", "% agreement", "Bins", "Cohen κ (amb. excl.)", "% (amb. excl.)",
                           "Bins (amb. excl.)"],
                          [[f"{p['rater_a']}–{p['rater_b']}", p["cohen_kappa"], pct(p["percent_agreement"]),
                            p["n_bins"], q["cohen_kappa"], pct(q["percent_agreement"]), q["n_bins"]]
                           for p, q in zip(prim["pairs"], sens["pairs"])])
        for pair in prim["pairs"]:
            lines += ["", f"Confusion {pair['rater_a']} (rows) × {pair['rater_b']} (columns), all bins:", ""]
            lines += md_table([f"{pair['rater_a']} \\ {pair['rater_b']}"] + res["classes"],
                              [[cls] + [int(v) for v in pair["confusion"][i]] for i, cls in enumerate(res["classes"])])
        lines += ["", "### Class coverage", "",
                  ("Seconds from each rater's spans. Speakers = distinct primary-pool speakers with ≥ 1 span of "
                   f"the class (by any rater / by a majority). Gate: ≥ {MIN_SPEAKERS} speakers by majority (§4.5)."),
                  ""]
        cov = res["coverage"]
        header = list(cov[0]) if cov else []
        lines += md_table(header, [[row[k] for k in header] for row in cov])
    return "\n".join(lines) + "\n"


def write_report(layers: dict, out_dir: Path, inputs: list[str], skipped: Counter, have_speakers: bool,
                 n_clips: int) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = [out_dir / name for name in
             ("agreement_report.md", "agreement_summary.csv", "agreement_confusion.csv", "class_coverage.csv")]
    paths[0].write_text(markdown(layers, inputs, skipped, have_speakers, n_clips), encoding="utf-8")
    write_csv(paths[1], summary_rows(layers))
    write_csv(paths[2], confusion_rows(layers))
    write_csv(paths[3], [{"layer": layer, **row} for layer, res in layers.items() for row in res["coverage"]])
    return paths


def main(argv=None) -> list[Path]:
    parser = argparse.ArgumentParser(description="N1/N2 pilot agreement (Fleiss/Cohen κ on 0.5 s bins) "
                                                 "and class coverage")
    parser.add_argument("labels", nargs="+", type=Path, help="JSONL files of GOLD independent records")
    parser.add_argument("--manifest", required=True, type=Path, help="private manifest CSV (blind_id, "
                        "masked_media_duration_s, optional participant_id, is_team_member, layers)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"output folder (default {DEFAULT_OUT})")
    args = parser.parse_args(argv)
    clips, have_speakers = read_manifest(args.manifest)
    records, skipped = read_records(args.labels)
    layers = build_report(records, clips)
    paths = write_report(layers, args.out, [p.name for p in args.labels], skipped, have_speakers, len(clips))
    for path in paths:
        print(path)
    return paths


if __name__ == "__main__":
    main()
