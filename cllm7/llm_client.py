from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
import time
import logging

logger = logging.getLogger(__name__)


class LLMClient(ABC):
    """Abstract base for all LLM provider clients."""

    def __init__(self, timeout: int = 30, max_retries: int = 3):
        self.timeout = timeout
        self.max_retries = max_retries

    @abstractmethod
    def generate_text(self, prompt: str, **kwargs) -> str:
        """Generate a text completion for the given prompt."""
        ...

    @abstractmethod
    def score_options(
        self, prompt: str, options: List[str], **kwargs
    ) -> Dict[str, float]:
        """
        Score each option in [0.0, 1.0] given the prompt context.
        Returns a dict mapping option -> score.
        """
        ...

    def _retry(self, fn, *args, **kwargs) -> Any:
        """Generic retry wrapper with exponential backoff."""
        last_exc: Optional[Exception] = None
        for attempt in range(self.max_retries):
            try:
                return fn(*args, **kwargs)
            except Exception as exc:
                last_exc = exc
                wait = 2 ** attempt
                logger.warning(
                    "Attempt %d/%d failed (%s). Retrying in %ds…",
                    attempt + 1,
                    self.max_retries,
                    exc,
                    wait,
                )
                time.sleep(wait)
        raise RuntimeError(
            f"All {self.max_retries} attempts failed."
        ) from last_exc


class GrokClient(LLMClient):
    """
    Client for xAI's Grok API.
    Replace the pseudocode stubs with real HTTP calls once the API is stable.
    """

    DEFAULT_MODEL = "grok-4.20"

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.x.ai/v1",
        model: str = DEFAULT_MODEL,
        timeout: int = 30,
        max_retries: int = 3,
    ):
        super().__init__(timeout=timeout, max_retries=max_retries)
        self.api_key = api_key
        self.base_url = base_url
        self.model = model

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _chat(self, messages: List[Dict[str, str]], **kwargs) -> str:
        """
        Low-level chat completion call.

        Pseudocode — swap in real requests call when API is available:

            import requests
            resp = requests.post(
                f"{self.base_url}/chat/completions",
                headers=self._headers(),
                json={"model": self.model, "messages": messages, **kwargs},
                timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
        """
        raise NotImplementedError("Wire _chat() to the real Grok API.")

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def generate_text(self, prompt: str, **kwargs) -> str:
        messages = [{"role": "user", "content": prompt}]
        return self._retry(self._chat, messages, **kwargs)

    def score_options(
        self, prompt: str, options: List[str], **kwargs
    ) -> Dict[str, float]:
        """
        Scoring strategy: ask Grok to return a JSON object mapping each
        option label to a float in [0, 1].

        Prompt template instructs the model to be deterministic and
        return *only* valid JSON so parsing is reliable.

        Pseudocode for the parse step (fill in once _chat() is live):

            import json, re
            numbered = "\n".join(f"{i}. {o}" for i, o in enumerate(options))
            scoring_prompt = (
                f"Context: {prompt}\n\n"
                f"Rate each option from 0.0 (worst) to 1.0 (best).\n"
                f"Options:\n{numbered}\n\n"
                "Reply with ONLY a JSON object: {\"0\": score, \"1\": score, ...}"
            )
            raw = self._chat([{"role": "user", "content": scoring_prompt}])
            data = json.loads(re.search(r'\{.*\}', raw, re.S).group())
            return {options[int(k)]: float(v) for k, v in data.items()}
        """
        raise NotImplementedError("Implement scoring logic using Grok.")


# ------------------------------------------------------------------
# Example: adding a second provider is trivial
# ------------------------------------------------------------------

class AnthropicClient(LLMClient):
    """Minimal Claude client — illustrates how easy it is to add providers."""

    def __init__(self, api_key: str, model: str = "claude-sonnet-4-20250514", **kwargs):
        super().__init__(**kwargs)
        self.api_key = api_key
        self.model = model

    def generate_text(self, prompt: str, **kwargs) -> str:
        import anthropic  # pip install anthropic
        client = anthropic.Anthropic(api_key=self.api_key)
        msg = client.messages.create(
            model=self.model,
            max_tokens=kwargs.pop("max_tokens", 1024),
            messages=[{"role": "user", "content": prompt}],
            **kwargs,
        )
        return msg.content[0].text

    def score_options(
        self, prompt: str, options: List[str], **kwargs
    ) -> Dict[str, float]:
        import json, re
        numbered = "\n".join(f"{i}. {o}" for i, o in enumerate(options))
        scoring_prompt = (
            f"Context: {prompt}\n\n"
            f"Rate each option from 0.0 (worst fit) to 1.0 (best fit).\n"
            f"Options:\n{numbered}\n\n"
            'Reply with ONLY a JSON object like {"0": 0.9, "1": 0.4, ...}'
        )
        raw = self._retry(self.generate_text, scoring_prompt)
        data = json.loads(re.search(r"\{.*\}", raw, re.S).group())
        return {options[int(k)]: float(v) for k, v in data.items()}
