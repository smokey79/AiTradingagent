from __future__ import annotations

import json
import logging
import os
import re
import time
from abc import ABC, abstractmethod
from typing import Dict, List, Literal, Optional

logger = logging.getLogger(__name__)

LLMName = Literal["grok", "gemini", "claude"]

# ---------------------------------------------------------------------------
# Valid model registries  (add new models here — validated at construction)
# ---------------------------------------------------------------------------

CLAUDE_MODELS = frozenset({
    "claude-opus-4-20250514",
    "claude-sonnet-4-20250514",
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
    "claude-3-opus-latest",
})

GEMINI_MODELS = frozenset({
    "gemini-2.0-flash",
    "gemini-2.0-pro",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
})


# ---------------------------------------------------------------------------
# Base class
# ---------------------------------------------------------------------------

class LLMClient(ABC):
    """Abstract base for all LLM provider clients."""

    def __init__(self, max_retries: int = 3, retry_delay: float = 1.0) -> None:
        self.max_retries  = max_retries
        self.retry_delay  = retry_delay

    @abstractmethod
    def generate(self, prompt: str, **kwargs) -> str:
        """Return a text completion for the given prompt."""
        ...

    def score_options(
        self, prompt: str, options: List[str], **kwargs
    ) -> Dict[str, float]:
        """
        Score each option in [0.0, 1.0] given the prompt context.
        Default implementation uses generate() with a structured prompt.
        Subclasses may override for provider-native scoring.
        """
        if not options:
            return {}

        numbered = "\n".join(f"{i}. {o}" for i, o in enumerate(options))
        scoring_prompt = (
            f"Context: {prompt}\n\n"
            "Rate each option from 0.0 (worst) to 1.0 (best).\n"
            f"Options:\n{numbered}\n\n"
            'Reply with ONLY a JSON object: {"0": score, "1": score, ...}'
        )
        raw  = self.generate(scoring_prompt, **kwargs)
        data = json.loads(re.search(r"\{.*\}", raw, re.S).group())
        return {options[int(k)]: float(v) for k, v in data.items()}

    def _retry(self, fn, *args, **kwargs):
        """Exponential-backoff retry wrapper."""
        last_exc: Optional[Exception] = None
        for attempt in range(self.max_retries):
            try:
                return fn(*args, **kwargs)
            except Exception as exc:
                last_exc = exc
                wait = self.retry_delay * (2 ** attempt)
                logger.warning(
                    "%s attempt %d/%d failed (%s). Retrying in %.1fs…",
                    type(self).__name__, attempt + 1, self.max_retries, exc, wait,
                )
                time.sleep(wait)
        raise RuntimeError(
            f"{type(self).__name__}: all {self.max_retries} attempts failed."
        ) from last_exc


# ---------------------------------------------------------------------------
# Claude
# ---------------------------------------------------------------------------

class ClaudeClient(LLMClient):
    def __init__(
        self,
        api_key : Optional[str] = None,
        model   : str = "claude-3-5-sonnet-latest",
        **kwargs,
    ) -> None:
        super().__init__(**kwargs)

        if model not in CLAUDE_MODELS:
            raise ValueError(
                f"Unknown Claude model {model!r}. "
                f"Valid options: {sorted(CLAUDE_MODELS)}"
            )

        resolved_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        if not resolved_key:
            raise ValueError(
                "ClaudeClient requires an API key. Pass api_key= or set "
                "the ANTHROPIC_API_KEY environment variable."
            )

        from anthropic import Anthropic  # deferred — optional dependency
        self.client = Anthropic(api_key=resolved_key)
        self.model  = model

    def _call(self, prompt: str, **kwargs) -> str:
        msg = self.client.messages.create(
            model      = self.model,
            max_tokens = kwargs.get("max_tokens", 1024),
            messages   = [{"role": "user", "content": prompt}],
        )
        return "".join(
            block.text for block in msg.content if hasattr(block, "text")
        )

    def generate(self, prompt: str, **kwargs) -> str:
        return self._retry(self._call, prompt, **kwargs)


# ---------------------------------------------------------------------------
# Gemini
# ---------------------------------------------------------------------------

class GeminiClient(LLMClient):
    def __init__(self, model: str = "gemini-2.0-flash", **kwargs) -> None:
        super().__init__(**kwargs)

        if model not in GEMINI_MODELS:
            raise ValueError(
                f"Unknown Gemini model {model!r}. "
                f"Valid options: {sorted(GEMINI_MODELS)}"
            )
        self.model = model

    def generate(self, prompt: str, **kwargs) -> str:
        """
        Wire to gemini-cli-sdk when ready:

            from gemini_cli_sdk import query, GeminiOptions
            result = query(prompt, GeminiOptions(model=self.model))
            return result.text

        For async runtimes, wrap in asyncio.run() or an executor.
        """
        raise NotImplementedError(
            "GeminiClient.generate: wire to gemini-cli-sdk.query."
        )


# ---------------------------------------------------------------------------
# Grok
# ---------------------------------------------------------------------------

class GrokClient(LLMClient):
    DEFAULT_MODEL = "grok-3"

    def __init__(
        self,
        api_key  : str,
        base_url : str = "https://api.x.ai/v1",
        model    : str = DEFAULT_MODEL,
        **kwargs,
    ) -> None:
        super().__init__(**kwargs)
        if not api_key:
            raise ValueError("GrokClient requires a non-empty api_key.")
        self.api_key  = api_key
        self.base_url = base_url
        self.model    = model

    def _call(self, prompt: str, **kwargs) -> str:
        """
        Wire to the Grok HTTP API:

            import requests
            resp = requests.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}",
                         "Content-Type": "application/json"},
                json={"model": self.model,
                      "messages": [{"role": "user", "content": prompt}],
                      **kwargs},
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
        """
        raise NotImplementedError("GrokClient._call: wire to xAI HTTP API.")

    def generate(self, prompt: str, **kwargs) -> str:
        return self._retry(self._call, prompt, **kwargs)


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

class LLMRouter:
    """
    Routes generate() / score_options() calls to the appropriate provider.

    Not a subclass of LLMClient intentionally — the router has a different
    contract (accepts an optional `llm` parameter) and should not be used
    polymorphically where a plain LLMClient is expected.
    """

    def __init__(
        self,
        default : LLMName,
        clients : Dict[LLMName, LLMClient],
    ) -> None:
        if default not in clients:
            raise ValueError(
                f"Default LLM {default!r} is not in clients "
                f"({list(clients.keys())})."
            )
        self.default = default
        self.clients = clients

    def _resolve(self, llm: Optional[LLMName]) -> LLMClient:
        name = llm or self.default
        if name not in self.clients:
            raise KeyError(
                f"LLM {name!r} not registered. "
                f"Available: {list(self.clients.keys())}."
            )
        return self.clients[name]

    def generate(
        self, prompt: str, llm: Optional[LLMName] = None, **kwargs
    ) -> str:
        return self._resolve(llm).generate(prompt, **kwargs)

    def score_options(
        self,
        prompt  : str,
        options : List[str],
        llm     : Optional[LLMName] = None,
        **kwargs,
    ) -> Dict[str, float]:
        return self._resolve(llm).score_options(prompt, options, **kwargs)
