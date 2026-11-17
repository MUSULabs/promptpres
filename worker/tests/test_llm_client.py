"""OpenRouter client without the network: model id rules, JSON parsing, settings precedence, retry."""
from types import SimpleNamespace

import pytest

from worker import settings
from worker.llm import client


@pytest.mark.parametrize("text", ['{"a": 1}', '```json\n{"a": 1}\n```', 'ผลคือ ```{"a": 1}``` ครับ', 'ok {"a": 1} end'])
def test_parse_json_accepts_plain_and_fenced(text):
    assert client.parse_json(text) == {"a": 1}


@pytest.mark.parametrize("text", ["", "not json", "[1, 2]"])
def test_parse_json_rejects_garbage(text):
    with pytest.raises(ValueError):
        client.parse_json(text)


@pytest.mark.parametrize("model", ["google/gemini-2.5-flash-lite", "anthropic/claude-sonnet-4.5", "openai/gpt-4.1-mini"])
def test_pinned_models_pass(model):
    assert client.check_model(model) == model


@pytest.mark.parametrize("model", ["", "gemini-2.5-flash", "google/gemma-3-27b-it:free", "openrouter/auto",
                                   "google/gemini-2.5-pro-preview", "google/gemini-2.0-flash-exp",
                                   "openai/chatgpt-4o-latest", "meta-llama/llama-3.1-8b:nitro"])
def test_floating_or_unpinned_models_fail(model):
    with pytest.raises(client.LLMError):
        client.check_model(model)


def test_env_model_beats_config_and_config_is_fallback(monkeypatch):
    monkeypatch.setattr(settings, "load_env", lambda: None)
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")
    monkeypatch.setenv("OPENROUTER_MODEL", "vendor/model-a")
    assert settings.llm_settings()["model"] == "vendor/model-a"
    monkeypatch.setenv("OPENROUTER_MODEL", "")
    assert settings.llm_settings()["model"] == settings.pipeline_config()["llm"]["model"]


def fake_reply(text):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))],
                           model="vendor/model-a-0601", usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5))


class FakeOpenAI:
    def __init__(self, replies):
        self.replies, self.calls = list(replies), []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kw):
        self.calls.append(kw)
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return fake_reply(r)


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(settings, "load_env", lambda: None)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test-secret")
    monkeypatch.setenv("OPENROUTER_MODEL", "vendor/model-a")


def test_chat_json_sends_temperature_0_json_mode_and_retries_bad_json(configured, monkeypatch):
    fake = FakeOpenAI(["sorry, no json", '```json\n{"topics": []}\n```'])
    monkeypatch.setattr(client, "_client", lambda cfg: fake)
    data, meta = client.chat_json("sys", "user", purpose="test")
    assert data == {"topics": []} and len(fake.calls) == 2
    call = fake.calls[0]
    assert call["temperature"] == 0 and call["response_format"] == {"type": "json_object"}
    assert call["model"] == "vendor/model-a" and meta["model"] == "vendor/model-a" and meta["prompt_tokens"] == 10


def test_chat_json_errors_never_show_the_key(configured, monkeypatch):
    fake = FakeOpenAI([RuntimeError("401 bad key sk-test-secret")])
    monkeypatch.setattr(client, "_client", lambda cfg: fake)
    with pytest.raises(client.LLMError) as e:
        client.chat_json("sys", "user", purpose="test")
    assert "sk-test-secret" not in str(e.value)


def busy(status=429):
    import httpx
    import openai
    response = httpx.Response(status, request=httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions"))
    kind = openai.RateLimitError if status == 429 else openai.InternalServerError
    return kind("google/gemini-2.5-flash-lite is temporarily rate-limited upstream", response=response, body=None)


class Budgeted(FakeOpenAI):
    def with_options(self, **kw):
        return self


def test_busy_provider_is_asked_again_with_backoff(configured, monkeypatch):
    """D-063: one 429 'rate-limited upstream' from the provider (seen live from Modal us-east) is not final."""
    waits, built = [], []
    monkeypatch.setattr(client.time, "sleep", waits.append)
    fake = Budgeted([busy(), busy(502), '{"ok": 1}'])
    monkeypatch.setattr(client, "_client", lambda cfg: built.append(cfg["max_retries"]) or fake)
    deadline = client.time.monotonic() + 60
    assert client.chat_json("sys", "user", purpose="topics", deadline=deadline)[0] == {"ok": 1}
    assert waits == [1, 2] and len(fake.calls) == 3 and built == [0]   # SDK retries off: the loop owns the budget


def test_without_a_deadline_only_the_sdk_retries(configured, monkeypatch):
    """Worker calls (coverage, coach on the T4): the SDK already retried 429/5xx/timeouts max_retries times, so the
    busy loop must not multiply them (a hung provider would hold the GPU 5x longer)."""
    waits, built = [], []
    monkeypatch.setattr(client.time, "sleep", waits.append)
    fake = FakeOpenAI([busy(), '{"ok": 1}'])
    monkeypatch.setattr(client, "_client", lambda cfg: built.append(cfg["max_retries"]) or fake)
    with pytest.raises(client.LLMError, match="coach: RateLimitError"):
        client.chat_json("sys", "user", purpose="coach")
    assert waits == [] and len(fake.calls) == 1
    assert built == [settings.pipeline_config()["llm"]["max_retries"]] and built[0] > 0


def test_busy_provider_gives_up_after_the_last_wait_or_before_the_deadline(configured, monkeypatch):
    waits = []
    monkeypatch.setattr(client.time, "sleep", waits.append)
    monkeypatch.setattr(client, "_client", lambda cfg: Budgeted([busy()] * 6))
    with pytest.raises(client.LLMError, match="RateLimitError"):
        client.chat_json("sys", "user", purpose="topics", deadline=client.time.monotonic() + 600)
    assert waits == list(client.BUSY_WAITS_S)
    waits.clear()
    monkeypatch.setattr(client, "_client", lambda cfg: Budgeted([busy()] * 6))
    deadline = client.time.monotonic() + 4.5          # room for the 1 s and 2 s waits, not for the 4 s one
    with pytest.raises(client.LLMError, match="topics: RateLimitError"):
        client.chat_json("sys", "user", purpose="topics", deadline=deadline)
    assert waits == [1, 2]                             # the 4 s wait would end past the deadline: not started
    monkeypatch.setattr(client, "_client", lambda cfg: FakeOpenAI([RuntimeError("400 bad request")]))
    waits.clear()
    with pytest.raises(client.LLMError):
        client.chat_json("sys", "user", purpose="test")
    assert waits == []                                 # a request error that is not 'busy' is final at once


def test_missing_key_is_a_clear_error(monkeypatch):
    monkeypatch.setattr(settings, "load_env", lambda: None)
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    monkeypatch.setenv("OPENROUTER_MODEL", "vendor/model-a")
    with pytest.raises(client.LLMError, match="OPENROUTER_API_KEY"):
        client.chat_json("sys", "user", purpose="test")


def test_prompt_files_carry_their_version():
    for name in ("topics-v1", "topics-v2", "coverage-v1", "coverage-v2"):
        text, version = client.load_prompt(name)
        assert version == name and "JSON" in text
