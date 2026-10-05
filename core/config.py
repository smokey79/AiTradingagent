from __future__ import annotations

from enum import Enum
from functools import lru_cache
from typing import Optional

from pydantic import SecretStr, model_validator
# pydantic-settings v2  (pip install pydantic-settings)
from pydantic_settings import BaseSettings, SettingsConfigDict


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class Environment(str, Enum):
    DEVELOPMENT = "development"
    STAGING     = "staging"
    PRODUCTION  = "production"
    TEST        = "test"


class ActiveExchange(str, Enum):
    BINANCE    = "binance"
    COINBASE   = "coinbase"
    CRYPTO_COM = "crypto.com"
    BYBIT      = "bybit"
    BITGET     = "bitget"


class ActiveLLM(str, Enum):
    GROK       = "grok"
    ANTHROPIC  = "anthropic"
    GEMINI     = "gemini"
    OPENROUTER = "openrouter"


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

class Settings(BaseSettings):
    """
    All configuration is read from environment variables or a .env file.

    No prefix — variables are read directly as named in .env
    (e.g. ANTHROPIC_API_KEY, GEMINI_API_KEY, XAI_API_KEY).
    """

    model_config = SettingsConfigDict(
        env_file          = ".env",
        env_file_encoding = "utf-8",
        # No prefix — read vars directly as named in .env
        case_sensitive    = False,
        extra             = "ignore",     # don't error on unknown vars
    )

    # ------------------------------------------------------------------
    # Runtime context
    # ------------------------------------------------------------------
    env            : Environment   = Environment.DEVELOPMENT
    active_exchange: ActiveExchange = ActiveExchange.BITGET
    active_llm     : ActiveLLM     = ActiveLLM.GEMINI

    # ------------------------------------------------------------------
    # HTTP server  (used by `python main.py`)
    # ------------------------------------------------------------------
    host   : str  = "127.0.0.1"
    port   : int  = 8000
    reload : bool = False

    # ------------------------------------------------------------------
    # Exchange secrets  (all optional — validated below based on active_exchange)
    # ------------------------------------------------------------------
    binance_api_key        : Optional[SecretStr] = None
    binance_secret         : Optional[SecretStr] = None
    binance_testnet        : bool = True

    coinbase_api_key       : Optional[SecretStr] = None
    coinbase_api_secret    : Optional[SecretStr] = None

    crypto_com_api_key     : Optional[SecretStr] = None
    crypto_com_api_secret  : Optional[SecretStr] = None
    cryptocom_api_key      : Optional[SecretStr] = None
    cryptocom_secret       : Optional[SecretStr] = None

    bybit_api_key          : Optional[SecretStr] = None
    bybit_api_secret       : Optional[SecretStr] = None

    bitget_api_key         : Optional[SecretStr] = None
    bitget_secret          : Optional[SecretStr] = None
    bitget_secret_key      : Optional[SecretStr] = None
    bitget_api_secret      : Optional[SecretStr] = None
    bitget_api_passphrase  : Optional[SecretStr] = None
    bitget_passphrase      : Optional[SecretStr] = None
    bitget_sandbox         : bool = False
    bitget_testnet         : bool = False

    # ------------------------------------------------------------------
    # LLM secrets — mapped to actual .env variable names
    # ------------------------------------------------------------------
    # Anthropic
    anthropic_api_key : Optional[SecretStr] = None
    claude_api_key    : Optional[SecretStr] = None

    # Google Gemini
    gemini_api_key    : Optional[SecretStr] = None
    gemini_model      : str = "gemini-3.7-flash"

    # xAI Grok — .env uses both XAI_API_KEY and GROK_API_KEY
    xai_api_key       : Optional[SecretStr] = None
    grok_api_key      : Optional[SecretStr] = None
    xai_model         : str = "grok-3-mini"

    # OpenRouter
    openrouter_api_key   : Optional[SecretStr] = None
    openrouter_free_model: str = "inclusionai/ling-3.0-flash-sante:free"
    openrouter_free_models: list = [
        "nvidia/nemotron-3-super-120b-a12b:free",
        "nex-agi/nex-n2.5-pro:free",
        "google/gemma-4-31b-it:free",
        "poolside/laguna-s-2.1:free",
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
        "thinkingmachines/inkling:free",
    ]

    # OpenAI (via CheaperInference gateway)
    openai_api_key    : Optional[SecretStr] = None
    openai_base_url   : str = "https://api.cheaperinference.com/v1"
    openai_model      : str = "gpt-4.1-nano"

    # ------------------------------------------------------------------
    # Infrastructure
    # ------------------------------------------------------------------
    rpc_url                    : Optional[SecretStr] = None
    tradingview_webhook_secret : Optional[SecretStr] = None
    webhook_secret             : Optional[SecretStr] = None

    # Trading configuration
    paper_trading    : bool = True
    paper_trade      : bool = True
    trading_mode     : str  = "paper"
    trading_pairs    : str  = "BTC/USDT,ETH/USDT,SOL/USDT,CRO/USDT"
    consensus_threshold : float = 0.45
    min_confidence   : float = 0.72

    # Telegram
    telegram_bot_token  : Optional[SecretStr] = None
    telegram_chat_id    : Optional[str] = None

    # ------------------------------------------------------------------
    # Cross-field validation
    # ------------------------------------------------------------------

    @model_validator(mode="after")
    def check_provider_secrets(self) -> "Settings":
        """Fail fast if the active provider's credentials are missing."""

        # Skip secret checks in test or development environments
        if self.env in (Environment.TEST, Environment.DEVELOPMENT):
            return self

        # Exchange key resolution
        exchange_check: dict[ActiveExchange, list[tuple[str, bool]]] = {
            ActiveExchange.BINANCE   : [
                ("binance_api_key",  self.binance_api_key is not None),
                ("binance_secret",   self.binance_secret is not None),
            ],
            ActiveExchange.COINBASE  : [
                ("coinbase_api_key",    self.coinbase_api_key is not None),
                ("coinbase_api_secret", self.coinbase_api_secret is not None),
            ],
            ActiveExchange.CRYPTO_COM: [
                ("cryptocom_api_key", (self.crypto_com_api_key or self.cryptocom_api_key) is not None),
                ("cryptocom_secret",  (self.crypto_com_api_secret or self.cryptocom_secret) is not None),
            ],
            ActiveExchange.BYBIT     : [
                ("bybit_api_key",    self.bybit_api_key is not None),
                ("bybit_api_secret", self.bybit_api_secret is not None),
            ],
            ActiveExchange.BITGET    : [
                ("bitget_api_key",     self.bitget_api_key is not None),
                ("bitget_secret",      (self.bitget_secret or self.bitget_secret_key or self.bitget_api_secret) is not None),
                ("bitget_passphrase",  (self.bitget_api_passphrase or self.bitget_passphrase) is not None),
            ],
        }

        # LLM key resolution
        llm_check: dict[ActiveLLM, list[tuple[str, bool]]] = {
            ActiveLLM.GROK       : [
                ("grok/xai_api_key", (self.grok_api_key or self.xai_api_key) is not None),
            ],
            ActiveLLM.ANTHROPIC  : [
                ("anthropic_api_key", (self.anthropic_api_key or self.claude_api_key) is not None),
            ],
            ActiveLLM.GEMINI     : [
                ("gemini_api_key", self.gemini_api_key is not None),
            ],
            ActiveLLM.OPENROUTER : [
                ("openrouter_api_key", self.openrouter_api_key is not None),
            ],
        }

        missing = [
            name for name, present in exchange_check[self.active_exchange] if not present
        ] + [
            name for name, present in llm_check[self.active_llm] if not present
        ]

        if missing:
            raise ValueError(
                f"Missing required secrets for "
                f"exchange={self.active_exchange.value}, llm={self.active_llm.value}: "
                + ", ".join(missing)
            )
        return self

    # ------------------------------------------------------------------
    # Convenience accessors  (resolves aliases — e.g. XAI_API_KEY or GROK_API_KEY)
    # ------------------------------------------------------------------

    @property
    def resolved_grok_key(self) -> Optional[str]:
        """Resolve Grok/xAI API key from either env var name."""
        key = self.grok_api_key or self.xai_api_key
        if key is None:
            return None
        return key.get_secret_value()

    @property
    def resolved_anthropic_key(self) -> Optional[str]:
        """Resolve Anthropic API key from either env var name."""
        key = self.anthropic_api_key or self.claude_api_key
        if key is None:
            return None
        return key.get_secret_value()

    @property
    def resolved_gemini_key(self) -> Optional[str]:
        if self.gemini_api_key is None:
            return None
        return self.gemini_api_key.get_secret_value()

    @property
    def resolved_openrouter_key(self) -> Optional[str]:
        if self.openrouter_api_key is None:
            return None
        return self.openrouter_api_key.get_secret_value()

    @property
    def active_exchange_keypair(self) -> tuple[str, str]:
        """Return (api_key, api_secret) for the active exchange as plain strings."""
        pairs: dict[ActiveExchange, tuple[Optional[SecretStr], Optional[SecretStr]]] = {
            ActiveExchange.BINANCE   : (self.binance_api_key,    self.binance_secret),
            ActiveExchange.COINBASE  : (self.coinbase_api_key,   self.coinbase_api_secret),
            ActiveExchange.CRYPTO_COM: (self.crypto_com_api_key or self.cryptocom_api_key,
                                        self.crypto_com_api_secret or self.cryptocom_secret),
            ActiveExchange.BYBIT     : (self.bybit_api_key,      self.bybit_api_secret),
            ActiveExchange.BITGET    : (self.bitget_api_key,
                                        self.bitget_secret or self.bitget_secret_key or self.bitget_api_secret),
        }
        key, secret = pairs[self.active_exchange]
        if key is None or secret is None:
            raise RuntimeError(
                f"Exchange keypair for {self.active_exchange.value} is not set."
            )
        return key.get_secret_value(), secret.get_secret_value()

    @property
    def active_llm_key(self) -> str:
        """Return the API key for the active LLM as a plain string."""
        resolvers: dict[ActiveLLM, Optional[str]] = {
            ActiveLLM.GROK      : self.resolved_grok_key,
            ActiveLLM.ANTHROPIC : self.resolved_anthropic_key,
            ActiveLLM.GEMINI    : self.resolved_gemini_key,
            ActiveLLM.OPENROUTER: self.resolved_openrouter_key,
        }
        key = resolvers[self.active_llm]
        if key is None:
            raise RuntimeError(
                f"LLM key for {self.active_llm.value} is not set."
            )
        return key

    @property
    def is_production(self) -> bool:
        return self.env == Environment.PRODUCTION

    @property
    def is_paper_mode(self) -> bool:
        return self.paper_trading or self.paper_trade or self.trading_mode == "paper"


# ---------------------------------------------------------------------------
# Singleton accessor  (lazy — not evaluated at import time)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """
    Use this instead of importing `settings` directly.

    In tests, call get_settings.cache_clear() then monkeypatch env vars
    before the first call to get a fresh Settings instance.
    """
    from core.private_env import load_api_defaults
    load_api_defaults()
    return Settings()
