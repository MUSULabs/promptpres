"""asr.load_model device order with a fake WhisperModel (no model files, no GPU needed)."""
import pytest

from worker.extract import asr
from worker.settings import pipeline_config

CFG = pipeline_config()["asr"]


class FakeModel:
    calls: list = []
    fail_on: set = set()

    def __init__(self, name, device, compute_type, **kw):
        FakeModel.calls.append((device, compute_type, kw.get("cpu_threads")))
        self.device = device

    def transcribe(self, audio, language):
        if self.device in FakeModel.fail_on:
            raise RuntimeError("Library cublas64_12.dll is not found or cannot be loaded")
        return iter([]), None


@pytest.fixture
def fake(monkeypatch):
    FakeModel.calls, FakeModel.fail_on = [], set()
    monkeypatch.setattr(asr, "WhisperModel", FakeModel)
    monkeypatch.setattr(asr, "_cuda_failed", None)
    return FakeModel


def test_config_fits_a_4gb_gpu():
    assert CFG["devices"][0] == ["cuda", "int8_float16"] and CFG["devices"][-1] == ["cpu", "int8"]
    assert ["cuda", "float16"] not in CFG["devices"] and CFG["batch_size"] == 2


def test_cuda_first_when_available(fake, monkeypatch):
    monkeypatch.setattr(asr, "cuda_problem", lambda: None)
    _, device, compute, errors = asr.load_model(CFG)
    assert (device, compute, errors) == ("cuda", "int8_float16", [])
    assert fake.calls == [("cuda", "int8_float16", None)]          # cpu_threads only for CPU


def test_missing_cuda_libs_skip_straight_to_cpu(fake, monkeypatch):
    monkeypatch.setattr(asr, "cuda_problem", lambda: "cublas64_12.dll not found")
    _, device, compute, errors = asr.load_model(CFG)
    assert (device, compute) == ("cpu", "int8")
    assert fake.calls == [("cpu", "int8", CFG["cpu_threads"])]
    assert all("skipped" in e for e in errors) and len(errors) == 2


def test_cuda_is_not_retried_after_a_cuda_failure(fake, monkeypatch):
    monkeypatch.setattr(asr, "cuda_problem", lambda: None)
    fake.fail_on = {"cuda"}
    _, device, _, errors = asr.load_model(CFG)
    assert device == "cpu"
    assert [c[0] for c in fake.calls] == ["cuda", "cpu"]           # second CUDA entry never loaded
    assert "RuntimeError" in errors[0] and "skipped" in errors[1]


def test_dll_dirs_helper_is_safe_to_call_twice():
    assert asr.add_nvidia_dll_dirs() == asr.add_nvidia_dll_dirs()


def test_cuda_failure_is_remembered_for_the_next_session(fake, monkeypatch):
    """worker.runner keeps one process: after CUDA failed once, the next clip must not try CUDA again."""
    monkeypatch.setattr(asr, "cuda_problem", lambda: None)
    fake.fail_on = {"cuda"}
    asr.load_model(CFG)
    fake.calls.clear()
    _, device, _, errors = asr.load_model(CFG)
    assert device == "cpu" and [c[0] for c in fake.calls] == ["cpu"]
    assert all("earlier CUDA attempt failed" in e for e in errors[:2])
