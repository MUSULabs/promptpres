"""Measurement accuracy: system values / events / C2 labels vs what a person counted (ground truth).

    python -m eval.measurement_eval --values data/eval/inputs/gt_values.csv
    python -m eval.measurement_eval --values gt_values.csv --events gt_events.csv --topics gt_topics.csv --runs data/runs

Inputs (templates in eval/templates/, how to fill in eval/README.md). clip_id = the run folder name in data/runs:
  gt_values.csv  clip_id, rater, then any column named <CODE>.<value key> of result.json,
                 e.g. S3.fillers, S2.long_pauses, T1.speech_span_s, N2.front_pct (blank = not counted)
  gt_events.csv  clip_id, criterion (S2 | S3 | N1), start_s, end_s[, label]
                 a row with blank start_s = "listened to this clip, found none" (so it still counts)
  gt_topics.csv  clip_id, topic_id (H01 …), label (clear | brief | not_mentioned)

Continuous values → MAE, MAPE, RMSE, bias, Pearson r, Spearman ρ.
Events (S2 pauses, S3 fillers, N1 still spans; system events = the card's evidence list)
  → event level: start times matched one-to-one within tol_s → precision, recall, F1
  → time level: clip cut into time_bin_s bins, event / no event → accuracy, Cohen's κ, precision, recall, F1
C2 labels → confusion matrix, accuracy, per-label precision/recall/F1, macro-F1, Cohen's κ, QWK.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

import numpy as np

from eval import stats
from eval.tables import (OUT, criterion, eval_config, find_col, fmt, md_table, parse_number, read_table, load_results,
                         write_outputs)

VALUE_COL = re.compile(r"^(C1|C2|S1|S2|S3|N1|N2|T1)\.([A-Za-z0-9_]+)$")
EVENT_COUNT = {"S2": "long_pauses", "S3": "fillers", "N1": "long_still_spans"}   # value that should equal len(evidence)
EVENT_NAME = {"S2": "ช่วงหยุดยาว", "S3": "เสียงเติมและคำติดปาก", "N1": "ช่วงมือนิ่งต่อเนื่อง"}   # rubric v0.9 names


# ----------------------------------------------------------------------------- continuous values
def human_values(path) -> dict[str, dict[str, float]]:
    """{clip_id: {"S3.fillers": value, ...}}; several raters of one clip are averaged."""
    df = read_table(path)
    c_clip = find_col(df, "clip_id", "clip")
    if not c_clip:
        raise ValueError("gt_values ต้องมีคอลัมน์ clip_id")
    cols = [c for c in df.columns if VALUE_COL.match(c)]
    if not cols:
        raise ValueError("gt_values ไม่มีคอลัมน์ค่า เช่น S3.fillers (รูปแบบ <รหัสเกณฑ์>.<ชื่อค่า>)")
    acc: dict[str, dict[str, list]] = {}
    for _, row in df.iterrows():
        clip = str(row[c_clip]).strip()
        if not clip or clip.upper().startswith("EXAMPLE"):
            continue
        for c in cols:
            v = parse_number(row[c])
            if v is not None:
                acc.setdefault(clip, {}).setdefault(c, []).append(v)
    return {clip: {c: float(np.mean(v)) for c, v in d.items()} for clip, d in acc.items()}


def compare_values(human: dict, results: dict) -> tuple[list[dict], list[dict], list[str]]:
    """Per value key: error statistics; per clip: the paired numbers; plus warnings."""
    pairs, notes = [], []
    for clip, vals in human.items():
        r = results.get(clip)
        if r is None:
            notes.append(f"ไม่พบผลวิเคราะห์ของ {clip}")
            continue
        for col, h in vals.items():
            code, key = VALUE_COL.match(col).groups()
            c = criterion(r, code)
            status = (c or {}).get("status", "ไม่มีการ์ด")
            # an unanalyzable card may still carry values (e.g. C1 tau with 3 topics) — never compared
            s = (c or {}).get("values", {}).get(key) if status == "ok" else None
            pairs.append({"clip_id": clip, "criterion": code, "value": key, "human": h,
                          "system": s if isinstance(s, (int, float)) else None, "status": status})
    rows = []
    for col in sorted({(p["criterion"], p["value"]) for p in pairs}):
        mine = [p for p in pairs if (p["criterion"], p["value"]) == col]
        usable = [p for p in mine if p["system"] is not None]
        skipped = len(mine) - len(usable)
        if skipped:
            notes.append(f"{col[0]}.{col[1]}: {skipped} คลิปไม่มีค่าจากระบบ (วิเคราะห์ไม่ได้) ไม่นำมาคิด")
        e = stats.continuous_errors([p["system"] for p in usable], [p["human"] for p in usable])
        rows.append({"criterion": col[0], "value": col[1], **e})
    return rows, pairs, notes


# ----------------------------------------------------------------------------- events
def human_events(path) -> dict[tuple[str, str], list[tuple[float, float]]]:
    """{(clip_id, criterion): [(start_s, end_s), ...]}; an empty list = labelled, no events found."""
    df = read_table(path)
    c_clip, c_crit = find_col(df, "clip_id", "clip"), find_col(df, "criterion", "เกณฑ์")
    c_start, c_end = find_col(df, "start_s", "start"), find_col(df, "end_s", "end")
    if not (c_clip and c_crit and c_start):
        raise ValueError("gt_events ต้องมีคอลัมน์ clip_id, criterion, start_s (และ end_s)")
    out: dict = {}
    for _, row in df.iterrows():
        clip, code = str(row[c_clip]).strip(), str(row[c_crit]).strip().upper()
        if not clip or clip.upper().startswith("EXAMPLE"):
            continue
        if code not in EVENT_COUNT:
            raise ValueError(f"gt_events: criterion '{code}' ต้องเป็น S2, S3 หรือ N1")
        spans = out.setdefault((clip, code), [])
        start = parse_number(row[c_start])
        if start is None:
            continue
        end = parse_number(row[c_end]) if c_end else None
        spans.append((start, end if end is not None else start))
    return out


def system_events(result: dict, code: str) -> tuple[list[tuple[float, float]], str | None]:
    c = criterion(result, code) or {}
    spans = [(float(e["start_s"]), float(e.get("end_s", e["start_s"]))) for e in c.get("evidence") or []]
    count = (c.get("values") or {}).get(EVENT_COUNT[code])
    warn = None
    if c.get("status") != "ok":
        warn = "วิเคราะห์ไม่ได้"
    elif isinstance(count, (int, float)) and int(count) != len(spans):
        warn = f"evidence {len(spans)} รายการ ไม่เท่าค่า {EVENT_COUNT[code]} = {count}"
    return spans, warn


def compare_events(human: dict, results: dict, tol: dict, bin_s: float) -> tuple[list[dict], list[dict], list[str]]:
    per_clip, notes = [], []
    for (clip, code), h_spans in sorted(human.items()):
        r = results.get(clip)
        if r is None:
            notes.append(f"ไม่พบผลวิเคราะห์ของ {clip}")
            continue
        s_spans, warn = system_events(r, code)
        if warn == "วิเคราะห์ไม่ได้":
            notes.append(f"{clip} {code}: ระบบวิเคราะห์ไม่ได้ ไม่นำมาคิด")
            continue
        if warn:
            notes.append(f"{clip} {code}: {warn}")
        tp, fp, fn, matched = stats.match_events([s for s, _ in s_spans], [h for h, _ in h_spans], tol[code])
        duration = float(r.get("duration_s") or max([e for _, e in s_spans + h_spans] + [bin_s]))
        per_clip.append({"clip_id": clip, "criterion": code, "human": len(h_spans), "system": len(s_spans),
                         "tp": tp, "fp": fp, "fn": fn,
                         "mean_onset_diff_s": float(np.mean([d for *_, d in matched])) if matched else float("nan"),
                         "_bins_h": stats.time_bins(h_spans, duration, bin_s),
                         "_bins_s": stats.time_bins(s_spans, duration, bin_s)})
    rows = []
    for code in EVENT_COUNT:
        mine = [p for p in per_clip if p["criterion"] == code]
        if not mine:
            continue
        ev = stats.prf(sum(p["tp"] for p in mine), sum(p["fp"] for p in mine), sum(p["fn"] for p in mine))
        bh = np.concatenate([p["_bins_h"] for p in mine])
        bs = np.concatenate([p["_bins_s"] for p in mine])
        cm = stats.confusion(bh.tolist(), bs.tolist(), [0, 1])
        tb = stats.prf(int(cm[1, 1]), int(cm[0, 1]), int(cm[1, 0]))
        rows.append({"criterion": code, "event": EVENT_NAME[code], "clips": len(mine), "tol_s": tol[code],
                     "human": sum(p["human"] for p in mine), "system": sum(p["system"] for p in mine),
                     "tp": ev["tp"], "fp": ev["fp"], "fn": ev["fn"],
                     "precision": ev["precision"], "recall": ev["recall"], "f1": ev["f1"],
                     "bins": int(bh.size), "bin_accuracy": float(np.mean(bh == bs)),
                     "bin_kappa": stats.cohen_kappa(bh.tolist(), bs.tolist(), [0, 1]),
                     "bin_precision": tb["precision"], "bin_recall": tb["recall"], "bin_f1": tb["f1"]})
    for p in per_clip:
        p.pop("_bins_h"), p.pop("_bins_s")
    return rows, per_clip, notes


# ----------------------------------------------------------------------------- C2 labels
def compare_topics(path, results: dict, labels: list[str]) -> tuple[dict | None, list[dict], list[str]]:
    df = read_table(path)
    c_clip, c_topic, c_label = find_col(df, "clip_id", "clip"), find_col(df, "topic_id", "topic"), find_col(df, "label", "ป้าย")
    if not (c_clip and c_topic and c_label):
        raise ValueError("gt_topics ต้องมีคอลัมน์ clip_id, topic_id, label")
    pairs, notes = [], []
    skipped = set()
    for _, row in df.iterrows():
        clip, tid, lab = str(row[c_clip]).strip(), str(row[c_topic]).strip(), str(row[c_label]).strip()
        if not clip or clip.upper().startswith("EXAMPLE"):
            continue
        if lab not in labels:
            raise ValueError(f"gt_topics: ป้าย '{lab}' ต้องเป็น {', '.join(labels)}")
        r = results.get(clip)
        if r and (criterion(r, "C2") or {}).get("status") != "ok":
            skipped.add(clip)
            continue
        sys_lab = {t.get("id"): t.get("coverage") for t in (r or {}).get("topics") or []}.get(tid)
        if sys_lab is None:
            notes.append(f"{clip} {tid}: ไม่มีป้ายจากระบบ")
            continue
        pairs.append({"clip_id": clip, "topic_id": tid, "human": lab, "system": sys_lab})
    if skipped:
        notes.append(f"ข้าม {len(skipped)} คลิปที่ C2 วิเคราะห์ไม่ได้")
    if not pairs:
        return None, pairs, notes
    rep = stats.classification_report([p["human"] for p in pairs], [p["system"] for p in pairs], labels)
    return rep, pairs, notes


# ----------------------------------------------------------------------------- report
NAMES = {"not_mentioned": "ไม่ได้กล่าวถึง", "brief": "กล่าวถึงบางส่วน", "clear": "อธิบายชัดเจน"}


def report(vrows, erows, ecl, topic_rep, labels, notes, bin_s) -> str:
    lines = ["# ความแม่นยำของการวัดเทียบกับการนับของคน", ""]
    if vrows:
        lines += ["## ค่าต่อเนื่อง", "",
                  md_table(vrows, [("criterion", "เกณฑ์"), ("value", "ค่า"), ("n", "n"), ("mae", "MAE"), ("mape", "MAPE (%)"),
                                   ("n_mape", "n (MAPE)"), ("rmse", "RMSE"), ("bias", "ระบบ − คน (เฉลี่ย)"),
                                   ("pearson_r", "Pearson r"), ("spearman_rho", "Spearman ρ")]), "",
                  "MAPE ไม่นับคลิปที่คนนับได้ 0 (หารด้วยศูนย์ไม่ได้) · r และ ρ ต้องมีอย่างน้อย 3 คลิป", ""]
    if erows:
        lines += ["## การตรวจจับเหตุการณ์", "",
                  "ระดับเหตุการณ์: จับคู่เวลาเริ่มของระบบกับคนแบบหนึ่งต่อหนึ่ง ห่างไม่เกิน tol วินาที", "",
                  md_table(erows, [("criterion", "เกณฑ์"), ("event", "เหตุการณ์"), ("clips", "คลิป"), ("tol_s", "tol (วินาที)"),
                                   ("human", "คนนับ"), ("system", "ระบบพบ"), ("tp", "TP"), ("fp", "FP"), ("fn", "FN"),
                                   ("precision", "Precision"), ("recall", "Recall"), ("f1", "F1")]), "",
                  f"ระดับช่วงเวลา: แบ่งคลิปเป็นช่วงละ {bin_s} วินาที แต่ละช่วงมี / ไม่มีเหตุการณ์", "",
                  md_table(erows, [("criterion", "เกณฑ์"), ("bins", "จำนวนช่วง"), ("bin_accuracy", "Accuracy"),
                                   ("bin_kappa", "Cohen's κ"), ("bin_precision", "Precision"), ("bin_recall", "Recall"),
                                   ("bin_f1", "F1")]), "",
                  "### รายคลิป", "",
                  md_table(ecl, [("clip_id", "คลิป"), ("criterion", "เกณฑ์"), ("human", "คนนับ"), ("system", "ระบบพบ"),
                                 ("tp", "TP"), ("fp", "FP"), ("fn", "FN"), ("mean_onset_diff_s", "ห่างเฉลี่ย (วินาที)")]), ""]
    if topic_rep:
        cm = topic_rep["confusion"]
        grid = [{"h": NAMES.get(lab, lab), **{f"s{j}": cm[i][j] for j in range(len(labels))}} for i, lab in enumerate(labels)]
        per = [{"label": NAMES.get(lab, lab), **topic_rep["per_label"][lab]} for lab in labels]
        lines += ["## ป้ายหัวข้อ C2", "",
                  f"n = {topic_rep['n']} หัวข้อ · Accuracy {fmt(topic_rep['accuracy'])} · macro-F1 {fmt(topic_rep['macro_f1'])} · "
                  f"Cohen's κ {fmt(topic_rep['kappa'])} · QWK {fmt(topic_rep['qwk'])}"
                  + (" (— = ไม่มีความแปรปรวน คำนวณไม่ได้)" if any(v != v for v in (topic_rep['kappa'], topic_rep['qwk'])) else ""),
                  "",
                  "ตารางความสับสน (แถว = คน, คอลัมน์ = ระบบ)", "",
                  md_table(grid, [("h", "คน \\ ระบบ"), *[(f"s{j}", NAMES.get(lab, lab)) for j, lab in enumerate(labels)]], 0), "",
                  md_table(per, [("label", "ป้าย"), ("precision", "Precision"), ("recall", "Recall"), ("f1", "F1")]), ""]
    if notes:
        lines += ["## หมายเหตุ", "", *[f"- {n}" for n in notes], ""]
    return "\n".join(lines)


def main(argv=None) -> list[Path]:
    cfg = eval_config()["measurement"]
    ap = argparse.ArgumentParser(description="ความแม่นยำของการวัดเทียบกับค่าที่คนนับ")
    ap.add_argument("--values", help="gt_values.csv (ค่ารวมต่อคลิป)")
    ap.add_argument("--events", help="gt_events.csv (เวลาของแต่ละเหตุการณ์)")
    ap.add_argument("--topics", help="gt_topics.csv (ป้ายหัวข้อ C2)")
    ap.add_argument("--runs", nargs="+", default=None, help="โฟลเดอร์ผลวิเคราะห์ (ค่าเริ่ม data/runs)")
    ap.add_argument("--out", default=str(OUT / "measurement"))
    a = ap.parse_args(argv)
    if not (a.values or a.events or a.topics):
        ap.error("ต้องให้อย่างน้อยหนึ่งไฟล์: --values, --events หรือ --topics")
    results = load_results(a.runs)
    notes, csvs = [], {}
    vrows, erows, ecl, topic_rep = [], [], [], None
    if a.values:
        vrows, pairs, n = compare_values(human_values(a.values), results)
        notes += n
        csvs |= {"values": vrows, "values_by_clip": pairs}
    if a.events:
        erows, ecl, n = compare_events(human_events(a.events), results, cfg["tol_s"], cfg["time_bin_s"])
        notes += n
        csvs |= {"events": erows, "events_by_clip": ecl}
    if a.topics:
        topic_rep, tpairs, n = compare_topics(a.topics, results, cfg["c2_labels"])
        notes += n
        if topic_rep:
            csvs |= {"topics": [{"label": k, **v} for k, v in topic_rep["per_label"].items()]
                     + [{"label": "ALL", "accuracy": topic_rep["accuracy"], "macro_f1": topic_rep["macro_f1"],
                         "kappa": topic_rep["kappa"], "qwk": topic_rep["qwk"], "n": topic_rep["n"]}],
                     "topics_by_clip": tpairs}
    md = report(vrows, erows, ecl, topic_rep, cfg["c2_labels"], notes, cfg["time_bin_s"])
    written = write_outputs(a.out, "measurement", md, csvs)
    print(f"→ {written[0]}" + (f" ({len(notes)} หมายเหตุ)" if notes else ""))
    return written


if __name__ == "__main__":
    main()
