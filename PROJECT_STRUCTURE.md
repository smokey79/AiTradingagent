# AiTradingAgents — Complete Project Structure
# Alan J | barcay0611@gmail.com | GitHub: smokey79
# Updated: April 2026

AiTradingAgents/
│
├── .env                          ← Your secrets (NEVER commit)
├── .env.template                 ← Template (safe to commit)
├── .gitignore
├── requirements.txt
├── main.py                       ← FastAPI app entry point
├── vercel.json                   ← Cloud deployment config
│
├── core/
│   ├── config.py                 ✅ DONE — pydantic-settings, Bybit/CryptoCom
│   ├── data_schema.py            ✅ DONE — Candle + DataSource enum
│   ├── llm_router.py             ✅ DONE — Anthropic+Grok+Gemini+fallback chain
│   └── nexo_sweep.py             ✅ DONE — Profit ledger + BTC sweep to Nexo
│
├── agents/
│   ├── strategy_agent.py         ✅ DONE — LLM decision + JSON parse + fallback
│   ├── sentiment_agent.py        ⬜ TODO — YouTube + NewsAPI + funding rates
│   ├── debate_agent.py           ✅ DONE — Bull/Bear/Neutral + Facilitator
│   └── learning_agent.py         ✅ DONE — SQLite memory + win-rate + adaptation
│
├── analytics/
│   ├── patterns.py               ✅ DONE — Double top/bottom + backtest
│   └── walk_forward.py           ✅ DONE — Walk-forward + Monte Carlo
│
├── data/
│   ├── market_data.py            ✅ DONE — CoinGecko + CMC + retry
│   ├── dexscreener_feed.py       ✅ DONE — DEX prices all chains
│   └── youtube_feed.py           ⬜ TODO — Channel transcripts + signal filter
│
├── execution/
│   └── order_router.py           ✅ DONE — Bybit+CryptoCom + SafetyGate
│
├── api/
│   ├── tradingview_webhook.py    ✅ DONE — HMAC auth + TVSignal model
│   └── routes.py                 ⬜ TODO — /status /positions /sweep endpoints
│
├── config/
│   └── chains.py                 ✅ DONE — 7-chain registry (ETH,MATIC,CRO,ARB,BASE,BSC,AVAX)
│
├── src/
│   ├── flashloan/
│   │   ├── arbitrage_scanner.py  ✅ DONE — Master multi-chain scanner
│   │   └── cross_chain_arbitrage.py ✅ DONE — Spread detection + gas gate
│   └── utils/
│       └── gas_optimizer.py      ✅ DONE — Gas estimation + profitability gate
│
├── scripts/
│   ├── run_paper_test.py         ✅ DONE — 500-trade validation pipeline
│   └── bootstrap.ps1             ⬜ TODO — PowerShell environment setup
│
├── tests/
│   └── test_multichain.py        ✅ DONE — Chain registry + arb + gas tests
│
└── data/
    ├── agent_memory.db           ← Auto-created (SQLite learning store)
    └── scan_log.jsonl            ← Auto-created (arb scan history)


# ═══════════════════════════════════════════════════════════════════
# ARCHITECTURE LAYERS (Copilot recommendation — implemented)
# ═══════════════════════════════════════════════════════════════════
#
# [ LLMRouter ]  ←  Anthropic + Grok + Gemini + OpenRouter fallback
#       ↓
# [ DebateOrchestrator ]  ←  Bull vs Bear vs Neutral → Facilitator
#       ↓
# [ LearningAgent ]  ←  SQLite memory, win-rate, weight adaptation
#       ↓
# [ StrategyAgent ]  ←  Single-shot LLM decision (fast path)
#       ↓
# [ WalkForwardValidator + MonteCarlo ]  ←  Before going live
#       ↓
# [ SafetyGate ]  ←  Daily loss cap + concurrent trade limit
#       ↓
# [ OrderRouter ]  ←  Bybit | Crypto.com paper/live execution
#       ↓
# [ NexoSweeper ]  ←  BTC profit sweep when threshold reached
#
# ═══════════════════════════════════════════════════════════════════
# SIGNAL SOURCES (in priority order)
# ═══════════════════════════════════════════════════════════════════
#
# 1. TradingView webhook  (HMAC authenticated, highest trust)
# 2. Multi-LLM debate     (Bull+Bear+Neutral → Facilitator)
# 3. Pattern recognition  (double_top/bottom, H&S, triangle)
# 4. YouTube signals      (transcript → NLP → signal filter)
# 5. Discord signals      (structured object + per-channel scoring)
# 6. Sentiment aggregate  (NewsAPI + YouTube + funding rates)
#
# All signals pass through SafetyGate before execution.
# YouTube and Discord are context layers — never sole trigger.
#
# ═══════════════════════════════════════════════════════════════════
# REQUIRED ENV VARS (minimum to run)
# ═══════════════════════════════════════════════════════════════════
#
# APP_ANTHROPIC_API_KEY   = sk-ant-...
# APP_BYBIT_API_KEY        = ...
# APP_BYBIT_API_SECRET     = ...
# NEXO_BTC_ADDRESS         = bc1q...
# PAPER_TRADE_MODE         = true   ← keep true until 500-trade test passes
