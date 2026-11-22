"""Versions written next to every feature table: model files + hashes, extractor version,
parameter hash, feature-set hash, library versions and the code commit (EXPERIMENT_PROTOCOL_V1 §7)."""
from __future__ import annotations

import hashlib
import json
import platform
import subprocess
from functools import cache
from pathlib import Path

import yaml

from research.features import EXTRACTOR_VERSION

PACKAGE_DIR = Path(__file__).resolve().parent
REPO = PACKAGE_DIR.parents[1]
PARAMS_PATH = PACKAGE_DIR / "features_v2.yaml"
MODEL_FILES = ("pose.task", "hand.task", "face.task")


def load_params(path: Path = PARAMS_PATH) -> dict:
    return yaml.safe_load(Path(path).read_text(encoding="utf-8"))


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        while block := f.read(chunk):
            h.update(block)
    return h.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def params_hash(params: dict) -> str:
    """Hash of the parameter values (key order does not matter)."""
    return sha256_text(json.dumps(params, sort_keys=True))


def feature_set_hash(columns: list[str], params: dict) -> str:
    """One id for 'these columns, computed this way': extractor version + parameters + column list."""
    return sha256_text(json.dumps({"extractor_version": EXTRACTOR_VERSION,
                                   "params": params_hash(params), "columns": list(columns)}))


@cache
def model_info(models_dir: str) -> list[dict]:
    """sha256 and size of each MediaPipe model file, checked against download_provenance.json."""
    d = Path(models_dir)
    known = {}
    prov = d / "download_provenance.json"
    if prov.exists():
        for item in json.loads(prov.read_text(encoding="utf-8")).get("items", []):
            known[f"{item['name']}.task"] = item
    out = []
    for name in MODEL_FILES:
        path = d / name
        if not path.exists():
            out.append({"file": name, "missing": True})
            continue
        digest = sha256_file(path)
        ref = known.get(name, {})
        out.append({"file": name, "bytes": path.stat().st_size, "sha256": digest,
                    "url": ref.get("url"), "matches_provenance": ref.get("sha256") == digest})
    return out


def missing_models(models_dir: Path) -> list[str]:
    return [n for n in MODEL_FILES if not (Path(models_dir) / n).exists()]


def code_version() -> dict:
    """Git commit of this repository and whether research/features has uncommitted edits."""
    def git(*args):
        res = subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True,
                             check=False, timeout=10)
        return res.stdout.strip() if res.returncode == 0 else None
    status = git("status", "--porcelain", "--", "research/features")
    return {"commit": git("rev-parse", "HEAD"),
            "features_dirty": None if status is None else bool(status)}


def library_versions() -> dict:
    import cv2
    import mediapipe
    import numpy
    import pandas
    return {"python": platform.python_version(), "mediapipe": mediapipe.__version__,
            "opencv": cv2.__version__, "numpy": numpy.__version__, "pandas": pandas.__version__}
