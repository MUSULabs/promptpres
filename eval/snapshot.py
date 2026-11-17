"""Copy a reviewed selection of result JSONs into a new, immutable-by-convention eval input."""
import argparse
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory

from eval.tables import load_results
from promptpres_shared.contract import validate_result
from promptpres_shared.json_files import atomic_json


def create_snapshot(results, ids: list[str], out: Path) -> None:
    if not ids or len(set(ids)) != len(ids):
        raise ValueError("--ids must contain a nonempty list of unique IDs")
    if out.exists():
        raise ValueError("--out must not exist")
    selected = {sid: results[sid] for sid in ids}
    for value in selected.values():
        validate_result(value)
    with TemporaryDirectory(dir=out.parent, prefix=".eval-snapshot-") as work:
        root = Path(work) / "snapshot"
        root.mkdir()
        manifest = {}
        for sid, value in selected.items():
            directory = root / sid
            directory.mkdir()
            path = directory / "result.json"
            atomic_json(path, value)
            manifest[sid] = hashlib.sha256(path.read_bytes()).hexdigest()
        atomic_json(root / "manifest.json", manifest)
        root.rename(out)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", required=True, action="append", type=Path)
    parser.add_argument("--ids", required=True, type=Path, help="reviewed text list of one run ID per line")
    parser.add_argument("--out", required=True, type=Path, help="a fresh directory")
    args = parser.parse_args()
    try:
        create_snapshot(load_results(args.runs), args.ids.read_text(encoding="utf-8").split(), args.out)
    except ValueError as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
