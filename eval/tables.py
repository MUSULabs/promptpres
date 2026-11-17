"""Shared input/output for eval/: read CSV/XLSX exports, parse scores, load run results, write md + csv.

อ่านไฟล์ที่ส่งออกจาก Google Forms / Excel, อ่านผลวิเคราะห์ใน data/runs, เขียนตาราง Markdown + CSV
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

REPO = Path(__file__).resolve().parents[1]          # Code/promptpres
CONFIG = REPO / "config"
RUNS = Path(os.environ.get("PROMPTPRES_RUNS", REPO / "data" / "runs"))
OUT = REPO / "data" / "eval"                         # gitignored: answers may hold names / emails
CODES = ["C1", "C2", "S1", "S2", "S3", "N1", "N2", "T1"]
CODE_RE = re.compile(r"(?<![A-Za-z0-9])(C1|C2|S1|S2|S3|N1|N2|T1)(?![0-9])")

# Windows consoles default to cp1252 and cannot print Thai
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass


# ----------------------------------------------------------------------------- config
def eval_config(path: str | Path | None = None) -> dict:
    return yaml.safe_load(Path(path or CONFIG / "eval-v0.yaml").read_text(encoding="utf-8"))


def thresholds(path: str | Path | None = None) -> dict:
    """Same file and env var as the worker (worker/criteria/base.py load_thresholds)."""
    path = path or CONFIG / os.environ.get("PROMPTPRES_THRESHOLDS", "thresholds-v0.yaml")
    return yaml.safe_load(Path(path).read_text(encoding="utf-8"))


# ----------------------------------------------------------------------------- reading inputs
def read_table(path: str | Path) -> pd.DataFrame:
    """CSV (UTF-8 with or without BOM; Thai Excel 'CSV' = cp874) or XLSX → DataFrame of strings."""
    path = Path(path)
    if path.suffix.lower() in (".xlsx", ".xls"):
        df = pd.read_excel(path, dtype=str)
    else:
        try:
            df = pd.read_csv(path, dtype=str, encoding="utf-8-sig", keep_default_na=False)
        except UnicodeDecodeError:
            print(f"หมายเหตุ: {path.name} ไม่ใช่ UTF-8 อ่านแบบ cp874 (CSV จาก Excel ภาษาไทย)", file=sys.stderr)
            df = pd.read_csv(path, dtype=str, encoding="cp874", keep_default_na=False)
    df.columns = [str(c).strip() for c in df.columns]
    return df.fillna("")


NUM_RE = re.compile(r"^\s*([+\-−–]?\s*\d+(?:\.\d+)?)")


def parse_number(text) -> float | None:
    """Leading number of a cell: '+1 (สอดคล้อง)' → 1, '−1' → -1, '5 - เห็นด้วยอย่างยิ่ง' → 5, '' → None."""
    if text is None:
        return None
    if isinstance(text, (int, float)):
        return None if (isinstance(text, float) and math.isnan(text)) else float(text)
    m = NUM_RE.match(str(text))
    if not m:
        return None
    s = m.group(1).replace("−", "-").replace("–", "-").replace(" ", "")
    return float(s)


def find_col(df: pd.DataFrame, *names: str) -> str | None:
    """First column whose lower-cased name equals or contains one of `names`."""
    low = {c.lower(): c for c in df.columns}
    for n in names:
        if n.lower() in low:
            return low[n.lower()]
    for n in names:
        for lc, c in low.items():
            if n.lower() in lc:
                return c
    return None


# ----------------------------------------------------------------------------- runs (worker results)
def scenario_of(session_id: str) -> str:
    """'sc02_G07_P05_S05_T01' → 'S05', 's_8befcae961' (web session) → 'web', anything else → 'other'."""
    m = re.search(r"_(S\d\d)(?:_|$)", session_id)
    if m:
        return m.group(1)
    if session_id.startswith("s_"):
        return "web"
    return "other"


def load_results(runs_dirs=None) -> dict[str, dict]:
    """{session_id (= run folder name): result.json} for every folder that has a result.json."""
    out, seen = {}, set()
    for d in [Path(p) for p in (runs_dirs or [RUNS])]:
        if not d.is_dir():
            raise FileNotFoundError(f"ไม่พบโฟลเดอร์ผลวิเคราะห์ {d}")
        manifest_path = d / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else None
        if manifest is not None and set(manifest) != {p.name for p in d.iterdir() if (p / "result.json").is_file()}:
            raise ValueError("ชุดผลไม่ตรงกับ manifest")
        for sub in sorted(d.iterdir()):
            f = sub / "result.json"
            if sub.is_dir() and f.is_file():
                raw = f.read_bytes()
                if manifest is not None and hashlib.sha256(raw).hexdigest() != manifest[sub.name]:
                    raise ValueError(f"ผลวิเคราะห์ถูกเปลี่ยนหลัง snapshot: {sub.name}")
                result = json.loads(raw)
                sid = result.get("session_id", sub.name)
                if sid in seen or sub.name in out:
                    raise ValueError(f"รหัสผลวิเคราะห์ซ้ำ: {sid}")
                seen.add(sid)
                out[sub.name] = result
    return out


def criterion(result: dict, code: str) -> dict | None:
    for c in result.get("criteria") or []:
        if c.get("code") == code:
            return c
    return None


# ----------------------------------------------------------------------------- writing outputs
def fmt(x, digits: int = 2) -> str:
    """Number for a table: NaN / ±inf / None → '—', ints stay ints (numpy scalars too)."""
    if x is None:
        return "—"
    if isinstance(x, (bool, np.bool_)):
        return "ใช่" if x else "ไม่"
    if isinstance(x, np.integer):
        x = int(x)
    elif isinstance(x, np.floating):
        x = float(x)
    if isinstance(x, int):
        return str(x)
    if isinstance(x, float):
        if not math.isfinite(x):
            return "—"
        if x.is_integer() and digits >= 0 and abs(x) < 1e9:
            return f"{x:.{digits}f}" if digits else str(int(x))
        return f"{x:.{digits}f}"
    return str(x)


def md_table(rows: list[dict], columns: list[tuple[str, str]], digits: int = 2) -> str:
    """Markdown table. columns = [(key in row, Thai header), ...]."""
    head = "| " + " | ".join(h for _, h in columns) + " |"
    sep = "|" + "|".join("---" for _ in columns) + "|"
    body = ["| " + " | ".join(fmt(r.get(k), digits).replace("|", "/") for k, _ in columns) + " |" for r in rows]
    return "\n".join([head, sep, *body])


def write_outputs(out_dir: str | Path, name: str, markdown: str, csvs: dict[str, list[dict]]) -> list[Path]:
    """Write <name>.md and one <name>_<part>.csv per table (UTF-8 with BOM so Excel shows Thai)."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    written = [out_dir / f"{name}.md"]
    written[0].write_text(markdown.rstrip() + "\n", encoding="utf-8")
    for part, rows in csvs.items():
        p = out_dir / (f"{name}_{part}.csv" if part else f"{name}.csv")
        pd.DataFrame(rows).to_csv(p, index=False, encoding="utf-8-sig")
        written.append(p)
    return written
