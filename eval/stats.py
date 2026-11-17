"""All statistics used in chapter 3/4, one plain function each (numpy only, scipy for p-values / t).

สูตรสถิติทั้งหมดของบทที่ 3–4 แยกเป็นฟังก์ชันละหนึ่งสูตร อ่านทีละบรรทัดได้ — ไม่มีค่าเกณฑ์ในไฟล์นี้
(ค่าเกณฑ์อยู่ใน config/eval-v0.yaml)

Missing values are None / NaN. A statistic that cannot be computed (no data, division by zero)
returns NaN; the tables print it as "—".
"""
from __future__ import annotations

import math
from itertools import combinations

import numpy as np
from scipy import stats as sps

NAN = float("nan")


# ----------------------------------------------------------------------------- IOC
def ioc(scores) -> float:
    """Index of item–objective congruence of one item: IOC = ΣR / N  (Rovinelli & Hambleton, 1977).

    scores: the N experts' scores for this item, each +1 (congruent), 0 (unsure) or -1 (not congruent).
    """
    scores = [s for s in scores if s is not None and not _isnan(s)]
    if not scores:
        return NAN
    return sum(scores) / len(scores)


# ----------------------------------------------------------------------------- descriptive statistics
def describe(values) -> dict:
    """n, min, P10, P25, median, mean, SD (n−1), P75, P90, max. Percentiles: linear interpolation."""
    x = _clean(values)
    keys = ["n", "min", "p10", "p25", "median", "mean", "sd", "p75", "p90", "max"]
    if x.size == 0:
        return dict.fromkeys(keys, NAN) | {"n": 0}
    return {
        "n": int(x.size),
        "min": float(x.min()),
        "p10": percentile(x, 10),
        "p25": percentile(x, 25),
        "median": percentile(x, 50),
        "mean": float(x.mean()),
        "sd": float(x.std(ddof=1)) if x.size > 1 else NAN,
        "p75": percentile(x, 75),
        "p90": percentile(x, 90),
        "max": float(x.max()),
    }


def percentile(values, p: float) -> float:
    """p-th percentile (0–100), linear interpolation between sorted values (numpy default)."""
    x = _clean(values)
    return float(np.percentile(x, p)) if x.size else NAN


# ----------------------------------------------------------------------------- continuous values
def continuous_errors(system, human) -> dict:
    """Errors of system values against human (ground-truth) values, paired by position.

    MAE  = mean |s − h|
    RMSE = sqrt(mean (s − h)²)
    MAPE = mean |s − h| / |h| × 100, only over pairs with h ≠ 0 (n_mape says how many)
    bias = mean (s − h)   (positive = system measures more than the human)
    Pearson r and Spearman ρ with two-sided p (need ≥ 3 pairs and some spread in both).
    """
    s, h = _pairs(system, human)
    out = {"n": int(s.size), "mae": NAN, "rmse": NAN, "mape": NAN, "n_mape": 0, "bias": NAN,
           "pearson_r": NAN, "pearson_p": NAN, "spearman_rho": NAN, "spearman_p": NAN}
    if s.size == 0:
        return out
    err = s - h
    out["mae"] = float(np.mean(np.abs(err)))
    out["rmse"] = float(np.sqrt(np.mean(err ** 2)))
    out["bias"] = float(np.mean(err))
    nonzero = h != 0
    out["n_mape"] = int(nonzero.sum())
    if nonzero.any():
        out["mape"] = float(np.mean(np.abs(err[nonzero]) / np.abs(h[nonzero])) * 100)
    if s.size >= 3 and _spread(s) and _spread(h):
        r = sps.pearsonr(s, h)
        rho = sps.spearmanr(s, h)
        out.update(pearson_r=float(r.statistic), pearson_p=float(r.pvalue),
                   spearman_rho=float(rho.statistic), spearman_p=float(rho.pvalue))
    return out


def spearman(a, b) -> float:
    """Spearman ρ of paired values (NaN when < 3 pairs or no spread)."""
    x, y = _pairs(a, b)
    if x.size < 3 or not _spread(x) or not _spread(y):
        return NAN
    return float(sps.spearmanr(x, y).statistic)


# ----------------------------------------------------------------------------- detection / classification
def prf(tp: int, fp: int, fn: int) -> dict:
    """Precision = TP/(TP+FP), Recall = TP/(TP+FN), F1 = 2PR/(P+R)."""
    precision = tp / (tp + fp) if tp + fp else NAN
    recall = tp / (tp + fn) if tp + fn else NAN
    if _isnan(precision) or _isnan(recall) or precision + recall == 0:
        f1 = 0.0 if (tp == 0 and (fp or fn)) else NAN
    else:
        f1 = 2 * precision * recall / (precision + recall)
    return {"tp": tp, "fp": fp, "fn": fn, "precision": precision, "recall": recall, "f1": f1}


def match_events(system_onsets, human_onsets, tol_s: float) -> tuple[int, int, int, list]:
    """One-to-one matching of event start times.

    Every (system, human) pair closer than tol_s is a candidate; the closest pairs are taken first and
    each event can be used once. Matched = TP, unmatched system = FP, unmatched human = FN.
    Returns (tp, fp, fn, pairs) with pairs = [(system_index, human_index, diff_s), ...].
    """
    cands = []
    for i, s in enumerate(system_onsets):
        for j, h in enumerate(human_onsets):
            d = abs(float(s) - float(h))
            if d <= tol_s + 1e-9:
                cands.append((d, i, j))
    cands.sort()
    used_s, used_h, pairs = set(), set(), []
    for d, i, j in cands:
        if i in used_s or j in used_h:
            continue
        used_s.add(i)
        used_h.add(j)
        pairs.append((i, j, d))
    tp = len(pairs)
    return tp, len(system_onsets) - tp, len(human_onsets) - tp, pairs


def time_bins(spans, duration_s: float, bin_s: float) -> np.ndarray:
    """0/1 per time bin: 1 when any event span (start_s, end_s) touches that bin.

    A zero-length event marks the bin that contains its start.
    """
    n = max(1, math.ceil(duration_s / bin_s))
    marks = np.zeros(n, dtype=int)
    for start, end in spans:
        first = int(start // bin_s)
        last = math.ceil(end / bin_s) - 1 if end > start else first   # bin i covers [i·bin_s, (i+1)·bin_s)
        first = min(max(first, 0), n - 1)      # an event starting at / after the end marks the last bin
        last = min(max(last, first), n - 1)
        marks[first:last + 1] = 1
    return marks


def confusion(a, b, labels) -> np.ndarray:
    """Confusion matrix: rows = labels of `a` (truth / rater 1), columns = labels of `b` (system / rater 2)."""
    idx = {lab: k for k, lab in enumerate(labels)}
    m = np.zeros((len(labels), len(labels)), dtype=float)
    for x, y in zip(a, b):
        if x is None or y is None or x not in idx or y not in idx:
            continue
        m[idx[x], idx[y]] += 1
    return m


def cohen_kappa(a, b, labels) -> float:
    """Cohen's κ = (po − pe) / (1 − pe)  (Cohen, 1960).

    po = share of items both give the same label; pe = Σ_k (share of a with k) × (share of b with k).
    """
    m = confusion(a, b, labels)
    n = m.sum()
    if n == 0:
        return NAN
    po = np.trace(m) / n
    pe = float((m.sum(axis=1) / n) @ (m.sum(axis=0) / n))
    if pe == 1:                         # both sides used one same label throughout: no variation, κ is 0/0
        return NAN
    return float((po - pe) / (1 - pe))


def weighted_kappa(a, b, labels, weight: str = "quadratic") -> float:
    """Weighted κ for ordered labels (Cohen, 1968). quadratic = QWK.

    w_ij = (i − j)² / (k − 1)²  (quadratic)  or  |i − j| / (k − 1)  (linear)
    κ_w = 1 − Σ w_ij O_ij / Σ w_ij E_ij,  E_ij = row_i × col_j / n  (expected under chance)
    """
    m = confusion(a, b, labels)
    n = m.sum()
    k = len(labels)
    if n == 0 or k < 2:
        return NAN
    i, j = np.meshgrid(np.arange(k), np.arange(k), indexing="ij")
    w = (i - j) ** 2 / (k - 1) ** 2 if weight == "quadratic" else np.abs(i - j) / (k - 1)
    expected = np.outer(m.sum(axis=1), m.sum(axis=0)) / n
    denom = float((w * expected).sum())
    if denom == 0:                      # no variation (one level on both sides): undefined, not "perfect"
        return NAN
    return float(1 - (w * m).sum() / denom)


def classification_report(truth, pred, labels) -> dict:
    """Accuracy, per-label precision/recall/F1, macro-F1, Cohen's κ and QWK (labels in their order)."""
    m = confusion(truth, pred, labels)
    n = m.sum()
    per = {}
    for k, lab in enumerate(labels):
        tp = int(m[k, k])
        per[lab] = prf(tp, int(m[:, k].sum()) - tp, int(m[k, :].sum()) - tp)
    f1s = [v["f1"] for v in per.values() if not _isnan(v["f1"])]
    return {
        "n": int(n),
        "confusion": m.astype(int).tolist(),
        "accuracy": float(np.trace(m) / n) if n else NAN,
        "per_label": per,
        "macro_f1": float(np.mean(f1s)) if f1s else NAN,
        "kappa": cohen_kappa(truth, pred, labels),
        "qwk": weighted_kappa(truth, pred, labels),
    }


# ----------------------------------------------------------------------------- level agreement
def exact_adjacent(a, b, within: int = 1) -> dict:
    """% of pairs with the same level, and % within ±`within` levels (pairs with a missing side skipped)."""
    x, y = _pairs(a, b)
    if x.size == 0:
        return {"n": 0, "exact_pct": NAN, "adjacent_pct": NAN}
    diff = np.abs(x - y)
    return {"n": int(x.size), "exact_pct": float(np.mean(diff == 0) * 100),
            "adjacent_pct": float(np.mean(diff <= within) * 100)}


def krippendorff_alpha(data, metric: str = "ordinal", values=None) -> float:
    """Krippendorff's α for several raters with missing values (Krippendorff, 2011, coincidence matrix).

    data: rows = raters, columns = units (clips); None / NaN = no rating.
    1. Units with fewer than 2 ratings are dropped.
    2. Coincidence matrix o_ck: in each unit, every ordered pair of ratings (c, k) from two different
       raters adds 1 / (m_u − 1), m_u = number of ratings in that unit.
    3. n_c = Σ_k o_ck,  n = Σ n_c.
    4. Distance δ²_ck: nominal 0/1; interval (c − k)²;
       ordinal (Σ_{g=c..k} n_g − (n_c + n_k)/2)²  (ranks of the values actually used).
    5. α = 1 − (n − 1) Σ o_ck δ²_ck / Σ n_c n_k δ²_ck.
    """
    arr = np.array([[NAN if v is None else float(v) for v in row] for row in data], dtype=float)
    if not arr.size:
        return NAN
    if values is None:
        values = sorted(set(arr[~np.isnan(arr)].tolist()))
    values = list(values)
    idx = {v: k for k, v in enumerate(values)}
    k = len(values)
    o = np.zeros((k, k))
    for u in range(arr.shape[1]):
        col = [v for v in arr[:, u] if not np.isnan(v)]
        m_u = len(col)
        if m_u < 2:
            continue
        for p, q in [(p, q) for p in range(m_u) for q in range(m_u) if p != q]:
            o[idx[col[p]], idx[col[q]]] += 1 / (m_u - 1)
    n_c = o.sum(axis=1)
    n = n_c.sum()
    if n <= 1:
        return NAN
    delta = _rating_distances(metric, values, n_c)
    expected = float((np.outer(n_c, n_c) * delta).sum())
    if expected == 0:                   # every rating the same value: no variation, α is undefined
        return NAN
    return float(1 - (n - 1) * (o * delta).sum() / expected)


def _rating_distances(metric, values, counts):
    k = len(values)
    delta = np.zeros((k, k))
    for c in range(k):
        for e in range(k):
            if metric == "nominal":
                delta[c, e] = 0.0 if c == e else 1.0
            elif metric == "interval":
                delta[c, e] = (values[c] - values[e]) ** 2
            elif metric == "ordinal":
                lo, hi = min(c, e), max(c, e)
                delta[c, e] = (counts[lo:hi + 1].sum() - (counts[c] + counts[e]) / 2) ** 2
            else:
                raise ValueError(f"unknown metric {metric}")
    return delta


def pairwise(raters: dict, fn) -> list[tuple[str, str, object]]:
    """Apply fn(a, b) to every pair of raters: [(name_a, name_b, result), ...]."""
    return [(x, y, fn(raters[x], raters[y])) for x, y in combinations(list(raters), 2)]


def median_level(levels) -> float:
    """Consensus level of several raters = median; a .5 median (even number of raters) is rounded up."""
    x = _clean(levels)
    if x.size == 0:
        return NAN
    return float(math.floor(np.median(x) + 0.5))


# ----------------------------------------------------------------------------- SUS
def sus_score(answers) -> float:
    """System Usability Scale score 0–100 of one person (Brooke, 1996).

    answers: 10 answers on a 1–5 scale, in questionnaire order.
    Odd items (1,3,5,7,9, positive wording) contribute (answer − 1);
    even items (2,4,6,8,10, negative wording) contribute (5 − answer); the sum × 2.5.
    """
    if len(answers) != 10 or any(a is None or _isnan(a) or not 1 <= a <= 5 for a in answers):
        raise ValueError("SUS needs 10 answers between 1 and 5")
    odd = sum(answers[i] - 1 for i in range(0, 10, 2))
    even = sum(5 - answers[i] for i in range(1, 10, 2))
    return (odd + even) * 2.5


def mean_ci(values, level: float = 0.95, bounds: tuple[float, float] | None = None) -> tuple[float, float]:
    """Confidence interval of the mean with the t distribution: x̄ ± t(1−α/2, n−1) · SD / √n.

    bounds=(lo, hi): clip both ends to the scale's possible range (e.g. SUS 0–100); with a small n
    the t interval can otherwise run past the scale.
    """
    x = _clean(values)
    if x.size < 2:
        return NAN, NAN
    half = sps.t.ppf(0.5 + level / 2, x.size - 1) * x.std(ddof=1) / math.sqrt(x.size)
    low, high = float(x.mean() - half), float(x.mean() + half)
    if bounds is not None and not (_isnan(low) or _isnan(high)):
        low, high = max(bounds[0], low), min(bounds[1], high)
    return low, high


def band(value: float, bands: list[dict]) -> str:
    """Label of the first band (sorted high → low by `min`) whose min the value reaches."""
    if value is None or _isnan(value):
        return "—"
    for b in sorted(bands, key=lambda b: -b["min"]):
        if value >= b["min"]:
            return b["label"]
    return "—"


# ----------------------------------------------------------------------------- helpers
def _spread(x: np.ndarray) -> bool:
    """Enough spread for a correlation (constant or near-constant input would give NaN + a scipy warning)."""
    return bool(np.std(x) > 1e-12 * max(1.0, float(np.max(np.abs(x)))))


def _isnan(x) -> bool:
    return isinstance(x, float) and math.isnan(x)


def _clean(values) -> np.ndarray:
    x = np.array([NAN if v is None else float(v) for v in values], dtype=float)
    return x[~np.isnan(x)]


def _pairs(a, b) -> tuple[np.ndarray, np.ndarray]:
    """Paired arrays with every pair that has a missing side removed."""
    x = np.array([NAN if v is None else float(v) for v in a], dtype=float)
    y = np.array([NAN if v is None else float(v) for v in b], dtype=float)
    keep = ~np.isnan(x) & ~np.isnan(y)
    return x[keep], y[keep]
