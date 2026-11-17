"""Deployment static checks (D-050 Compose, D-062 Modal + Vercel) + real SPA routes without cloud services."""
import ast
from pathlib import Path

import yaml
from fastapi.testclient import TestClient

from app import main

ROOT = Path(__file__).resolve().parents[2]


def decorator_args(node, name):
    """Literal keyword arguments of the decorator call `<x>.<name>(...)` on a function or class."""
    call = next(d for d in node.decorator_list if isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute)
                and d.func.attr == name)
    out = {}
    for k in call.keywords:
        try:
            out[k.arg] = ast.literal_eval(k.value)
        except ValueError:
            out[k.arg] = ast.unparse(k.value)
    return out


def test_modal_two_tiers_volumes_and_maintenance():
    """D-062: CPU web (us-east, one container, no Volume mount), on-demand T4 analyser, 15-minute CPU job."""
    tree = ast.parse((ROOT / "deploy_modal.py").read_text(encoding="utf-8-sig"))
    nodes = {n.name: n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ClassDef))}
    web = decorator_args(nodes["web"], "function")
    keys = ("cpu", "memory", "min_containers", "max_containers", "scaledown_window", "region")
    assert {k: web[k] for k in keys} == \
        {"cpu": 1.0, "memory": 1024, "min_containers": 0, "max_containers": 1, "scaledown_window": 300, "region": "us-east"}
    assert "gpu" not in web and "volumes" not in web                    # the media Volume is never mounted here
    assert decorator_args(nodes["web"], "concurrent") == {"max_inputs": 32}
    gpu = decorator_args(nodes["Analyser"], "cls")
    assert {k: gpu[k] for k in ("gpu", "cpu", "memory", "min_containers", "max_containers", "scaledown_window",
                                "timeout")} == {"gpu": "T4", "cpu": 4.0, "memory": 8192, "min_containers": 0,
                                                "max_containers": 4, "scaledown_window": 60, "timeout": 3600}
    assert gpu["volumes"] == "{'/models': models}"
    maintain = decorator_args(nodes["maintain"], "function")
    assert maintain["schedule"] == "modal.Period(minutes=15)" and "gpu" not in maintain
    # D-063: background job, so no region surcharge, smallest container, no 60 s idle tail every run
    assert "region" not in maintain and maintain["cpu"] == 0.25 and maintain["memory"] == 256
    assert maintain["scaledown_window"] == 2
    source = ast.unparse(tree)
    assert "trim_cache(runs_dir" in source                               # bounded local copy cache (D-063)
    assert ".reload(" not in source and "sqlite:" not in source and "sqlite3" not in source   # no SQLite on Modal
    assert "modal.Volume.from_name('promptpres-media', version=2)" in source
    assert "modal.Volume.from_name('promptpres-models', version=2)" in source
    assert "worker/requirements-linux.lock" in source and "api/requirements-linux.lock" in source
    assert "'PROMPTPRES_TRUSTED_PROXY': 'vercel'" in source
    for lib in ("libegl1", "libgl1", "libgles2", "libsm6", "libice6"):   # MediaPipe/OpenCV .so deps (ldd-checked)
        assert f"'{lib}'" in source, lib
    stop = ast.unparse(next(n for n in nodes["Analyser"].body if isinstance(n, ast.FunctionDef) and n.name == "stop"))
    assert "store.requeue(self.current)" in stop


def test_worker_lock_matches_the_thesis_versions():
    """The GPU image installs the exact versions of the Windows lock the measured results came from."""
    import re

    def pins(name):
        text = (ROOT / name).read_text(encoding="utf-8")
        return {k.lower(): v for k, v in re.findall(r"^([A-Za-z0-9_.-]+)==(\S+)", text, re.M)}
    windows, linux = pins("worker/requirements-windows.lock"), pins("worker/requirements-linux.lock")
    for package in ("faster-whisper", "ctranslate2", "mediapipe", "onnxruntime", "numpy", "pythainlp",
                    "opencv-contrib-python", "av", "tokenizers", "nvidia-cublas-cu12", "nvidia-cudnn-cu12"):
        assert linux[package] == windows[package], package
    assert {k for k in linux if k in windows and linux[k] != windows[k]} == set()


def test_compose_and_dockerfile_stay_single_machine():
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8-sig"))
    assert set(compose["services"]) == {"db", "api", "worker"}
    assert compose["services"]["api"]["environment"]["PROMPTPRES_REQUIRE_LOGIN"] == '1'
    assert 'sessions:/data' in compose["services"]["worker"]["volumes"]
    assert compose["services"]["worker"]["gpus"] == 'all'
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8-sig")
    assert 'npm run build' in dockerfile and '--from=web-build' in dockerfile and 'ffmpeg' in dockerfile
    assert (ROOT / "PILOT_RUNBOOK.md").is_file()


def test_vercel_rewrites_api_and_serves_the_spa():
    import json
    config = json.loads((ROOT / "web/vercel.json").read_text(encoding="utf-8"))
    api, spa = config["rewrites"]
    assert api["source"] == "/api/:path*" and api["destination"].startswith("https://")
    assert api["destination"].endswith(".modal.run/api/:path*")
    assert spa == {"source": "/((?!api/).*)", "destination": "/index.html"}
    header = config["headers"][0]
    assert header["source"] == "/api/(.*)" and header["headers"] == [{"key": "x-vercel-enable-rewrite-caching", "value": "0"}]


def test_vercel_git_build_installs_the_lockfile_and_keeps_the_web_sources():
    """D-065: a Git deployment (Root Directory = web) read web/.vercelignore from the repo root; its "/*" allowlist
    removed web/, so `npx vite build` fetched vite 8 and found no index.html. The build uses only the locked vite
    (--no-install fails instead of downloading); tsc stays in CI because it reads ../contracts outside web/."""
    import fnmatch
    import json
    config = json.loads((ROOT / "web/vercel.json").read_text(encoding="utf-8"))
    assert config["installCommand"] == "npm ci" and config["buildCommand"] == "npx --no-install vite build"
    lock = json.loads((ROOT / "web/package-lock.json").read_text(encoding="utf-8"))
    assert lock["packages"]["node_modules/vite"]["version"].startswith("6.")
    rules = [r.strip() for r in (ROOT / "web/.vercelignore").read_text(encoding="utf-8").splitlines()
             if r.strip() and not r.startswith("#")]
    assert not [r for r in rules if r.startswith(("/", "!")) or r.strip("/*") == ""]   # blocklist, unanchored
    for path in ("web", "web/index.html", "web/package.json", "web/package-lock.json", "web/src/main.tsx",
                 "web/vite.config.ts", "web/tsconfig.json", "web/vercel.json", "index.html", "src/main.tsx"):
        for part in Path(path).parts:
            assert not [r for r in rules if fnmatch.fnmatch(part, r.rstrip("/"))], (path, part)


def test_single_origin_spa_and_missing_api():
    # Build is a test prerequisite for the SPA integration and Playwright gates.
    assert (ROOT / "web/dist/index.html").exists(), "Run npm run build before the SPA integration test"
    client = TestClient(main.app)
    for path in ('/', '/login', '/new', '/sessions/nonexistent', '/sessions/nonexistent/video'):
        response = client.get(path)
        assert response.status_code == 200 and '<html' in response.text
    assert client.get('/api/no-such-endpoint').status_code == 404
    assert client.get('/assets/no-such-file.js').status_code == 404


def test_cloud_settings_and_runbooks():
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
    for key in ("PROMPTPRES_SESSION_SECRET", "PROMPTPRES_PUBLIC_ORIGIN", "PROMPTPRES_TRUSTED_PROXY"):
        assert key in compose["services"]["api"]["environment"]
    ignored = (ROOT / ".dockerignore").read_text(encoding="utf-8").split()
    assert {".env", "data", "models"} <= set(ignored)
    runbook = (ROOT / "PILOT_RUNBOOK.md").read_text(encoding="utf-8")
    for text in ("ตรวจคิวงาน", "pg_dump", "modal app stop promptpres", "docker compose down", "150 วินาที", "USD/ชั่วโมง"):
        assert text in runbook
    deploy = (ROOT / "DEPLOY_RUNBOOK.md").read_text(encoding="utf-8")
    for text in ("promptpres-media", "download_models", "set_modal_secret.ps1", "vercel deploy", "deploy_smoke.py",
                 "pg_dump"):
        assert text in deploy
    script = (ROOT / "tools/set_modal_secret.ps1").read_text(encoding="utf-8")
    assert "--from-dotenv" in script and "Remove-Item" in script and "PROMPTPRES_DIRECT_ORIGIN" in script


def test_clean_stop_folds_the_wal_into_the_database(tmp_path):
    from promptpres_shared import store
    sid = store.create_session(60)["session_id"]
    wal = tmp_path / "test.db-wal"
    assert wal.exists() and wal.stat().st_size > 0
    with TestClient(main.app):                                         # lifespan shutdown runs store.checkpoint()
        pass
    assert wal.stat().st_size == 0
    store.reset_engine()
    assert store.get_session(sid)["status"] == "created"


def test_one_python_version_everywhere_and_api_lock_has_pythainlp():
    import re
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    versions = set(re.findall(r"FROM python:(\d+\.\d+)", dockerfile)) | set(re.findall(r"uv venv --python (\d+\.\d+)", dockerfile))
    modal_file = (ROOT / "deploy_modal.py").read_text(encoding="utf-8")
    versions |= set(re.findall(r'add_python="(\d+\.\d+)"', modal_file)) | set(re.findall(r'python_version="(\d+\.\d+)"', modal_file))
    versions |= set(re.findall(r"python-version: '(\d+\.\d+)'", (ROOT / ".github/workflows/checks.yml").read_text(encoding="utf-8")))
    assert versions == {"3.12"}
    assert "python3" not in dockerfile                                # no distro interpreter in the worker image
    lock = (ROOT / "api/requirements-linux.lock").read_text(encoding="utf-8")
    assert re.search(r"^pythainlp==", lock, re.M)                     # cloud API splits Thai words like the worker


def test_web_build_stage_has_the_contract_mocks_the_type_check_imports():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    web = dockerfile[:dockerfile.index("AS api")]
    # web/src/contract.check.ts imports ../../contracts/mocks/*.json: found by a real `docker build` (D-051)
    assert "WORKDIR /repo/web" in web and web.index("COPY contracts/ /repo/contracts/") < web.index("npm run build")
    assert "--from=web-build /repo/web/dist/" in dockerfile
