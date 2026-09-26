<!-- claude-skills-manager:installed-skills -->
## Installed Claude Skills

Claude Code discovers and loads skills under `.claude/skills/` automatically — nothing here needs to be read for that to work. This table is kept up to date purely as a human-readable summary of what's installed and why.

| Skill | Detected via | Description |
|---|---|---|
| deployment-practical | `**/*.tf, **/*.bicep, **/azure.yaml, **/azure.yml, **/Dockerfile, **/Dockerfile.*, **/docker-compose*.yml, **/.gitlab-ci.yml, **/azure-pipelines.yml, **/.env*, **/deployment/**` | Deployment-first delivery — concrete architecture and IaC over theoretical advice. Use when deploying, provisioning infra, debugging first-apply failures, or when the user wants advice that works on the first attempt (not hand-wavy theory). Pair with Practical Focus toggle (architecture-first / deploy-ready). |
| doc-coauthoring | `**/*.md, **/docs/**` | Guide users through a structured workflow for co-authoring documentation. Use when user wants to write documentation, proposals, technical specs, decision docs, or similar structured content. This workflow helps users efficiently transfer context, refine content through iteration, and verify the doc works for readers. Trigger when user mentions writing docs, creating proposals, drafting specs, or similar documentation tasks. |
| extension-value-audit | `**/.claude/learning/hook-health.jsonl, **/.claude/learning/task-skill-proposals.json, **/.claude/learning/skill-adoption.jsonl, **/.claude/learning/runs.jsonl` | Give an honest, evidence-based verdict on whether the "Claude Skills Manager" VS Code extension (claude-skill-deployer) is actually delivering real value in THIS project — not a usage-count report of individual skills (see skill-usage-insights for that), but a judgment of the extension's own core mechanisms (adaptive skill suggestions/confidence scoring, task-focus, budget/cost gating, MCP-Force security mode, cross-agent sync, hooks pipeline) against real .claude/learning/ telemetry and the agent's own actual session experience. Use when asked "is this extension helping", "give feedback on Claude Skills Manager", "extension ROI", "does the extension actually do anything", "audit the extension's value", or similar. Produces a blunt, numbers-grounded report — not marketing copy. |
| file-style-conventions | `**/*` | Apply two lightweight file-hygiene conventions when writing or editing files - no emoji characters outside Markdown (.md) files, and YAML files (.yml/.yaml) end with exactly one trailing newline. Use whenever creating or editing non-Markdown files that might contain emoji, or any .yml/.yaml file. |
| github-actions-ci | `**/.github/workflows/*.yml, **/.github/workflows/*.yaml, **/.github/**/*.md, **/test/**, **/src/**, **/*.test.ts, **/*.test.js` | Debug GitHub Actions pipeline failures and reproduce CI stages locally. Use when asked to debug CI, fix a failing workflow, reproduce a job with act, or run a pre-flight check before pushing. |
| mcp-server-creation | `**/mcp-servers/**/*.js, **/mcpCli.ts, **/mcpOfficial.ts, **/resources/mcp-servers/**` | Build, wire, and debug a stdio MCP server bundled inside a VS Code extension (claude-skills-deployer pattern). Covers server code, allow-list security, MCP content-response format, premature-exit fix, deployment to ~/.claude/mcp-servers/, registration in ~/.claude.json for Claude/Cursor/Kiro, auto-start on activation, and health dialog integration. Use when adding a new MCP server or debugging "no output" / early-exit failures. |
| self-learning | `**/*` | Maintain a project-local self-learning base of task/command outcomes — record successes and failures with timestamps, durations, and fixes; generate a patterns report (pass rates, recurring errors, known fixes); and surface a learned hint before retrying something that failed before. Use at the start of a session to check learned hints, after running a non-trivial command/skill to record the outcome, when asked "what failed before" or "what did we learn", or to record a manual decision/learning. |
| skill-creator | `**/*` | Create new skills, modify and improve existing skills, and measure skill performance. Use when users want to create a skill from scratch, edit, or optimize an existing skill, run evals to test a skill, benchmark skill performance with variance analysis, or optimize a skill's description for better triggering accuracy. |
| skill-feedback-adaptation | `**/.claude/learning/skill-feedback.jsonl, **/.claude/learning/task-skill-proposals.json, **/.claude/learning/**` | AUTO-START on new agent session/window (injected by profile-init-watch for Claude, Cursor, Kiro, Copilot) and on new tasks — analyze the prompt and repo, write task-skill-proposals.json, then read top proposed skills before other work. Also register user disagreement into skill-feedback.jsonl when the user says no, not, wrong, stop, or disagrees with agent output. |
| skill-official-updater | `**/*` | At the start of a new session, do a cheap check for new or updated official Anthropic skills (github.com/anthropics/skills) and automatically add or update them in skills_library/ (no user prompt). Also use on explicit request ("check for official skill updates", "sync official skills"). |
| skill-usage-insights | `**/.claude/learning/runs.jsonl, **/.claude/skills/**` | Analyze recorded skill usage in this project (.claude/learning/runs.jsonl, written by self-learning) and the skills installed in .claude/skills/ to produce a usage and KPI report - which skills are actively used and reliable, which are failing, and which are unused or low-value, with recommendations on what to add or remove. Use when asked for "skill usage stats", "skill KPIs", "which skills should we add or remove", or "are our installed skills still useful". |
| vscode-extension-publishing | `**/.vscodeignore, **/vsc-extension-quickstart.md, **/*.vsix, **/src/extension.ts, **/src/extension.js, **/extension/**, **/MARKETPLACE*.md` | Create, package, test, and publish a VS Code extension to the Marketplace using @vscode/vsce. Covers package.json manifest fields, .vscodeignore, local debugging (Extension Development Host), vsce package/publish, version bumps, publisher/PAT setup, and common publish errors. Use when building a new VS Code extension, preparing a release, or debugging `vsce package`/`vsce publish` failures. |

<!-- /claude-skills-manager:installed-skills -->

## Project: AiTradingAgent

Multi-agent AI crypto trading bot. Not an embedded/IoT/hardware project — ignore any hardware-flashing or nRF/ESP tooling suggested by editor extensions; it does not apply here.

**Architecture (in progress):** consensus engine at `orchestrator/consensus_engine.py` polls multiple AI agents for a trade signal and only acts on supermajority agreement. Line-up being migrated to: Claude, Gemini, Hermes (local via Ollama), and multiple OpenRouter free-tier models as separate voters — replacing GPT-4o/Grok. Agent implementations live under `core/agents/` (`claude_agent.py`, `gemini_agent.py`, `hermes_agent.py`, `openrouter_agent.py`, plus the retired `gpt4o_agent.py`, `grok_agent.py`).

**Known repo state:** a large git rename is staged but not committed, moving duplicate/legacy trees (`Aitradingbot-skeleton/`, `cllm7/`, a duplicate `core/`, etc.) into `_archive/`. Don't assume it's finished or safe to build on until confirmed with the user. Three git remotes are configured (`origin`, `repo-boa799`, `repo-mllm4v1`) — confirm which is canonical before pushing anything.

**Conventions:**
- No hard-coded secrets or credentials in code or logs — use the `.env` files, never commit real keys.
- PowerShell logic goes in a `.ps1` file first, then run via `powershell.exe -ExecutionPolicy Bypass -File`, not inline `-Command` with multiline strings.
- Keep dev/paper/live trading environments clearly separated.
- Prefer modular, reusable scripts over one-off inline commands.

## Session notes — 2026-09-13

**Two Windows profiles exist on this machine: `C:\Users\AlanJ` and `C:\Users\barcl`** (barcl is the one actually logged in / running Claude Desktop). `C:\Users\AlanJ\projects\AiTradingagent\.env` — the path several old scripts still hardcoded — does **not exist**; AlanJ's profile has no `projects` folder at all. This was the root cause of "lost" API keys: the canonical `.env` was always at `F:\aitradingagent\.env` (fully populated), scripts pointing at the AlanJ path were silently loading nothing and falling back to defaults.

**Launcher fixed**: `LAUNCH-AGENT.ps1` was starting the stale `ecosystem.config.js` (never got the 2026-09-03 fix disabling the ledger-corrupting legacy Python engines). It now starts `ecosystem.config.cjs`, which is the current canonical process list: dashboard, trading-orchestrator, arb-scanner, python-debate, telegram-listener, risk-gate, trading-data, freqtrade-bridge (dry-run). `ecosystem.config.js` and `START-PAPER-TRADE.ps1` are marked deprecated in-file, not deleted.

**Bugs fixed this session** (all applied directly, verified with `py_compile` + a live `pm2 start`):
- `flashloan_scanner.py` and `src/flashloan/flash_loan_executor.py`: hardcoded `load_dotenv` path to the nonexistent AlanJ path → now resolved relative to the script's own location.
- `src/flashloan/cross_chain_arbitrage.py`: `find_best_arb_pair` only checked `price <= 0`, which let a near-zero float (e.g. `1e-300`) through and produced bogus trillion-percent "opportunities" in `vault_summary.json`. Added a sane minimum-price floor (1e-6) and a 20%-gross-spread phantom-mismatch cap (mirroring the guard already in `src/arbitrage/arbScanner.js`).
- `agents/debate_agent.py`: `DebateOrchestrator.from_router()` hardcoded every seat (bull/bear/neutral/facilitator) to `anthropic`/`grok` via an explicit `llm=` override — which makes `LLMRouter._call_with_fallback` skip its own fallback chain entirely. Since the Anthropic key has no API credit (separate from the Claude Pro/Max subscription) and the xAI/Grok key 403s, every debate round failed outright even with Gemini and OpenRouter both wired and working. Fixed two ways: (1) defaults now point at `openrouter`/`gemini` instead, (2) both `DebaterAgent.argue()` and `FacilitatorAgent.decide()` now retry through the router's full chain if their assigned provider fails, instead of giving up.
- `scripts/debate_runner.py`: `has_live_keys` only checked for an Anthropic/Grok key before even trying to build a router — a Gemini/OpenRouter-only `.env` (your actual setup) skipped straight to the heuristic mock decision. Now it just tries `LLMRouter.from_config()` directly.
- `core/llm_router.py`: OpenRouter's local-Ollama failover had a bare `timeout=10` (too short for CPU-only inference) and was missing `import os` (so it silently failed with `NameError` every time, logged as "Local Ollama failover failed: name 'os' is not defined"). Both fixed.

**Ollama — FIXED (2026-09-13, same session, later that day):** the installed copy was missing `llama-server.exe` and its entire `lib/` runtime (top-level Program Files dir had only the two launcher `.exe`s — a corrupted/incomplete install, cause unknown). `winget uninstall` failed ("Application not found") because the uninstaller itself was one of the missing pieces. Fixed by downloading the official installer fresh (`https://ollama.com/download/OllamaSetup.exe`, ~1.5GB — it bundles both CUDA and ROCm runtimes even though this machine uses neither) via `Start-BitsTransfer` (plain `Invoke-WebRequest` kept dying mid-download on this connection — BITS resumes/retries automatically and is the more reliable way to pull anything this large here), then running it with `/VERYSILENT`. Verified: `llama-server.exe` now present, direct `POST http://127.0.0.1:11434/api/generate` returns real completions, and the **live** `python-debate` process log shows `OpenRouter failover to local Ollama (llama3.2) succeeded.` after Gemini/Anthropic/Grok/OpenRouter all failed in the same round — the full fallback chain now works end-to-end, not just in isolation. `ollama app.exe` needs to be running (it's not a Windows service on this install, so it won't survive a reboot on its own) — if `LAUNCH-AGENT.ps1` doesn't already start it, add a step that does, or the local fallback will silently stop working again after the next restart.

**Still broken / needs your attention (not code — infra):**
- **Gemini free tier**: capped at 20 requests/day per model — got exhausted during this session's testing alone. Fine as a light secondary provider, not viable as a primary with `DEBATE_INTERVAL_S=120` and 2 debate rounds (7 calls/cycle).
- **OpenRouter free tier**: capped at 50 requests/day without any account credit; several of the hardcoded `DEFAULT_MODELS` in `OpenRouterClient` (the `gemma-4-*` and `nemotron-3-*` free slugs) are returning 404 "no endpoints match your guardrail restrictions" — worth pruning/updating that list against OpenRouter's current free-model catalog. Adding $10 of OpenRouter credit raises the free-model cap to 1000/day at no per-token cost for `:free` models — the cheapest fix for "running constantly."
- Anthropic key has no API console credit (confirmed pre-existing — separate top-up needed if you want Claude in the live rotation) and the xAI/Grok key is returning 403 (likely invalid/revoked) — both still wired into the router as fallback links so they'll "self-heal" back in automatically if funded/fixed, no code change needed.
- `config\.env` / `config\master.env` are unused duplicates (only one throwaway test script reads them) — safe to archive whenever.
- Host RAM ran around 80-90% with the full PM2 stack + Chrome/etc. already open — worth watching on this 16GB machine, especially before adding Ollama model load back into the mix.

**Tool-stack wishlist from user (2026-09-13), not yet built — mapped against current repo state:**
| Tool | Purpose | Status |
|---|---|---|
| Freqtrade | automated execution | Already wired — `freqtrade-bridge` PM2 app, `config_bridge_dryrun.json`, `ConsensusBridgeStrategy`, dry-run only |
| Python + CCXT | data collection | `ccxt` already installed in `venv` — confirm what currently uses it, if anything, vs. DexScreener (arb) |
| CoinGecko | market data | not wired into the Python side (`pycoingecko` not installed) — a CoinGecko MCP connector is available in the Claude chat session for research, separate from the running bot |
| VectorBT | backtesting | not installed, no backtest harness in repo yet |
| TradingView | charting | not integrated (`tvDatafeed` not installed) — TradingView also has no free official data API; unofficial libraries carry ToS/reliability risk, worth discussing before building on one |
| Delta | portfolio tracking | third-party app, no public read API for retail accounts — likely stays a manual cross-check rather than an integration |
| crypto.com / Bitget / Binance | exchange | none chosen yet as the live/paper data+execution venue — needs a decision before wiring real order books in |

None of this is built yet at the time it was written — see below for what got built same-day.

## Session notes — 2026-09-13 (continued) — CoinGecko + CCXT data layer, Bitget chosen as exchange

User picked **Bitget** as the primary data/execution venue and **CoinGecko + CCXT data layer** as the next build (over VectorBT backtesting and pulling Hermes3, given the 16GB RAM is already tight).

**Found first, before writing anything new:** `src/data/price_aggregator.py` has been silently broken this whole time — it imports `from src.data.price_feed import get_price, get_multi_price`, but `src/data/price_feed.py` doesn't exist (an archived copy exists at `_archive/caudemllmcode2arbritrage/price_feed.py`). Nothing currently live imports `price_aggregator.py`, so this was dead code, not a live bug — left as-is rather than rescued, since the real live price path turned out to be elsewhere (next paragraph). Also found `_archive/dead_code/execution/bitget_client.py` — a working `BitgetTrader` (ccxt.bitget, spot market orders) already written for this exact exchange choice, but **not wired to anything live** and never will be while `PAPER_TRADE_MODE=true`. It had a hard-coded fallback passphrase and a missing `import os` (same class of bug as the `core/llm_router.py` fix earlier today) — both fixed in place; `BITGET_PASSPHRASE` now has no default and the class raises clearly if any of the three Bitget env vars are missing. Still dead code, still not called from anywhere live — fixed for hygiene/future-readiness only.

**The actual live price feed** turned out to be inline in `scripts/debate_runner.py`'s `get_latest_market_candle()` — a bare `ccxt.binance` call with ad-hoc symbol slicing, plus a CoinGecko fallback via `data/market_data.py`'s existing `CoinGeckoClient` (which was already solid — proper retry/backoff session, throttling, validated `Candle` objects). This is the file actually feeding the live `python-debate` PM2 process.

**Built:**
- `data/market_data.py`: added `CCXTClient` (matches the existing `CoinGeckoClient`'s quality/style — `get_ticker`, `get_latest_candle`, `get_ohlcv_candles`, `get_order_book`, pair normalisation for both `"BTC/USDT"` and `"BTCUSDT"` input), plus a module-level `get_latest_candle(symbol, exchange_id="bitget")` that tries CCXT first and falls back to CoinGecko (symbol→CoinGecko-id map covers the 7-token universe from `TRADING_PAIRS`). All public endpoints — no API key needed for market data, nothing here places orders.
- `core/data_schema.py`: added `BITGET` and `COINGECKO` to the `DataSource` enum (previously only `BINANCE`/`COINBASE`/`CRYPTO_COM`/`BYBIT`/`BACKTEST`/`UNKNOWN` — candles from Bitget or CoinGecko were being mis-tagged or would've had to fall back to `UNKNOWN`).
- `scripts/debate_runner.py`: `get_latest_market_candle()` now calls the shared `data.market_data.get_latest_candle()` instead of its own inline `ccxt.binance` logic. Exchange is configurable via `MARKET_DATA_EXCHANGE` env var (default `"bitget"`).

**Verified live, not just unit-tested:** direct test script confirmed real Bitget tickers/candles for all 7 tokens in `TRADING_PAIRS` (BTC, ETH, CRO, SOL, AVAX, ARB, OP) and a working CoinGecko fallback. After `pm2 restart python-debate`, the live log's next debate round shows `Running debate for BTCUSDT @ $77215.0...` — the exact same value the standalone test printed for `BTC/USDT` from Bitget moments earlier, confirming the live process is genuinely pulling from the new data layer, not a cached/placeholder value.

**Not done / next candidates from the earlier wishlist:** VectorBT backtesting harness (would let you test the debate/consensus logic against history before trusting it live — probably the highest-value next step), pulling Hermes3 into Ollama (works now that Ollama is repaired, but adds real RAM pressure on top of the ~90% already in use with the full stack running), TradingView charting (no free official API — would need an unofficial library, worth a quick discussion on ToS/reliability risk first), Delta portfolio tracking (no public API for retail accounts — stays a manual cross-check).

**Watch item:** host RAM was reading 90.4% right after this restart, up from ~80% earlier in the session — same 16GB machine, same PM2 stack, nothing new resident (the CCXT/CoinGecko additions are lightweight, request-driven, no persistent model load). Worth a `Get-Process | Sort WS -Descending | Select -First 15` check next time the machine feels sluggish, before assuming today's changes are the cause.

## Session notes — 2026-09-13 (continued) — hermes3 pulled into Ollama, NOT made the active fallback model

User asked to pull hermes3 into Ollama (now that it's repaired). Done — `ollama pull hermes3` succeeded, 4.7GB, confirmed working with a direct API test (`"Say OK"` → `"OK! How can I help you today?"`).

**Real-world cost measured, not assumed:** that trivial one-line completion took **39.8 seconds** on this CPU-only machine (no usable GPU acceleration — the embedded Radeon graphics don't have ROCm support), and system RAM peaked at **91.6% used, 1.3GB free** while hermes3's `llama-server.exe` process held ~2.3GB resident. `pm2 list` itself became noticeably slower to respond during that window. A real debate prompt (much longer than "Say OK", with market context) would take meaningfully longer than 40s — likely well past what's comfortable inside the existing 120s debate interval if hermes3 becomes the fallback every provider chain reaches for.

**Decision made:** left `OLLAMA_MODEL=llama3.2` / `HERMES_MODEL=llama3.2` in `.env` unchanged — hermes3 is downloaded and available (`ollama run hermes3` works any time), but is **not** wired in as the active local fallback. llama3.2 (2.6GB resident, faster, already proven working live in the actual fallback chain) stays the default. Ran `ollama stop hermes3` afterward to unload it from RAM immediately rather than waiting for Ollama's default 5-minute keep-alive.

**If you want hermes3 active anyway:** change `OLLAMA_MODEL` and `HERMES_MODEL` to `hermes3` in `.env` and restart `python-debate` — but expect slower fallback responses and less RAM headroom for everything else running.

## Session notes — 2026-09-13 (continued) — hermes3 given its own periodic job instead

Built the "safer middle ground" from the previous note: **`scripts/hermes_analyst.py`**, a new PM2 app (`hermes-analyst` in `ecosystem.config.cjs`) that runs Hermes3 on its own 30-minute interval (`HERMES_ANALYSIS_INTERVAL_S`, default 1800s), calling Ollama directly rather than through `core.llm_router` — this process only ever wants Hermes3, never a paid/rate-limited provider. It fetches the latest candle via the same `data.market_data.get_latest_candle()` used everywhere else, asks Hermes3 for a brief independent read (bias, one risk, momentum agree/disagree), and writes the result to `data/hermes_deep_analysis.json`. It does **not** touch `latest_decision.json` and has no path into the live trade decision — commentary only, by design, so the RAM/latency cost is fully contained to a half-hourly blip instead of sitting in the fast debate loop's fallback chain.

Verified live: first cycle ran clean on `pm2 start`, Hermes3 responded in 47.6s (matches the ~40s measured earlier), wrote a coherent analysis to the JSON file, and the rest of the 9-process PM2 stack stayed at 0 new restarts with RAM at 86.7% right after — no worse than before, and it drops further once Ollama's keep-alive unloads the idle model between cycles. `OLLAMA_MODEL`/`HERMES_MODEL` stay on `llama3.2` for the actual fast debate loop, untouched by this.

**To read the output:** `data/hermes_deep_analysis.json`, refreshed every ~30 min. Not yet surfaced in the dashboard UI — would be a small addition to `web-dashboard/routes/dashboard.py` if you want it visible there rather than just in the file.


## 2026-09-13 — TradingView MCP server installed (charting/data tool, outside the trading engine)

User explicitly requested this after being warned of the risks (see below) and chose
"Install it as requested."

- Cloned https://github.com/tradesdontlie/tradingview-mcp.git to
  `C:\Users\barcl\claude-mcp-servers\tradingview-mcp`. `npm install` + `npm audit fix`
  (6 transitive vulns -> 0).
- Registered globally in `C:\Users\barcl\.claude\.mcp.json`:
  `{"mcpServers":{"tradingview":{"command":"node","args":["C:/Users/barcl/claude-mcp-servers/tradingview-mcp/src/server.js"]}}}`
  This is a GLOBAL config — it will load in every future local Claude Code CLI session on
  this machine, not just this project. A brand-new local `claude` session (not this cloud
  session) must be started for the `tv_*` MCP tools to actually appear as callable tools.
- TradingView Desktop on this machine is a Microsoft Store (MSIX) package
  (`31178TradingViewInc.TradingView_3.4.1.0_x64__q4jpyh43s5mv6`), NOT a normal installed
  exe. The repo's bundled `scripts\launch_tv_debug.bat` looks for the wrong Appx package
  name (`TradingView.Desktop`) and fails to find it — same bug exists in the repo's own
  `core/health.js` `launch()` fallback. Worked around by launching
  `TradingView.exe --remote-debugging-port=9222` directly from the real WindowsApps path
  found via `Get-AppxPackage -Name '*TradingView*'`. On this machine direct launch from
  WindowsApps worked fine (CDP bound immediately) — did NOT need the local-copy fallback.
- Verified live: ran the CLI's own `status` command (same code path as the `tv_health_check`
  MCP tool) — `node src\cli\index.js status` from the repo dir returned
  `cdp_connected: true`, `api_available: true`, live chart symbol `OKX:BTCUSDT`.
- Risks disclosed to and accepted by the user before proceeding: this tool is unaffiliated
  with TradingView Inc.; its own README says automated CDP interaction with the Desktop
  app "may conflict with" TradingView's Terms of Use (which restrict automated data
  collection/scraping) and any account ban is the user's own risk; it is unaudited
  third-party code; the `.mcp.json` change is global, not project-scoped.
- Scope: this MCP server only gives Claude Code (local CLI) the ability to read/control a
  TradingView Desktop chart (symbols, indicators, Pine Script, screenshots, drawings,
  replay). It is NOT wired into AiTradingAgent's trading engine, has no API keys, and
  cannot place trades — it's a separate charting/analysis tool, unrelated to the paper-only
  trading and simulate-only flash-loan constraints already in force for the bot itself.


## 2026-09-13 — TradingKit (trader.dev) actually fixed and wired up

`src/data/tradingKitFeed.js` had been live-imported by `src/orchestrator/index.js`,
`src/orchestrator/consensus.js`, and `src/dashboard/server.js` for a while, but had
**never once returned real data**, for two independent reasons found and fixed today:

1. It called tool names (`get_ticker`, `get_ohlcv`, `get_indicators`, `get_orderbook`,
   `get_signal`, `get_economic_calendar`, `get_market_overview`, `ping`) that do not
   exist on the real TradingKit server (`traderdev-backtester`). TradingKit is NOT a
   market-data feed — it's a Pine Script v6 backtesting-as-a-service + live Telegram/
   webhook alerts platform (`quick_backtest`, `optimize_strategy`, `create_alert`, 44
   tools total). Every call returned `MCP error -32602: Tool X not found`.
2. Even a real tool name (e.g. `whoami`) would have failed anyway: the module never did
   the MCP Streamable-HTTP session handshake (`initialize` -> `notifications/initialized`
   -> reuse `Mcp-Session-Id` header), so every call got back `400 Server not initialized`.
3. On top of both of those, the API key (hard-coded as a fallback default, against
   Alan's "no hard-coded secrets" rule) had been revoked.

All three fixed:
- New key obtained by Alan via the browser login flow (`https://mcp-api.trader.dev/login`,
  Google sign-in) and put ONLY in `.env` (`TRADINGKIT_API_KEY` / `TRADINGKIT_MCP_URL`) —
  no fallback literal in source anymore. Confirmed live via `whoami`:
  `barclay0611@gmail.com`, free tier, 1000 credits/week.
- `tradingKitFeed.js` rewritten: proper session handshake with one retry, only calls
  tools that actually exist. `fetchCandles/fetchTicker/fetchIndicators/fetchOrderBook/
  fetchCalendarEvents/fetchMarketOverview` are now honest no-ops (TradingKit has no
  market-data tools at all — real prices already come from `data/market_data.py`'s
  CCXT/Bitget + CoinGecko layer, built 2026-09-12). `fetchSignal()`/`enrichMarketData()`
  keep their old call signatures (so orchestrator/consensus/dashboard needed zero
  changes) but now read a cache file instead of hitting the API inline.
- New periodic job `scripts/tradingkit_analyst.js` (PM2 app `tradingkit-analyst`,
  default every 4h — see `TRADINGKIT_ANALYST_INTERVAL_S` in `.env`): runs a fixed,
  mcprule-compliant Pine v6 EMA20/50-cross strategy through `quick_backtest` for each
  of the 7 target tokens (BTC/ETH/CRO/SOL/AVAX/ARB/OP, all confirmed live as Bybit USDT
  perps via `search_perps`), and writes `data/tradingkit_signals.json`. Same "isolate
  the slow/costly external call into its own process" pattern as `hermes-analyst` —
  never called inline from the fast debate loop, since each backtest costs 1 credit
  and takes 1-3s. Verified live end-to-end (`node scripts/tradingkit_analyst.js --once`):
  6 of 7 tokens correctly returned `hold` (no real edge from this simple strategy over
  the last 30 days), OP returned a genuine `buy` signal (net +19.8%, profit factor 6.29,
  Sharpe 4.14, 8 trades) — and `fetchSignal('OP/USDT')` / `enrichMarketData` both read
  it back correctly.
- Signal derivation defaults to `hold` whenever `profitFactor <= 1` or fewer than 5
  backtested trades, per Alan's standing "don't recommend low-odds/thin-sample trades"
  rule — it never asserts a direction on weak evidence.
- Registered `tradingkit` as a remote HTTP MCP server in the GLOBAL
  `C:\Users\barcl\.claude\.mcp.json` (alongside `tradingview`, added earlier today) so
  a local Claude Code CLI session can also use TradingKit's other 40+ tools directly
  (strategy search/fork/optimize, live alerts) for ad-hoc work outside the bot itself.
- **Separately found while doing this**: the whole PM2 stack (all 9 apps) was NOT
  running when this session started — the daemon had been restarted (machine reboot or
  similar) and nothing had been resurrected. Not something this session broke; just
  discovered it while starting `tradingkit-analyst`. Restarted the full stack
  (`pm2 start ecosystem.config.cjs`) and ran `pm2 save` so `pm2 resurrect` can restore
  it next time — but there's still no PM2-on-Windows-boot service installed, so a
  reboot will need `pm2 resurrect` run by hand (or `pm2-windows-startup` set up) unless
  Alan wants that automated too.
- Scope note: this only gives the consensus engine a *confidence signal* from
  historical backtest performance — it does not place trades, deploy live alert
  strategies, or touch execution. Paper-trading-only and simulate-only-flash-loans
  constraints are unaffected.


## 2026-09-13 (later): BTC/USDT strategy discovery lab — winner found

Ran a 4-round strategy research+backtest loop (41 Pine v6 strategies tested via
TradingKit's `quick_backtest`) hunting for a BTCUSDT strategy meeting: net profit>0,
>=250 trades, profit factor>1.12, max drawdown<=20%. Full write-up, leaderboard, and
Pine source for the winner: `research/btc_strategy_lab_2026-09-13/FINAL_REPORT.md`.

- **Found a critical platform bug**: TradingKit's engine force-overrides ANY position
  sizing to 100%-of-equity-per-trade (see `parityAdjustments` in raw API responses).
  This makes its own raw drawdown numbers a worst-case stress test, not a realistic
  result. Built `research/btc_strategy_lab_2026-09-13/resim.js` to resimulate any
  strategy's trades under realistic fixed-fractional sizing (5-20% per trade) from
  each trade's sizing-independent `profitPct` — use this on every future strategy
  tested on this platform before trusting its raw PF/drawdown output.
- **Winner**: `R4j_2h_VWAP_EMA_NoADX` — 2h BTCUSDT, EMA(50)/EMA(100) cross confirmed by
  price vs session VWAP, 2.0x ATR(14) fixed stop, flip-to-reverse. At realistic 20%
  equity-per-trade sizing: net +40.3%, max DD 11.1%, pctPF 1.50, 256 trades over the
  full 2020-2026 sample — clears all 4 criteria with real margin. Backup/diversification
  candidates and an untested next step (extend the same VWAP+EMA logic to the other 6
  target symbols to grow sample size) are in the report.
- **Cautionary finding logged for future strategy work**: `R3g` looked like a winner on
  raw engine output (PF 1.21) but its sizing-independent %-based PF was 0.99 (no real
  edge) — a pure compounding artifact. Always cross-check raw engine PF against the
  %-based PF from `resim.js` before believing a result.
- **Round 5 (cross-asset test)**: ran the identical, unmodified R4j/R4h rules on ETH,
  SOL, AVAX, ARB, OP, CRO with zero re-tuning. Full-history (2020-2026) edge looked
  genuine on ETH/SOL/AVAX (pctPF 1.30/1.37/1.57), none on ARB/OP/CRO (shorter listing
  histories). Initially recommended a 4-symbol BTC+ETH+SOL+AVAX portfolio — **superseded
  by Round 6 below.**
- **Round 6 (out-of-sample walk-forward validation — the important one)**: re-ran the
  exact same locked Pine source (zero changes) for BTC/ETH/SOL/AVAX on 2024-01-01
  through today ONLY (excluded from being the dominant driver of the full-history
  numbers). Result: **BTC's edge reversed (pctPF 1.50 full-history -> 0.88 OOS) and
  AVAX's reversed badly (1.57 -> 0.60)** — their full-history numbers were regime-
  specific artifacts (concentrated in the 2020-23 COVID/bull/bear cycles), not real
  forward edge. SOL weakened to roughly break-even (1.37 -> 1.01). **Only ETH held up**
  (1.30 -> 1.27, nearly identical) — this is the one strategy in the whole 57-strategy,
  6-round lab that passed both the full-history test AND a genuine out-of-sample check.
  **Final recommendation: trade ETH alone** (2h EMA50/100+VWAP+2xATR-stop, 15-20% equity
  per position), watch SOL, do not trade BTC/AVAX on this rule set. Full detail in
  `research/btc_strategy_lab_2026-09-13/FINAL_REPORT.md`.
- **Standing lesson for the self-learning system being built**: a strategy that looks
  profitable on a full-history backtest can still be fit to a specific past regime.
  Any strategy the agent adopts should be continuously re-validated on a rolling
  recent window (e.g. re-check pctPF on the trailing 6-12 months periodically) and
  auto-paused if that recent-window edge collapses, rather than trusted forever off
  one historical fit. `resim.js`'s walk-forward pattern (freeze the rules, test on a
  held-out recent slice) is a reusable template for that ongoing check. Still open if
  further research is wanted: literal candlestick-pattern confirmation (needs raw OHLC
  outside this Pine-parity sandbox) and live paper-trading ETH to confirm execution
  matches backtest.
- **Round 7 (timeframe sweep)**: held the winning ETH/BTC strategy logic fixed and
  swept 30m/1h/4h/12h (12h errored — TradingKit has no coverage for the 720 interval).
  Every other timeframe was clearly worse than 2h for both symbols (30m/1h: no edge,
  PF ~0.96-1.03; 4h: too few trades and weaker PF) — confirms 2h isn't an arbitrary
  choice, it's genuinely the sweet spot for this signal.
- **Round 8 (top-5-strategies x all-7-assets grid + 100-iteration Monte Carlo
  bootstrap)**: completed a full grid of the lab's top 5 strategies by raw profit
  factor (R4h, R4i, R3a, R4j, R2_4h templates) against all 7 target tokens (35 combos),
  then bootstrap-resampled each combo's actual trades 100x (with replacement, realistic
  15% sizing) to check sequence-risk robustness separately from Round 6's regime-risk
  (walk-forward) check. **Important nuance for future strategy work**: BTC scored the
  BEST bootstrap robustness in the whole grid (90-93% of resamples profitable) despite
  Round 6 already proving its forward edge is dead — bootstrap only proves the
  historical trade distribution wasn't a lucky one-off ordering, it does NOT prove that
  distribution repeats going forward. **A strategy needs to pass BOTH checks (bootstrap
  AND walk-forward), and ETH+R4j remains the only combination in the whole 80-strategy
  lab that does.** Even that combo was only net-profitable in 78/100 bootstrap
  resamples at 15% sizing — a real ~1-in-5 chance of a losing outcome from trade-order
  luck alone, not a strategy flaw, just honest uncertainty for a ~13%-win-rate
  trend system. A weak CRO lead surfaced (R2_4h-style, 4h, no VWAP) but only had 54
  out-of-sample trades — inconclusive, flagged for revisit once more data accumulates,
  not adopted. Full grid: `bootstrap_grid.json` in the lab folder. `bootstrap.js` (the
  Monte Carlo resampler) is a third reusable robustness tool alongside `resim.js`
  (sizing-independent pctPF) for evaluating any future strategy on this platform.


## 2026-09-13 (later same day) — ported the validated ETH strategy into aitradingagent2 + long/short/flip-to-reverse rewrite + self-healing edge monitor

Took the ETH 2h EMA50/100+VWAP+ATR-stop strategy validated above (the one that survived
both full-history AND out-of-sample walk-forward) and wired it into the separate
`F:\aitradingagent2` build (5-agent lean paper-trading MVP). Confirmed that build's
architecture ALREADY satisfies "2 debating LLM agents + a deterministic risk gate" —
Bull (OpenRouter) and Bear (local Ollama) are the only LLM-cost agents; Technical and
Risk Manager are pure math; Meta-Evaluator is deterministic with optional narration off
by default. No architectural rebuild was needed, just a strategy swap and several
supporting fixes:

- `technicalAgent.js` rewritten: implements the frozen EMA50/100+VWAP+2xATR-stop rule
  with honest per-token gating (ETH enabled at full confidence, SOL watch-only/never
  traded, BTC/AVAX/ARB/OP/CRO disabled with the specific research reason attached).
  Old version had ETH under a hardcoded confidence cap — backwards from the research.
- `priceFeed.js` rewritten to add `getIntradayCandles` (Bybit public v5 kline, 2h bars,
  no API key) — same exchange/timeframe the strategy was actually researched on. Daily
  CoinGecko candles kept for nothing now (orchestrator switched fully to 2h).
- `indicators.js` extended with `sessionVwap`, `crossover`, `crossunder`.
- Found and fixed an architecture mismatch: old `paperLedger.js`/`riskGate.js` were
  long-only, required a fixed take-profit, and only allowed risk-based sizing (1% of
  equity risked to stop distance) — none of which fit a strategy with no fixed TP,
  long/short flip-to-reverse exits, and a backtest that assumed notional-fraction
  sizing (equity x 15-20% as position size). Rewrote both:
  - `paperLedger.js`: LONG/SHORT PnL, optional target, `closePosition()` for explicit
    flip closes, `MAX_HOLD_HOURS` default raised 72->480h (safety net only, not the
    primary exit — typical hold is ~55-73 2h bars).
  - `riskGate.js`: flip-to-reverse (opposite-direction open position gets closed at
    market then the new one opens, same cycle; same-direction still blocks/no
    pyramiding); `POSITION_SIZING_MODEL` env var, default `notional` (matches the lab's
    backtest sizing and is the only mode that reproduces its numbers), `risk` kept as
    a legacy/more-conservative option.
  - `riskManagerAgent.js`: "already open" veto now only fires same-direction; opposite
    direction is recognized as a flip and allowed through.
  - Bull/Bear/metaEvaluator/consensus.js all made direction-aware (they only ever
    supported a long "BUY" signal before) — Bull/Bear now debate whichever direction
    Technical proposed, metaEvaluator's finalSignal is BUY or SELL to match, and
    consensus.js now SKIPS Bull/Bear's LLM calls entirely on HOLD cycles (most cycles,
    given this strategy's low trade frequency) — this is the main real reduction in how
    often the local Ollama model gets invoked, which matters for the RAM constraint.
- New `src/risk/edgeMonitor.js`: self-healing check — tracks the bot's OWN trailing
  closed trades per token (never backtest numbers) and auto-suppresses NEW entries if
  the live profit factor drops below a floor once there's enough live sample size.
  This is the honest version of "keep trying to maximize win rate / self-heal" the user
  asked for — continuous re-validation against real results, not a literal 100%-win-rate
  promise (no strategy in the whole lab had one; ETH's realistic win rate is ~13%).
- Verified everything: `node --check` on all 12 touched files, a real `smoke_test.js`
  run (hit live Bybit 2h data for ETH/SOL, correctly produced HOLD and correctly SKIPPED
  Bull/Bear since there was no signal — proves the RAM-saving skip actually works), and
  a new `test_risk_logic.js` (hand-built long-open -> pyramiding-blocked -> flip-to-short
  -> stop-out sequence, all math checked by hand: sizing, flip PnL, stop PnL all correct)
  which resets the real ledger back to a clean state afterward and is safe to re-run
  after any future change to riskGate.js/paperLedger.js.
- `.env`/`.env.example` updated: `TOKENS` narrowed to `ETH,SOL` (others still safely
  disabled by technicalAgent.js's gating if added back, but cost a wasted candle fetch
  per cycle for no benefit), `MAX_HOLD_HOURS=480`, new `POSITION_SIZING_MODEL`/
  `EXPOSURE_FRACTION`/`EDGE_MONITOR_*` vars, all with plain-language comments.
- README.md updated to explain the "2 agents + risk gate" framing explicitly (the user
  didn't realize the existing architecture already matched what they asked for), the
  self-healing edge monitor, and a full step-by-step Oracle Cloud free-tier VM guide for
  moving Bear's Ollama model off the laptop entirely (no code changes needed —
  `OLLAMA_HOST` was already env-configurable; just VM creation, security-list + in-VM
  firewall ports, Ollama `0.0.0.0` binding, and the `.env` change). Asked the user for
  their specific Oracle Cloud error since "out of host capacity" (free ARM tier) and
  "can't reach 11434 from outside the VM" (missing in-VM firewall rule, not just the
  console security list) are both extremely common but need the actual error to fix
  precisely.
