"""prep.py: audio level, quality flags, and a real ffmpeg round-trip when ffmpeg is installed."""
import subprocess

import numpy as np
import pytest

from worker import prep
from worker.settings import pipeline_config, tool
from worker.tests.helpers import tone, write_wav

CFG = pipeline_config()["prep"]


def has_ffmpeg() -> bool:
    try:
        tool("ffmpeg"); tool("ffprobe")
        return True
    except FileNotFoundError:
        return False


def test_dbfs_of_known_signals():
    assert prep.audio_level_dbfs(np.ones(1000, dtype=np.float32)) == pytest.approx(0.0, abs=1e-6)
    # sine of amplitude A has RMS A / sqrt(2): 0.5 -> about -9.03 dBFS
    assert prep.audio_level_dbfs(tone(1.0, amp=0.5)) == pytest.approx(-9.03, abs=0.05)
    assert prep.audio_level_dbfs(np.zeros(100, dtype=np.float32)) == -120.0
    assert prep.audio_level_dbfs(np.zeros(0, dtype=np.float32)) is None


def test_load_wav_roundtrip(tmp_path):
    path = write_wav(tmp_path / "a.wav", tone(0.5, amp=0.25))
    samples, rate = prep.load_wav(path)
    assert rate == 16000 and len(samples) == 8000
    assert float(np.max(np.abs(samples))) == pytest.approx(0.25, abs=1e-3)


@pytest.mark.parametrize("info, level, expect", [
    ({"has_audio": True, "duration_s": 60}, -40.0, set()),
    ({"has_audio": False, "duration_s": 60}, None, {"no_audio"}),
    ({"has_audio": True, "duration_s": 60}, -70.0, {"too_quiet"}),
    ({"has_audio": True, "duration_s": 3}, -40.0, {"too_short"}),
])
def test_quality_flags(info, level, expect):
    flags = prep.quality_flags(info, level, CFG)
    assert set(flags) == expect
    assert all(isinstance(r, str) and r for r in flags.values())     # Thai reason for each flag


@pytest.mark.skipif(not has_ffmpeg(), reason="ffmpeg not installed")
def test_prepare_real_file(tmp_path):
    src = tmp_path / "in.webm"
    subprocess.run([tool("ffmpeg"), "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=12",
                    "-f", "lavfi", "-i", "sine=frequency=300:duration=12", "-c:v", "libvpx", "-c:a", "libopus",
                    "-shortest", str(src)], check=True)
    out = prep.prepare(src, tmp_path / "run", CFG)
    assert out["probe"]["has_audio"] and out["probe"]["duration_s"] == pytest.approx(12, abs=0.3)
    assert (tmp_path / "run" / "media.mp4").exists() and (tmp_path / "run" / "prep.json").exists()
    assert prep.probe(tmp_path / "run" / "media.mp4")["video_codec"] == "h264"
    samples, rate = prep.load_wav(tmp_path / "run" / "audio.wav")
    assert rate == 16000 and out["flags"] == {}


@pytest.mark.skipif(not has_ffmpeg(), reason="ffmpeg not installed")
def test_unreadable_file_raises_media_error(tmp_path):
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"not a video")
    with pytest.raises(prep.MediaError):
        prep.probe(bad)


@pytest.mark.parametrize("text, expect", [("30/1", 30), ("30000/1001", 30000 / 1001), ("0/0", 0), ("1/0", 0),
                                          ("N/A", 0), (None, 0), ("", 0)])
def test_frame_rate_parsing_never_raises(text, expect):
    assert float(prep._rate(text)) == pytest.approx(expect)


@pytest.mark.parametrize("text, expect", [("12.5", 12.5), ("N/A", None), ("0", None), (None, None), ("nan", None)])
def test_duration_parsing(text, expect):
    assert prep._seconds(text) == expect


@pytest.mark.skipif(not has_ffmpeg(), reason="ffmpeg not installed")
def test_browser_webm_without_duration_header(tmp_path):
    """MediaRecorder-style webm (written to a pipe, so no Duration in the header) must not be 'too short'."""
    src = tmp_path / "live.webm"
    with open(src, "wb") as f:
        subprocess.run([tool("ffmpeg"), "-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=12",
                        "-f", "lavfi", "-i", "sine=frequency=300:duration=12", "-c:v", "libvpx", "-c:a", "libopus",
                        "-shortest", "-f", "webm", "pipe:1"], stdout=f, check=True)
    assert prep.probe(src)["duration_s"] is None                       # the bug's precondition
    out = prep.prepare(src, tmp_path / "run", CFG)
    assert out["probe"]["duration_s"] == pytest.approx(12, abs=0.3) and out["probe"]["duration_source"] == "media.mp4"
    assert out["flags"] == {}
    assert not (tmp_path / "run" / "media.tmp.mp4").exists()


@pytest.mark.skipif(not has_ffmpeg(), reason="ffmpeg not installed")
def test_ffmpeg_failure_message_is_thai(tmp_path):
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"not a video")
    with pytest.raises(prep.MediaError, match="อ่านไฟล์วิดีโอไม่ได้"):
        prep.probe(bad)
