"""Agreement of levels 1–4 (3 raters and the system) and System Usability Scale scores.

    python -m eval.agreement_and_sus levels data/eval/inputs/ratings.csv [--runs data/runs]
    python -m eval.agreement_and_sus sus data/eval/inputs/sus_responses.csv [--items Q1 Q2 … Q10]

levels — input (either shape):
  long : clip_id, criterion, rater, level            level 1–4; blank / "วิเคราะห์ไม่ได้" = no level
  wide : clip_id, rater, then one column per criterion whose header contains its code (C1 … T1)
  System levels come from data/runs/<clip_id>/result.json, unless the file has a rater named "system".
  Per criterion and overall:
    raters among themselves : Krippendorff's α (ordinal), exact % and ±1 % (mean over rater pairs)
    system vs raters        : vs the raters' median level → QWK, exact %, ±1 %, Spearman ρ;
                              QWK vs each rater (mean); α with the system as one more rater (supporting)
sus — input: Google Forms export, one row per person, 10 answer columns 1–5 found by header
  ("Q1" … "Q10", "ข้อ 1" …, or a header starting with "1." …) or listed with --items.
  SUS = (Σ(odd − 1) + Σ(5 − even)) × 2.5 per person; mean, SD, median, min, max, 95% CI, bands from config.
People are shown as R1, R2, … (no names or emails in the outputs).
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

import numpy as np

from eval import stats
from eval.tables import (CODE_RE, CODES, OUT, criterion, eval_config, find_col, fmt, load_results, md_table,
                         parse_number, read_table, write_outputs)

SYSTEM = "system"
SUS_RANGE = (0.0, 100.0)        # SUS scores are 0–100 by definition (Brooke 1996); the CI is clipped to it


# ----------------------------------------------------------------------------- levels
def read_levels(path) -> dict[tuple[str, str], dict[str, float | None]]:
    """{(clip_id, criterion): {rater: level or None}}."""
    df = read_table(path)
    c_clip = find_col(df, "clip_id", "clip", "คลิป")
    c_rater = find_col(df, "rater", "ผู้ประเมิน", "email", "อีเมล")
    if not (c_clip and c_rater):
        raise ValueError("ไฟล์ระดับต้องมีคอลัมน์ clip_id และ rater")
    c_crit, c_level = find_col(df, "criterion", "เกณฑ์"), find_col(df, "level", "ระดับ")
    out: dict = {}
    long = c_crit is not None and c_level is not None and c_crit != c_level
    for _, row in df.iterrows():
        clip, rater = str(row[c_clip]).strip(), str(row[c_rater]).strip()
        if not clip or clip.upper().startswith("EXAMPLE"):
            continue
        if long:
            cells = [(str(row[c_crit]).strip().upper(), row[c_level])]
        else:
            cells = [(CODE_RE.search(c).group(1), row[c]) for c in df.columns
                     if c not in (c_clip, c_rater) and CODE_RE.search(c)]
        for code, cell in cells:
            if code not in CODES:
                raise ValueError(f"ไม่รู้จักเกณฑ์ '{code}'")
            lv = parse_number(cell)
            if lv is not None and lv not in (1, 2, 3, 4):
                raise ValueError(f"ระดับของ {rater} คลิป {clip} เกณฑ์ {code} = '{cell}' ต้องเป็น 1–4")
            out.setdefault((clip, code), {})[rater] = lv
    if not out:
        raise ValueError("ไม่พบระดับในไฟล์ (หัวคอลัมน์ต้องมีรหัสเกณฑ์ C1 … T1 หรือมีคอลัมน์ criterion + level)")
    return out


def add_system(data: dict, results: dict) -> list[str]:
    """Fill the 'system' level of each (clip, criterion) from result.json unless the file already has it."""
    notes = []
    if any(SYSTEM in {r.lower() for r in v} for v in data.values()):
        for v in data.values():                                   # normalise the name
            for r in list(v):
                if r.lower() == SYSTEM and r != SYSTEM:
                    v[SYSTEM] = v.pop(r)
        return notes
    for (clip, code), v in data.items():
        r = results.get(clip)
        if r is None:
            v[SYSTEM] = None
            notes.append(f"ไม่พบผลวิเคราะห์ของ {clip}")
            continue
        c = criterion(r, code) or {}
        v[SYSTEM] = c.get("level") if c.get("status") == "ok" else None
    return notes


def agreement(units: list[dict], levels: list[int], within: int) -> dict:
    """Statistics for one set of units, each unit = {rater: level or None, 'system': level or None}."""
    raters = sorted({r for u in units for r in u if r != SYSTEM})
    table = {r: [u.get(r) for u in units] for r in raters}
    pairs = stats.pairwise(table, lambda a, b: stats.exact_adjacent(a, b, within))
    consensus = [stats.median_level([u.get(r) for r in raters]) for u in units]
    system = [u.get(SYSTEM) for u in units]
    vs = stats.exact_adjacent(system, consensus, within)
    keep = [k for k, (s, c) in enumerate(zip(system, consensus)) if s is not None and not np.isnan(c)]
    sys_k = [int(system[k]) for k in keep]
    con_k = [int(consensus[k]) for k in keep]
    per_rater_qwk = []
    for r in raters:
        both = [(int(s), int(h)) for s, h in zip(system, table[r]) if s is not None and h is not None]
        per_rater_qwk.append(stats.weighted_kappa([s for s, _ in both], [h for _, h in both], levels) if both else float("nan"))
    return {
        "units": len(units), "raters": len(raters),
        "alpha_raters": stats.krippendorff_alpha([table[r] for r in raters], "ordinal", levels),
        "raters_exact_pct": _mean([p[2]["exact_pct"] for p in pairs]),
        "raters_adjacent_pct": _mean([p[2]["adjacent_pct"] for p in pairs]),
        "system_n": vs["n"], "system_missing": sum(s is None for s in system),
        "qwk_consensus": stats.weighted_kappa(con_k, sys_k, levels) if keep else float("nan"),
        "exact_pct": vs["exact_pct"], "adjacent_pct": vs["adjacent_pct"],
        "spearman": stats.spearman(sys_k, con_k),
        "qwk_mean_raters": _mean(per_rater_qwk),
        "alpha_with_system": stats.krippendorff_alpha([table[r] for r in raters] + [system], "ordinal", levels),
    }


def _mean(xs) -> float:
    xs = [x for x in xs if x is not None and not np.isnan(x)]
    return float(np.mean(xs)) if xs else float("nan")


def levels_report(rows: list[dict], notes: list[str], within: int) -> str:
    lines = ["# ความสอดคล้องของระดับ 1–4 ระหว่างผู้ประเมินและระบบ", "",
             "## ระหว่างผู้ประเมิน", "",
             md_table(rows, [("criterion", "เกณฑ์"), ("units", "คลิป"), ("raters", "ผู้ประเมิน"),
                             ("alpha_raters", "Krippendorff's α (ordinal)"), ("raters_exact_pct", "ตรงกัน (%)"),
                             ("raters_adjacent_pct", f"ห่างไม่เกิน {within} ระดับ (%)")]), "",
             "ตรงกัน / ห่างไม่เกิน 1 ระดับ = ค่าเฉลี่ยของผู้ประเมินทุกคู่", "",
             "## ระบบเทียบกับผู้ประเมิน", "",
             md_table(rows, [("criterion", "เกณฑ์"), ("system_n", "คลิปที่เทียบได้"), ("system_missing", "ระบบวิเคราะห์ไม่ได้"),
                             ("exact_pct", "ตรงกัน (%)"), ("adjacent_pct", f"ห่างไม่เกิน {within} ระดับ (%)"),
                             ("qwk_consensus", "QWK"), ("spearman", "Spearman ρ"), ("qwk_mean_raters", "QWK เฉลี่ยรายคน"),
                             ("alpha_with_system", "α รวมระบบ (ประกอบ)")]), "",
             "ตรงกัน / ห่างไม่เกิน 1 ระดับ / QWK / ρ เทียบกับมัธยฐานของผู้ประเมิน (จำนวนคู่ปัดขึ้น) · "
             "QWK เฉลี่ยรายคน = เทียบระบบกับผู้ประเมินทีละคนแล้วเฉลี่ย · คลิปที่ระบบวิเคราะห์ไม่ได้ไม่นำมาเทียบ", ""]
    if notes:
        lines += ["## หมายเหตุ", "", *[f"- {n}" for n in sorted(set(notes))], ""]
    return "\n".join(lines)


def run_levels(a, cfg) -> list[Path]:
    data = read_levels(a.ratings)
    notes = add_system(data, load_results(a.runs)) if not _has_system(data) else add_system(data, {})
    levels, within = cfg["levels"], cfg["adjacent_within"]
    rows = []
    for code in CODES:
        units = [v for (clip, c), v in sorted(data.items()) if c == code]
        if units:
            rows.append({"criterion": code, **agreement(units, levels, within)})
    rows.append({"criterion": "รวมทุกเกณฑ์", **agreement([v for _, v in sorted(data.items())], levels, within)})
    by_clip = [{"clip_id": clip, "criterion": code, **{k: v for k, v in r.items()}} for (clip, code), r in sorted(data.items())]
    raters = sorted({k for r in data.values() for k in r if k != SYSTEM})
    anon = {r: f"R{k + 1}" for k, r in enumerate(raters)}
    by_clip = [{anon.get(k, k): v for k, v in row.items()} for row in by_clip]
    written = write_outputs(a.out, "levels", levels_report(rows, notes, within), {"agreement": rows, "by_clip": by_clip})
    last = rows[-1]
    print(f"ผู้ประเมิน {last['raters']} คน · α = {fmt(last['alpha_raters'])} · ระบบตรงกัน {fmt(last['exact_pct'], 1)}% "
          f"ห่างไม่เกิน 1 ระดับ {fmt(last['adjacent_pct'], 1)}% · QWK {fmt(last['qwk_consensus'])} → {written[0]}")
    return written


def _has_system(data) -> bool:
    return any(SYSTEM in {r.lower() for r in v} for v in data.values())


# ----------------------------------------------------------------------------- SUS
ITEM_HEAD = re.compile(r"^\s*(?:Q|ข้อ(?:ที่)?)?\s*(\d{1,2})(?:[.):\s]|$)", re.I)


def sus_columns(df, items: list[str] | None) -> list[str]:
    if items:
        missing = [c for c in items if c not in df.columns]
        if missing or len(items) != 10:
            raise ValueError(f"--items ต้องมี 10 คอลัมน์ที่มีอยู่ในไฟล์ (ไม่พบ: {', '.join(missing)})")
        return items
    by_no = {}
    for c in df.columns:
        m = ITEM_HEAD.match(c)
        if m and 1 <= int(m.group(1)) <= 10 and int(m.group(1)) not in by_no:
            by_no[int(m.group(1))] = c
    if sorted(by_no) == list(range(1, 11)):
        return [by_no[k] for k in range(1, 11)]
    numeric = [c for c in df.columns
               if any(str(v).strip() for v in df[c])
               and all(parse_number(v) in (1, 2, 3, 4, 5) for v in df[c] if str(v).strip())]
    if len(numeric) == 10:
        return numeric
    raise ValueError("หาคอลัมน์คำตอบ SUS 10 ข้อไม่เจอ — ตั้งหัวคอลัมน์เป็น Q1 … Q10 หรือระบุด้วย --items")


def run_sus(a, cfg) -> list[Path]:
    df = read_table(a.answers)
    cols = sus_columns(df, a.items)
    people, excluded = [], []
    for k, (_, row) in enumerate(df.iterrows(), start=1):
        answers = [parse_number(row[c]) for c in cols]
        try:
            score = stats.sus_score(answers)
        except ValueError:
            excluded.append(f"R{k}")
            continue
        people.append({"respondent": f"R{k}", **{f"q{i + 1}": int(v) for i, v in enumerate(answers)}, "sus": score,
                       "adjective": stats.band(score, cfg["adjective"]),
                       "acceptability": stats.band(score, cfg["acceptability"])})
    scores = [p["sus"] for p in people]
    d = stats.describe(scores)
    lo, hi = stats.mean_ci(scores, bounds=SUS_RANGE)
    summary = {"n": d["n"], "mean": d["mean"], "sd": d["sd"], "median": d["median"], "min": d["min"], "max": d["max"],
               "ci95_low": lo, "ci95_high": hi, "adjective": stats.band(d["mean"], cfg["adjective"]),
               "acceptability": stats.band(d["mean"], cfg["acceptability"]), "excluded": len(excluded)}
    counts = {}
    for p in people:
        counts[p["acceptability"]] = counts.get(p["acceptability"], 0) + 1
    lines = ["# ความพึงพอใจในการใช้งาน (System Usability Scale)", "",
             "คะแนนรายคน = (ผลรวมของ (คำตอบข้อคี่ − 1) + ผลรวมของ (5 − คำตอบข้อคู่)) × 2.5 ช่วง 0–100", "",
             "## สรุป", "",
             md_table([summary], [("n", "n"), ("mean", "x̄"), ("sd", "SD"), ("median", "มัธยฐาน"), ("min", "ต่ำสุด"),
                                  ("max", "สูงสุด"), ("ci95_low", "95% CI ล่าง"), ("ci95_high", "95% CI บน"),
                                  ("adjective", "ระดับ (Bangor 2009)"), ("acceptability", "การยอมรับ (Bangor 2008)")]), "",
             "ขอบ 95% CI ถูกจำกัดไว้ในช่วง 0–100 ตามนิยามคะแนน SUS", "",
             "จำนวนคนตามการยอมรับ: " + " · ".join(f"{k} {v} คน" for k, v in counts.items()), "",
             "## รายคน", "",
             md_table(people, [("respondent", "ผู้ตอบ"), *[(f"q{i}", f"ข้อ {i}") for i in range(1, 11)], ("sus", "SUS"),
                               ("adjective", "ระดับ"), ("acceptability", "การยอมรับ")], 1), ""]
    if excluded:
        lines += [f"ไม่นำมาคิด (ตอบไม่ครบ 10 ข้อหรือคำตอบนอกช่วง 1–5): {', '.join(excluded)}", ""]
    written = write_outputs(a.out, "sus", "\n".join(lines), {"people": people, "summary": [summary]})
    print(f"SUS n = {summary['n']} · x̄ = {fmt(summary['mean'], 1)} · SD = {fmt(summary['sd'], 1)} · "
          f"{summary['adjective']} → {written[0]}")
    return written


def main(argv=None) -> list[Path]:
    cfg = eval_config()
    ap = argparse.ArgumentParser(description="ความสอดคล้องของระดับ และคะแนน SUS")
    sub = ap.add_subparsers(dest="cmd", required=True)
    lv = sub.add_parser("levels", help="ความสอดคล้องของระดับ 1–4")
    lv.add_argument("ratings")
    lv.add_argument("--runs", nargs="+", default=None)
    lv.add_argument("--out", default=str(OUT / "agreement"))
    su = sub.add_parser("sus", help="คะแนน SUS")
    su.add_argument("answers")
    su.add_argument("--items", nargs="+", default=None, help="ชื่อคอลัมน์ 10 ข้อตามลำดับ")
    su.add_argument("--out", default=str(OUT / "sus"))
    a = ap.parse_args(argv)
    return run_levels(a, cfg["agreement"]) if a.cmd == "levels" else run_sus(a, cfg["sus"])


if __name__ == "__main__":
    main()
