"""Paths and config files shared by the worker (no numbers live here — they are in config/)."""
from __future__ import annotations

import os
import shutil
from functools import lru_cache
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[1]           # Code/promptpres
CONFIG_DIR = REPO / "config"
MODELS_DIR = Path(os.environ.get("PROMPTPRES_MODELS", REPO / "models"))
def pilot_mode() -> bool:
    return os.environ.get("PROMPTPRES_MODE") == "pilot"


def data_root() -> Path:
    if pilot_mode():
        return REPO / "data" / "pilot"
    return Path(os.environ.get("PROMPTPRES_DATA", REPO / "data"))


def llm_enabled() -> bool:
    return not pilot_mode() or os.environ.get("PROMPTPRES_PILOT_LLM") == "approved"


RUNS_DIR = data_root() / "runs" if pilot_mode() else Path(os.environ.get("PROMPTPRES_RUNS", data_root() / "runs"))


def load_yaml(env_var: str, default_name: str) -> dict:
    """Read config/<name>.yaml; the file name can be switched with an env var."""
    path = CONFIG_DIR / os.environ.get(env_var, default_name)
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def pipeline_config() -> dict:
    return load_yaml("PROMPTPRES_PIPELINE", "pipeline-v0.yaml")


LLM_ENV_KEYS = ("OPENROUTER_API_KEY", "OPENROUTER_MODEL")


@lru_cache(maxsize=None)
def load_env() -> None:
    """Read the OpenRouter key and model from REPO/.env once (variables already set in the shell win).

    Only these two keys are taken (D-062): a cloud DATABASE_URL kept in .env for the deploy script must
    never switch a local run or a test to the cloud database.
    """
    from dotenv import dotenv_values   # noqa: PLC0415
    for key, value in dotenv_values(REPO / ".env").items():
        if key in LLM_ENV_KEYS and value is not None and key not in os.environ:
            os.environ[key] = value


@lru_cache(maxsize=None)
def storage_config() -> dict:
    """Upload chunks, playback copy, retention and queue repair (D-062). Not part of the analysis snapshot,
    so the config digest recorded in results does not change."""
    return load_yaml("PROMPTPRES_STORAGE", "storage-v0.yaml")


_llm_override = ContextVar("llm_config_override", default=None)


@contextmanager
def use_llm_config(settings):
    token = _llm_override.set(settings)
    try:
        yield
    finally:
        _llm_override.reset(token)


def llm_settings() -> dict:
    """OpenRouter settings: key + model from .env / environment, the rest from pipeline-v0.yaml `llm`.

    The model falls back to llm.model in the config only when OPENROUTER_MODEL is empty.
    """
    load_env()
    cfg = dict(_llm_override.get() or pipeline_config()["llm"])
    cfg["api_key"] = os.environ.get("OPENROUTER_API_KEY", "").strip()
    cfg["model"] = os.environ.get("OPENROUTER_MODEL", "").strip() or cfg["model"]
    return cfg


@lru_cache(maxsize=None)
def tool(name: str) -> str:
    """Full path of ffmpeg / ffprobe.

    Order: env PROMPTPRES_FFMPEG_DIR, PATH, then a winget install (Windows dev machine).
    """
    exe = name + (".exe" if os.name == "nt" else "")
    folder = os.environ.get("PROMPTPRES_FFMPEG_DIR")
    if folder and (Path(folder) / exe).exists():
        return str(Path(folder) / exe)
    found = shutil.which(name)
    if found:
        return found
    winget = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    for hit in sorted(winget.glob(f"Gyan.FFmpeg*/*/bin/{exe}")):
        return str(hit)
    raise FileNotFoundError(f"{name} not found: install FFmpeg or set PROMPTPRES_FFMPEG_DIR")


def load_thresholds(path: str | Path | None = None) -> dict:
    if path is None:
        return load_yaml("PROMPTPRES_THRESHOLDS", "thresholds-v0.yaml")
    return yaml.safe_load(Path(path).read_text(encoding="utf-8"))


def analysis_settings() -> dict:
    return {"pipeline": pipeline_config(), "thresholds": load_thresholds(),
            "feedback": load_yaml("PROMPTPRES_FEEDBACK", "feedback-v0.yaml")["feedback"]}
