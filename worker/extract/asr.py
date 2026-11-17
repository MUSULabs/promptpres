"""ASR: faster-whisper large-v3 -> transcript.json (words with start/end seconds).

ค่าตั้งที่ผ่านในต้นแบบเดิม (ต.ค. 2569, 1 คลิป, ไม่ได้วัด WER): BatchedInferencePipeline,
chunk_length=10, VAD min_silence 300 ms, speech_pad 200 ms, batch 4, word_timestamps=True, language th
- chunk 30 s (ค่า default) ตัดท้ายทุกก้อน — ห้ามใช้
- Whisper มักลบเสียงเติม (S3 ได้ 0 ในต้นแบบ) — ลอง initial_prompt ที่มีเสียงเติม (ยังไม่ได้วัด recall)
- ช่องว่างคำ > 2.5 s มักเป็น ASR ตกหล่น ไม่ใช่การหยุดจริง (S2 ใช้ VAD ไม่ใช้ช่องว่างคำ)
Device: tries config `asr.devices` in order (cuda int8_float16 -> cuda int8 -> cpu int8, 8 threads).
On Windows the cuBLAS/cuDNN pip wheels are found in site-packages/nvidia/*/bin (add_nvidia_dll_dirs).
Idea from the earlier prototype's transcriber (removed in D-060); rewritten here.
"""
from __future__ import annotations

import ctypes
import gc
import json
import os
import sys
import sysconfig
import time
from pathlib import Path

import numpy as np
from faster_whisper import BatchedInferencePipeline, WhisperModel

from worker.prep import load_wav
from worker.settings import MODELS_DIR


# set once a CUDA load/decode fails; later sessions in the same process (worker.runner) go straight
# to CPU instead of retrying CUDA (a retry hung for 16 min on the dev laptop)
_cuda_failed: str | None = None

CUDA_LIBS = {"win32": ("cublas64_12.dll", "cudnn_ops64_9.dll"),
             "linux": ("libcublas.so.12", "libcudnn_ops.so.9")}


_dll_dirs_added: list[str] = []


def add_nvidia_dll_dirs() -> list[str]:
    """Windows: make cuBLAS/cuDNN from the pip wheels (nvidia-cublas-cu12, nvidia-cudnn-cu12) loadable.

    The wheels put DLLs in site-packages/nvidia/<lib>/bin, which Windows does not search. CTranslate2
    loads cublas64_12.dll itself at the first decode, so the folders go both into add_dll_directory
    and in front of PATH. Runs once per process; returns the folders added.
    """
    if sys.platform != "win32" or _dll_dirs_added:
        return _dll_dirs_added
    roots = {Path(sysconfig.get_paths()["purelib"]), Path(sysconfig.get_paths()["platlib"])}
    for root in roots:
        for bin_dir in sorted((root / "nvidia").glob("*/bin")):
            os.add_dll_directory(str(bin_dir))
            os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")
            _dll_dirs_added.append(str(bin_dir))
    return _dll_dirs_added


def cuda_problem() -> str | None:
    """Why CUDA can't be used, or None. Checked BEFORE loading a CUDA model: when cuBLAS/cuDNN are
    missing, CTranslate2 loads fine, fails at the first decode, and a second CUDA attempt in the same
    process hung for 16 min on the dev laptop (14 Nov 2026)."""
    import ctranslate2
    add_nvidia_dll_dirs()
    if ctranslate2.get_cuda_device_count() == 0:
        return "no CUDA device"
    for lib in CUDA_LIBS.get(sys.platform, ()):
        try:
            ctypes.CDLL(lib)
        except OSError:
            return f"{lib} not found"
    return None


def load_model(cfg: dict) -> tuple[WhisperModel, str, str, list[str]]:
    """First (device, compute_type) that loads AND decodes 1 s of silence; returns the errors seen."""
    global _cuda_failed
    errors = []
    no_cuda = _cuda_failed or cuda_problem()
    for device, compute in cfg["devices"]:
        if device == "cuda" and no_cuda:
            errors.append(f"cuda/{compute}: skipped ({no_cuda})")
            continue
        try:
            extra = {"cpu_threads": cfg["cpu_threads"]} if device == "cpu" else {}
            model = WhisperModel(cfg["model"], device=device, compute_type=compute,
                                 download_root=str(MODELS_DIR / "whisper"), local_files_only=True, **extra)
            segs, _ = model.transcribe(np.zeros(16000, dtype=np.float32), language=cfg["language"])
            list(segs)                       # CUDA library problems only show up when decoding
            return model, device, compute, errors
        except Exception as e:  # noqa: BLE001 — fall through to the next device
            errors.append(f"{device}/{compute}: {type(e).__name__}: {str(e)[:160]}")
            if device == "cuda":
                no_cuda = _cuda_failed = "an earlier CUDA attempt failed"   # never retry CUDA in this process
    raise RuntimeError("โหลดโมเดลถอดเสียงไม่ได้: " + " | ".join(errors))


def gpu_used_mb() -> int | None:
    """GPU memory in use right now (nvidia-smi), to check the 4 GB budget. None if unavailable."""
    import subprocess
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=10).stdout
        return int(out.split()[0])
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


def version_string(t: dict) -> str:
    """What goes into result.versions.asr."""
    return (f"faster-whisper {t['model']} {t['device']}/{t['compute_type']} batched "
            f"chunk{t['params']['chunk_length']} prompt={'yes' if t['params']['initial_prompt'] else 'no'}")


def transcribe(audio_wav: Path, out_json: Path, cfg: dict) -> dict:
    """Write transcript.json: {model, device, compute_type, text, words: [{word, start_s, end_s, probability}]}."""
    t0 = time.perf_counter()
    model, device, compute, errors = load_model(cfg)
    load_s = time.perf_counter() - t0
    samples, _ = load_wav(audio_wav)
    pipe = BatchedInferencePipeline(model=model)
    try:
        segments, info = pipe.transcribe(
            samples, language=cfg["language"], word_timestamps=True, beam_size=cfg["beam_size"],
            chunk_length=cfg["chunk_length"], batch_size=cfg["batch_size"],
            initial_prompt=cfg["initial_prompt"] or None,
            vad_filter=True, vad_parameters={"min_silence_duration_ms": cfg["vad_min_silence_ms"],
                                             "speech_pad_ms": cfg["vad_speech_pad_ms"]})
        words, texts = [], []
        for seg in segments:
            texts.append(seg.text.strip())
            for w in seg.words or []:
                words.append({"word": w.word.strip(), "start_s": round(w.start, 3),
                              "end_s": round(w.end, 3), "probability": round(w.probability, 4)})
        gpu_mb = gpu_used_mb() if device == "cuda" else None
    finally:
        # free the model (and its VRAM) here, not whenever Python gets to it: the runner analyses
        # several clips in one process on a 4 GB GPU
        del pipe, model
        gc.collect()
    out = {"model": cfg["model"], "device": device, "compute_type": compute, "device_errors": errors,
           "gpu_used_mb_after": gpu_mb,
           "params": {k: cfg[k] for k in ("language", "chunk_length", "batch_size", "beam_size",
                                          "vad_min_silence_ms", "vad_speech_pad_ms", "initial_prompt")},
           "load_s": round(load_s, 1), "transcribe_s": round(time.perf_counter() - t0 - load_s, 1),
           "text": " ".join(t for t in texts if t), "words": [w for w in words if w["word"]]}
    Path(out_json).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return out
