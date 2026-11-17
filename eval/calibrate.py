"""Spread of every measured value across runs, by SC02 scenario, plus suggested level cutoffs for thresholds-v1.

    python -m eval.calibrate                         # all of data/runs → data/eval/calibrate/
    python -m eval.calibrate --runs data/runs other/runs --reference S01 web --config-version thresholds-v0

What it writes (data/eval/calibrate/):
  calibrate.md                     tables for chapter 4 (scored values only; the CSV has every value)
  calibrate_stats.csv              n, min, P10, P25, median, mean, SD, P75, P90, max per scenario × criterion × value
  calibrate_levels.csv             how many runs got each v0 level / unanalyzable, per scenario
  calibrate_checks.csv             controlled scenarios vs S01 (expected direction, from config/eval-v0.yaml)
  calibrate_suggested.csv + thresholds-v1-suggested.yaml
                                   percentile cutoffs from the reference pool (natural practice only)

The suggested cutoffs are a starting point, never copied automatically into config/: by construction
they put about a quarter of the reference pool in each band. Decide v1 together with the IOC comments
and the agreement with the 3 raters (eval.agreement_and_sus).
"""
from __future__ import annotations

import argparse
from pathlib import Path

from eval import stats
from eval.tables import (CODES, OUT, criterion, eval_config, fmt, load_results, md_table, scenario_of,
                         thresholds, write_outputs)

ALL = "ทั้งหมด"
STAT_COLS = [("n", "n"), ("min", "ต่ำสุด"), ("p10", "P10"), ("p25", "P25"), ("median", "มัธยฐาน"), ("mean", "เฉลี่ย"),
             ("sd", "SD"), ("p75", "P75"), ("p90", "P90"), ("max", "สูงสุด")]


def collect(results: dict, config_version: str | None = None) -> list[dict]:
    """One record per run × criterion: scenario, status, level, values."""
    recs = []
    for sid, r in results.items():
        if config_version and config_version not in str((r.get("versions") or {}).get("config")):
            continue
        for code in CODES:
            c = criterion(r, code)
            if c is None:
                continue
            recs.append({"session_id": sid, "scenario": scenario_of(sid), "code": code, "status": c.get("status"),
                         "level": c.get("level"), "values": c.get("values") or {}})
    return recs


def scenario_key(s: str):
    return (0, s) if s.startswith("S") else (1, s)


def value_stats(recs: list[dict]) -> list[dict]:
    """Descriptive statistics of every numeric value of cards with status ok, per scenario and overall."""
    rows = []
    scenarios = sorted({r["scenario"] for r in recs}, key=scenario_key)
    for code in CODES:
        mine = [r for r in recs if r["code"] == code and r["status"] == "ok"]
        keys = sorted({k for r in mine for k, v in r["values"].items() if isinstance(v, (int, float))})
        for key in keys:
            for sc in [*scenarios, ALL]:
                vals = [r["values"].get(key) for r in mine if sc == ALL or r["scenario"] == sc]
                vals = [v for v in vals if isinstance(v, (int, float))]
                if vals:
                    rows.append({"criterion": code, "value": key, "scenario": sc, **stats.describe(vals)})
    return rows


def level_counts(recs: list[dict]) -> list[dict]:
    rows = []
    for sc in sorted({r["scenario"] for r in recs}, key=scenario_key):
        for code in CODES:
            mine = [r for r in recs if r["code"] == code and r["scenario"] == sc]
            if not mine:
                continue
            row = {"scenario": sc, "criterion": code, "n": len(mine)}
            for lv in (4, 3, 2, 1):
                row[f"L{lv}"] = sum(r["status"] == "ok" and r["level"] == lv for r in mine)
            row["unanalyzable"] = sum(r["status"] != "ok" for r in mine)
            rows.append(row)
    return rows


def c2_labels(results: dict) -> list[dict]:
    """How many confirmed topics got clear / brief / not_mentioned, per scenario."""
    acc = {}
    for sid, r in results.items():
        for t in r.get("topics") or []:
            row = acc.setdefault(scenario_of(sid), {"scenario": scenario_of(sid), "clear": 0, "brief": 0, "not_mentioned": 0})
            if t.get("coverage") in row:
                row[t["coverage"]] += 1
    return sorted(acc.values(), key=lambda r: scenario_key(r["scenario"]))


def scenario_checks(recs: list[dict], checks: list[dict], base: str = "S01") -> list[dict]:
    """Median of each controlled scenario vs the median of S01, in the direction the scenario should push."""
    rows = []
    for ch in checks:
        sc, code, key, expect = ch["scenario"], ch["criterion"], ch.get("value"), ch["expect"]
        here = [r for r in recs if r["code"] == code and r["scenario"] == sc]
        row = {"scenario": sc, "criterion": code, "value": key or "—", "expect": expect, "note": ch.get("note", ""),
               "n": len(here), "median": float("nan"), "median_base": float("nan")}
        if expect == "unanalyzable":
            bad = sum(r["status"] != "ok" for r in here)
            row["median"] = bad
            row["result"] = "ข้อมูลไม่พอ" if not here else ("✓" if bad == len(here) else f"✗ ({len(here) - bad} คลิปได้ระดับ)")
            rows.append(row)
            continue
        vals = [r["values"].get(key) for r in here if r["status"] == "ok"]
        base_vals = [r["values"].get(key) for r in recs if r["code"] == code and r["scenario"] == base and r["status"] == "ok"]
        vals = [v for v in vals if isinstance(v, (int, float))]
        base_vals = [v for v in base_vals if isinstance(v, (int, float))]
        row["n"] = len(vals)
        if not vals or not base_vals:
            row["result"] = "ข้อมูลไม่พอ"
        else:
            row["median"], row["median_base"] = stats.percentile(vals, 50), stats.percentile(base_vals, 50)
            ok = row["median"] > row["median_base"] if expect == "higher" else row["median"] < row["median_base"]
            row["result"] = "✓" if ok else "✗"
        rows.append(row)
    return rows


def suggest(recs: list[dict], th: dict, reference: list[str], quantiles: dict, min_n: int,
            only: list[str] | None = None) -> list[dict]:
    """Percentile cutoffs per scored value from the reference pool, in the shape of thresholds levels."""
    rows = []
    for code, spec in th["criteria"].items():
        if only is not None and code not in only:
            continue
        direction = spec.get("direction")
        q = quantiles.get(direction)
        if not q:
            continue
        pool = [r for r in recs if r["code"] == code and r["scenario"] in reference and r["status"] == "ok"]
        for key in spec.get("scored_values", []):
            vals = [r["values"].get(key) for r in pool]
            vals = [v for v in vals if isinstance(v, (int, float))]
            row = {"criterion": code, "value": key, "direction": direction, "n": len(vals),
                   "warning": "" if len(vals) >= min_n else f"n < {min_n} — ยังไม่ควรใช้"}
            for lv in (4, 3, 2):
                v0 = spec["levels"][lv].get(key)
                row[f"v0_L{lv}"] = _bound_text(v0)
                if not vals:
                    row[f"L{lv}"], row[f"L{lv}_rule"] = None, ""
                elif direction == "range":
                    lo, hi = q[lv]
                    row[f"L{lv}"] = [round(stats.percentile(vals, lo), 2), round(stats.percentile(vals, hi), 2)]
                    row[f"L{lv}_rule"] = f"P{lo}–P{hi}"
                else:
                    row[f"L{lv}"] = round(stats.percentile(vals, q[lv]), 2)
                    row[f"L{lv}_rule"] = f"{'≥' if direction == 'higher' else '≤'} P{q[lv]}"
            rows.append(row)
    return rows


def _bound_text(b) -> str:
    if b is None:
        return "—"
    if isinstance(b, list):
        return f"{fmt(float(b[0]))}–{fmt(float(b[1]))}"
    return fmt(float(b))


def suggested_yaml(rows: list[dict], reference: list[str], th: dict) -> str:
    """thresholds-v1 draft: same `levels:` shape as thresholds-v0, each number commented with its source."""
    lines = ["# SUGGESTED level bounds from eval/calibrate.py — a draft to review, NOT a config in use.",
             f"# Reference pool: scenarios {', '.join(reference)} (status ok only). Percentile shown per bound.",
             f"# Compare with {th.get('version')} (v0 in the comments) and the IOC / rater results before copying.",
             "version: thresholds-v1-suggested", "criteria:"]
    by_code = {}
    for r in rows:
        by_code.setdefault(r["criterion"], []).append(r)
    for code, rs in by_code.items():
        lines.append(f"  {code}:")
        lines.append(f"    direction: {rs[0]['direction']}")
        lines.append("    levels:")
        for lv in (4, 3, 2):
            parts, notes = [], []
            for r in rs:
                v = r[f"L{lv}"]
                parts.append(f"{r['value']}: {v if v is not None else 'null'}")
                notes.append(f"{r['value']} {r[f'L{lv}_rule'] or 'no data'} n={r['n']} (v0 {r[f'v0_L{lv}']})")
            lines.append(f"      {lv}: {{{', '.join(parts)}}}   # {'; '.join(notes)}"
                         + ("  WARNING: " + rs[0]["warning"] if rs[0]["warning"] else ""))
    return "\n".join(lines) + "\n"


def report(results, recs, vstats, levels, labels, checks, sugg, th, reference) -> str:
    scen_n = {}
    for sid in results:
        scen_n[scenario_of(sid)] = scen_n.get(scenario_of(sid), 0) + 1
    configs = sorted({str((r.get("versions") or {}).get("config")) for r in results.values()})
    lines = ["# การกระจายของค่าที่วัดได้ และค่าขอบระดับที่แนะนำ", "",
             f"ผลวิเคราะห์ {len(results)} รอบ · " + " · ".join(f"{s} {n}" for s, n in sorted(scen_n.items(), key=lambda x: scenario_key(x[0]))),
             f"รุ่น config ในผล: {', '.join(configs)}",
             "สถิติคิดเฉพาะการ์ดที่วิเคราะห์ได้ (status ok) · ฉาก S02–S12 เป็นพฤติกรรมที่สั่งให้ทำ ไม่ใช่การซ้อมธรรมชาติ", ""]
    lines += ["## 1. สถิติเชิงพรรณนาของค่าที่ใช้ตัดระดับ แยกตามฉาก", ""]
    for code in CODES:
        for key in th["criteria"].get(code, {}).get("scored_values", []):
            rows = [r for r in vstats if r["criterion"] == code and r["value"] == key]
            if rows:
                lines += [f"**{code} · {key}**", "", md_table(rows, [("scenario", "ฉาก"), *STAT_COLS]), ""]
    lines += ["ค่าประกอบอื่นทั้งหมดอยู่ใน `calibrate_stats.csv`", "",
              "## 2. จำนวนคลิปในแต่ละระดับตามขอบ v0", "",
              "ช่อง = จำนวนคลิประดับ 4 · 3 · 2 · 1 / วิเคราะห์ไม่ได้", ""]
    scen = sorted({r["scenario"] for r in levels}, key=scenario_key)
    grid = []
    for sc in scen:
        row = {"scenario": sc}
        for r in levels:
            if r["scenario"] == sc:
                row[r["criterion"]] = f"{r['L4']}·{r['L3']}·{r['L2']}·{r['L1']} / {r['unanalyzable']}"
        grid.append(row)
    lines += [md_table(grid, [("scenario", "ฉาก"), *[(c, c) for c in CODES]]), ""]
    if labels:
        lines += ["## 3. ป้ายหัวข้อของ C2 แยกตามฉาก", "",
                  md_table(labels, [("scenario", "ฉาก"), ("clear", "อธิบายชัดเจน"), ("brief", "กล่าวถึงบางส่วน"),
                                    ("not_mentioned", "ไม่ได้กล่าวถึง")]), ""]
    lines += ["## 4. ฉากควบคุมเทียบกับ S01 (ทิศทางที่ควรเป็น)", "",
              md_table(checks, [("scenario", "ฉาก"), ("note", "พฤติกรรมที่สั่ง"), ("criterion", "เกณฑ์"), ("value", "ค่า"),
                                ("expect", "ควร"), ("n", "n"), ("median", "มัธยฐานฉากนี้"), ("median_base", "มัธยฐาน S01"),
                                ("result", "ผล")]), "",
              "higher / lower = มัธยฐานของฉากควรสูงกว่า / ต่ำกว่า S01 · unanalyzable = การ์ดควรเป็นวิเคราะห์ไม่ได้ทุกคลิป "
              "(ช่องมัธยฐาน = จำนวนคลิปที่วิเคราะห์ไม่ได้)", "",
              f"## 5. ค่าขอบระดับที่แนะนำ (จากฉาก {', '.join(reference)} เท่านั้น)", "",
              "ไม่แนะนำ T1 (ขอบเป็นร้อยละของเวลาเป้าหมายของผู้ใช้ ตามข้อกำหนดของสาขา) และ C1 C2 (ขอบตามกติกาหัวข้อในรูบริก)", ""]
    shown = [{**r, **{f"L{lv}_txt": f"{_bound_text(r[f'L{lv}'])} ({r[f'L{lv}_rule']})" if r[f"L{lv}"] is not None else "—"
                      for lv in (4, 3, 2)}} for r in sugg]
    lines += [md_table(shown, [("criterion", "เกณฑ์"), ("value", "ค่า"), ("direction", "ทิศทาง"), ("n", "n"),
                               ("v0_L4", "v0 ระดับ 4"), ("L4_txt", "แนะนำ ระดับ 4"), ("v0_L3", "v0 ระดับ 3"),
                               ("L3_txt", "แนะนำ ระดับ 3"), ("v0_L2", "v0 ระดับ 2"), ("L2_txt", "แนะนำ ระดับ 2"),
                               ("warning", "หมายเหตุ")]), "",
              "ค่าแนะนำมาจากเปอร์เซ็นไทล์ของกลุ่มอ้างอิง จึงแบ่งกลุ่มนั้นเป็นส่วนเท่า ๆ กันโดยปริยาย "
              "ใช้เป็นจุดเริ่มคุยเท่านั้น ตัดสินค่า v1 ร่วมกับข้อเสนอแนะ IOC และความสอดคล้องกับผู้ประเมิน 3 ท่าน", ""]
    return "\n".join(lines)


def main(argv=None) -> list[Path]:
    cfg = eval_config()["calibration"]
    ap = argparse.ArgumentParser(description="สถิติของค่าที่วัดได้ แยกตามฉาก และค่าขอบระดับที่แนะนำ")
    ap.add_argument("--runs", nargs="+", default=None, help="โฟลเดอร์ผลวิเคราะห์ (ค่าเริ่ม data/runs)")
    ap.add_argument("--reference", nargs="+", default=cfg["reference_scenarios"], help="ฉากที่ใช้คิดค่าแนะนำ")
    ap.add_argument("--config-version", default=None, help="ใช้เฉพาะผลที่ versions.config มีข้อความนี้")
    ap.add_argument("--thresholds", default=None, help="ไฟล์ขอบระดับที่ใช้เทียบ (ค่าเริ่ม thresholds-v0.yaml)")
    ap.add_argument("--out", default=str(OUT / "calibrate"))
    a = ap.parse_args(argv)
    th = thresholds(a.thresholds)
    results = {k: v for k, v in load_results(a.runs).items()
               if not any(k.startswith(x) for x in cfg.get("exclude_prefixes") or [])}
    if a.config_version:
        results = {k: v for k, v in results.items() if a.config_version in str((v.get("versions") or {}).get("config"))}
    if not results:
        raise SystemExit("ไม่พบ result.json ในโฟลเดอร์ที่ให้มา")
    recs = collect(results)
    vstats, levels, labels = value_stats(recs), level_counts(recs), c2_labels(results)
    checks = scenario_checks(recs, cfg["scenario_checks"])
    sugg = suggest(recs, th, a.reference, cfg["quantiles"], cfg["min_n"], cfg.get("suggest_criteria"))
    md = report(results, recs, vstats, levels, labels, checks, sugg, th, a.reference)
    written = write_outputs(a.out, "calibrate", md, {"stats": vstats, "levels": levels, "checks": checks,
                                                    "suggested": sugg, "c2_labels": labels})
    y = Path(a.out) / "thresholds-v1-suggested.yaml"
    y.write_text(suggested_yaml(sugg, a.reference, th), encoding="utf-8")
    few = sorted({r["criterion"] for r in sugg if r["warning"]})
    print(f"{len(results)} รอบ → {written[0]} · {y}" + (f"\nเตือน: ข้อมูลอ้างอิงน้อยกว่า {cfg['min_n']} คลิปใน {', '.join(few)}" if few else ""))
    return [*written, y]


if __name__ == "__main__":
    main()
