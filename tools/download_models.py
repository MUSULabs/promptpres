"""Provision official model assets into persistent storage; never upload presentation data."""
import os
from pathlib import Path
from urllib.request import urlretrieve

ASSETS = {
    "pose.task": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
    "hand.task": "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    "face.task": "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
}


def download():
    from faster_whisper.utils import download_model
    root = Path(os.environ.get("PROMPTPRES_MODELS", Path(__file__).resolve().parents[1] / "models"))
    root.mkdir(parents=True, exist_ok=True)
    for name, url in ASSETS.items():
        dest = root / name
        if not dest.exists():
            temporary = dest.with_suffix(".download")
            urlretrieve(url, temporary)
            temporary.replace(dest)
    download_model("large-v3", cache_dir=str(root / "whisper"))


if __name__ == "__main__":
    download()
