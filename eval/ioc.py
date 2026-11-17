"""IOC of the rubric (5 experts × 16 items, scores +1 / 0 / −1) → tables for chapters 3 and 4.

    python -m eval.ioc data/eval/inputs/ioc.csv            # → data/eval/ioc/ioc.md + CSVs
    python -m eval.ioc answers.xlsx --pass-min 0.5 --out somewhere/

Input (either shape, see eval/README.md):
  long : columns expert, item, score[, comment]           item = C1-1 … T1-2 or the form number 1–16
  wide : one row per expert (Google Forms export); a column per item whose header contains the item id
         (C1-1, C1.1, "C1 ข้อ 1") or starts with the form number ("1.", "ข้อ 1"); optional comment columns
         whose header contains the item id and "ข้อเสนอแนะ" / "comment".
Experts are shown as E1, E2, … in the order of the file; names never go into the tables.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

from eval import stats
from eval.tables import (CODE_RE, CODES, OUT, eval_config, find_col, fmt, md_table, parse_number, read_table,
                         write_outputs)

ITEMS = Path(__file__).resolve().parent / "templates" / "ioc_items.csv"
ITEM_RE = re.compile(r"(?<![A-Za-z0-9])(C1|C2|S1|S2|S3|N1|N2|T1)\s*(?:[-._]|\s)\s*(?:ข้อ(?:ที่)?\s*)?([12])(?!\d)")
FORM_NO_RE = re.compile(r"^\s*(?:ข้อ(?:ที่)?\s*)?(\d{1,2})\s*(?:[.):]|\s|$)")
COMMENT_RE = re.compile(r"ข้อเสนอแนะ|comment|suggest|เหตุผล", re.I)


def load_items(path=ITEMS) -> list[dict]:
    rows = read_table(path).to_dict("records")
    for r in rows:
        r["form_no"], r["item_no"] = int(r["form_no"]), int(r["item_no"])
    return rows


def item_of(header: str, items: list[dict]) -> str | None:
    """Item id named in a column header, e.g. 'C1-2 การแบ่งระดับ…' → 'C1-2', '3. …' → item with form_no 3."""
    m = ITEM_RE.search(header)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    m = FORM_NO_RE.match(header)
    if m:
        by_no = {it["form_no"]: it["item_id"] for it in items}
        return by_no.get(int(m.group(1)))
    return None


def read_scores(path, items: list[dict]) -> tuple[list[str], dict, dict]:
    """→ (experts, scores {item_id: {expert: score}}, comments {item_id: [(expert, text)]})."""
    df = read_table(path)
    ids = {it["item_id"] for it in items}
    scores = {i: {} for i in ids}
    comments = {key: [] for key in [*ids, *CODES]}          # per item, or per criterion when the form asks per criterion
    c_exp, c_item, c_score = find_col(df, "expert", "ผู้เชี่ยวชาญ"), find_col(df, "item"), find_col(df, "score", "คะแนน")
    if c_exp and c_item and c_score:                                         # long format
        experts = _read_long(df, items, (c_exp, c_item, c_score), scores, comments)
    else:
        experts = _read_wide(df, items, scores, comments)
    return experts, scores, comments


def _read_long(df, items, columns, scores, comments):
    c_exp, c_item, c_score = columns
    c_com = find_col(df, "comment", "ข้อเสนอแนะ")
    for line, (_, row) in enumerate(df.iterrows(), start=2):
        item = item_of(str(row[c_item]), items)
        if item is None:
            raise ValueError(f"ไม่รู้จักข้อ '{row[c_item]}' (ใช้ C1-1 … T1-2 หรือเลขข้อ 1–16)")
        expert = row[c_exp]
        if expert in scores[item]:
            raise ValueError(f"แถว {line}: ผู้เชี่ยวชาญ {expert} ส่งคะแนนข้อ {item} ซ้ำ")
        scores[item][expert] = _score(row[c_score], item, expert)
        if c_com and str(row[c_com]).strip():
            comments[item].append((expert, str(row[c_com]).strip()))
    return list(dict.fromkeys(df[c_exp]))


def _read_wide(df, items, scores, comments):
    experts = [f"E{k + 1}" for k in range(len(df))]
    found = 0
    for col in df.columns:
        is_comment = bool(COMMENT_RE.search(col))
        item = item_of(col, items)
        if item is None and is_comment and CODE_RE.search(col):
            item = CODE_RE.search(col).group(1)                                # comment box for a whole criterion
        if item is None:
            continue
        for k, cell in enumerate(df[col]):
            if is_comment:
                if str(cell).strip():
                    comments[item].append((experts[k], str(cell).strip()))
            else:
                if experts[k] in scores[item]:
                    raise ValueError(f"คอลัมน์ {col}: คะแนนข้อ {item} ซ้ำ")
                scores[item][experts[k]] = _score(cell, item, experts[k])
        found += not is_comment
    if found == 0:
        raise ValueError("ไม่พบคอลัมน์คะแนนรายข้อ — หัวคอลัมน์ต้องมีรหัสข้อ เช่น C1-1 หรือขึ้นต้นด้วยเลขข้อ 1–16")
    return experts


def _score(cell, item, expert):
    s = parse_number(cell)
    if s is None:
        return None
    if s not in (-1, 0, 1):
        raise ValueError(f"คะแนนข้อ {item} ของ {expert} = '{cell}' ต้องเป็น +1, 0 หรือ −1")
    return int(s)


def compute(experts, scores, items, pass_min, alt_min, allow_missing=False) -> tuple[list[dict], list[dict], dict]:
    """Per-item rows, per-criterion rows and a whole-form summary."""
    rows = []
    for it in sorted(items, key=lambda r: r["form_no"]):
        given = [scores[it["item_id"]].get(e) for e in experts]
        missing = [e for e, s in zip(experts, given) if s is None]
        if missing and not allow_missing:
            raise ValueError(f"ข้อ {it['item_id']} ไม่มีคะแนนของ {', '.join(missing)} (ใช้ --allow-missing เพื่อคิดจากที่มี)")
        value = stats.ioc(given)
        row = {"form_no": it["form_no"], "item_id": it["item_id"], "criterion": it["criterion"],
               "criterion_name": it["criterion_name"], "item_no": it["item_no"], "text": it["text"],
               **{e: s for e, s in zip(experts, given)},
               "sum": sum(s for s in given if s is not None), "n": len(given) - len(missing), "ioc": value,
               "pass": bool(value >= pass_min - 1e-9), "pass_alt": bool(value >= alt_min - 1e-9),
               "missing": ", ".join(missing)}
        row["result"] = "—" if value != value else "ผ่าน" if row["pass"] else "ต้องปรับปรุง"
        rows.append(row)
    per_crit = []
    for code in CODES:
        mine = [r for r in rows if r["criterion"] == code]
        if not mine:
            continue
        per_crit.append({"criterion": code, "criterion_name": mine[0]["criterion_name"],
                         **{f"ioc_{r['item_no']}": r["ioc"] for r in mine},
                         "mean": stats.ioc([r["ioc"] for r in mine]),
                         "to_fix": ", ".join(r["item_id"] for r in mine if not r["pass"]) or "—"})
    summary = {"experts": len(experts), "items": len(rows), "mean": stats.ioc([r["ioc"] for r in rows]),
               "passed": sum(r["pass"] for r in rows), "passed_alt": sum(r["pass_alt"] for r in rows)}
    return rows, per_crit, summary


def report(experts, rows, per_crit, summary, comments, pass_min, alt_min) -> str:
    ecols = [(e, e) for e in experts]
    item_cols = [("form_no", "ข้อ"), ("item_id", "รหัส"), ("criterion", "เกณฑ์"), *ecols, ("sum", "ΣR"),
                 ("ioc", "IOC"), ("result", f"ผล (≥ {pass_min:.2f})"), ("pass_alt", f"ผ่านที่ {alt_min:.2f}")]
    texts = {}
    for r in rows:
        texts.setdefault(r["text"], []).append(r["item_id"])
    lines = [
        "# ผลการตรวจความสอดคล้องของเกณฑ์ (IOC)", "",
        f"ผู้เชี่ยวชาญ {summary['experts']} ท่าน · {summary['items']} ข้อ · คะแนน +1 สอดคล้อง, 0 ไม่แน่ใจ, −1 ไม่สอดคล้อง · "
        f"IOC = ΣR / N · ข้อที่ผ่านต้องมี IOC ≥ {pass_min:.2f}", "",
        "## ตารางที่ 1 ค่า IOC รายข้อ", "", md_table(rows, item_cols), "",
        "ข้อความของแต่ละข้อ:", "",
        *[f"- {', '.join(ids)}: {t}" for t, ids in texts.items()], "",
        "## ตารางที่ 2 ค่า IOC รายเกณฑ์", "",
        md_table(per_crit, [("criterion", "เกณฑ์"), ("criterion_name", "ชื่อเกณฑ์"), ("ioc_1", "IOC ข้อ 1"),
                            ("ioc_2", "IOC ข้อ 2"), ("mean", "เฉลี่ย"), ("to_fix", "ข้อที่ต้องปรับปรุง")]), "",
        f"**สรุป:** IOC เฉลี่ยทั้งฉบับ {fmt(summary['mean'])} · ผ่าน {summary['passed']} จาก {summary['items']} ข้อ "
        f"(ที่เกณฑ์ {alt_min:.2f} ผ่าน {summary['passed_alt']} ข้อ)", "",
    ]
    missing = [r for r in rows if r["missing"]]
    if missing:
        lines += ["**ข้อที่คะแนนไม่ครบ** (คิดจากคะแนนที่มี): " + ", ".join(f"{r['item_id']} ขาด {r['missing']}" for r in missing), ""]
    if any(comments.values()):
        lines += ["## ข้อเสนอแนะของผู้เชี่ยวชาญ", ""]
        for key in [*CODES, *[r["item_id"] for r in rows]]:
            for e, text in comments.get(key, []):
                lines.append(f"- **{key}** ({_anon(e, experts)}): {text}")
    return "\n".join(lines)


def _anon(expert, experts):
    return expert if re.fullmatch(r"E\d+", str(expert)) else f"E{experts.index(expert) + 1}"


def main(argv=None) -> list[Path]:
    cfg = eval_config()["ioc"]
    ap = argparse.ArgumentParser(description="IOC รายข้อ รายเกณฑ์ และทั้งฉบับ")
    ap.add_argument("answers", help="CSV / XLSX ของคะแนน (long หรือ wide)")
    ap.add_argument("--items", default=str(ITEMS), help="รายการข้อ (ค่าเริ่ม eval/templates/ioc_items.csv)")
    ap.add_argument("--pass-min", type=float, default=cfg["pass_min"])
    ap.add_argument("--alt-min", type=float, default=cfg["alt_min"])
    ap.add_argument("--allow-missing", action="store_true", help="คิด IOC จากคะแนนที่มีเมื่อบางท่านไม่ตอบบางข้อ")
    ap.add_argument("--out", default=str(OUT / "ioc"))
    a = ap.parse_args(argv)
    items = load_items(a.items)
    experts, scores, comments = read_scores(a.answers, items)
    rows, per_crit, summary = compute(experts, scores, items, a.pass_min, a.alt_min, a.allow_missing)
    # names never go into the outputs: long-format expert names are replaced by E1, E2, …
    anon = {e: _anon(e, experts) for e in experts}
    rows = [{(anon.get(k, k)): v for k, v in r.items()} for r in rows]
    shown = [anon[e] for e in experts]
    md = report(shown, rows, per_crit, summary, {i: [(anon.get(e, e), t) for e, t in c] for i, c in comments.items()},
                a.pass_min, a.alt_min)
    written = write_outputs(a.out, "ioc", md, {"items": rows, "criteria": per_crit, "summary": [summary]})
    print(f"IOC เฉลี่ย {fmt(summary['mean'])} · ผ่าน {summary['passed']}/{summary['items']} ข้อ → {written[0]}")
    return written


if __name__ == "__main__":
    main()
