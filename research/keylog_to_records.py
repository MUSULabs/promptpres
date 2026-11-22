"""Key-press labeller file -> N1/N2 label records (D-069, replaces ELAN as the main labelling tool).

The offline page research/labeler/index.html plays one masked clip. The annotator presses 1-4 when the
behaviour changes, one layer at a time. The page saves `<annotator code>_<blind_id>.json`:

    {"format": "promptpres-keylog-v1", "annotator_id": "A2", "blind_id": "PV01-07",
     "media_duration_s": 60.0, "manual_version": "...", "created_at": "...", "work_seconds": 900,
     "layers": {"N1_function":  [{"t": 0.0, "label": "REST_OR_HOLD", "ambiguous": false}, ...],
                "N2_direction": [{"t": 0.0, "label": "NOTES", "ambiguous": false}, ...]},
     "holding_notes": [[12.3, 20.1], ...]}

Each layer is a list of change points: a label lasts from its `t` to the next change point (or the end of the
clip). This file turns change points into the same GOLD independent records as elan_to_records.py:

1. the first change point must be at 0 (within EDGE_TOL_S);
2. neighbouring spans with the same label are joined;
3. spans shorter than the manual minimum (N1 0.5 s, N2 0.3 s; manual section 0) are merged into the longer
   neighbour, shortest first;
4. the last span ends at the masked media duration (from the private manifest when given).

Usage (repository root):
    python -m research.keylog_to_records A2_PV01-07.json [...] -o labels.jsonl [--manifest PRIVATE.csv]
        [--times TIMES.csv]
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from research.elan_to_records import DEFAULT_MANUAL, FILE_NAME

FORMAT = "promptpres-keylog-v1"
LABELS = {
    "N1_function": ["GESTURE", "REST_OR_HOLD", "ADAPTOR_MANIPULATION", "UNOBSERVABLE"],
    "N2_direction": ["CAMERA_REGION", "NOTES", "OTHER", "UNOBSERVABLE"],
}
MIN_SPAN_S = {"N1_function": 0.5, "N2_direction": 0.3}
FLAG_MIN_S = 0.5
EDGE_TOL_S = 0.1
SHORT = {"N1_function": "n1", "N2_direction": "n2"}


def _r(x: float) -> float:
    return round(float(x), 3)


def change_points_to_spans(points: list[dict], end_s: float, min_s: float) -> list[dict]:
    """Change points -> contiguous spans [start, end) covering 0..end_s, joined and with short spans merged."""
    pts = sorted((p for p in points if p["t"] < end_s), key=lambda p: p["t"])
    if not pts:
        raise ValueError("no label in this layer")
    if pts[0]["t"] > EDGE_TOL_S:
        raise ValueError(f"the first label starts at {pts[0]['t']} s, not at 0")
    spans = []
    for i, p in enumerate(pts):
        start = 0.0 if i == 0 else p["t"]
        stop = pts[i + 1]["t"] if i + 1 < len(pts) else end_s
        if stop > start:
            spans.append({"start_s": start, "end_s": stop, "label": p["label"], "ambiguous": bool(p.get("ambiguous"))})
    spans = _join_same(spans)
    while len(spans) > 1:
        short = [i for i, s in enumerate(spans) if s["end_s"] - s["start_s"] < min_s - 1e-9]
        if not short:
            break
        i = min(short, key=lambda k: (spans[k]["end_s"] - spans[k]["start_s"], k))
        left = spans[i - 1] if i > 0 else None
        right = spans[i + 1] if i + 1 < len(spans) else None
        target = left if right is None or (left is not None and
                                           left["end_s"] - left["start_s"] >= right["end_s"] - right["start_s"]) else right
        if target is left:
            left["end_s"] = spans[i]["end_s"]
        else:
            right["start_s"] = spans[i]["start_s"]
        del spans[i]
        spans = _join_same(spans)
    return spans


def _join_same(spans: list[dict]) -> list[dict]:
    out: list[dict] = []
    for s in spans:
        if out and out[-1]["label"] == s["label"] and out[-1]["ambiguous"] == s["ambiguous"]:
            out[-1]["end_s"] = s["end_s"]
        else:
            out.append(dict(s))
    return out


def flag_spans(pairs: list, end_s: float) -> list[tuple[float, float]]:
    """holding_notes [start, end] pairs clipped to the clip, overlaps joined, spans under FLAG_MIN_S dropped."""
    clipped = sorted((max(0.0, a), min(end_s, b)) for a, b in pairs if min(end_s, b) > max(0.0, a))
    out: list[list[float]] = []
    for a, b in clipped:
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(a, b) for a, b in out if b - a >= FLAG_MIN_S]


def load_keylog(path) -> dict:
    path = Path(path)
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("format") != FORMAT:
        raise ValueError(f"{path.name}: format must be {FORMAT}")
    m = FILE_NAME.match(path.stem)
    if not m:
        raise ValueError(f"{path.name}: file name must be <annotator code>_<blind_id>.json, e.g. A2_PV01-07.json")
    if (data.get("annotator_id"), data.get("blind_id")) != m.groups():
        raise ValueError(f"{path.name}: annotator_id/blind_id inside the file do not match the file name")
    for layer, points in data.get("layers", {}).items():
        if layer not in LABELS:
            raise ValueError(f"{path.name}: unknown layer {layer}")
        bad = sorted({p.get("label") for p in points} - set(LABELS[layer]))
        if bad:
            raise ValueError(f"{path.name}: {layer} has unknown labels {bad}")
    return data


def keylog_to_records(path, manifest: dict | None = None) -> list[dict]:
    data = load_keylog(path)
    reviewer, blind = data["annotator_id"], data["blind_id"]
    end_s = float(data["media_duration_s"])
    if manifest and blind in manifest:
        end_s = manifest[blind]["masked_media_duration_s"]
    common = {"blind_id": blind, "tier": "GOLD_MANUAL", "record_role": "independent", "label_source": "manual",
              "reviewer_id": reviewer, "manual_version": data.get("manual_version") or DEFAULT_MANUAL,
              "created_at": data["created_at"]}
    records = []
    for layer in LABELS:
        if layer not in data.get("layers", {}):
            raise ValueError(f"{Path(path).name}: layer {layer} is missing")
        try:
            spans = change_points_to_spans(data["layers"][layer], end_s, MIN_SPAN_S[layer])
        except ValueError as exc:
            raise ValueError(f"{Path(path).name} {layer}: {exc}") from None
        for i, s in enumerate(spans, 1):
            records.append({"annotation_id": f"{blind}-{reviewer}-{SHORT[layer]}{i:03d}", **common, "layer": layer,
                            "start_s": _r(s["start_s"]), "end_s": _r(s["end_s"]), "final_label": s["label"],
                            "ambiguous": s["ambiguous"]})
    for i, (a, b) in enumerate(flag_spans(data.get("holding_notes", []), end_s), 1):
        records.append({"annotation_id": f"{blind}-{reviewer}-hn{i:03d}", **common, "layer": "N1_flags",
                        "start_s": _r(a), "end_s": _r(b), "final_label": None, "flags": ["holding_notes"],
                        "ambiguous": False})
    return records


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Convert labeller .json files of the N1/N2 study to label records.")
    ap.add_argument("keylogs", nargs="+", help="<annotator code>_<blind_id>.json files")
    ap.add_argument("-o", "--out", required=True, help="output JSONL")
    ap.add_argument("--manifest", help="private manifest CSV; the last span ends at its masked duration and the "
                                       "semantic validator runs on the output")
    ap.add_argument("--times", help="write annotator, blind_id, work_minutes per file to this CSV")
    args = ap.parse_args(argv)

    from research import validate_labels as vl
    manifest = vl.load_manifest(args.manifest) if args.manifest else None
    records, times = [], []
    for p in args.keylogs:
        records += keylog_to_records(p, manifest)
        d = load_keylog(p)
        times.append({"annotator_id": d["annotator_id"], "blind_id": d["blind_id"],
                      "work_minutes": round(float(d.get("work_seconds", 0)) / 60, 1)})
    Path(args.out).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records), encoding="utf-8")
    print(f"wrote {len(records)} record(s) from {len(args.keylogs)} file(s) to {args.out}")
    if args.times:
        with open(args.times, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["annotator_id", "blind_id", "work_minutes"])
            w.writeheader()
            w.writerows(times)
    if args.manifest:
        return vl.main([args.out, "--manifest", args.manifest])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
