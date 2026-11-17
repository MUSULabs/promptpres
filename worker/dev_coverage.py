"""Re-run only the topic-coverage step (C2, C1) with a chosen prompt version on existing runs.

Uses the transcript.json + topics.json already in each run folder (no ASR, no video). The new
coverage goes to coverage-<prompt>.json beside the run; coverage.json and result.json are not touched.
Prints the current result (result.json) next to the new prompt, and for SC02 S01 / S11 clips how many
topic labels match what the recording protocol asked the speaker to do.

    python -m worker.dev_coverage --prompt coverage-v2 --runs sc02_G03_P07_S11_T01 sc02_G03_P07_S01_T01
    python -m worker.dev_coverage --prompt coverage-v2 --scenarios S01 S11     # every sc02 run of those scenarios
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from worker.criteria import c1, c2
from promptpres_shared.settings import load_thresholds
from worker.llm import coverage
from worker.session import Session
from worker.settings import REPO, RUNS_DIR, pipeline_config

# What the SC02 protocol asked for (vault Knowledge/05_Data_Collection/SPEAKER_PACKET_QA.md):
# S01 = natural talk, all 4 points explained; S11 = K01 partly, K02 name only, K03 skipped, K04 full.
PROTOCOL = {
    "S01": {"H01": "clear", "H02": "clear", "H03": "clear", "H04": "clear"},
    "S11": {"H01": "brief", "H02": "brief", "H03": "not_mentioned", "H04": "clear"},
}
OUT_DIR = REPO / "data" / "eval" / "c2_prompt_check"


def scenario(run_name: str) -> str | None:
    m = re.search(r"_(S\d\d)(?:_|$)", run_name)
    return m.group(1) if m else None


def card(cards: list[dict], code: str) -> dict:
    return next((c for c in cards if c["code"] == code), {})


def summary(cards: list[dict], labels: dict) -> dict:
    a, b = card(cards, "C2"), card(cards, "C1")
    return {"labels": labels, "C2_level": a.get("level"), "C2_clear_pct": (a.get("values") or {}).get("coverage_clear_pct"),
            "C1_level": b.get("level"), "C1_tau": (b.get("values") or {}).get("kendall_tau"), "C1_status": b.get("status")}


def check(run_dir: Path, prompt: str, cfg: dict, th: dict) -> dict:
    """Current result vs the given prompt for one run folder."""
    old = json.loads((run_dir / "result.json").read_text(encoding="utf-8"))
    old_cov = json.loads((run_dir / "coverage.json").read_text(encoding="utf-8")) if (run_dir / "coverage.json").exists() else {}
    before = summary(old["criteria"], {t["id"]: t["label"] for t in old_cov.get("topics", [])})
    before["prompt"] = old_cov.get("prompt")

    session = Session.from_dir(run_dir, run_dir.name, old.get("target_duration_s"))
    if not session.topics or not (session.transcript or {}).get("words"):
        raise SystemExit(f"{run_dir.name}: no topics.json or transcript words")
    session.coverage = coverage.analyse(session.topics, session.transcript, old.get("duration_s"),
                                        run_dir / f"coverage-{prompt}.json", cfg["llm"], th["criteria"]["C2"],
                                        prompt=prompt)
    cards = [c1.run(session, th["criteria"]["C1"], th["criteria"]["C2"]), c2.run(session, th["criteria"]["C2"])]
    after = summary(cards, {t["id"]: t["label"] for t in session.coverage["topics"]})
    after["prompt"] = session.coverage["prompt"]
    row = {"run": run_dir.name, "scenario": scenario(run_dir.name), "before": before, "after": after}
    expected = PROTOCOL.get(row["scenario"])
    if expected:
        row["expected"] = expected
        for k in ("before", "after"):
            row[k]["protocol_match"] = sum(row[k]["labels"].get(t) == lab for t, lab in expected.items())
    return row


def short(label: str | None) -> str:
    return {"clear": "C", "brief": "b", "not_mentioned": "-"}.get(label or "", "?")


def main() -> None:
    ap = argparse.ArgumentParser(description="Re-run C2/C1 with another coverage prompt on existing runs")
    ap.add_argument("--prompt", default=coverage.PROMPT)
    ap.add_argument("--runs", nargs="*", default=[], help="run folder names under data/runs")
    ap.add_argument("--scenarios", nargs="*", default=[], help="every sc02_* run of these scenarios")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    names = list(args.runs)
    for d in sorted(RUNS_DIR.glob("sc02_*")):
        if scenario(d.name) in args.scenarios and d.name not in names and (d / "topics.json").exists():
            names.append(d.name)
    if not names:
        raise SystemExit("give --runs or --scenarios")
    cfg, th = pipeline_config(), load_thresholds()
    rows = [check(RUNS_DIR / n, args.prompt, cfg, th) for n in names]

    print(f"labels H01..H04: C = clear, b = brief, - = not_mentioned · new prompt = {args.prompt}")
    print(f"{'run':28} {'now':6} {'new':6} {'want':6} {'C2 now→new':14} {'C1 tau now→new':18} match now→new")
    totals = {}
    for r in rows:
        ids = sorted(r["after"]["labels"])
        lab = lambda d: "".join(short(d.get(i)) for i in ids)   # noqa: E731
        b, a = r["before"], r["after"]
        want = lab(r["expected"]) if "expected" in r else ""
        match = f"{b['protocol_match']}→{a['protocol_match']}/{len(r['expected'])}" if "expected" in r else ""
        print(f"{r['run']:28} {lab(b['labels']):6} {lab(a['labels']):6} {want:6} "
              f"{str(b['C2_clear_pct']) + '→' + str(a['C2_clear_pct']):14} "
              f"{str(b['C1_tau']) + '→' + str(a['C1_tau']):18} {match}")
        if "expected" in r:
            t = totals.setdefault(r["scenario"], [0, 0, 0])
            t[0] += b["protocol_match"]
            t[1] += a["protocol_match"]
            t[2] += len(r["expected"])
    for s, (b, a, n) in sorted(totals.items()):
        print(f"{s}: labels matching the protocol {b}/{n} now → {a}/{n} with {args.prompt}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{args.prompt}.json"
    out.write_text(json.dumps({"prompt": args.prompt, "rows": rows, "totals": totals}, ensure_ascii=False, indent=1),
                   encoding="utf-8")
    print("->", out)


if __name__ == "__main__":
    main()
