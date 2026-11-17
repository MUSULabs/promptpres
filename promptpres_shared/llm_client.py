"""The only door to an LLM: OpenRouter chat completions, temperature 0, JSON reply (D-037, CLAUDE.md rule 6).

- key and model come from Code/promptpres/.env (OPENROUTER_API_KEY, OPENROUTER_MODEL); the model falls
  back to config/pipeline-v0.yaml llm.model. The model id must be pinned (check_model) and is logged in
  versions.llm of every result that used it.
- POST {base_url}/chat/completions through the openai SDK (OpenAI-compatible API):
  temperature 0, response_format json_object, timeout and retries from config (the SDK retries network
  errors, 429 rate limits and 5xx with backoff).
- Calls with a deadline (PDF topics while the user waits) turn the SDK retries off so every request fits the
  remaining time; there a busy provider (HTTP 429 "rate-limited upstream", 5xx, dropped connection) is asked
  again after 1, 2, 4 and 8 s, and a wait that would pass the deadline is not started (D-063: the live PDF
  step failed on one 429 from Modal us-east that the next request did not get). Calls without a deadline
  (coverage, coach in the GPU worker) keep only the SDK retries: stacking both would let one hung provider
  hold the GPU for 5 x (1 + max_retries) x timeout_s.
- The reply is parsed with parse_json(), which also accepts a ```json ... ``` fenced block. A reply that
  is still not JSON gets one more request, then LLMError.
- The API key never appears in errors, logs or results.
Prompts live in worker/prompts/<name>-v<N>.txt; the file stem is the prompt version (versions.prompt).
"""
from __future__ import annotations

import json
import re
import time
from contextlib import nullcontext
from pathlib import Path

from promptpres_shared.settings import llm_settings

PROMPTS_DIR = Path(__file__).resolve().parents[1] / "worker" / "prompts"
MODEL_ID = re.compile(r"[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*")
FLOATING = ("latest", "preview", "exp", "auto")
FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)


class LLMError(RuntimeError):
    """LLM call failed or gave an unusable reply. The message is Thai and safe to show (no key)."""


BUSY_WAITS_S = (1, 2, 4, 8)          # deadline calls only: waits before asking a busy provider again (D-063)


def provider_busy(error: Exception) -> bool:
    """429 rate limit, 5xx, timeout or dropped connection: worth asking again. Other errors are final."""
    try:
        import openai
    except ImportError:          # pragma: no cover — the SDK is a dependency wherever chat_json runs
        return False
    return isinstance(error, (openai.RateLimitError, openai.InternalServerError, openai.APIConnectionError))


def check_model(model: str) -> str:
    """Accept only a pinned 'vendor/name' id: no ':free'-style variants, no preview / latest / auto alias."""
    m = (model or "").strip()
    if not m:
        raise LLMError("ยังไม่ได้ตั้ง OPENROUTER_MODEL")
    if ":" in m or not MODEL_ID.fullmatch(m.lower()):
        raise LLMError(f"ชื่อโมเดล '{m}' ต้องเป็นรุ่นที่ระบุแน่นอนแบบ vendor/name (ห้ามมี :free หรือ :ส่วนต่อท้าย)")
    name = m.lower().split("/", 1)[1]
    if m.lower() == "openrouter/auto" or any(w in re.split(r"[-._]", name) for w in FLOATING):
        raise LLMError(f"ชื่อโมเดล '{m}' เป็นรุ่นทดลองหรือชื่อลอยที่เปลี่ยนเองได้ ต้องล็อกรุ่นแน่นอน")
    return m


def parse_json(text: str) -> dict:
    """JSON object from the reply text: plain, inside ```json fences, or the outermost {...}."""
    if not text or not text.strip():
        raise ValueError("empty reply")
    candidates = [text.strip()] + [m.strip() for m in FENCE.findall(text)]
    first, last = text.find("{"), text.rfind("}")
    if 0 <= first < last:
        candidates.append(text[first:last + 1])
    for c in candidates:
        try:
            value = json.loads(c)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise ValueError("reply is not a JSON object")


def load_prompt(name: str) -> tuple[str, str]:
    """(prompt text, version) for worker/prompts/<name>.txt, e.g. 'coverage-v1'."""
    path = PROMPTS_DIR / f"{name}.txt"
    return path.read_text(encoding="utf-8"), path.stem


def model_name() -> str:
    """Pinned model id that a call would use now (for versions.llm)."""
    return check_model(llm_settings()["model"])


def _client(cfg: dict):
    """OpenAI SDK client for OpenRouter.

    TLS certificates are checked against the operating system's trust store (truststore), not only
    Python's bundled list: on the Windows dev laptop the bundled list fails (CERTIFICATE_VERIFY_FAILED)
    while the system store works. Verification stays on.
    """
    import ssl   # noqa: PLC0415

    import httpx   # noqa: PLC0415
    import truststore   # noqa: PLC0415
    from openai import OpenAI   # noqa: PLC0415 — only needed when really calling
    http = httpx.Client(verify=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT), timeout=float(cfg["timeout_s"]))
    return OpenAI(api_key=cfg["api_key"], base_url=cfg["base_url"], http_client=http,
                  timeout=float(cfg["timeout_s"]), max_retries=int(cfg["max_retries"]))


def _ask(client, cfg: dict, model: str, messages: list, purpose: str, deadline: float | None):
    """One chat completion. With a deadline (SDK retries off) a busy provider is asked again after each wait
    in BUSY_WAITS_S; without one the SDK has already retried (max_retries), so any error is final here."""
    waits = list(BUSY_WAITS_S) if deadline is not None else []
    while True:
        try:
            request_client = client
            if deadline is not None:
                left = deadline - time.monotonic()
                if left <= 0:
                    raise TimeoutError
                request_client = client.with_options(timeout=min(left, cfg["timeout_s"]))
            return request_client.chat.completions.create(
                model=model, messages=messages, temperature=float(cfg["temperature"]),
                max_tokens=int(cfg["max_tokens"]), response_format={"type": "json_object"})
        except Exception as e:  # noqa: BLE001 — report the kind only (never the key)
            wait = waits.pop(0) if waits and provider_busy(e) else None
            if wait is None or (deadline is not None and time.monotonic() + wait >= deadline - 1):
                raise LLMError(f"เรียกแบบจำลองภาษาไม่สำเร็จ ({purpose}: {type(e).__name__})") from None
            time.sleep(wait)


def chat_json(system: str, user: str, *, purpose: str, timeout_s: float | None = None,
              max_retries: int | None = None, deadline: float | None = None) -> tuple[dict, dict]:
    """One JSON answer from the pinned model -> (parsed dict, meta {model, response_model, tokens}).

    timeout_s / max_retries override the config for calls made while a user waits (PDF topics in the API).
    """
    cfg = llm_settings()
    if timeout_s is not None:
        cfg["timeout_s"] = timeout_s
    if max_retries is not None:
        cfg["max_retries"] = max_retries
    model = check_model(cfg["model"])
    if not cfg["api_key"]:
        raise LLMError("ยังไม่ได้ตั้ง OPENROUTER_API_KEY")
    if deadline is not None:
        cfg["max_retries"] = 0   # each manually budgeted attempt respects the remaining time
    client = _client(cfg)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    last_problem = ""
    with (client if hasattr(client, "__enter__") else nullcontext(client)):
        for _attempt in range(2):                     # second request only when the reply was not JSON
            reply = _ask(client, cfg, model, messages, purpose, deadline)
            choice = reply.choices[0] if reply.choices else None
            text = (choice.message.content if choice and choice.message else "") or ""
            try:
                data = parse_json(text)
            except ValueError as e:
                last_problem = str(e)
                continue
            usage = getattr(reply, "usage", None)
            meta = {"model": model, "response_model": getattr(reply, "model", None), "purpose": purpose,
                    "prompt_tokens": getattr(usage, "prompt_tokens", None),
                    "completion_tokens": getattr(usage, "completion_tokens", None)}
            return data, meta
    raise LLMError(f"แบบจำลองภาษาตอบไม่เป็น JSON ({purpose}: {last_problem})")
