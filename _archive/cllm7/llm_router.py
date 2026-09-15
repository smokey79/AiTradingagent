from __future__ import annotations

"""
core/llm_router.py

Replaces both core/llm_client.py and the original llm_router.py.
Single abstract base + concrete providers + a router that supports
fallback chains and per-call provider overrides.
"""

import logging
import time
from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Sequence

from core.config import get_settings, ActiveLLM

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Abstract base  (single definition — replaces core/llm_client.py)
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

    @abstractmethod
    def score_options(
        self, prompt: str, options: List[str], **kwargs
    ) -> Dict[str, float]:
        """Score each option in [0, 1] given the prompt context."""
        ...

    def _retry(self, fn, *args, **kwargs):
        last_exc: Optional[Exception] = None
        for attempt in range(self.max_retries):
            try:
                return fn(*args, **kwargs)
            except Exception as exc:
                last_exc = exc
                wait = 2 ** attempt
                logger.warning(
                    "%s attempt %d/%d failed: %s. Retrying in %ds.",
                    type(self).__name__, attempt + 1, self.max_retries, exc, wait,
                )
                time.sleep(wait)
        raise RuntimeError(
            f"{type(self).__name__}: all {self.max_retries} attempts failed."
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

        resolved_key = api_key or get_settings().anthropic_api_key
        if resolved_key is None:
            raise ValueError(
                "AnthropicClient requires an API key. "
                "Set APP_ANTHROPIC_API_KEY in your environment."
            )
        key_str = (
            resolved_key.get_secret_value()
            if hasattr(resolved_key, "get_secret_value")
            else resolved_key
        )
        self._client = Anthropic(api_key=key_str)
        self.model   = model

    def generate_text(self, prompt: str, **kwargs) -> str:
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

    def score_options(
        self, prompt: str, options: List[str], **kwargs
    ) -> Dict[str, float]:
        import json, re
        numbered = "\n".join(f"{i}. {o}" for i, o in enumerate(options))
        scoring_prompt = (
            f"Context: {prompt}\n\n"
            f"Rate each option from 0.0 (worst) to 1.0 (best).\n"
            f"Options:\n{numbered}\n\n"
            'Reply with ONLY a JSON object like {"0": 0.9, "1": 0.4, ...}'
        )
        raw  = self._retry(self.generate_text, scoring_prompt)
        data = json.loads(re.search(r"\{.*\}", raw, re.S).group())
        return {options[int(k)]: float(v) for k, v in data.items()}


# ---------------------------------------------------------------------------
# Gemini
# ---------------------------------------------------------------------------

class GeminiClient(LLMClient):
    DEFAULT_MODEL = "gemini-2.0-flash"

    def __init__(self, model: str = DEFAULT_MODEL, **kwargs) -> None:
        super().__init__(**kwargs)
        self.model = model

    def generate_text(self, prompt: str, **kwargs) -> str:
        # TODO: wire to google-generativeai SDK
        # import google.generativeai as genai
        # genai.configure(api_key=get_settings().gemini_api_key.get_secret_value())
        # model = genai.GenerativeModel(self.model)
        # return model.generate_content(prompt).text
        raise NotImplementedError("Connect GeminiClient to google-generativeai SDK.")

    def score_options(
        self, prompt: str, options: List[str], **kwargs
    ) -> Dict[str, float]:
        raise NotImplementedError("Implement Gemini scoring.")


# ---------------------------------------------------------------------------
# Grok  (xAI)
# ---------------------------------------------------------------------------

class GrokClient(LLMClient):
    DEFAULT_MODEL = "grok-4.20"

    def __init__(
        self,
        api_key  : Optional[str] = None,
        base_url : str           = "https://api.x.ai/v1",
        model    : str           = DEFAULT_MODEL,
        **kwargs,
    ) -> None:
        super().__init__(**kwargs)
        resolved_key = api_key or get_settings().grok_api_key
        if resolved_key is None:
            raise ValueError(
                "GrokClient requires an API key. "
                "Set APP_GROK_API_KEY in your environment."
            )
        self.api_key  = (
            resolved_key.get_secret_value()
            if hasattr(resolved_key, "get_secret_value")
            else resolved_key
        )
        self.base_url = base_url
        self.model    = model

    def _chat(self, messages: list, **kwargs) -> str:
        # TODO: wire to real Grok HTTP API
        # import requests
        # resp = requests.post(
        #     f"{self.base_url}/chat/completions",
        #     headers={"Authorization": f"Bearer {self.api_key}",
        #              "Content-Type": "application/json"},
        #     json={"model": self.model, "messages": messages, **kwargs},
        #     timeout=self.timeout,
        # )
        # resp.raise_for_status()
        # return resp.json()["choices"][0]["message"]["content"]
        raise NotImplementedError("Connect GrokClient to xAI HTTP API.")

    def generate_text(self, prompt: str, **kwargs) -> str:
        return self._retry(
            self._chat, [{"role": "user", "content": prompt}], **kwargs
        )

    def score_options(
        self, prompt: str, options: List[str], **kwargs
    ) -> Dict[str, float]:
        import json, re
        numbered = "\n".join(f"{i}. {o}" for i, o in enumerate(options))
        scoring_prompt = (
            f"Context: {prompt}\n\n"
            "Rate each option 0.0–1.0.\n"
            f"Options:\n{numbered}\n\n"
            'Reply ONLY with JSON: {"0": score, ...}'
        )
        raw  = self._retry(self.generate_text, scoring_prompt)
        data = json.loads(re.search(r"\{.*\}", raw, re.S).group())
        return {options[int(k)]: float(v) for k, v in data.items()}


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

        # Always try to wire the active LLM
        if cfg.active_llm == ActiveLLM.ANTHROPIC:
            clients[ActiveLLM.ANTHROPIC] = AnthropicClient()
        elif cfg.active_llm == ActiveLLM.GROK:
            clients[ActiveLLM.GROK] = GrokClient()

        # Wire secondary providers if keys are present (for fallback)
        if cfg.grok_api_key and ActiveLLM.GROK not in clients:
            try:
                clients[ActiveLLM.GROK] = GrokClient()
            except Exception as exc:
                logger.warning("Could not initialise GrokClient for fallback: %s", exc)

        if cfg.anthropic_api_key and ActiveLLM.ANTHROPIC not in clients:
            try:
                clients[ActiveLLM.ANTHROPIC] = AnthropicClient()
            except Exception as exc:
                logger.warning("Could not initialise AnthropicClient for fallback: %s", exc)

        fallbacks = [k for k in clients if k != cfg.active_llm]
        return cls(default=cfg.active_llm, clients=clients, fallbacks=fallbacks)

    # ------------------------------------------------------------------
    # Routing
    # ------------------------------------------------------------------

    def _resolve(self, llm: Optional[ActiveLLM | str]) -> ActiveLLM:
        if llm is None:
            return self.default
        key = ActiveLLM(llm) if isinstance(llm, str) else llm
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
                    method, name, exc,
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
