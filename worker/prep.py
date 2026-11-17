"""Media preparation with FFmpeg/ffprobe -> media.mp4, audio.wav, prep.json.

- อ่านข้อมูลไฟล์ด้วย ffprobe: ความยาว, fps, ขนาดภาพ, มีเสียงหรือไม่
- วิดีโอ: ถ้าเป็น H.264 อัตราเฟรมคงที่อยู่แล้วคัดลอกตรง ไม่เช่นนั้นเข้ารหัสใหม่เป็น H.264 CFR
- เสียง: mono 16 kHz PCM 16-bit (ใช้กับ VAD และ ASR)
- ไฟล์ .webm ที่อัดจาก MediaRecorder มักไม่มีความยาวในส่วนหัว -> อ่านความยาวจาก media.mp4 ที่แปลงแล้วแทน
  (ถ้ายังไม่ได้ ใช้ความยาวของ audio.wav)
- เขียน media.mp4 เป็นไฟล์ชั่วคราวก่อนแล้วค่อยเปลี่ยนชื่อ API จึงไม่เสิร์ฟไฟล์ที่ยังเขียนไม่เสร็จ
- ตรวจคุณภาพเบื้องต้น -> flags (ไม่มีเสียง / เสียงเบาเกินไป / สั้นเกินไป) พร้อมเหตุผลภาษาไทย
  เกณฑ์ที่ใช้เสียงอ่าน flags แล้วคืน "วิเคราะห์ไม่ได้" แทนการทำให้ไปป์ไลน์ล้ม
Idea from the earlier prototype's audio helpers (removed in D-060); rewritten here.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import wave
from fractions import Fraction
from pathlib import Path

import numpy as np

from promptpres_shared.settings import tool

FLAG_REASONS = {
    "no_audio": "ไฟล์ไม่มีเสียง",
    "too_quiet": "เสียงเบาเกินไปจนวิเคราะห์ไม่ได้",
    "too_short": "คลิปสั้นเกินไปจนวิเคราะห์ไม่ได้",
}


class MediaError(Exception):
    """The file cannot be read at all -> the whole session fails (status: failed)."""


def _run(args: list[str], timeout: int = 3600, what: str = "ประมวลผลไฟล์วิดีโอไม่สำเร็จ") -> subprocess.CompletedProcess:
    """Run ffmpeg/ffprobe; a failure raises MediaError without exposing file paths or diagnostic output."""
    proc = subprocess.run(args, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", timeout=timeout)
    if proc.returncode != 0:
        raise MediaError(what)
    return proc


def _rate(text: str | None) -> Fraction:
    """ffprobe frame rate "30/1" -> Fraction; missing, "0/0", "1/0" or "N/A" -> 0."""
    try:
        return Fraction(text) if text else Fraction(0)
    except (ValueError, ZeroDivisionError):
        return Fraction(0)


def _seconds(text) -> float | None:
    """ffprobe duration -> seconds; missing, "N/A", 0 or not a number -> None."""
    try:
        value = float(text)
    except (TypeError, ValueError):
        return None
    return value if value > 0 and value == value and value != float("inf") else None


def probe(video: Path, *, input_format: str | None = None) -> dict:
    """ffprobe summary of a media file."""
    demuxer = ["-f", input_format] if input_format else []
    try:
        out = _run([tool("ffprobe"), "-v", "error", "-print_format", "json",
                    "-show_format", "-show_streams", "-protocol_whitelist", "file", *demuxer, str(video)], timeout=120, what="อ่านไฟล์วิดีโอไม่ได้")
    except MediaError as e:
        raise MediaError(str(e)) from e
    info = json.loads(out.stdout)
    streams = info.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if v is None:
        raise MediaError("ไม่พบภาพวิดีโอในไฟล์")
    duration = _seconds(info.get("format", {}).get("duration")) or _seconds(v.get("duration"))
    avg, real = _rate(v.get("avg_frame_rate")), _rate(v.get("r_frame_rate"))
    return {
        "duration_s": duration,
        "fps": round(float(avg), 3) if avg else None,
        "constant_fps": bool(avg) and avg == real,
        "width": v.get("width"),
        "height": v.get("height"),
        "video_codec": v.get("codec_name"),
        "has_audio": a is not None,
        "audio_codec": a.get("codec_name") if a else None,
    }


def load_wav(path: Path) -> tuple[np.ndarray, int]:
    """Mono PCM16 wav -> float32 samples in [-1, 1] and the sample rate."""
    with wave.open(str(path), "rb") as w:
        rate, channels, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if width != 2:
        raise MediaError("audio.wav ต้องเป็น PCM 16-bit")
    samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return samples, rate


def audio_level_dbfs(samples: np.ndarray) -> float | None:
    """Mean RMS level of the whole file in dBFS (0 dBFS = full scale). None for empty audio."""
    if samples.size == 0:
        return None
    rms = float(np.sqrt(np.mean(np.square(samples, dtype=np.float64))))
    return 20 * np.log10(rms) if rms > 0 else -120.0


def quality_flags(info: dict, level_dbfs: float | None, cfg: dict) -> dict:
    """{flag: Thai reason} for problems that make audio/time criteria unanalyzable."""
    flags = {}
    if not info["has_audio"]:
        flags["no_audio"] = FLAG_REASONS["no_audio"]
    elif level_dbfs is None or level_dbfs < cfg["min_audio_dbfs"]:
        flags["too_quiet"] = FLAG_REASONS["too_quiet"]
    if info["duration_s"] is None or info["duration_s"] < cfg["min_duration_s"]:
        flags["too_short"] = FLAG_REASONS["too_short"]
    return flags


def fingerprint(video: Path) -> dict | None:
    """Cheap file metadata for diagnostics and model revisions, never the input cache identity."""
    video = Path(video)
    if not video.exists():
        return None
    st = video.stat()
    return {"name": video.name, "size": st.st_size, "mtime": round(st.st_mtime, 3)}


def source_digest(video: Path) -> dict | None:
    """Identify input bytes and format without retaining the file in memory."""
    try:
        with video.open("rb") as source:
            sha256 = hashlib.file_digest(source, "sha256").hexdigest()
    except OSError:
        return None  # prep reports unreadable video through the normal failure path
    return {"sha256": sha256, "format": video.suffix.lower()}


def make_playback(media: Path, out: Path, cfg: dict) -> Path:
    """Small H.264/AAC copy of media.mp4 for the result page player (D-062, config/storage-v0.yaml playback).

    Runs only after result.json is written, so it cannot change any measurement. It is made from media.mp4
    (not the raw upload) with no trimming and no frame-rate change, so every evidence time still points at
    the same moment. Height is capped at max_height and never enlarged.
    """
    media, out = Path(media), Path(out)
    tmp = out.with_name(out.stem + ".tmp.mp4")
    height = int(cfg["max_height"])
    try:
        _run([tool("ffmpeg"), "-y", "-v", "error", "-protocol_whitelist", "file", "-i", str(media),
              "-map", "0:v:0", "-map", "0:a:0?", "-vf", f"scale=-2:'min({height},ih)'",
              "-c:v", "libx264", "-preset", str(cfg["preset"]), "-crf", str(cfg["crf"]), "-pix_fmt", "yuv420p",
              "-c:a", "aac", "-b:a", f"{int(cfg['audio_kbps'])}k", "-movflags", "+faststart", str(tmp)],
             what="ทำวิดีโอสำหรับเล่นบนหน้าเว็บไม่สำเร็จ")
        os.replace(tmp, out)
    finally:
        tmp.unlink(missing_ok=True)
    return out


def prepare(video: Path, run_dir: Path, cfg: dict) -> dict:
    """Write run_dir/media.mp4, run_dir/audio.wav (if any audio) and run_dir/prep.json."""
    video, run_dir = Path(video), Path(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    input_format = {".mp4": "mov", ".mov": "mov", ".webm": "matroska"}.get(video.suffix.lower())
    if input_format is None:
        raise MediaError("รูปแบบไฟล์วิดีโอไม่รองรับ")
    info = probe(video, input_format=input_format)
    source_args = ["-protocol_whitelist", "file", "-f", input_format, "-i", str(video)]
    max_duration = cfg.get("max_duration_s", 1800)
    if info["duration_s"] and info["duration_s"] > max_duration:
        raise MediaError("วิดีโอยาวเกินเวลาที่กำหนด")
    ffmpeg = tool("ffmpeg")

    media, tmp = run_dir / "media.mp4", run_dir / "media.tmp.mp4"
    convert = "แปลงไฟล์วิดีโอไม่สำเร็จ"
    if info["video_codec"] == "h264" and info["constant_fps"] and video.suffix.lower() == ".mp4":
        _run([ffmpeg, "-y", "-v", "error", *source_args, "-t", str(max_duration + 2), "-c", "copy", "-movflags", "+faststart",
              str(tmp)], what=convert)
    else:
        _run([ffmpeg, "-y", "-v", "error", *source_args, "-t", str(max_duration + 2), "-c:v", "libx264", "-preset", "veryfast",
              "-crf", "23", "-r", str(cfg["video_fps"]), "-pix_fmt", "yuv420p",
              "-c:a", "aac", "-movflags", "+faststart", str(tmp)], what=convert)
    measured = probe(tmp)["duration_s"]
    if measured is None or measured > max_duration:
        tmp.unlink(missing_ok=True)
        raise MediaError("วิดีโอยาวเกินเวลาที่กำหนดหรืออ่านความยาวไม่ได้")
    os.replace(tmp, media)          # the API serves media.mp4 only once it is complete

    level, audio_s = None, None
    wav = run_dir / "audio.wav"
    if info["has_audio"]:
        _run([ffmpeg, "-y", "-v", "error", *source_args, "-t", str(max_duration + 2), "-vn", "-ac", "1",
              "-ar", str(cfg["audio_rate_hz"]), "-c:a", "pcm_s16le", str(wav)], what="แยกเสียงจากไฟล์วิดีโอไม่สำเร็จ")
        samples, rate = load_wav(wav)
        level = audio_level_dbfs(samples)
        audio_s = len(samples) / rate if rate else None
    if info["duration_s"] is None:   # browser .webm: no duration in the header -> the converted file has one
        info["duration_source"] = "media.mp4"
        info["duration_s"] = measured
        if info["duration_s"] is None and audio_s:
            info["duration_s"], info["duration_source"] = round(audio_s, 3), "audio.wav"

    result = {"source": str(video), "source_fingerprint": fingerprint(video), "probe": info,
              "audio_dbfs": None if level is None else round(level, 2),
              "flags": quality_flags(info, level, cfg),
              "media": media.name, "audio": wav.name if info["has_audio"] else None}
    (run_dir / "prep.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result
