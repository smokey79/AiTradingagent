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


class ActiveLLM(str, Enum):
    GROK      = "grok"
    ANTHROPIC = "anthropic"


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

class Settings(BaseSettings):
    """
    All configuration is read from environment variables or a .env file.
    Prefix every variable with APP_  (e.g. APP_ENV, APP_GROK_API_KEY).

    Required fields have no default; pydantic will raise on startup if missing.
    Optional fields default to None and are validated in context by
    `check_provider_secrets` below.
    """

    model_config = SettingsConfigDict(
        env_file          = ".env",
        env_file_encoding = "utf-8",
        env_prefix        = "APP_",       # avoids accidental env collisions
        case_sensitive    = False,
        extra             = "ignore",     # don't error on unknown APP_* vars
    )

    # ------------------------------------------------------------------
    # Runtime context
    # ------------------------------------------------------------------
    env            : Environment   = Environment.DEVELOPMENT
    active_exchange: ActiveExchange = ActiveExchange.BYBIT
    active_llm     : ActiveLLM     = ActiveLLM.ANTHROPIC

    # ------------------------------------------------------------------
    # Exchange secrets  (all optional — validated below based on active_exchange)
    # ------------------------------------------------------------------
    binance_api_key        : Optional[SecretStr] = None
    binance_api_secret     : Optional[SecretStr] = None

    coinbase_api_key       : Optional[SecretStr] = None
    coinbase_api_secret    : Optional[SecretStr] = None

    crypto_com_api_key     : Optional[SecretStr] = None
    crypto_com_api_secret  : Optional[SecretStr] = None

    bybit_api_key          : Optional[SecretStr] = None
    bybit_api_secret       : Optional[SecretStr] = None

    # ------------------------------------------------------------------
    # LLM secrets
    # ------------------------------------------------------------------
    grok_api_key      : Optional[SecretStr] = None
    anthropic_api_key : Optional[SecretStr] = None

    # ------------------------------------------------------------------
    # Infrastructure
    # ------------------------------------------------------------------
    rpc_url                    : Optional[SecretStr] = None
    tradingview_webhook_secret : Optional[SecretStr] = None

    # ------------------------------------------------------------------
    # Cross-field validation
    # ------------------------------------------------------------------

    @model_validator(mode="after")
    def check_provider_secrets(self) -> "Settings":
        """Fail fast if the active provider's credentials are missing."""
        exchange_keys: dict[ActiveExchange, list[tuple[str, Optional[SecretStr]]]] = {
            ActiveExchange.BINANCE   : [("binance_api_key",    self.binance_api_key),
                                        ("binance_api_secret", self.binance_api_secret)],
            ActiveExchange.COINBASE  : [("coinbase_api_key",    self.coinbase_api_key),
                                        ("coinbase_api_secret", self.coinbase_api_secret)],
            ActiveExchange.CRYPTO_COM: [("crypto_com_api_key",    self.crypto_com_api_key),
                                        ("crypto_com_api_secret", self.crypto_com_api_secret)],
            ActiveExchange.BYBIT     : [("bybit_api_key",    self.bybit_api_key),
                                        ("bybit_api_secret", self.bybit_api_secret)],
        }
        llm_keys: dict[ActiveLLM, list[tuple[str, Optional[SecretStr]]]] = {
            ActiveLLM.GROK      : [("grok_api_key",      self.grok_api_key)],
            ActiveLLM.ANTHROPIC : [("anthropic_api_key", self.anthropic_api_key)],
        }

        # Skip secret checks in test environments
        if self.env == Environment.TEST:
            return self

        missing = [
            name
            for name, value in exchange_keys[self.active_exchange]
            if value is None
        ] + [
            name
            for name, value in llm_keys[self.active_llm]
            if value is None
        ]

        if missing:
            raise ValueError(
                f"Missing required secrets for "
                f"exchange={self.active_exchange.value}, llm={self.active_llm.value}: "
                + ", ".join(missing)
            )
        return self

    # ------------------------------------------------------------------
    # Convenience accessors  (avoids .get_secret_value() call sites)
    # ------------------------------------------------------------------

    @property
    def active_exchange_keypair(self) -> tuple[str, str]:
        """Return (api_key, api_secret) for the active exchange as plain strings."""
        pairs: dict[ActiveExchange, tuple[Optional[SecretStr], Optional[SecretStr]]] = {
            ActiveExchange.BINANCE   : (self.binance_api_key,    self.binance_api_secret),
            ActiveExchange.COINBASE  : (self.coinbase_api_key,   self.coinbase_api_secret),
            ActiveExchange.CRYPTO_COM: (self.crypto_com_api_key, self.crypto_com_api_secret),
            ActiveExchange.BYBIT     : (self.bybit_api_key,      self.bybit_api_secret),
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
        keys: dict[ActiveLLM, Optional[SecretStr]] = {
            ActiveLLM.GROK      : self.grok_api_key,
            ActiveLLM.ANTHROPIC : self.anthropic_api_key,
        }
        key = keys[self.active_llm]
        if key is None:
            raise RuntimeError(
                f"LLM key for {self.active_llm.value} is not set."
            )
        return key.get_secret_value()

    @property
    def is_production(self) -> bool:
        return self.env == Environment.PRODUCTION


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
    return Settings()
