"""
orchestrator/luxalgo_strategy_learner.py
========================================
YouTube Alpha Sourcing, Multi-Channel Sentiment Gauging & LuxAlgo Strategy Learner Engine.
1. Auto-discovers and ingests transcripts from subscribed reliable crypto channels (LuxAlgo, Crypto Banter, Coin Bureau, etc.).
2. Gauges multi-factor sentiment (polarity, key price levels, bullish/bearish bias, token mentions).
3. Synthesizes 5X leverage futures & DEX strategies with PineScript v5 generation.
4. Reinforces channel credibility weights dynamically based on realized market accuracy.

2026-09-24 evidence fix (see orchestrator/strategy_evidence.py):
- Win rates are no longer hard-coded. `target_win_rate_pct` is the MEASURED win rate from a
  recorded backtest/paper run, or None when nothing has been measured.
- `gate_68_met` is kept for backward compatibility but now means "passed the evidence gate"
  (sample size, profit factor, expectancy, drawdown, out-of-sample). It is False until
  real results exist. The full verdict is in `evidence_gate`.
- New strategies start as UNVERIFIED_RESEARCH, never ACTIVE_PRODUCTION_STRATEGY.
- Failed transcript fetches no longer invent a bullish transcript; placeholder channels
  produce a neutral HOLD with data_quality="no_real_transcript".
- Run `python -m orchestrator.luxalgo_strategy_learner --migrate` once to re-label old
  entries (backups are written first).
"""

import os
import re
import sys
import json
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

# Google Drive OAuth helper for loading config files
try:
    from orchestrator.google_drive_auth import list_files, download_file
except Exception:
    try:
        from google_drive_auth import list_files, download_file
    except Exception:
        try:
            from .google_drive_auth import list_files, download_file
        except Exception:
            def list_files(folder_id=None):
                return []
            def download_file(file_id, dest_path):
                return False

# Environment variables for Drive access
GOOGLE_DRIVE_FOLDER_ID = os.getenv("GOOGLE_DRIVE_FOLDER_ID")  # Folder ID containing .py/.json/.env files
GOOGLE_DRIVE_CREDS = os.getenv("GOOGLE_DRIVE_CREDS")  # Path to OAuth credentials JSON

def load_drive_file(file_name: str, dest_dir: Path = Path("./drive_cache")) -> Path:
    """Download *file_name* from the configured Drive folder into *dest_dir* and return the local Path.
    Raises FileNotFoundError if the file does not exist in Drive.
    """
    if not GOOGLE_DRIVE_FOLDER_ID:
        raise EnvironmentError("GOOGLE_DRIVE_FOLDER_ID env var not set")
    files = list_files(GOOGLE_DRIVE_FOLDER_ID)
    match = next((f for f in files if f["name"] == file_name), None)
    if not match:
        raise FileNotFoundError(f"{file_name} not found in Drive folder")
    dest_path = dest_dir / file_name
    download_file(match["id"], dest_path)
    return dest_path
    sys.path.insert(0, str(PROJECT_ROOT))

try:
    from orchestrator.strategy_evidence import (
        EvidenceStore, evaluate_gate, from_js_backtest, STATUS_UNVERIFIED,
    )
except Exception:  # running from inside orchestrator/
    from strategy_evidence import EvidenceStore, evaluate_gate, from_js_backtest, STATUS_UNVERIFIED  # type: ignore

DATA_DIR = PROJECT_ROOT / "data"
STRATEGY_DIR = PROJECT_ROOT / "strategy"
SENTIMENT_DIR = PROJECT_ROOT / "src" / "sentiment"
MEMORY_PATH = STRATEGY_DIR / "strategy_memory.json"
LEARNED_STRATEGIES_PATH = DATA_DIR / "learned_strategies.json"
CREDIBILITY_PATH = SENTIMENT_DIR / "channel_credibility.json"
SENTIMENT_CACHE_PATH = DATA_DIR / "youtube_sentiment_cache.json"
TRANSCRIPT_CACHE_PATH = DATA_DIR / "youtube_transcripts_cache.json"   # real transcripts only, keyed by channel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [LuxAlgoLearner] %(message)s")
log = logging.getLogger("LuxAlgoStrategyLearner")


def extract_video_id(url_or_id: str) -> str:
    """Extracts clean 11-char YouTube video ID from various URL formats."""
    if not url_or_id:
        return ""
    if len(url_or_id) == 11 and re.match(r"^[a-zA-Z0-9_-]{11}$", url_or_id):
        return url_or_id
    patterns = [
        r"(?:v=|\/)([0-9A-Za-z_-]{11})",
        r"youtu\.be\/([0-9A-Za-z_-]{11})",
        r"embed\/([0-9A-Za-z_-]{11})",
        r"shorts\/([0-9A-Za-z_-]{11})",
    ]
    for p in patterns:
        m = re.search(p, url_or_id)
        if m:
            return m.group(1)
    return url_or_id[:11]


# ── Subscribed Crypto Channels Registry ──────────────────────────────────────
# WARNING: channel_id values and recent_videos below are PLACEHOLDERS, not real YouTube
# data, and the weights are unmeasured priors. Sentiment is only produced for a channel
# once a real transcript from it has been fetched (see TRANSCRIPT_CACHE_PATH).
CHANNEL_REGISTRY_IS_PLACEHOLDER = True
SUBSCRIBED_ALPHA_CHANNELS = {
    "LuxAlgo": {
        "channel_id": "UC_LuxAlgo_Official",
        "handle": "@LuxAlgo",
        "category": "Smart Money Concepts & Algorithmic Indicators",
        "weight": 1.45,
        "sample_topics": ["Order Blocks", "Liquidity Sweeps", "Oscillator Matrix", "Fair Value Gaps", "5X Futures Presets"],
        "recent_videos": [
            {"id": "LX_SMC_01", "title": "LuxAlgo Smart Money Concepts: 5X Leverage Liquidity Sweep Strategy", "views": "142K"},
            {"id": "LX_OSC_02", "title": "Oscillator Matrix & Institutional Money Flow Divergence Guide", "views": "98K"},
            {"id": "LX_NEO_03", "title": "Neo-Cloud Dynamic Volatility Trend Catcher for Bitcoin & Ethereum", "views": "115K"},
        ]
    },
    "Crypto Banter": {
        "channel_id": "UC_CryptoBanterOfficial",
        "handle": "@CryptoBanterOfficial",
        "category": "Daily Market Momentum & Altcoin Rotations",
        "weight": 1.20,
        "sample_topics": ["Altcoin Season", "Bitcoin ETF Flows", "Layer 2 Breakouts", "Macro Inflows"],
        "recent_videos": [
            {"id": "CB_MKT_01", "title": "Massive Bitcoin Breakout Imminent — Institutional Inflow Explosion", "views": "210K"},
            {"id": "CB_ALT_02", "title": "Top Layer 2 Tokens (Arbitrum, Base, Solana) Ready for 5X Move", "views": "185K"},
        ]
    },
    "Coin Bureau": {
        "channel_id": "UC_CoinBureau",
        "handle": "@CoinBureau",
        "category": "Macroeconomics, Regulation & Fundamental Research",
        "weight": 1.25,
        "sample_topics": ["Federal Reserve Interest Rates", "Crypto Liquidity Cycle", "Ethereum Staking & L2s"],
        "recent_videos": [
            {"id": "CBU_MAC_01", "title": "Global Liquidity Shock: What It Means for Crypto Markets 2026", "views": "340K"},
            {"id": "CBU_ETH_02", "title": "Ethereum vs Solana: Comprehensive Institutional Flow Breakdown", "views": "290K"},
        ]
    },
    "TradingView Mastery": {
        "channel_id": "UC_TradingViewMastery",
        "handle": "@TradingViewMastery",
        "category": "Quantitative Backtesting & PineScript Development",
        "weight": 1.30,
        "sample_topics": ["PineScript v5 Backtesting", "ATR Trailing Stops", "Win Rate Optimization"],
        "recent_videos": [
            {"id": "TVM_PINE_01", "title": "How to Build a 75% Win-Rate PineScript v5 Trading Strategy", "views": "88K"},
            {"id": "TVM_RISK_02", "title": "Monte Carlo Sizing & 5X Margin Liquidation Protection", "views": "72K"},
        ]
    },
    "Benjamin Cowen": {
        "channel_id": "UC_BenjaminCowen",
        "handle": "@BenjaminCowen",
        "category": "Quantitative Risk Regimes & Market Cycles",
        "weight": 1.35,
        "sample_topics": ["Bitcoin Dominance", "Risk Metric Bands", "MVRV Z-Score", "Monetary Policy"],
        "recent_videos": [
            {"id": "BC_CYCLE_01", "title": "Bitcoin Market Cycle Dynamic Risk Band Analysis", "views": "165K"},
        ]
    },
    "Glassnode Insights": {
        "channel_id": "UC_GlassnodeInsights",
        "handle": "@Glassnode",
        "category": "On-Chain Accumulation & Exchange Reserves",
        "weight": 1.40,
        "sample_topics": ["Exchange Outflows", "Whale Cohort Accumulation", "SOPR Realized Profit/Loss"],
        "recent_videos": [
            {"id": "GN_ONCH_01", "title": "On-Chain Supercycle: Whale Accumulation at Record Highs", "views": "95K"},
        ]
    }
}


# ── Built-in LuxAlgo & SMC Master Indicator Presets ───────────────────────────
LUXALGO_KNOWLEDGE_BASE = {
    "luxalgo_smc_order_block": {
        "title": "LuxAlgo Smart Money Concepts — Order Block & Liquidity Sweep 5X",
        "channel": "LuxAlgo",
        "concepts": ["Order Blocks (OB)", "Liquidity Sweeps", "Fair Value Gaps (FVG)", "Break of Structure (BoS)"],
        "claimed_win_rate_pct": None,   # no measured result; old 76.5 was invented
        "requires_paid_indicator": False,  # free SMC logic (LuxAlgo SMC script / smartmoneyconcepts pip)
        "timeframes": ["15m", "1h", "4h"],
        "summary": "Identifies institutional order blocks after stop-hunts and enters on retest with 5X leverage.",
        "entry_rule": "Enter LONG when price sweeps previous swing low liquidity and closes back above Bullish Order Block with confirmation volume.",
        "exit_rule": "Take profit at 1:2.6 RR (+4.0% price = +20% on 5X margin). Stop loss placed 0.5% below Order Block low.",
    },
    "luxalgo_oscillator_matrix": {
        "title": "LuxAlgo Oscillator Matrix & Money Flow Divergence v2",
        "channel": "LuxAlgo",
        "concepts": ["Oscillator Matrix", "Money Flow Index (MFI)", "Hyper-Wave Momentum", "Volume Exhaustion"],
        "claimed_win_rate_pct": None,   # old 73.0 was invented
        "requires_paid_indicator": True,   # Oscillator Matrix is a paid, closed-source LuxAlgo toolkit
        "paid_indicators": ["LuxAlgo Oscillator Matrix"],
        "timeframes": ["5m", "15m", "1h"],
        "summary": "Combines multi-layer momentum waves and institutional money flow divergence for reversal sniping.",
        "entry_rule": "Enter LONG on bullish regular divergence on Oscillator Matrix while Money Flow line turns dark green above baseline.",
        "exit_rule": "Exit on momentum wave exhaustion cluster or when price reaches +3.8% target (+19.0% on 5X margin).",
    },
    "luxalgo_confirmation_neo_cloud": {
        "title": "LuxAlgo Signals & Overlays — Neo-Cloud Trend Catcher 5X",
        "channel": "LuxAlgo",
        "concepts": ["Confirmation Signals", "Neo-Cloud", "Smart Trail", "Dynamic Volatility Bands"],
        "claimed_win_rate_pct": None,   # old 71.5 was invented
        "requires_paid_indicator": True,   # Signals & Overlays (Neo-Cloud, Smart Trail) is paid, closed-source
        "paid_indicators": ["LuxAlgo Signals & Overlays"],
        "timeframes": ["15m", "1h"],
        "summary": "Trend-following breakout system with Neo-Cloud dynamic support and ATR trailing stop.",
        "entry_rule": "Enter LONG on 'Strong Buy' signal confirmed by Neo-Cloud color shift (Green) and candle close above Smart Trail.",
        "exit_rule": "Trailing stop 1.5x ATR below Smart Trail. Target profit: +4.2% (+21.0% on 5X margin).",
    },
}


def _normalize_strategy(s: Dict[str, Any]) -> Dict[str, Any]:
    """Normalizes any strategy dictionary to ensure all required fields are present."""
    if not isinstance(s, dict):
        return {}
    title = s.get("title") or s.get("name") or "LuxAlgo 5X Strategy"
    channel = s.get("channel_source") or s.get("channel") or "LuxAlgo Official & YouTube Alpha"
    leverage = s.get("leverage") or "5X"
    symbol = s.get("symbol") or "BTC/USDT"
    timeframe = s.get("timeframe") or "15m"

    # Only a measured win rate is kept. Old records carry invented values (76.5 etc.),
    # so a stored number is trusted only when it comes with an embedded backtest that has trades.
    bt = s.get("backtest") if isinstance(s.get("backtest"), dict) else {}
    bt_trades = int(float(bt.get("totalTrades") or 0)) if bt else 0
    target_win_rate = None
    if bt_trades > 0 and bt.get("winRate") is not None:
        target_win_rate = float(bt["winRate"])
    elif isinstance(s.get("evidence_gate"), dict) and (s["evidence_gate"].get("metrics") or {}).get("win_rate_pct") is not None:
        target_win_rate = s["evidence_gate"]["metrics"]["win_rate_pct"]

    rm = s.get("risk_management")
    if not isinstance(rm, dict):
        rr = 2.5
        if isinstance(s.get("backtest"), dict) and s["backtest"].get("riskRewardRatio"):
            rr = s["backtest"]["riskRewardRatio"]
        rm = {
            "take_profit_pct": 4.0,
            "take_profit_leveraged_pct": 20.0,
            "stop_loss_pct": 1.5,
            "stop_loss_leveraged_pct": 7.5,
            "liquidation_safety_buffer_pct": 17.5,
            "risk_reward_ratio": rr,
        }
    elif "risk_reward_ratio" not in rm:
        rm["risk_reward_ratio"] = 2.5

    concepts = s.get("concepts")
    if not isinstance(concepts, list) or not concepts:
        concepts = [
            "Order Block (OB) Identification",
            "Liquidity Sweep Invalidation",
            "Dynamic ATR Trailing Stop (1.5x)",
            "Isolated 5X Leverage Margin",
        ]

    pinescript = s.get("pinescript_code") or s.get("pinescript") or ""

    return {
        "id": s.get("id") or f"STRAT_SMC_{symbol.replace('/', '_')}",
        "title": title,
        "name": title,
        "type": s.get("type") or s.get("strategyType") or "luxalgo_smc",
        "symbol": symbol,
        "timeframe": timeframe,
        "leverage": leverage,
        "channel_source": channel,
        "target_win_rate_pct": target_win_rate,
        "win_rate_is_measured": target_win_rate is not None,
        "gate_68_met": bool((s.get("evidence_gate") or {}).get("passed", False)),
        "evidence_gate": s.get("evidence_gate") or {"passed": False, "status": STATUS_UNVERIFIED,
                                                     "reasons": ["Not yet evaluated against measured results."], "metrics": None},
        "concepts": concepts,
        "risk_management": rm,
        "pinescript_code": pinescript,
        "pinescript": pinescript,
        "learned_at": s.get("learned_at") or s.get("learnedAt") or datetime.now(timezone.utc).isoformat(),
        # Never trust a stored "ACTIVE_PRODUCTION_STRATEGY": status follows the evidence gate.
        "status": (s.get("evidence_gate") or {}).get("status") or STATUS_UNVERIFIED,
        "backtest": s.get("backtest") or {},
        "parameters": s.get("parameters") or {},
    }


class LuxAlgoStrategyLearnerAgent:
    """
    Unified YouTube Alpha Sourcing, Sentiment Gauging & Strategy Learner Agent.
    - Extracts transcripts & sentiment from subscribed channels
    - Gauges token-level sentiment & key price levels
    - Generates 5X futures PineScript v5 strategies
    - Updates credibility & strategy reinforcement memory
    """

    def __init__(self):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        STRATEGY_DIR.mkdir(parents=True, exist_ok=True)
        SENTIMENT_DIR.mkdir(parents=True, exist_ok=True)
        self.learned_strategies = self._load_learned_strategies()
        self.credibility = self._load_credibility()
        self.sentiment_cache = self._load_sentiment_cache()
        self.evidence = EvidenceStore()
        self.transcripts = self._load_json(TRANSCRIPT_CACHE_PATH, {})

    def _load_learned_strategies(self) -> List[Dict[str, Any]]:
        try:
            if LEARNED_STRATEGIES_PATH.exists():
                raw = json.loads(LEARNED_STRATEGIES_PATH.read_text(encoding="utf-8"))
                if isinstance(raw, list):
                    return [_normalize_strategy(item) for item in raw if isinstance(item, dict)]
        except Exception as e:
            log.warning(f"Could not load learned strategies: {e}")
        return []

    def _save_learned_strategies(self):
        try:
            LEARNED_STRATEGIES_PATH.write_text(json.dumps(self.learned_strategies, indent=2), encoding="utf-8")
        except Exception as e:
            log.error(f"Error saving learned strategies: {e}")

    def _load_credibility(self) -> Dict[str, Any]:
        try:
            if CREDIBILITY_PATH.exists():
                return json.loads(CREDIBILITY_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
        # Start every channel neutral: weight 1.0, no trades, accuracy unknown.
        # (Previously this invented 20 trades and a 70-80% accuracy per channel.)
        res = {}
        for name, data in SUBSCRIBED_ALPHA_CHANNELS.items():
            res[name] = {
                "weight": 1.0,
                "accuracy": None,
                "trades": 0,
                "wins": 0,
                "category": data["category"],
            }
        return res

    def _save_credibility(self):
        try:
            CREDIBILITY_PATH.write_text(json.dumps(self.credibility, indent=2), encoding="utf-8")
        except Exception as e:
            log.error(f"Error saving credibility: {e}")

    def _load_sentiment_cache(self) -> Dict[str, Any]:
        try:
            if SENTIMENT_CACHE_PATH.exists():
                return json.loads(SENTIMENT_CACHE_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
        return {}

    def _save_sentiment_cache(self):
        try:
            SENTIMENT_CACHE_PATH.write_text(json.dumps(self.sentiment_cache, indent=2), encoding="utf-8")
        except Exception as e:
            log.error(f"Error saving sentiment cache: {e}")

    @staticmethod
    def _load_json(path: Path, default: Any) -> Any:
        try:
            if path.exists():
                return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
        return default

    def _save_transcripts(self):
        try:
            TRANSCRIPT_CACHE_PATH.write_text(json.dumps(self.transcripts, indent=2), encoding="utf-8")
        except Exception as e:
            log.error(f"Error saving transcript cache: {e}")

    # ── Transcript Ingestion ──────────────────────────────────────────────────

    def fetch_youtube_transcript(self, video_url_or_id: str) -> Dict[str, Any]:
        """
        Fetches transcript text and metadata from a YouTube video URL using youtube_transcript_api or oEmbed.
        """
        video_id = extract_video_id(video_url_or_id)
        if not video_id:
            return {"success": False, "error": "Invalid YouTube URL or Video ID"}

        transcript_text = ""
        title = f"Crypto Strategy Video [{video_id}]"
        author = "LuxAlgo / Crypto Analyst"

        # Try oEmbed for title & author
        try:
            import requests
            res = requests.get(f"https://noembed.com/embed?url=https://www.youtube.com/watch?v={video_id}", timeout=4)
            if res.status_code == 200:
                data = res.json()
                title = data.get("title", title)
                author = data.get("author_name", author)
        except Exception:
            pass

        # Try fetching real transcript via youtube-transcript-api
        try:
            from youtube_transcript_api import YouTubeTranscriptApi
            transcript_list = YouTubeTranscriptApi.get_transcript(video_id, languages=['en', 'en-US'])
            transcript_text = " ".join([item["text"] for item in transcript_list])
            log.info(f"Fetched {len(transcript_list)} transcript segments for video {video_id}")
        except Exception as e:
            # No invented transcript: without real text there is no sentiment signal.
            log.warning(f"No transcript available for {video_id} ({e}). Sentiment will be neutral/no-signal.")
            transcript_text = ""

        transcript_available = bool(transcript_text.strip())
        sentiment_analysis = self.gauge_transcript_sentiment(transcript_text, channel_name=author)

        if transcript_available:
            entry = {"video_id": video_id, "title": title, "text": transcript_text[:20000],
                     "fetched_at": datetime.now(timezone.utc).isoformat()}
            vids = [v for v in self.transcripts.get(author, []) if v.get("video_id") != video_id]
            self.transcripts[author] = ([entry] + vids)[:10]
            self._save_transcripts()

        return {
            "success": True,
            "transcript_available": transcript_available,
            "video_id": video_id,
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "title": title,
            "channel": author,
            "transcript_snippet": transcript_text[:1200],
            "full_transcript_length": len(transcript_text),
            "transcript_text": transcript_text,
            "sentiment": sentiment_analysis,
        }

    # ── Multi-Factor Sentiment Gauging ────────────────────────────────────────

    def gauge_transcript_sentiment(self, transcript_text: str, channel_name: str = "LuxAlgo") -> Dict[str, Any]:
        """
        Gauges multi-factor sentiment from transcript text:
        - Bullish/Bearish keyword density & polarity
        - Target price detection ($80k, $3500, etc.)
        - Target symbol mentions (BTC, ETH, SOL, CRO, AVAX, ARB, OP)
        - Channel-weighted conviction scoring
        """
        text_lower = transcript_text.lower()

        bullish_keywords = [
            "bull", "bullish", "breakout", "accumulate", "accumulation", "buy", "surge", "rally",
            "ath", "pump", "uptrend", "golden cross", "undervalued", "inflow", "inflows", "long",
            "support held", "liquidity sweep", "order block bounce", "reversal up", "expansion",
            "target higher", "etf demand", "whale buying", "higher highs", "5x long"
        ]

        bearish_keywords = [
            "bear", "bearish", "crash", "dump", "sell", "panic", "collapse", "liquidation",
            "downtrend", "death cross", "overvalued", "outflow", "outflows", "short",
            "resistance rejected", "break of structure down", "distribution", "lower lows",
            "recession", "hawkish", "whale dumping", "drawdown", "5x short"
        ]

        bull_count = sum(text_lower.count(kw) for kw in bullish_keywords)
        bear_count = sum(text_lower.count(kw) for kw in bearish_keywords)
        total_signals = bull_count + bear_count

        if total_signals > 0:
            raw_polarity = (bull_count - bear_count) / total_signals
        else:
            raw_polarity = 0.0  # no keywords = no opinion (was a hard-coded +0.25 bullish bias)

        # Categorize
        if raw_polarity >= 0.40:
            category = "STRONG_BULLISH"
            bias_signal = "BUY"
        elif raw_polarity >= 0.10:
            category = "BULLISH"
            bias_signal = "BUY"
        elif raw_polarity <= -0.40:
            category = "STRONG_BEARISH"
            bias_signal = "SELL"
        elif raw_polarity <= -0.10:
            category = "BEARISH"
            bias_signal = "SELL"
        else:
            category = "NEUTRAL"
            bias_signal = "HOLD"

        # Channel credibility weight multiplier
        channel_weight = self.credibility.get(channel_name, {}).get("weight", 1.0)
        if total_signals == 0:
            confidence = 0.0
        else:
            # Confidence grows with evidence volume; capped well below certainty.
            volume_factor = min(1.0, total_signals / 20.0)
            confidence = round(min(0.90, abs(raw_polarity) * volume_factor * min(channel_weight, 1.5)), 2)

        # Detect mentioned assets
        tokens_detected = []
        for sym in ["BTC", "ETH", "SOL", "CRO", "AVAX", "ARB", "OP"]:
            if sym.lower() in text_lower or sym in transcript_text:
                tokens_detected.append(f"{sym}/USDT")
        # (no default assets: if none are mentioned, none are reported)

        # Detect potential price targets using regex (e.g. $80,000, 78k, $3,500)
        price_patterns = re.findall(r"\$?\b(\d{1,3}(?:,\d{3})+|\d{2,5}(?:\.\d+)?k?)\b", transcript_text, re.IGNORECASE)
        notable_levels = [p for p in price_patterns[:4] if len(p) >= 2]

        return {
            "channel": channel_name,
            "channel_weight": channel_weight,
            "category": category,
            "bias_signal": bias_signal,
            "polarity_score": round(raw_polarity, 3),
            "confidence": confidence,
            "bullish_indicators_count": bull_count,
            "bearish_indicators_count": bear_count,
            "mentioned_assets": tokens_detected,
            "notable_price_levels": notable_levels,
            "data_quality": "ok" if total_signals > 0 else ("no_keywords" if transcript_text.strip() else "no_real_transcript"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    # ── Comprehensive Alpha Sourcing from Subscriptions ───────────────────────

    def source_all_subscription_alpha(self) -> Dict[str, Any]:
        """
        Aggregates sentiment across subscribed channels using REAL cached transcripts only.
        Channels with no real transcript report HOLD with data_quality="no_real_transcript"
        and are left out of the composite. (Previously every channel was fed an invented
        bullish sentence, so the composite was always BUY.)
        """
        all_sentiment = []
        channel_summaries = []

        for name, meta in SUBSCRIBED_ALPHA_CHANNELS.items():
            cached = self.transcripts.get(name) or []
            if cached:
                latest = cached[0]
                sent = self.gauge_transcript_sentiment(latest.get("text", ""), channel_name=name)
                video_title = latest.get("title", "")
            else:
                sent = self.gauge_transcript_sentiment("", channel_name=name)
                video_title = ""
            if sent["data_quality"] == "ok":
                all_sentiment.append(sent)

            cred = self.credibility.get(name, {})
            acc = cred.get("accuracy")
            channel_summaries.append({
                "name": name,
                "handle": meta.get("handle", "@" + name.replace(" ", "")),
                "category": meta.get("category"),
                "credibility_weight": cred.get("weight", 1.0),
                "accuracy_hit_rate": f"{acc * 100:.1f}% over {cred.get('trades', 0)} calls" if acc is not None else "not measured",
                "recent_video_title": video_title or "(no real transcript fetched yet)",
                "sentiment_category": sent["category"],
                "bias_signal": sent["bias_signal"],
                "confidence": sent["confidence"],
                "data_quality": sent["data_quality"],
            })

        if all_sentiment:
            total_weight = sum(s_["channel_weight"] for s_ in all_sentiment)
            composite_polarity = sum(s_["polarity_score"] * s_["channel_weight"] for s_ in all_sentiment) / max(total_weight, 1e-6)
            coverage = len(all_sentiment) / max(len(SUBSCRIBED_ALPHA_CHANNELS), 1)
            overall_conf = round(coverage * sum(s_["confidence"] for s_ in all_sentiment) / len(all_sentiment), 2)
        else:
            composite_polarity, overall_conf = 0.0, 0.0

        composite_category = ("NO_DATA" if not all_sentiment else
                              "BULLISH_EXPANSION" if composite_polarity >= 0.20 else
                              "DEFENSIVE_CONSOLIDATION" if composite_polarity >= -0.10 else "BEARISH_DISTRIBUTION")

        res = {
            "composite_market_sentiment": composite_category,
            "composite_polarity": round(composite_polarity, 3),
            "total_channels_monitored": len(channel_summaries),
            "channels_with_real_data": len(all_sentiment),
            "channels": channel_summaries,
            "active_bias": "BUY" if (all_sentiment and composite_polarity >= 0.10) else "HOLD",
            "overall_confidence": overall_conf,
            "registry_is_placeholder": CHANNEL_REGISTRY_IS_PLACEHOLDER,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        self.sentiment_cache = res
        self._save_sentiment_cache()
        return res

    # ── Strategy Generation & Reinforcement ───────────────────────────────────

    def learn_and_generate_strategy(
        self,
        video_url: Optional[str] = None,
        strategy_type: str = "luxalgo_smc",
        symbol: str = "BTC/USDT",
        timeframe: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Builds a strategy template (with PineScript v5) from the knowledge base and an optional
        video, then attaches MEASURED evidence for (strategy_type, symbol, timeframe) if any has
        been recorded. Without evidence the strategy is UNVERIFIED_RESEARCH, its win rate is
        None and gate_68_met is False.
        """
        video_data = {}
        if video_url:
            video_data = self.fetch_youtube_transcript(video_url)

        # Select matching base template
        if "oscillator" in strategy_type.lower() or "divergence" in strategy_type.lower():
            base = LUXALGO_KNOWLEDGE_BASE["luxalgo_oscillator_matrix"]
        elif "cloud" in strategy_type.lower() or "trend" in strategy_type.lower():
            base = LUXALGO_KNOWLEDGE_BASE["luxalgo_confirmation_neo_cloud"]
        else:
            base = LUXALGO_KNOWLEDGE_BASE["luxalgo_smc_order_block"]

        timeframe = timeframe or base["timeframes"][0]
        channel_name = video_data.get("channel") or base["channel"]
        video_title = video_data.get("title") or base["title"]

        evidence = self.evidence.best_for(strategy_type, symbol, timeframe)
        gate = evaluate_gate(evidence)
        measured_wr = (gate["metrics"] or {}).get("win_rate_pct")

        strategy_id = f"STRAT_LUX_{symbol.replace('/', '_')}_{int(datetime.now().timestamp())}"
        pinescript = self.generate_pinescript_v5(
            strategy_name=f"LuxAlgo SMC & 5X Futures Strategy — {symbol}",
            symbol=symbol,
            leverage=5.0,
            measured_win_rate=measured_wr,
        )

        strategy_obj = {
            "id": strategy_id,
            "strategy_key": strategy_type,
            "title": f"LuxAlgo Enhanced: {video_title}",
            "symbol": symbol,
            "timeframe": timeframe,
            "channel_source": channel_name,
            "video_url": video_data.get("url", ""),
            "transcript_available": video_data.get("transcript_available", False),
            "target_win_rate_pct": measured_wr,            # measured or None
            "win_rate_is_measured": measured_wr is not None,
            "gate_68_met": gate["passed"],                  # legacy name: evidence gate passed
            "evidence_gate": gate,
            "requires_paid_indicator": base.get("requires_paid_indicator", False),
            "paid_indicators": base.get("paid_indicators", []),
            "leverage": "5X Futures",
            "leverage_multiplier": 5.0,
            "concepts": base["concepts"],
            "entry_conditions": [
                f"SMC Liquidity Sweep confirmed on {symbol} ({timeframe})",
                "LuxAlgo Order Block retest with Bullish confirmation signal",
                "Volume Expansion > 1.45x 20-SMA & Money Flow positive",
            ],
            "risk_management": {
                "take_profit_pct": 4.0,
                "take_profit_leveraged_pct": 20.0,
                "stop_loss_pct": 1.5,
                "stop_loss_leveraged_pct": 7.5,
                "liquidation_safety_buffer_pct": 17.5,
                "risk_reward_ratio": 2.67,
            },
            "pinescript_code": pinescript,
            "learned_at": datetime.now(timezone.utc).isoformat(),
            "status": gate["status"],
        }

        # Save to learned strategies cache
        self.learned_strategies.insert(0, strategy_obj)
        if len(self.learned_strategies) > 50:
            self.learned_strategies = self.learned_strategies[:50]
        self._save_learned_strategies()

        # Update persistent strategy_memory.json
        self._update_strategy_memory(strategy_obj)

        wr_txt = f"{measured_wr}% measured" if measured_wr is not None else "no measured results"
        log.info(f"Generated LuxAlgo strategy: {strategy_obj['title']} [{gate['status']}, {wr_txt}]")
        if base.get("requires_paid_indicator"):
            log.warning(f"Template uses paid closed-source indicators {base.get('paid_indicators')}; the bot cannot compute these.")
        return strategy_obj

    def record_backtest(self, strategy_key: str, backtest: Dict[str, Any], source: str = "strategyLearningAgent") -> Dict[str, Any]:
        """Record a JS-agent-style backtest dict as evidence and return the gate verdict."""
        ev = self.evidence.record(from_js_backtest(backtest, strategy_key, source))
        return evaluate_gate(self.evidence.best_for(strategy_key, ev.symbol, ev.timeframe) if ev else None)

    def _update_strategy_memory(self, strategy_obj: dict):
        """Appends strategy to strategy_memory.json (learnedStrategies only; tradeHistory untouched)."""
        try:
            mem = {}
            if MEMORY_PATH.exists():
                mem = json.loads(MEMORY_PATH.read_text(encoding="utf-8"))
            mem["lastUpdated"] = datetime.now(timezone.utc).isoformat()
            if "learnedStrategies" not in mem:
                mem["learnedStrategies"] = []
            mem["learnedStrategies"].insert(0, {
                "id": strategy_obj["id"],
                "title": strategy_obj["title"],
                "channel": strategy_obj["channel_source"],
                "winRate": strategy_obj["target_win_rate_pct"],      # measured or null
                "verified": bool(strategy_obj.get("gate_68_met")),
                "evidenceStatus": strategy_obj.get("status"),
                "leverage": strategy_obj["leverage"],
            })
            MEMORY_PATH.write_text(json.dumps(mem, indent=2), encoding="utf-8")
        except Exception as e:
            log.warning(f"Could not update strategy memory: {e}")

    def update_credibility_from_outcome(self, channel_name: str, was_correct: bool):
        """
        Self-learning loop: reinforces channel credibility based on closed trade results.
        +0.05 on correct calls (capped at 2.50x), -0.05 on false calls (floored at 0.20x).
        """
        if channel_name not in self.credibility:
            self.credibility[channel_name] = {"weight": 1.0, "accuracy": 0.5, "trades": 0, "wins": 0}

        entry = self.credibility[channel_name]
        entry["trades"] += 1
        if was_correct:
            entry["wins"] += 1
            entry["weight"] = round(min(2.50, entry["weight"] + 0.05), 2)
        else:
            entry["weight"] = round(max(0.20, entry["weight"] - 0.05), 2)

        entry["accuracy"] = round(entry["wins"] / max(1, entry["trades"]), 3)
        self._save_credibility()
        log.info(f"Updated credibility for {channel_name}: weight={entry['weight']}x (accuracy={entry['accuracy']*100:.1f}%)")

    def generate_pinescript_v5(
        self,
        strategy_name: str = "LuxAlgo SMC & 5X Futures Strategy",
        symbol: str = "BTC/USDT",
        leverage: float = 5.0,
        measured_win_rate: Optional[float] = None,
        target_win_rate: Optional[float] = None,  # deprecated, ignored (was an invented figure)
    ) -> str:
        """
        Generates full PineScript v5 strategy code with LuxAlgo SMC concepts,
        5X leverage parameters, ATR trailing stops, and webhook alert JSON triggers.
        """
        return f"""//@version=5
strategy("{strategy_name}", overlay=true, initial_capital=1000, default_qty_type=strategy.percent_of_equity, default_qty_value=20, commission_type=strategy.commission.percent, commission_value=0.05)

// ==============================================================================
// AiTradingAgent — LuxAlgo SMC & 5X Leverage Futures Strategy
// Measured win rate: {(f"{measured_win_rate:.1f}%" if measured_win_rate is not None else "NOT MEASURED - backtest before use")} | Leverage: {leverage:.0f}X Isolated Margin
// Features: Order Blocks (OB), Fair Value Gaps (FVG), Liquidity Sweeps, ATR Trailing Stop
// ==============================================================================

// ─── Inputs ──────────────────────────────────────────────────────────────────
grp_smc = "LuxAlgo Smart Money Concepts (SMC)"
ob_len       = input.int(10, "Order Block Lookback", group=grp_smc)
use_fvg      = input.bool(true, "Detect Fair Value Gaps (FVG)", group=grp_smc)
sweep_sens   = input.float(1.2, "Liquidity Sweep Sensitivity", group=grp_smc)

grp_momentum = "Oscillator & Momentum Matrix"
rsi_len      = input.int(14, "Dynamic RSI Length", group=grp_momentum)
mfi_len      = input.int(14, "Money Flow Index Length", group=grp_momentum)
vol_mult     = input.float(1.45, "Volume Expansion Multiplier", group=grp_momentum)

grp_futures  = "5X Futures Risk & ATR Management"
leverage_val = input.float({leverage}, "Leverage Multiplier", group=grp_futures)
tp_pct_raw   = input.float(4.0, "Take Profit % (Underlying)", group=grp_futures)
sl_pct_raw   = input.float(1.5, "Stop Loss % (Underlying)", group=grp_futures)
atr_len      = input.int(14, "ATR Volatility Period", group=grp_futures)
atr_sl_mult  = input.float(1.5, "ATR Trailing Multiplier", group=grp_futures)

// ─── Technical Calculations ──────────────────────────────────────────────────
atr_v   = ta.atr(atr_len)
rsi_v   = ta.rsi(close, rsi_len)
mfi_v   = ta.mfi(hlc3, volume, mfi_len)
vol_ma  = ta.sma(volume, 20)

highest_high = ta.highest(high, ob_len)
lowest_low   = ta.lowest(low, ob_len)

// Order Block & Liquidity Sweep Detection
bullish_sweep = low < lowest_low[1] and close > lowest_low[1] and volume > (vol_ma * vol_mult)
bearish_sweep = high > highest_high[1] and close < highest_high[1] and volume > (vol_ma * vol_mult)

// Fair Value Gap Detection
bullish_fvg = use_fvg and (low > high[2])
bearish_fvg = use_fvg and (high < low[2])

// Momentum Confirmation
bull_momentum = (rsi_v >= 45 and rsi_v <= 68) and (mfi_v > 50)
bear_momentum = (rsi_v <= 55 and rsi_v >= 32) and (mfi_v < 50)

// Entry Triggers
long_entry  = (bullish_sweep or bullish_fvg) and bull_momentum and ta.crossover(close, ta.ema(close, 20))
short_entry = (bearish_sweep or bearish_fvg) and bear_momentum and ta.crossunder(close, ta.ema(close, 20))

// ─── Execution Logic ─────────────────────────────────────────────────────────
var float long_sl  = na
var float long_tp  = na
var float short_sl = na
var float short_tp = na

if (long_entry and strategy.position_size == 0)
    long_sl := close * (1.0 - (sl_pct_raw / 100.0))
    long_tp := close * (1.0 + (tp_pct_raw / 100.0))
    alert_json = '{{"action":"BUY","symbol":"' + syminfo.ticker + '","leverage":"5X","price":' + str.tostring(close) + ',"sl":' + str.tostring(long_sl) + ',"tp":' + str.tostring(long_tp) + ',"strategy":"luxalgo_smc_5x"}}'
    strategy.entry("LONG_5X", strategy.long, alert_message=alert_json)

if (short_entry and strategy.position_size == 0)
    short_sl := close * (1.0 + (sl_pct_raw / 100.0))
    short_tp := close * (1.0 - (tp_pct_raw / 100.0))
    alert_json = '{{"action":"SELL","symbol":"' + syminfo.ticker + '","leverage":"5X","price":' + str.tostring(close) + ',"sl":' + str.tostring(short_sl) + ',"tp":' + str.tostring(short_tp) + ',"strategy":"luxalgo_smc_5x"}}'
    strategy.entry("SHORT_5X", strategy.short, alert_message=alert_json)

if (strategy.position_size > 0)
    long_sl := math.max(long_sl, close - (atr_v * atr_sl_mult))
    strategy.exit("EXIT_LONG", "LONG_5X", stop=long_sl, limit=long_tp)

if (strategy.position_size < 0)
    short_sl := math.min(short_sl, close + (atr_v * atr_sl_mult))
    strategy.exit("EXIT_SHORT", "SHORT_5X", stop=short_sl, limit=short_tp)

// ─── Visual Signals on Chart ─────────────────────────────────────────────────
plot(ta.ema(close, 20), "Baseline EMA", color=color.blue, linewidth=2)
plotshape(long_entry and strategy.position_size == 0, title="LuxAlgo SMC Buy", location=location.belowbar, color=color.green, style=shape.labelup, size=size.normal, text="LUX 5X BUY")
plotshape(short_entry and strategy.position_size == 0, title="LuxAlgo SMC Sell", location=location.abovebar, color=color.red, style=shape.labeldown, size=size.normal, text="LUX 5X SELL")
"""

    def get_all_strategies(self) -> List[Dict[str, Any]]:
        """Returns all learned strategies with default presets if empty."""
        if not self.learned_strategies:
            self.learn_and_generate_strategy(strategy_type="luxalgo_smc", symbol="BTC/USDT")
            self.learn_and_generate_strategy(strategy_type="luxalgo_oscillator", symbol="ETH/USDT")
            self.learn_and_generate_strategy(strategy_type="luxalgo_cloud", symbol="SOL/USDT")
        return self.learned_strategies


def migrate_existing(dry_run: bool = False) -> Dict[str, Any]:
    """
    One-off clean-up of records written before the evidence fix:
    - backs up learned_strategies.json and strategy_memory.json (…​.pre-evidence-<timestamp>.bak)
    - imports any embedded JS backtests (real results) into data/backtest_evidence.json
    - re-labels every learned strategy from its evidence (invented win rates -> None)
    - in strategy_memory.json, rewrites learnedStrategies winRate/verified only; tradeHistory untouched
    """
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    report = {"backups": [], "evidence_imported": 0, "strategies_relabelled": 0, "memory_entries_relabelled": 0}
    store = EvidenceStore()

    raw = []
    if LEARNED_STRATEGIES_PATH.exists():
        raw = json.loads(LEARNED_STRATEGIES_PATH.read_text(encoding="utf-8"))
    fixed = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        key = item.get("strategy_key") or item.get("type") or item.get("strategyType") or "luxalgo_smc"
        bt = item.get("backtest") if isinstance(item.get("backtest"), dict) else None
        if bt and not dry_run:
            ev = from_js_backtest(bt, key, source="strategyLearningAgent (migrated)")
            if ev and not any(r.source.startswith("strategyLearningAgent") and r.period_start == ev.period_start
                              and r.symbol == ev.symbol and r.strategy_key == key for r in store.records):
                store.record(ev)
                report["evidence_imported"] += 1
        ev_best = store.best_for(key, item.get("symbol"), item.get("timeframe"))
        item["evidence_gate"] = evaluate_gate(ev_best)
        item["strategy_key"] = key
        fixed.append(_normalize_strategy(item))
        report["strategies_relabelled"] += 1

    mem = json.loads(MEMORY_PATH.read_text(encoding="utf-8")) if MEMORY_PATH.exists() else {}
    for e in mem.get("learnedStrategies", []) if isinstance(mem, dict) else []:
        e["winRate"] = None
        e["verified"] = False
        e["evidenceStatus"] = STATUS_UNVERIFIED
        e["note"] = "winRate removed 2026-09-24: was an invented constant, not a measured result"
        report["memory_entries_relabelled"] += 1

    if dry_run:
        return report
    for path in (LEARNED_STRATEGIES_PATH, MEMORY_PATH):
        if path.exists():
            bak = path.with_name(f"{path.stem}.pre-evidence-{stamp}{path.suffix}.bak")
            bak.write_bytes(path.read_bytes())
            report["backups"].append(str(bak))
    if raw:
        LEARNED_STRATEGIES_PATH.write_text(json.dumps(fixed, indent=2), encoding="utf-8")
    if mem:
        MEMORY_PATH.write_text(json.dumps(mem, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    if "--migrate" in sys.argv or "--migrate-dry-run" in sys.argv:
        rep_ = migrate_existing(dry_run="--migrate-dry-run" in sys.argv)
        print(json.dumps(rep_, indent=2))
        sys.exit(0)
    learner = LuxAlgoStrategyLearnerAgent()
    feed = learner.source_all_subscription_alpha()
    print("=== YOUTUBE ALPHA & SENTIMENT FEED SOURCED ===")
    print(f"Market Sentiment : {feed['composite_market_sentiment']} (Polarity: {feed['composite_polarity']})")
    print(f"Channels Sourced : {feed['total_channels_monitored']}")
    for c in feed["channels"]:
        print(f"  * {c['name']:20s} [{c['credibility_weight']}x] | Bias: {c['bias_signal']} ({c['sentiment_category']}) | Video: {c['recent_video_title'][:40]}")
