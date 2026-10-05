# Calibration changes - 3 Oct 2026

Everything here is paper / dry-run. Nothing can place a real order: `.env` is paper, every app in
`ecosystem.demo.config.cjs` gets paper-mode locks that win over `.env`, and `NO_TRADES=true` / `EXECUTION_ENABLED=false` are untouched.

## Why
The trade records available on 3 Oct could not be used to calibrate anything:
* `agent_memory.db` (2,464 "trades", +$337,950): 964 were debate *decisions* stored as winning trades (entry = exit, pnl 0, correct = 1); the rest had implausible P&L. Every learned weight came from that.
* The old orchestrator ledger was 17 cross-chain flash-loan "wins" that cannot exist (a flash loan opens and closes on ONE chain).
* `won_trades_memory.json` still held 5 of those flash-loan wins.
* Candle fallback: when Binance (UK-blocked) and Bitget both failed, `marketData.js` generated RANDOM candles and agents voted on them.
* Only the 20 closed Freqtrade dry-run trades were usable (8 wins, +$70, but +$94.90 came from two trades).

## What was done
| # | Request | Where |
|---|---|---|
| 0 | Archive contaminated stores, reset weights, purge flash-loan wins | `scripts/calibration_reset_2026-10-03.py` -> archive in `runs/2026-10-03_calibration/archive/contaminated_stores/` (nothing deleted) |
| 1 | Minimum order from the exchange's market info | `src/utils/exchangeLimits.js` -> `data/exchange_limits.json` (Bitget, public, refreshed every 6 h); `realism.minOrderUsd()`; used by `allocationAgent.js`. Real minimum is about $1.05, not the old hand-set $10 that blocked trades. Unknown pair = blocked, never guessed |
| 2 | Fees 0.06% + slippage 0.02% everywhere | `config/realism.json` is the single source. Wired into `exchangeRouter.js`, `riskGate.js` (round trip 0.16%), `backtestEngine.js`, `evidenceCandidates/engine.js`, `duel/paperBook.js`, Freqtrade (`fee` 0.0006, orders cross the spread) |
| 3 | Data-quality gate | `realism.dataQualityCheck()`: synthetic/missing/stale/flat candles, seed price, zero volume, RSI <=1 or >=99, ATR 0, ticker vs candle mismatch. Enforced in `orchestrator/index.js` and again in `consensus.js`. Synthetic candles are now OFF (`ALLOW_SYNTHETIC_CANDLES=false`) |
| 4 | Promotion bar | >= 60 OOS trades, PF > 1.3, drawdown < 20%, fees included; live gate 68% over 250 trades PLUS PF/DD/fees on the same window. `strategyEvidence.js`, `strategy_evidence.py`, `tradeLedger.js`. Unknown = fail |
| 5 | Free models / cost | Claude-solo (paid) is not in the demo set; OpenRouter free rotation stays the default |
| 5b | One SQLite ledger | `data/ledger.db` (`config/ledger_schema.sql`): `source`, `fees_included`, `is_simulated`; view `real_trades`. Node dual-writes from `tradeLedger.js`; `scripts/ledger_sync.py` imports Freqtrade; learning code reads `real_trades` only |
| 6 | Freqtrade dry-run = main calibration loop | one strategy (`consensus_bridge_v1`), every entry tagged `consensus_bridge_v1\|c<confidence>\|a<agents>`, 7 pairs, $250 wallet / $25 stake, fresh DB `freqtrade_calibration_dryrun.sqlite` |
| 7 | Flash loans observation-only | `ARB_MODE=observe`; live needs `ARB_MODE=live` AND `flashloan-sim/results/fork_test_passed.json` (`node flashloan-sim/scripts/mark_fork_test.js`). Current fork test: 0 of 12 routes profitable after gas -> stays locked |
| 8 | Ollama on demand | `src/utils/ollamaQueue.js` starts `ollama serve` when needed and stops it after 10 idle minutes (only if the bot started it); `hermes-analyst` not in the demo set; `scripts/ollama_on_demand.ps1 -Action Enable` also stops Windows autostart (not run for you: it changes user settings) |

## Run it
* Start: `scripts\START-DEMO.ps1` (or `npm run demo:start`). Stop: `scripts\STOP-DEMO.ps1`.
* Progress vs the bar: `.venv\Scripts\python.exe scripts\calibration_report.py` (or `npm run calibration`).
* Tests: `npm test` (sandbox copy, never touches live data), `npm run test:unit`, `.venv\Scripts\python.exe -m unittest tests.test_calibration_py`, `freqtrade-stable\.venv\Scripts\python.exe -m unittest tests.test_bridge_tags`.
* `node tests/runAllTests.js` now refuses to run on live data (it writes to `data/` and can send Telegram messages).

## Incident tonight (fixed)
At 21:04 the full test suite was run once against the LIVE data folder. It added 21 fake winning BTC trades to `trade_ledger.json`, changed portfolio/vault/allocation settings, added a test row to `telegram_alpha.json` / `sentiment_memory.json` / `allocation_log.jsonl`, and sent test Telegram messages to your chat. All restored by `scripts/restore_after_test_run_2026-10-03.py` (originals archived in `runs/2026-10-03_calibration/archive/test_run_side_effects/`). `allocation_settings.json` was restored from git (maxExposurePct 40); the exact pre-test value was not captured.

## Undo
Every edited file was copied first to `backups/2026-10-03_precalibration/` (same relative paths). Exceptions: `allocationAgent.js` and `consensus.js` were copied after a small edit (undo: remove the 3 marked edits / the guard block at the top of `runConsensus`).

## Known, not changed
* Two tests in `runAllTests.js` failed before and still fail: "6-agent pipeline >= 5 agents" (needs live LLM providers) and "72% threshold" (threshold is now 68%).
* `testSelfHealingHitRate.js` passes but its process does not exit (open timers in `riskGate.js`).
* Telegram listener logs `Cannot read properties of undefined (reading 'title')` on some events (existing bug).
* The old Freqtrade DB still holds 5 stale open dry-run positions (kept as archive, excluded from `real_trades`).
* `.env`: `ROUND_TRIP_COST_PCT=0.20` commented out (realism.json now decides), `ARB_MODE=observe` and `ALLOW_SYNTHETIC_CANDLES=false` added. No secrets touched.


---

## Addendum (same night): gate false positive, models, predictor, arbitrage module

**Bug fixed (mine): data-quality gate rejected cheap coins.** `calculateATR` rounded to 2 decimals, so any coin under ~$1 (ARB, OP, HBAR...) had ATR 0.00 and the new gate skipped it ("ATR zero"). It also gave those coins a zero-volatility stop. Now 8 significant digits (`src/data/indicators.js`). Test: `tests/indicators_atr.test.js`.

**Free models (verified against openrouter.ai/api/v1/models and through the key):** only three free models exist in the requested families: `qwen/qwen3.8-27b:free` (answered valid JSON in ~3 s), `google/gemma-4-31b-it:free` and `google/gemma-4-26b-a4b-it:free` (exist, returned 429 at test time). No free DeepSeek, Gemini or Hermes on OpenRouter today. Qwen + Gemma added to `openrouterFreeAgent.js` and `providerRotator.js`; Gemini's OpenRouter fallback is now Gemma. Hermes stays local (Ollama). Check script: `scripts/test_openrouter_models_2026-10-03.js`.

**Predictor agent (both modules)** - `src/predictor/`: `predictionStore.js` (SQLite `data/predictions.db`, scores every prediction against the real outcome: hit rate, Brier score, calibration table), `predictorAgent.js` (`predictTrade`, `predictArb`), `llm.js` (free-model JSON helper). Main module: runs after the bull/bear debate and before the risk gate (`src/orchestrator/index.js`; the debate summary is now returned by `consensus.js` as `consensus.debate`). ADVISORY ONLY: it does not veto or size trades until it has >= 60 scored predictions with a proven hit rate.

**Arbitrage module (PAPER ONLY)** - `src/arb/`: `exchanges.js` (live public data, 6 exchanges via ccxt, no keys), `math.js` (order-book walking, fees, latency haircut, rebalancing cost), `memory.js` (own DB `data/arb/arb.db`: observations, paper trades with cost breakdown, 24 h history statistics), `arbAgent.js` (scan -> memory -> bull/bear debate -> predictor -> paper trade only if the spread persisted two scans). Dashboard page `http://localhost:3001/arb.html`, API `/api/arb/*` and `/api/predictions/*` (`src/dashboard/arbRoutes.js`). New PM2 app `arb-agent` in `ecosystem.demo.config.cjs`. Live execution is NOT implemented and stays locked by `config/realism.json`.

Tests: `tests/arb.test.js` (20), `scripts/run_unit_tests_2026-10-03.ps1` (all unit tests), `npm test` sandbox suite still 41/43 (same two known failures). Backups of every file touched are in `backups/2026-10-03_precalibration/`.


---

## Addendum 2 (late night): master env, temporary 55% paper gate, why trades are scarce

**Master env** - `scripts/build_master_env.py` (tests: `tests/test_build_master_env.py`, 10 checks, fake keys only). Read 65 key files (.env and loose .txt, UTF-8/UTF-16) from F:\aitradingagent, F:\aitradingagent2, F:\aitrader, Downloads, D:\ and the archives. Wrote `config/master.env` (77 names, user-only permissions, git-ignored). Filled only EMPTY/MISSING names in `.env` (backup `backups/2026-10-03_master_env/`): ALPACA_API_KEY, ALPACA_SECRET_KEY, CLAUDE_API_KEY (same working Anthropic key), WEBHOOK_PASSPHRASE, YOUTUBE_API_KEY, YOUTUBE_CLIENT_ID. No existing value was changed. Keys the provider rejected (OpenAI, xAI/Grok, 6 extra OpenRouter keys, GitHub, a Gemini key) were NOT carried over. Wallet private keys / seed phrases were never copied. Exchange trading keys (Binance, Crypto.com) are in master.env only, not in `.env`. DeepSeek: both keys found are valid but have 0.00 USD balance, so DeepSeek direct is unusable. (One bug found and fixed on the way: an empty `KEY=` with Windows line endings got its value on the next line; `.env` was restored from the backup and re-applied; test added.)

**Temporary 55% gate** - `RISK_MIN_WIN_RATE_GATE=0.55` in `PAPER_LOCKS` of `ecosystem.demo.config.cjs` (demo/paper apps only; `.env` stays 0.68). To revert: delete that line and `pm2 reload ecosystem.demo.config.cjs --update-env`. `LIVE_GATE_WIN_RATE` (68%, 250 trades, PF > 1.3, fees included) is untouched.

**Why paper trades are scarce (found, not yet changed):** the "Claude" agent never answers. `.env` has `CLAUDE_BASE_URL=http://127.0.0.1:11434/v1` and `CLAUDE_MODEL=llama3.2`, so it calls local Ollama, which times out at 15 s on this loaded laptop (123 of 123 calls after the reload). One of four voters is therefore always a degraded HOLD, which produces the "1/4 agents agreeing" skips. The bear-debate veto and `MIN_CONFIDENCE=0.68` in the risk gate are the other main blockers; the win-rate gate was not blocking anything.
