"""Commit stage outputs through a manifest; partial writes are never cache hits."""
import hashlib
import json
import os
import tempfile
import time
from pathlib import Path
import pandas as pd

from promptpres_shared.json_files import atomic_json, read_json

MANIFEST_SCHEMA = 2

def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     allow_nan=False).encode("utf-8")).hexdigest()


class Artifacts:
    def __init__(self, root, source, reuse, timings):
        self.root, self.reuse, self.timings = root, reuse, timings
        self.path = root / "manifest.json"
        try:
            previous = read_json(self.path)
        except (OSError, ValueError):
            previous = {}
        if not isinstance(previous, dict):
            previous = {}
        same_input = (source is not None and previous.get("schema") == MANIFEST_SCHEMA
                      and previous.get("source") == source)
        if reuse and not same_input:
            timings["reuse"] = "source changed: all stages rerun"
        self.manifest = {"schema": MANIFEST_SCHEMA, "source": source, "stages": {}}
        if reuse and same_input:
            if isinstance(previous.get("stages"), dict):
                self.manifest["stages"] = previous["stages"]

    def run(self, name, config, fn, output):
        key = digest({"stage": name, "inputs": config})
        stages = self.manifest["stages"]
        entry = stages.get(name)
        files = entry.get("files") if isinstance(entry, dict) else None
        if (self.reuse and isinstance(files, list) and output in files and key == entry.get("key")
                and all(isinstance(file, str) and Path(file).name == file and (self.root / file).is_file()
                        for file in files)):
            try:
                path = self.root / output
                value = pd.read_parquet(path) if path.suffix == ".parquet" else read_json(path)
                if path.suffix != ".parquet" and not isinstance(value, dict):
                    raise ValueError("Expected a JSON object")
            except (OSError, ValueError):
                pass   # truncated/corrupt output is a cache miss
            else:
                self.timings[name] = "reused"
                return value
        stages.pop(name, None)
        atomic_json(self.path, self.manifest)
        started = time.perf_counter()
        with tempfile.TemporaryDirectory(prefix=f".{name}-", dir=self.root) as temp:
            folder = Path(temp)
            value = fn(folder)
            files = [f.name for f in folder.iterdir() if f.is_file()]
            if output not in files:
                raise RuntimeError(f"{name} did not produce {output}")
            for file in files:
                os.replace(folder / file, self.root / file)
        stages[name] = {"key": key, "files": sorted(files)}
        atomic_json(self.path, self.manifest)
        self.timings[name] = round(time.perf_counter() - started, 1)
        return value

    def key(self, stage):
        return self.manifest["stages"][stage]["key"]
