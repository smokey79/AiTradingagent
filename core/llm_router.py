from __future__ import annotations

"""
core/llm_router.py

Canonical LLM module — single abstract base + concrete providers + router.
Replaces both core/llm_client.py and core/llm_clients.py.

Providers:
  - AnthropicClient  (Claude via anthropic SDK)
  - GeminiClient     (Google Gemini via google-genai SDK)
  - GrokClient       (xAI Grok via OpenAI-compatible HTTP API)
  - OpenRouterClient (DeepSeek, free-tier models via OpenRouter)
"""

import json
import logging
import os
import re
import time
from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Sequence

from core.config import get_settings, ActiveLLM

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Permanent-error detection (2026-09-26)
# ---------------------------------------------------------------------------

_PERMANENT_MESSAGE_MARKERS = (
    "credit balance",       # Anthropic's actual wording, confirmed live on
    "insufficient_quota",   # this account: "Your credit balance is too low
    "exceeded your current quota",  # to access the Anthropic API."
    "invalid_api_key",
    "authentication_error",
    "permission_denied",
    "resource_exhausted",   # Gemini's free-tier daily quota error code, e.g.
                             # "429 RESOURCE_EXHAUSTED... You exceeded your
                             # current quota... GenerateRequestsPerDay
                             # PerProjectPerModel-FreeTier... quotaValue: 20"
)


def _is_permanent_llm_error(exc: Exception) -> bool:
    """
    True if `exc` represents a condition that will NEVER succeed on retry -
    no credit/quota, or bad/revoked credentials - as opposed to a transient
    one (rate limit, timeout, brief network blip) worth retrying.

    Added after confirming live that AnthropicClient's real "no credit"
    error (HTTP 400, error.type="invalid_request_error", message "Your
    credit balance is too low...") was being retried 3 times with 1s/2s/4s
    backoff by _retry() below before the router finally moved on to the
    next provider - ~7 wasted seconds and 2 wasted API calls on EVERY
    single occurrence, for a condition that cannot change between attempt 1
    and attempt 3 four seconds later. This function lets _retry() recognise
    that case (and the equivalent for other providers) and fail fast
    instead, so LLMRouter's fallback chain moves to the next provider
    immediately rather than after a pointless multi-second delay.
    """
    status_code = getattr(exc, "status_code", None)
    if status_code in (401, 403):
        return True  # bad/revoked credentials never fix themselves on retry

    message = str(exc).lower()
    if any(marker in message for marker in _PERMANENT_MESSAGE_MARKERS):
        return True

    if status_code == 400 and ("credit" in message or "quota" in message or "billing" in message):
        return True

    return False


# ---------------------------------------------------------------------------
# Shared Gemini daily call budget (2026-09-26)
# ---------------------------------------------------------------------------
#
# Google's free tier caps Gemini at 20 requests/day/model. The fixes above
# stop wasted RETRIES once a call has already failed with a quota error,
# but several separate processes call Gemini (this router - used by
# python-debate, hermes-analyst, tradingkit-analyst - AND the Node.js
# consensus engine's src/agents/geminiAgent.js), so none of them know how
# close the *shared* daily quota is until they personally get rejected.
# This is a small cross-process, cross-language soft budget: a single JSON
# file both sides read/increment before attempting a real call, so once
# today's count hits GEMINI_DAILY_CALL_LIMIT (18 by default - a safety
# margin under Google's real 20/day cap) every process skips the real API
# call entirely instead of making one they can now predict will fail.
# It resets itself automatically at UTC midnight (compares the stored date
# to today's UTC date on every check) - note this may not line up exactly
# with the instant Google's own quota resets, so it's a courtesy pre-check,
# not a replacement for the per-call 429 handling above.

# CORRECTED 2026-09-27: comment above previously claimed a real 20/day free-tier cap.
# Verified false (ai.google.dev rate-limits docs + independent sources): Flash-tier
# free accounts get ~1,500 requests/day. Default bumped 18 -> 300, still conservative.
GEMINI_DAILY_CALL_LIMIT = int(os.environ.get("GEMINI_DAILY_CALL_LIMIT", "300"))
_GEMINI_BUDGET_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data", "gemini_call_budget.json",
)


def _today_utc_str() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


def _read_gemini_budget() -> dict:
    try:
        with open(_GEMINI_BUDGET_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if data.get("date") != _today_utc_str():
            return {"date": _today_utc_str(), "count": 0}
        return {"date": data["date"], "count": int(data.get("count", 0))}
    except (FileNotFoundError, json.JSONDecodeError, ValueError, KeyError, OSError):
        return {"date": _today_utc_str(), "count": 0}


def _write_gemini_budget(data: dict) -> None:
    try:
        os.makedirs(os.path.dirname(_GEMINI_BUDGET_PATH), exist_ok=True)
        tmp_path = _GEMINI_BUDGET_PATH + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp_path, _GEMINI_BUDGET_PATH)
    except OSError as exc:
        logger.warning("Could not persist Gemini call budget: %s", exc)


def _reserve_gemini_call_slot() -> bool:
    """
    True  -> a slot was reserved (count incremented); go ahead and call.
    False -> today's soft budget is already used; skip the real API call.

    Best-effort, not distributed-locked: two processes racing on the exact
    same instant could each read the same count before either writes back,
    so this can occasionally overshoot by a call or two. That's fine here -
    Google's real 20/day cap is the actual backstop, and a slightly early
    or late skip has no functional cost since the existing fallback chain
    (OpenRouter/Ollama/rule-engine) produces the same result either way.
    """
    data = _read_gemini_budget()
    if data["count"] >= GEMINI_DAILY_CALL_LIMIT:
        return False
    data["count"] += 1
    _write_gemini_budget(data)
    return True


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------

class LLMClient(ABC):
    """Common interface for all LLM providers."""

    def __init__(self, timeout: int = 30, max_retries: int = 3) -> None:
        self.timeout     = timeout
        self.max_retries = max_retries

    @abstractmethod
    def generate_text(self, prompt: str, **kwargs) -> str:
        """Return a text completion for `prompt`."""
        ...

    def score_options(
        self, prompt: str, options: List[str], **kwargs
    ) -> Dict[str, float]:
        """Score each option in [0, 1] given the prompt context."""
        if not options:
            return {}

        numbered = "\n".join(f"{i}. {o}" for i, o in enumerate(options))
        scoring_prompt = (
            f"Context: {prompt}\n\n"
            "Rate each option from 0.0 (worst) to 1.0 (best).\n"
            f"Options:\n{numbered}\n\n"
            'Reply with ONLY a JSON object: {"0": score, "1": score, ...}'
        )
        # Strip llm= kwarg if present (used by router, not individual clients)
        kwargs.pop("llm", None)
        raw  = self.generate_text(scoring_prompt, **kwargs)
        match = re.search(r"\{.*\}", raw, re.S)
        if not match:
            raise ValueError(f"No JSON object found in LLM response: {raw[:200]}")
        data = json.loads(match.group())
        return {options[int(k)]: float(v) for k, v in data.items()}

    def _retry(self, fn, *args, **kwargs):
        last_exc: Optional[Exception] = None
        for attempt in range(self.max_retries):
            try:
                return fn(*args, **kwargs)
            except Exception as exc:
                last_exc = exc
                if _is_permanent_llm_error(exc):
                    # 2026-09-26: no credit/quota or bad credentials - never
                    # succeeds on retry, so fail immediately instead of
                    # burning 1s/2s/4s of backoff on a condition that cannot
                    # change mid-retry. LLMRouter's fallback chain (the
                    # caller one level up) moves on to the next provider
                    # right away.
                    logger.warning(
                        "%s attempt %d/%d failed with a permanent error (no credit/quota or bad credentials): %s. Not retrying - failing fast.",
                        type(self).__name__, attempt + 1, self.max_retries, exc,
                    )
                    break
                wait = 2 ** attempt
                logger.warning(
                    "%s attempt %d/%d failed: %s. Retrying in %ds.",
                    type(self).__name__, attempt + 1, self.max_retries, exc, wait,
                )
                time.sleep(wait)
        raise RuntimeError(
            f"{type(self).__name__}: all attempts failed."
        ) from last_exc


# ---------------------------------------------------------------------------
# Claude  (Anthropic)
# ---------------------------------------------------------------------------

class AnthropicClient(LLMClient):
    DEFAULT_MODEL = "claude-sonnet-4-20250514"

    def __init__(
        self,
        api_key : Optional[str] = None,
        model   : str           = DEFAULT_MODEL,
        **kwargs,
    ) -> None:
        super().__init__(**kwargs)
        try:
            from anthropic import Anthropic
        except ImportError as exc:
            raise ImportError(
                "anthropic package is required: pip install anthropic"
            ) from exc

        resolved_key = api_key or get_settings().resolved_anthropic_key
        if not resolved_key:
            raise ValueError(
                "AnthropicClient requires an API key. "
                "Set ANTHROPIC_API_KEY in your .env file."
            )
        self._client = Anthropic(api_key=resolved_key)
        self.model   = model

    def generate_text(self, prompt: str, **kwargs) -> str:
        kwargs.pop("llm", None)  # strip router kwarg

        def _call():
            msg = self._client.messages.create(
                model     = self.model,
                max_tokens= kwargs.pop("max_tokens", 1024),
                messages  = [{"role": "user", "content": prompt}],
                **kwargs,
            )
            return "".join(
                block.text for block in msg.content if hasattr(block, "text")
            )
        return self._retry(_call)


# ---------------------------------------------------------------------------
# Gemini  (Google)
# ---------------------------------------------------------------------------

class GeminiClient(LLMClient):
    DEFAULT_MODEL = "gemini-3.7-flash"

    def __init__(
        self,
        api_key : Optional[str] = None,
        model   : Optional[str] = None,
        **kwargs,
    ) -> None:
        super().__init__(**kwargs)

        cfg = get_settings()
        resolved_key = api_key or cfg.resolved_gemini_key
        if not resolved_key:
            raise ValueError(
                "GeminiClient requires an API key. "
                "Set GEMINI_API_KEY in your .env file."
            )

        self.api_key = resolved_key
        self.model = model or cfg.gemini_model or self.DEFAULT_MODEL
        self._sdk_client = None

        try:
            from google import genai
            self._sdk_client = genai.Client(api_key=resolved_key)
        except Exception as exc:
            logger.debug("google-genai SDK init failed (%s), using direct HTTP REST.", exc)

    def _call_http_rest(self, prompt: str, max_tokens: int = 1024, temperature: float = 0.7) -> str:
        import requests as req
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={self.api_key}"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "maxOutputTokens": max_tokens,
                "temperature": temperature,
            },
        }
        resp = req.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=self.timeout)
        resp.raise_for_status()
        data = resp.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]

    def generate_text(self, prompt: str, **kwargs) -> str:
        kwargs.pop("llm", None)
        max_tokens = kwargs.pop("max_tokens", 1024)
        temperature = kwargs.get("temperature", 0.7)

        if not _reserve_gemini_call_slot():
            # 2026-09-26: today's shared soft budget (GEMINI_DAILY_CALL_LIMIT,
            # default 18 of Google's real 20/day free-tier cap) is already
            # used - across ALL processes sharing this key, not just this
            # one. Skip the real call entirely instead of making one we can
            # already predict will be rejected; LLMRouter's fallback chain
            # (the caller one level up) moves on to the next provider
            # immediately, exactly as it would on a real 429.
            raise RuntimeError(
                f"GeminiClient: skipped - today's shared call budget "
                f"({GEMINI_DAILY_CALL_LIMIT}/day) is already used across "
                f"all processes. Not calling the real API."
            )

        def _call():
            if self._sdk_client is not None:
                try:
                    response = self._sdk_client.models.generate_content(
                        model=self.model,
                        contents=prompt,
                        config={
                            "max_output_tokens": max_tokens,
                            "temperature": temperature,
                        },
                    )
                    return response.text
                except Exception as sdk_err:
                    if _is_permanent_llm_error(sdk_err):
                        # FIX 2026-09-26: the free tier's daily quota error
                        # (RESOURCE_EXHAUSTED) was being swallowed here in
                        # favour of falling through to _call_http_rest() -
                        # which hits the exact same API key/quota and is
                        # therefore guaranteed to also fail, just with a
                        # terse "429 Client Error: Too Many Requests" that
                        # carries none of the SDK error's informative text.
                        # That meant _retry() below never saw a message it
                        # could recognise as permanent, so it retried 3x
                        # with 1s/2s/4s backoff - and each retry paid for
                        # BOTH a wasted SDK call and a wasted REST call, 6
                        # real HTTP requests to Google for a single already-
                        # doomed generate_text() call. Re-raise immediately
                        # instead so the informative SDK error (not the
                        # REST fallback's terse one) is what _retry() sees.
                        raise
                    logger.warning("Gemini SDK call failed (%s), using HTTP REST fallback.", sdk_err)
            return self._call_http_rest(prompt, max_tokens, temperature)

        return self._retry(_call)


# ---------------------------------------------------------------------------
# Grok  (xAI — OpenAI-compatible HTTP API)
# ---------------------------------------------------------------------------

class GrokClient(LLMClient):
    DEFAULT_MODEL = "grok-3-mini"

    def __init__(
        self,
        api_key  : Optional[str] = None,
        base_url : str           = "https://api.x.ai/v1",
        model    : str           = DEFAULT_MODEL,
        **kwargs,
    ) -> None:
        super().__init__(**kwargs)
        resolved_key = api_key or get_settings().resolved_grok_key
        if not resolved_key:
            raise ValueError(
                "GrokClient requires an API key. "
                "Set XAI_API_KEY or GROK_API_KEY in your .env file."
            )
        self.api_key  = resolved_key
        self.base_url = base_url
        self.model    = model

    def _chat(self, messages: list, **kwargs) -> str:
        """Call xAI's OpenAI-compatible chat completions endpoint."""
        import requests as req

        max_tokens = kwargs.pop("max_tokens", 1024)
        resp = req.post(
            f"{self.base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": self.model,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": kwargs.get("temperature", 0.7),
            },
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

    def generate_text(self, prompt: str, **kwargs) -> str:
        kwargs.pop("llm", None)
        return self._retry(
            self._chat, [{"role": "user", "content": prompt}], **kwargs
        )


# ---------------------------------------------------------------------------
# OpenRouter  (DeepSeek, free-tier models, etc.)
# ---------------------------------------------------------------------------

class OpenRouterClient(LLMClient):
    DEFAULT_MODELS = [
        "nvidia/nemotron-3-super-120b-a12b:free",
        "nex-agi/nex-n2.5-pro:free",
        "google/gemma-4-31b-it:free",
        "poolside/laguna-s-2.1:free",
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
        "thinkingmachines/inkling:free",
    ]
    _rotation_index = 0

    def __init__(
        self,
        api_key  : Optional[str] = None,
        model    : Optional[str] = None,
        **kwargs,
    ) -> None:
        super().__init__(**kwargs)
        cfg = get_settings()
        resolved_key = api_key or cfg.resolved_openrouter_key
        if not resolved_key:
            raise ValueError(
                "OpenRouterClient requires an API key. "
                "Set OPENROUTER_API_KEY in your .env file."
            )
        self.api_key  = resolved_key
        self.base_url = "https://openrouter.ai/api/v1"
        self.model    = model or cfg.openrouter_free_model or self.DEFAULT_MODELS[0]

    def _get_next_model(self) -> str:
        model = self.DEFAULT_MODELS[OpenRouterClient._rotation_index % len(self.DEFAULT_MODELS)]
        OpenRouterClient._rotation_index += 1
        return model

    def _chat(self, messages: list, **kwargs) -> str:
        import requests as req

        max_tokens = kwargs.pop("max_tokens", 1024)
        active_model = self.model or self._get_next_model()

        # Try active model, then rotate through models on 429/404
        for attempt in range(len(self.DEFAULT_MODELS)):
            try:
                resp = req.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                        "HTTP-Referer": "https://github.com/smokey79/aitradingagent",
                        "X-Title": "AiTradingAgent",
                    },
                    json={
                        "model": active_model,
                        "messages": messages,
                        "max_tokens": max_tokens,
                        "temperature": kwargs.get("temperature", 0.7),
                    },
                    timeout=self.timeout,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    message = data["choices"][0]["message"]
                    # FIX 2026-09-26: some free/"reasoning" models (e.g. the
                    # *-reasoning:free entries in DEFAULT_MODELS) return
                    # content=null and put the real text in a separate
                    # `reasoning` field instead. Returning that None as a
                    # "successful" result used to silently propagate all the
                    # way up to FacilitatorAgent.decide() / DebaterAgent.argue(),
                    # which then crashed on re.sub(pattern, "", None) with a
                    # confusing NoneType error instead of trying the next model
                    # or falling through to Ollama. Treat empty content as a
                    # failed attempt so rotation actually kicks in.
                    content = message.get("content") or message.get("reasoning")
                    if content:
                        return content
                    logger.warning(
                        "OpenRouter free model %s returned empty content. Rotating to next free model.",
                        active_model,
                    )
                    active_model = self._get_next_model()
                    continue
                logger.warning(
                    "OpenRouter free model %s failed (%s: %s). Rotating to next free model.",
                    active_model, resp.status_code, resp.text[:100],
                )
                active_model = self._get_next_model()
            except Exception as exc:
                logger.warning("OpenRouter error with %s: %s. Trying next model.", active_model, exc)
                active_model = self._get_next_model()

        # Fallback to local Ollama if OpenRouter free pool is exhausted
        # FIX 2026-09-13: 10s was too tight for CPU-only inference on this
        # machine (no dedicated GPU) — a ~400-token llama3.2 completion
        # regularly runs longer than that, so the fallback was timing out
        # and silently failing instead of actually being used. This is the
        # last-resort step anyway, so it's fine for it to take longer.
        try:
            prompt_text = "\n".join([m.get("content", "") for m in messages])
            ollama_model = os.getenv("OLLAMA_MODEL", "llama3.2")
            ollama_resp = req.post(
                f"{os.getenv('OLLAMA_URL', 'http://127.0.0.1:11434')}/api/generate",
                json={"model": ollama_model, "prompt": prompt_text, "stream": False},
                timeout=60,
            )
            if ollama_resp.status_code == 200:
                ollama_text = ollama_resp.json().get("response") or ""
                if ollama_text:
                    logger.info("OpenRouter failover to local Ollama (llama3.2) succeeded.")
                    return ollama_text
                logger.warning("Local Ollama failover returned an empty response.")
        except Exception as o_err:
            logger.warning("Local Ollama failover failed: %s", o_err)

        raise RuntimeError("OpenRouterClient: All free models and Ollama failovers failed.")

    def generate_text(self, prompt: str, **kwargs) -> str:
        kwargs.pop("llm", None)
        # 2026-09-26: do NOT wrap this in the base class's _retry(). _chat()
        # already tries all 7 free models plus a local Ollama failover in
        # one call - that's a complete retry/fallback strategy on its own.
        # Wrapping it in _retry() (max_retries=3) meant a fully-exhausted
        # OpenRouter outage silently re-ran that entire 7-model+Ollama
        # rotation two MORE times before finally giving up - triple the
        # wasted latency and API calls for a result that was already
        # determined on the first pass.
        return self._chat([{"role": "user", "content": prompt}], **kwargs)


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

class LLMRouter(LLMClient):
    """
    Routes generate_text / score_options calls to a named provider.
    Supports:
    - Per-call provider override via `llm=` kwarg
    - Ordered fallback chain on failure

    Example:
        router = LLMRouter.from_config()
        result = router.generate_text(prompt)                     # uses default
        result = router.generate_text(prompt, llm="grok")        # override
    """

    def __init__(
        self,
        default  : ActiveLLM,
        clients  : Dict[ActiveLLM, LLMClient],
        fallbacks: Optional[Sequence[ActiveLLM]] = None,
    ) -> None:
        super().__init__()
        if default not in clients:
            raise ValueError(
                f"Default LLM {default!r} is not in clients: {list(clients)}."
            )
        self.default   = default
        self.clients   = clients
        self.fallbacks = list(fallbacks or [])

    # ------------------------------------------------------------------
    # Factory
    # ------------------------------------------------------------------

    @classmethod
    def from_config(cls) -> "LLMRouter":
        """Build a router from the current Settings, wiring only available clients."""
        cfg     = get_settings()
        clients : Dict[ActiveLLM, LLMClient] = {}

        # --- Wire Gemini (primary if configured) ---
        if cfg.resolved_gemini_key:
            try:
                clients[ActiveLLM.GEMINI] = GeminiClient()
                logger.info("GeminiClient initialised (model=%s).", cfg.gemini_model)
            except Exception as exc:
                logger.warning("Could not initialise GeminiClient: %s", exc)

        # --- Wire Anthropic ---
        if cfg.resolved_anthropic_key:
            try:
                clients[ActiveLLM.ANTHROPIC] = AnthropicClient()
                logger.info("AnthropicClient initialised.")
            except Exception as exc:
                logger.warning("Could not initialise AnthropicClient: %s", exc)

        # --- Wire Grok ---
        if cfg.resolved_grok_key:
            try:
                clients[ActiveLLM.GROK] = GrokClient()
                logger.info("GrokClient initialised.")
            except Exception as exc:
                logger.warning("Could not initialise GrokClient: %s", exc)

        # --- Wire OpenRouter ---
        if cfg.resolved_openrouter_key:
            try:
                clients[ActiveLLM.OPENROUTER] = OpenRouterClient()
                logger.info("OpenRouterClient initialised (model=%s).", cfg.openrouter_free_model)
            except Exception as exc:
                logger.warning("Could not initialise OpenRouterClient: %s", exc)

        # If no clients could be wired, raise a clear error
        if not clients:
            raise RuntimeError(
                "No LLM clients could be initialised. "
                "Check that at least one API key is set in .env: "
                "GEMINI_API_KEY, ANTHROPIC_API_KEY, XAI_API_KEY, or OPENROUTER_API_KEY."
            )

        # Use active_llm as default if available, else pick OpenRouter (most reliable free pool)
        if cfg.active_llm in clients:
            default = cfg.active_llm
        elif ActiveLLM.OPENROUTER in clients:
            default = ActiveLLM.OPENROUTER
        else:
            default = next(iter(clients))
            logger.warning(
                "Configured active_llm=%s is not available and OpenRouter is missing. Using %s as default.",
                cfg.active_llm.value, default.value,
            )

        # Prioritize OpenRouter and Local Ollama in the fallback chain
        fallbacks = []
        for provider in [ActiveLLM.OPENROUTER, ActiveLLM.GEMINI, ActiveLLM.ANTHROPIC, ActiveLLM.GROK]:
            if provider in clients and provider != default:
                fallbacks.append(provider)
        
        return cls(default=default, clients=clients, fallbacks=fallbacks)

    # ------------------------------------------------------------------
    # Routing
    # ------------------------------------------------------------------

    def _resolve(self, llm: Optional[ActiveLLM | str]) -> ActiveLLM:
        if llm is None:
            return self.default
        try:
            key = ActiveLLM(llm) if isinstance(llm, str) else llm
        except ValueError:
            raise ValueError(
                f"Unknown LLM {llm!r}. Available: {list(self.clients)}."
            )
        if key not in self.clients:
            raise ValueError(
                f"LLM {key!r} is not registered. Available: {list(self.clients)}."
            )
        return key

    def _call_with_fallback(self, method: str, *args, **kwargs):
        llm_override = kwargs.pop("llm", None)
        primary      = self._resolve(llm_override)
        chain        = [primary] + ([] if llm_override else self.fallbacks)

        last_exc: Optional[Exception] = None
        for name in chain:
            if name not in self.clients:
                continue
            try:
                return getattr(self.clients[name], method)(*args, **kwargs)
            except Exception as exc:
                logger.warning(
                    "LLMRouter: %s failed on %s: %s. Trying next in chain.",
                    method, name.value, exc,
                )
                last_exc = exc

        raise RuntimeError(
            f"LLMRouter: all providers failed for {method}."
        ) from last_exc

    def generate_text(self, prompt: str, **kwargs) -> str:
        return self._call_with_fallback("generate_text", prompt, **kwargs)

    def score_options(
        self, prompt: str, options: List[str], **kwargs
    ) -> Dict[str, float]:
        return self._call_with_fallback("score_options", prompt, options, **kwargs)
