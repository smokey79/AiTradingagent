"""Private master API defaults; no network calls or trading-mode changes."""
from __future__ import annotations
import os
from pathlib import Path
import re

_PROVIDERS = 'ALPACA APCA ANTHROPIC CLAUDE BIGDATA BINANCE BITGET BROWSERBASE BYBIT CEREBRAS CMC COINMARKETCAP COINGECKO CRYPTOCOM CRYPTO_COM DEEPSEEK EXA FAL FIRECRAWL FIREWORKS GEMINI GITHUB GLASSNODE GOOGLE GOOGLECLOUD GROK GROQ HERMES HF HUGGINGFACE INFURA KIMI KUCOIN LANGFUSE META5 MT5 MINIMAX MISTRAL NEWS NEWSAPI NEXO NOVITA NVIDIA OANDA OKX OLLAMA OPENAI OPENROUTER OPEN_ROUTER PERPLEXITY PPLX SOSOVALUE TELEGRAM TRADING212 TRADINGKIT TRADINGVIEW WAKA WAKATIME XAI YOUTUBE'.split()
_NAME = re.compile(r'^(?:' + '|'.join(_PROVIDERS) + r')_[A-Z0-9_]*(?:KEYS?|SECRET|TOKEN|PASSWORD|PASSPHRASE|URL|ENDPOINT|ACCOUNT_ID|CLIENT_ID|TENANT_ID|PROJECT_ID|ADDRESS|LOGIN)(?:_[A-Z0-9_]+)?$')
_EXCLUDED = re.compile(r'HISTORICAL|ARCHIVE|DEPRECATED|PRIVATE_KEY|MNEMONIC|SEED', re.I)
_PLACEHOLDER = re.compile(r'placeholder|example|dummy|your[_ -]|change[_-]?me|disabled|\$\{|\.\.\.', re.I)

def read_private_env(path: str | Path) -> dict[str, str]:
    path = Path(path)
    if not path.is_file(): return {}
    data = path.read_bytes()
    text = data.decode('utf-16' if data.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig', errors='replace')
    result = {}
    for line in text.splitlines():
        match = re.match(r'\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$', line)
        if not match: continue
        name, value = match.groups()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'": value = value[1:-1]
        else: value = re.split(r'\s+#', value, maxsplit=1)[0].strip()
        result[name] = value
    return result

def load_api_defaults(project_root: str | Path | None = None, master_path: str | Path | None = None) -> list[str]:
    project_root = Path(project_root) if project_root else Path(__file__).resolve().parent.parent
    local = read_private_env(project_root / '.env')
    master = read_private_env(master_path or os.getenv('API_MASTER_PATH', 'F:/aitrader/.env.master'))
    loaded = []
    for name, value in master.items():
        if not _NAME.fullmatch(name) or _EXCLUDED.search(name) or '__' in name or not value.strip() or _PLACEHOLDER.search(value): continue
        if name in os.environ or name in local: continue
        os.environ[name] = value
        loaded.append(name)
    return loaded
