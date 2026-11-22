"""ELAN template and .eaf -> label-record converter for the N1/N2 annotation pilot (D-067).

Annotators label in ELAN (annotation manual section 0) with the template research/elan/n1_n2_template_v1.etf and
save one file per clip named `<annotator code>_<blind_id>.eaf`, for example `A2_PV01-07.eaf`. This file turns
those files into GOLD_MANUAL / independent records (research/schemas/n1_n2_labels_v1.schema.json) and can run the
semantic validator right away.

Tiers in the template:
    N1_function, N2_direction                  primary labels, one per span, spans must cover the whole clip
    N1_intensity, N1_exploratory               optional labels on GESTURE / ADAPTOR_MANIPULATION spans
    N1_flag_holding_notes, N1_flag_one_hand_hidden, N1_flag_repetitive
                                               one tier per flag so flags may overlap (ELAN allows one value per
                                               span inside one tier); each span becomes an N1_flags record
    <label tier>_ambiguous / _confidence / _note
                                               child tiers (one value per parent span): ambiguous = "ambiguous",
                                               confidence = 1/2/3, note = short text (evidence_note, no personal data)

Usage (repository root):
    python -m research.elan_to_records A1_PV01-03.eaf [...] -o labels.jsonl [--manifest PRIVATE.csv]
    python -m research.elan_to_records --write-template research/elan/n1_n2_template_v1.etf
"""
from __future__ import annotations

import argparse
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

LABEL_TIERS = {
    "N1_function": ["GESTURE", "REST_OR_HOLD", "ADAPTOR_MANIPULATION", "UNOBSERVABLE"],
    "N1_intensity": ["LOW", "MODERATE", "HIGH"],
    "N1_exploratory": ["MESSAGE_SUPPORTING", "POTENTIALLY_DISTRACTING", "UNCERTAIN"],
    "N2_direction": ["CAMERA_REGION", "NOTES", "OTHER", "UNOBSERVABLE"],
}
FLAGS = ["holding_notes", "one_hand_hidden", "repetitive"]
FLAG_TIERS = {f"N1_flag_{flag}": flag for flag in FLAGS}
CHILD_KINDS = {"ambiguous": ["ambiguous"], "confidence": ["1", "2", "3"], "note": None}
FILE_NAME = re.compile(r"^(A[0-9]+)_([A-Z]{2}[0-9]{2}-[0-9]{2})$")
DEFAULT_MANUAL = "ANNOTATION_MANUAL_N1_N2_V1.0"
XSI = "http://www.w3.org/2001/XMLSchema-instance"


# ---------------------------------------------------------------- template

def _cv(root: ET.Element, cv_id: str, values: list[str]) -> None:
    cv = ET.SubElement(root, "CONTROLLED_VOCABULARY", CV_ID=cv_id)
    ET.SubElement(cv, "DESCRIPTION", LANG_REF="und")
    for i, value in enumerate(values, 1):
        entry = ET.SubElement(cv, "CV_ENTRY_ML", CVE_ID=f"{cv_id}_{i}")
        ET.SubElement(entry, "CVE_VALUE", LANG_REF="und").text = value


def _add_tiers(root: ET.Element) -> None:
    for tier in LABEL_TIERS:
        ET.SubElement(root, "TIER", LINGUISTIC_TYPE_REF=tier, TIER_ID=tier)
        for kind in CHILD_KINDS:
            ET.SubElement(root, "TIER", LINGUISTIC_TYPE_REF=f"child_{kind}", PARENT_REF=tier, TIER_ID=f"{tier}_{kind}")
    for tier in FLAG_TIERS:
        ET.SubElement(root, "TIER", LINGUISTIC_TYPE_REF=tier, TIER_ID=tier)


def _add_types(root: ET.Element) -> None:
    for tier in [*LABEL_TIERS, *FLAG_TIERS]:
        ET.SubElement(root, "LINGUISTIC_TYPE", CONTROLLED_VOCABULARY_REF=f"{tier}_cv", GRAPHIC_REFERENCES="false",
                      LINGUISTIC_TYPE_ID=tier, TIME_ALIGNABLE="true")
    for kind, values in CHILD_KINDS.items():
        attrs = {"CONSTRAINTS": "Symbolic_Association", "GRAPHIC_REFERENCES": "false",
                 "LINGUISTIC_TYPE_ID": f"child_{kind}", "TIME_ALIGNABLE": "false"}
        if values:
            attrs["CONTROLLED_VOCABULARY_REF"] = f"child_{kind}_cv"
        ET.SubElement(root, "LINGUISTIC_TYPE", attrs)


def _add_vocabularies(root: ET.Element) -> None:
    for tier, values in LABEL_TIERS.items():
        _cv(root, f"{tier}_cv", values)
    for tier, flag in FLAG_TIERS.items():
        _cv(root, f"{tier}_cv", [flag])
    for kind, values in CHILD_KINDS.items():
        if values:
            _cv(root, f"child_{kind}_cv", values)


def build_template() -> str:
    """EAF 3.0 template text: tiers, linguistic types and controlled vocabularies, no media and no annotations."""
    ET.register_namespace("xsi", XSI)
    root = ET.Element("ANNOTATION_DOCUMENT", {"AUTHOR": "", "DATE": "2026-11-22T00:00:00+07:00", "FORMAT": "3.0",
                                              "VERSION": "3.0", f"{{{XSI}}}noNamespaceSchemaLocation":
                                              "http://www.mpi.nl/tools/elan/EAFv3.0.xsd"})
    ET.SubElement(root, "HEADER", MEDIA_FILE="", TIME_UNITS="milliseconds")
    ET.SubElement(root, "TIME_ORDER")
    _add_tiers(root)
    _add_types(root)
    ET.SubElement(root, "LANGUAGE", LANG_DEF="http://cdb.iso.org/lg/CDB-00130975-001", LANG_ID="und",
                  LANG_LABEL="undetermined (und)")
    ET.SubElement(root, "CONSTRAINT", DESCRIPTION="1-1 association with a parent annotation",
                  STEREOTYPE="Symbolic_Association")
    _add_vocabularies(root)
    ET.indent(root)
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode") + "\n"


# ---------------------------------------------------------------- reading .eaf

def _read_eaf(path: Path):
    root = ET.parse(path).getroot()
    if root.find("HEADER").get("TIME_UNITS", "milliseconds") != "milliseconds":
        raise ValueError(f"{path.name}: TIME_UNITS must be milliseconds")
    slots = {ts.get("TIME_SLOT_ID"): ts.get("TIME_VALUE") for ts in root.iter("TIME_SLOT")}
    spans, children = {}, {}          # tier -> [(eaf id, start ms, end ms, value)], parent eaf id -> {kind: value}
    for tier in root.iter("TIER"):
        tier_id = tier.get("TIER_ID")
        for ann in tier.iter("ALIGNABLE_ANNOTATION"):
            t1, t2 = slots[ann.get("TIME_SLOT_REF1")], slots[ann.get("TIME_SLOT_REF2")]
            if t1 is None or t2 is None:
                raise ValueError(f"{path.name}: annotation {ann.get('ANNOTATION_ID')} on {tier_id} has an unaligned time")
            value = (ann.findtext("ANNOTATION_VALUE") or "").strip()
            spans.setdefault(tier_id, []).append((ann.get("ANNOTATION_ID"), int(t1), int(t2), value))
        for ref in tier.iter("REF_ANNOTATION"):
            kind = tier_id.rsplit("_", 1)[-1]
            children.setdefault(ref.get("ANNOTATION_REF"), {})[kind] = (ref.findtext("ANNOTATION_VALUE") or "").strip()
    media = [m.get("RELATIVE_MEDIA_URL") or m.get("MEDIA_URL") or "" for m in root.iter("MEDIA_DESCRIPTOR")]
    return root.get("DATE"), spans, children, media


def _check_file(path: Path, spans: dict, media: list[str]) -> tuple[str, str]:
    """(annotator code, blind_id) from the file name, after checking the linked media and the tier names."""
    m = FILE_NAME.match(path.stem)
    if not m:
        raise ValueError(f"{path.name}: file name must be <annotator code>_<blind_id>.eaf, e.g. A2_PV01-07.eaf")
    reviewer, blind = m.groups()
    for url in media:
        if url and Path(url.replace("file:///", "")).name != f"{blind}.mp4":
            raise ValueError(f"{path.name}: linked media {url} is not {blind}.mp4")
    unknown = sorted(t for t in spans if t not in LABEL_TIERS and t not in FLAG_TIERS)
    if unknown:
        raise ValueError(f"{path.name}: tiers not in the template: {', '.join(unknown)}")
    return reviewer, blind


def _label_record(base: dict, value: str, extra: dict) -> dict:
    rec = dict(base, final_label=value, ambiguous=extra.get("ambiguous") == "ambiguous")
    if extra.get("confidence"):
        conf = extra["confidence"]
        rec["confidence"] = int(conf) if conf.isdigit() else conf     # a wrong value is left for the schema to report
    if extra.get("note"):
        rec["evidence_note"] = extra["note"]
    return rec


def eaf_to_records(path, manual_version: str = DEFAULT_MANUAL) -> list[dict]:
    path = Path(path)
    date, spans, children, media = _read_eaf(path)
    reviewer, blind = _check_file(path, spans, media)
    created = date or datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()

    def base(eaf_id: str, layer: str, t1: int, t2: int) -> dict:
        return {"annotation_id": f"{blind}-{reviewer}-{eaf_id}", "blind_id": blind, "tier": "GOLD_MANUAL",
                "record_role": "independent", "layer": layer, "start_s": round(t1 / 1000, 3), "end_s": round(t2 / 1000, 3),
                "label_source": "manual", "reviewer_id": reviewer, "manual_version": manual_version, "created_at": created}

    records = [_label_record(base(eaf_id, layer, t1, t2), value, children.get(eaf_id, {}))
               for layer in LABEL_TIERS for eaf_id, t1, t2, value in spans.get(layer, [])]

    flag_spans: dict[tuple[int, int], dict] = {}       # identical spans on different flag tiers become one record
    for tier, flag in FLAG_TIERS.items():
        for eaf_id, t1, t2, _value in spans.get(tier, []):
            rec = flag_spans.setdefault((t1, t2), dict(base(eaf_id, "N1_flags", t1, t2), final_label=None, flags=[],
                                                       ambiguous=False))
            rec["flags"].append(flag)
    return records + sorted(flag_spans.values(), key=lambda r: (r["start_s"], r["end_s"]))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Convert ELAN .eaf files of the N1/N2 pilot to label records.")
    ap.add_argument("eaf", nargs="*", help="<annotator code>_<blind_id>.eaf files")
    ap.add_argument("-o", "--out", help="output JSONL")
    ap.add_argument("--manual-version", default=DEFAULT_MANUAL)
    ap.add_argument("--manifest", help="private manifest CSV; when given, the semantic validator runs on the output")
    ap.add_argument("--write-template", help="write the ELAN template (.etf) to this path and exit")
    args = ap.parse_args(argv)

    if args.write_template:
        Path(args.write_template).write_text(build_template(), encoding="utf-8", newline="\n")
        print(f"wrote {args.write_template}")
        return 0
    if not args.eaf or not args.out:
        ap.error("give .eaf files and -o OUT.jsonl")
    records = []
    for p in args.eaf:
        records += eaf_to_records(p, args.manual_version)
    Path(args.out).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records), encoding="utf-8")
    print(f"wrote {len(records)} record(s) from {len(args.eaf)} file(s) to {args.out}")
    if args.manifest:
        from research import validate_labels as vl
        return vl.main([args.out, "--manifest", args.manifest])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
