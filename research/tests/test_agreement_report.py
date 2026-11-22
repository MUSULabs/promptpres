"""Tests for research/agreement_report.py (D-067 pilot agreement and class coverage).

Run from the repository root:  python -m pytest research/tests -q
Every label, clip and speaker here is invented. Expected κ values are worked out by hand in the comments.
"""
import csv
import json
import math
from pathlib import Path

import numpy as np
import pytest

from research import agreement_report as ar

SCHEMA = json.loads((Path(__file__).resolve().parents[1] / "schemas" / "n1_n2_labels_v1.schema.json")
                    .read_text(encoding="utf-8"))
G, R = "GESTURE", "REST_OR_HOLD"


def span(start, end, label, ambiguous=False):
    return ar.Span(start, end, label, ambiguous)


def record(rater, start, end, label, layer="N1_function", blind_id="ZZ00-01", ambiguous=False, **kw):
    return {"annotation_id": f"{rater}-{layer}-{start}", "blind_id": blind_id, "tier": "GOLD_MANUAL",
            "record_role": "independent", "layer": layer, "start_s": start, "end_s": end, "final_label": label,
            "label_source": "manual", "reviewer_id": rater, "manual_version": "ANNOTATION_MANUAL_N1_N2_V1.0",
            "created_at": "2026-11-22T10:00:00+07:00", "ambiguous": ambiguous, **kw}


def write_jsonl(path, records):
    path.write_text("\n".join(json.dumps(r) for r in records) + "\n", encoding="utf-8")
    return path


def write_manifest(path, rows, header="blind_id,participant_id,is_team_member,masked_media_duration_s,layers"):
    path.write_text("# invented test manifest\n" + header + "\n" + "\n".join(rows) + "\n", encoding="utf-8")
    return path


# ---------------------------------------------------------------- class lists

@pytest.mark.parametrize("layer", list(ar.LAYERS))
def test_class_lists_match_schema(layer):
    rule = next(r for r in SCHEMA["allOf"] if r.get("if", {}).get("properties", {}).get("layer", {}).get("const") == layer)
    enum = [v for v in rule["then"]["properties"]["final_label"]["enum"] if v is not None]
    assert ar.LAYERS[layer] == enum


# ---------------------------------------------------------------- Fleiss κ

def test_fleiss_perfect_agreement():
    # 3 raters, every item unanimous, two classes used → P̄ = 1, P̄e = (2/3)² + (1/3)² = 5/9 → κ = 1
    counts = [[3, 0], [0, 3], [3, 0]]
    assert ar.fleiss_kappa(counts) == pytest.approx(1.0)
    assert ar.mean_pairwise_agreement(counts) == pytest.approx(1.0)
    assert ar.fleiss_kappa_per_class(counts) == pytest.approx([1.0, 1.0])


def test_fleiss_chance_level():
    # All 8 label patterns of 3 raters × 2 classes, once each: p_X = p_Y = 1/2 → P̄e = 1/2.
    # 2 unanimous items (P_i = 1) and 6 split 2–1 items (P_i = (4 + 1 − 3)/6 = 1/3) → P̄ = (2 + 2)/8 = 1/2 → κ = 0
    counts = [[3, 0], [2, 1], [2, 1], [1, 2], [2, 1], [1, 2], [1, 2], [0, 3]]
    assert ar.fleiss_kappa(counts) == pytest.approx(0.0, abs=1e-12)
    assert ar.mean_pairwise_agreement(counts) == pytest.approx(0.5)


def test_fleiss_textbook_example():
    # Fleiss (1971)-style worked example reproduced in many textbooks (and Wikipedia "Fleiss' kappa"):
    # 10 subjects, 14 raters, 5 categories → P̄ = 0.378, P̄e = 0.213, κ = 0.210
    counts = [
        [0, 0, 0, 0, 14],
        [0, 2, 6, 4, 2],
        [0, 0, 3, 5, 6],
        [0, 3, 9, 2, 0],
        [2, 2, 8, 1, 1],
        [7, 7, 0, 0, 0],
        [3, 2, 6, 3, 0],
        [2, 5, 3, 2, 2],
        [6, 5, 2, 1, 0],
        [0, 2, 2, 3, 7],
    ]
    assert ar.mean_pairwise_agreement(counts) == pytest.approx(0.378, abs=5e-4)
    assert ar.fleiss_kappa(counts) == pytest.approx(0.210, abs=5e-4)


def test_fleiss_small_hand_example_and_per_class():
    # Items AAA, AAB, BBB, ABB: P_i = 1, 1/3, 1, 1/3 → P̄ = 2/3; p_A = 6/12 → P̄e = 1/2 → κ = (2/3 − 1/2)/(1/2) = 1/3.
    # Per class A: Σ n(m − n) = 0 + 2 + 0 + 2 = 4; N m (m−1) p q = 4·3·2·¼ = 6 → κ_A = 1 − 4/6 = 1/3 (same for B)
    counts = [[3, 0], [2, 1], [0, 3], [1, 2]]
    assert ar.fleiss_kappa(counts) == pytest.approx(1 / 3)
    assert ar.fleiss_kappa_per_class(counts) == pytest.approx([1 / 3, 1 / 3])


def test_fleiss_undefined_without_variation_or_items():
    assert math.isnan(ar.fleiss_kappa([[3, 0], [3, 0]]))          # P̄e = 1
    assert math.isnan(ar.fleiss_kappa(np.zeros((0, 2))))
    assert np.isnan(ar.fleiss_kappa_per_class([[3, 0], [3, 0]])).all()


def test_fleiss_needs_equal_raters_per_item():
    with pytest.raises(ValueError):
        ar.fleiss_kappa([[3, 0], [1, 1]])


def test_rating_counts():
    labels = np.array([[G, G, R], [R, R, R]], dtype=object)
    assert ar.rating_counts(labels, [G, R]).tolist() == [[2, 1], [0, 3]]


# ---------------------------------------------------------------- bins (§4.3)

@pytest.mark.parametrize("duration, n_bins, last", [
    (2.0, 4, (1.5, 2.0)),
    (2.2, 4, (1.5, 2.0)),        # last 0.2 s piece < 0.25 s → dropped
    (2.25, 5, (2.0, 2.25)),      # last 0.25 s piece kept
    (0.3, 1, (0.0, 0.3)),
])
def test_bin_edges(duration, n_bins, last):
    edges = ar.bin_edges(duration)
    assert len(edges) == n_bins
    assert edges[-1] == pytest.approx(last)


def test_bin_takes_majority_label():
    assert ar.assign_bin([span(0, 0.3, G), span(0.3, 1.0, R)], 0.0, 0.5) == (G, False, False)


def test_bin_tie_goes_to_span_holding_midpoint():
    # G covers [0, 0.25), R covers [0.25, 0.5): equal time; midpoint 0.25 belongs to R (half-open spans)
    assert ar.assign_bin([span(0, 0.25, G), span(0.25, 1.0, R)], 0.0, 0.5) == (R, False, True)


def test_bin_tie_with_midpoint_in_a_third_label_takes_earliest_tied():
    # G 0.2 s, ADAPTOR 0.1 s (holds the midpoint 0.25), R 0.2 s → G and R tie; midpoint label not tied → earliest, G
    spans = [span(0, 0.2, G), span(0.2, 0.3, "ADAPTOR_MANIPULATION"), span(0.3, 0.5, R)]
    assert ar.assign_bin(spans, 0.0, 0.5) == (G, False, True)


def test_bin_uncovered_when_gap_is_largest():
    assert ar.assign_bin([span(0, 0.1, G)], 0.0, 0.5)[0] is None      # gap 0.4 s > G 0.1 s
    assert ar.assign_bin([span(0, 0.3, G)], 0.0, 0.5)[0] == G         # G 0.3 s > gap 0.2 s
    assert ar.assign_bin([], 0.0, 0.5) == (None, False, False)


def test_bin_ambiguous_only_from_spans_of_the_assigned_label():
    assert ar.assign_bin([span(0, 0.4, G, ambiguous=True), span(0.4, 1, R)], 0.0, 0.5) == (G, True, False)
    assert ar.assign_bin([span(0, 0.1, G, ambiguous=True), span(0.1, 1, R)], 0.0, 0.5) == (R, False, False)


def test_check_spans_rejects_overlap_and_outside_media():
    with pytest.raises(ValueError, match="overlap"):
        ar.check_spans([span(0, 1.0, G), span(0.9, 2.0, R)], 2.0, "t")
    with pytest.raises(ValueError, match="after the masked media"):
        ar.check_spans([span(0, 2.5, G)], 2.0, "t")
    ar.check_spans([span(0, 1.0, G), span(1.0, 2.0, R)], 2.0, "t")      # touching spans are fine


# ---------------------------------------------------------------- whole report

# One 2.0 s clip = 4 bins. Per bin (A1, A2, A3): (G,G,G), (G,G,R), (R,R,R), (G,R,R) — the hand example above.
N1_RECORDS = [
    record("A1", 0.0, 1.0, G), record("A1", 1.0, 1.5, R), record("A1", 1.5, 2.0, G),
    record("A2", 0.0, 1.0, G), record("A2", 1.0, 2.0, R),
    record("A3", 0.0, 0.5, G, ambiguous=True), record("A3", 0.5, 2.0, R),
]
N2_RECORDS = [record(r, 0.0, 2.0, "CAMERA_REGION", layer="N2_direction") for r in ("A1", "A2", "A3")]


@pytest.fixture
def report(tmp_path):
    labels = write_jsonl(tmp_path / "labels.jsonl", N1_RECORDS + N2_RECORDS + [
        record("A3", 0.0, 2.0, G, record_role="consensus"),                 # skipped: not independent
    ])
    manifest = write_manifest(tmp_path / "manifest.csv", ["ZZ00-01,SPK_A,false,2.0,N1;N2"])
    paths = ar.main([str(labels), "--manifest", str(manifest), "--out", str(tmp_path / "out")])
    clips, _ = ar.read_manifest(manifest)
    records, skipped = ar.read_records([labels])
    return ar.build_report(records, clips), skipped, paths


def test_report_fleiss_and_raw_agreement(report):
    layers, _, _ = report
    prim = layers["N1_function"]["primary"]
    assert prim["n_bins"] == 4
    assert prim["fleiss_kappa"] == pytest.approx(1 / 3)
    assert prim["mean_pairwise_agreement"] == pytest.approx(2 / 3)
    assert prim["all_agree"] == pytest.approx(0.5)                         # bins 1 and 3 unanimous


def test_report_pairwise_cohen(report):
    # A1 GGRG vs A2 GGRR: po = 3/4, pe = ¾·½ + ¼·½ = ½ → κ = 0.5
    # A1 GGRG vs A3 GRRR: po = 1/2, pe = ¾·¼ + ¼·¾ = 3/8 → κ = (1/2 − 3/8)/(5/8) = 0.2
    # A2 GGRR vs A3 GRRR: po = 3/4, pe = ½·¼ + ½·¾ = ½ → κ = 0.5
    layers, _, _ = report
    pairs = {(p["rater_a"], p["rater_b"]): p for p in layers["N1_function"]["primary"]["pairs"]}
    assert pairs[("A1", "A2")]["cohen_kappa"] == pytest.approx(0.5)
    assert pairs[("A1", "A3")]["cohen_kappa"] == pytest.approx(0.2)
    assert pairs[("A2", "A3")]["cohen_kappa"] == pytest.approx(0.5)
    assert pairs[("A1", "A3")]["percent_agreement"] == pytest.approx(0.5)
    # rows A1, columns A2 (class order G, R, ADAPTOR, UNOBSERVABLE): G→G 2, G→R 1, R→R 1
    assert pairs[("A1", "A2")]["confusion"][:2, :2].tolist() == [[2, 1], [0, 1]]
    assert pairs[("A1", "A2")]["confusion"].sum() == 4


def test_report_sensitivity_drops_ambiguous_bins(report):
    # A3's first span is ambiguous → bin 1 dropped. Items (G,G,R), (R,R,R), (G,R,R):
    # P̄ = (1/3 + 1 + 1/3)/3 = 5/9; p_G = 3/9 → P̄e = 1/9 + 4/9 = 5/9 → κ = 0
    layers, _, _ = report
    sens = layers["N1_function"]["sensitivity"]
    assert sens["n_bins"] == 3
    assert sens["fleiss_kappa"] == pytest.approx(0.0, abs=1e-12)
    pairs = {(p["rater_a"], p["rater_b"]): p for p in sens["pairs"]}
    assert pairs[("A1", "A2")]["n_bins"] == 4                              # A3's ambiguity does not touch A1–A2
    assert pairs[("A1", "A3")]["n_bins"] == 3
    assert layers["N1_function"]["ambiguous"] == {"A1": 0, "A2": 0, "A3": 1}


def test_report_layer_without_variation_is_undefined_not_perfect(report):
    layers, _, _ = report
    prim = layers["N2_direction"]["primary"]
    assert math.isnan(prim["fleiss_kappa"])
    assert prim["mean_pairwise_agreement"] == pytest.approx(1.0)
    assert all(math.isnan(p["cohen_kappa"]) for p in prim["pairs"])


def test_report_files(report):
    _, skipped, paths = report
    assert skipped == {"GOLD_MANUAL / consensus / N1_function": 1}
    assert [p.name for p in paths] == ["agreement_report.md", "agreement_summary.csv", "agreement_confusion.csv",
                                       "class_coverage.csv"]
    text = paths[0].read_text(encoding="utf-8")
    assert "SPK_A" not in text                                             # never writes participant ids
    assert "merge / simplify / drop optional label (< 0.60)" in text
    with open(paths[1], encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    fleiss = next(r for r in rows if r["layer"] == "N1_function" and r["bin_set"] == "all_bins"
                  and r["measure"] == "fleiss_kappa")
    assert float(fleiss["value"]) == pytest.approx(1 / 3, abs=1e-6)
    assert fleiss["n_bins"] == "4"
    with open(paths[2], encoding="utf-8", newline="") as f:
        assert len(list(csv.DictReader(f))) == 2 * 2 * 3 * 16                # layers × bin sets × pairs × cells


def test_missing_rater_clip_counts_as_uncovered(tmp_path):
    # A3 labelled clip 01 but not clip 02 → clip 02's 4 bins are uncovered for A3, left out of Fleiss, kept for A1–A2
    recs = [record(r, 0.0, 2.0, G, blind_id="ZZ00-01") for r in ("A1", "A2", "A3")]
    recs += [record(r, 0.0, 2.0, R, blind_id="ZZ00-02") for r in ("A1", "A2")]
    clips, _ = ar.read_manifest(write_manifest(tmp_path / "m.csv", ["ZZ00-01,S1,false,2.0,N1",
                                                                    "ZZ00-02,S2,false,2.0,N1"]))
    res = ar.build_report(recs, clips)["N1_function"]
    assert res["uncovered"] == {"A1": 0, "A2": 0, "A3": 4}
    assert res["primary"]["n_bins"] == 4
    a1_a2 = res["primary"]["pairs"][0]
    assert a1_a2["n_bins"] == 8 and a1_a2["cohen_kappa"] == pytest.approx(1.0)


def test_class_coverage_seconds_and_speakers(tmp_path):
    clips, have_speakers = ar.read_manifest(write_manifest(tmp_path / "m.csv", [
        "ZZ00-01,SPK_A,false,4.0,N1", "ZZ00-02,SPK_B,false,4.0,N1", "ZZ00-03,SPK_T,true,4.0,N1"]))
    assert have_speakers
    recs = [
        record("A1", 0.0, 4.0, G, blind_id="ZZ00-01"), record("A2", 0.0, 1.0, G, blind_id="ZZ00-01"),
        record("A2", 1.0, 4.0, R, blind_id="ZZ00-01"), record("A3", 0.0, 4.0, R, blind_id="ZZ00-01"),
        record("A1", 0.0, 2.0, G, blind_id="ZZ00-02"),                        # only A1 saw GESTURE on SPK_B
        record("A1", 2.0, 4.0, R, blind_id="ZZ00-02"),
        record("A2", 0.0, 4.0, R, blind_id="ZZ00-02"), record("A3", 0.0, 4.0, R, blind_id="ZZ00-02"),
    ] + [record(r, 0.0, 4.0, G, blind_id="ZZ00-03") for r in ("A1", "A2", "A3")]
    cov = {row["class"]: row for row in ar.build_report(recs, clips)["N1_function"]["coverage"]}
    gesture = cov[G]
    assert (gesture["seconds_A1"], gesture["seconds_A2"], gesture["seconds_A3"]) == (10.0, 5.0, 4.0)
    assert gesture["seconds_mean"] == pytest.approx(19 / 3, abs=1e-3)
    assert gesture["primary_speakers_any"] == 2                            # SPK_A, SPK_B
    assert gesture["primary_speakers_majority"] == 1                       # only SPK_A has ≥ 2 of 3 raters
    assert gesture["team_speakers_any"] == 1
    assert gesture["meets_5_speaker_gate"] is False
    assert cov[R]["primary_speakers_majority"] == 2
    assert cov["UNOBSERVABLE"]["seconds_mean"] == 0.0


def test_speaker_falls_back_to_blind_id(tmp_path):
    clips, have_speakers = ar.read_manifest(write_manifest(tmp_path / "m.csv", ["ZZ00-01,2.0"],
                                                           header="blind_id,masked_media_duration_s"))
    assert not have_speakers
    assert clips["ZZ00-01"].speaker == "ZZ00-01"
    assert clips["ZZ00-01"].layers == ("N1_function", "N2_direction")


@pytest.mark.parametrize("bad, message", [
    (record("A1", 0.0, 1.0, G, blind_id="ZZ99-99"), "not in the manifest"),
    (record("A1", 0.0, 1.0, "NOTES"), "not a N1_function class"),
    (record("A1", 0.0, 1.0, "NOTES", layer="N2_direction"), "not assigned N2_direction"),
])
def test_bad_records_are_rejected(tmp_path, bad, message):
    clips, _ = ar.read_manifest(write_manifest(tmp_path / "m.csv", ["ZZ00-01,S1,false,2.0,N1"]))
    with pytest.raises(ValueError, match=message):
        ar.build_report([bad], clips)
