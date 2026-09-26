module.exports = {
  apps: [
    {
      name: "risk-gate",
      cwd: "F:/aitradingagent/mcp-servers/risk-gate-mcp",
      script: "index.js",
      interpreter: "node",
      watch: false
    },
    {
      name: "trading-data",
      cwd: "F:/aitradingagent/mcp-servers/trading-data-mcp",
      script: "index.js",
      interpreter: "node",
      watch: false
    },
    // --- DISABLED 2026-09-03 ---
    // trading-api (trading_api.py) and autonomous-matrix (the legacy Python
    // engine) each run their OWN independent trading loop/controller. Running
    // either alongside trading-orchestrator (below, the real Node consensus
    // engine) means two uncoordinated systems writing to the same
    // trade_ledger.json / portfolio_state.json at once — that would corrupt
    // the win-rate numbers this session just made honest. Left here,
    // commented out, rather than deleted, so nothing is lost and either can
    // be re-enabled deliberately if you want to compare them side by side
    // (with separate ledger files) later.
    // flask-dashboard (wsgi.py) is a separate "Developments Studio" UI on
    // port 3002 (TradingView/Terminal/PineScript) — not a trading loop, so
    // it doesn't conflict, but it's outside tonight's verification scope.
    // Uncomment any of these individually if you want them running too.
    //
    // {
    //   name: "trading-api",
    //   cwd: "F:/aitradingagent",
    //   script: "trading_api.py",
    //   interpreter: "F:/aitradingagent/venv/Scripts/python.exe",
    //   watch: false
    // },
    // {
    //   name: "autonomous-matrix",
    //   cwd: "F:/aitradingagent",
    //   script: "agents/AI-Trading-Agent/autonomous_engine.py",
    //   interpreter: "F:/aitradingagent/venv/Scripts/python.exe",
    //   watch: false
    // },
    // {
    //   name: "flask-dashboard",
    //   cwd: "F:/aitradingagent",
    //   script: "wsgi.py",
    //   interpreter: "F:/aitradingagent/venv/Scripts/python.exe",
    //   watch: false
    // },
    {
      // Cross-chain flash-loan arbitrage scanner (analysis/paper-log only —
      // see src/flashloan/flash_loan_executor.py, whose execute_live() is
      // still an unimplemented stub, so nothing here ever sends a real
      // on-chain transaction). Re-added 2026-09-13 after fixing a bug where
      // a near-zero price from a bad feed produced bogus trillion-percent
      // "opportunities" in vault_summary.json (see cross_chain_arbitrage.py).
      // Was in the older ecosystem.config.js but never wired into this
      // (safer, de-conflicted) config until now.
      name: "arb-scanner",
      cwd: "F:/aitradingagent",
      script: "src/flashloan/arbitrage_scanner.py",
      args: "--continuous",
      interpreter: "F:/aitradingagent/venv/Scripts/python.exe",
      watch: false,
      autorestart: true,
      restart_delay: 10000,
      max_restarts: 15,
      error_file: "logs/arb-scanner-err.log",
      out_file: "logs/arb-scanner-out.log"
    },
    // --- NOT ENABLED YET 2026-09-15 ---
    // src/flashloan/opportunity_scout.py — the broader "not just arbitrage"
    // cross-chain scanner (bridge-latency windows, LP fee-turnover leads,
    // liquidity-bootstrap gaps, gas-optimized near-miss routing). Written
    // and reviewed but not yet syntax-checked/run on this machine (see
    // claude/session-2026-09-15-cfd-futures-and-crosschain-scout.md).
    // Analysis/logging only, same as arb-scanner — no execute path exists.
    // Uncomment once you've run `python src/flashloan/opportunity_scout.py`
    // once by hand and are happy with what it logs to
    // data/opportunity_scout_log.jsonl.
    //
    // {
    //   name: "opportunity-scout",
    //   cwd: "F:/aitradingagent",
    //   script: "src/flashloan/opportunity_scout.py",
    //   interpreter: "F:/aitradingagent/venv/Scripts/python.exe",
    //   watch: false,
    //   autorestart: true,
    //   restart_delay: 30000,
    //   max_restarts: 15,
    //   error_file: "logs/opportunity-scout-err.log",
    //   out_file: "logs/opportunity-scout-out.log"
    // },
    {
      // Multi-LLM Bull/Bear/Neutral debate engine (scripts/debate_runner.py).
      // Publishes decisions to latest_decision.json alongside the Node
      // consensus loop. Falls back to a heuristic momentum rule if no LLM
      // key resolves (see the has_live_keys fix in that file, 2026-09-13).
      // Re-added for the same reason as arb-scanner above.
      name: "python-debate",
      cwd: "F:/aitradingagent",
      script: "scripts/debate_runner.py",
      interpreter: "F:/aitradingagent/venv/Scripts/python.exe",
      watch: false,
      autorestart: true,
      restart_delay: 10000,
      max_restarts: 15,
      error_file: "logs/debate-err.log",
      out_file: "logs/debate-out.log"
    },
    {
      // Periodic Hermes3 "deep analysis" commentary — scripts/hermes_analyst.py.
      // Added 2026-09-13: hermes3 is downloaded and works, but a single
      // completion measured ~40s on this CPU-only machine and briefly pushed
      // host RAM to 91.6% used (1.3GB free) while loaded. Wiring it into the
      // fast debate loop's fallback chain would have risked missing the
      // 120s debate interval and starving the rest of the stack of RAM. So
      // it runs here instead: its own long interval (default 30 min, see
      // HERMES_ANALYSIS_INTERVAL_S in .env), calls Ollama directly (never
      // through core.llm_router — this process only ever wants Hermes3),
      // and writes to data/hermes_deep_analysis.json. It does NOT feed into
      // latest_decision.json or any live trade decision — commentary only.
      // llama3.2 remains the fast fallback for the actual debate loop.
      name: "hermes-analyst",
      cwd: "F:/aitradingagent",
      script: "scripts/hermes_analyst.py",
      interpreter: "F:/aitradingagent/venv/Scripts/python.exe",
      watch: false,
      autorestart: true,
      restart_delay: 30000,
      max_restarts: 15,
      error_file: "logs/hermes-analyst-err.log",
      out_file: "logs/hermes-analyst-out.log"
    },
    {
      // Periodic TradingKit (trader.dev) backtest-derived signal —
      // scripts/tradingkit_analyst.js. Added 2026-09-13. Runs a fixed,
      // mcprule-compliant EMA20/50 crossover strategy through TradingKit's
      // quick_backtest for each of the 7 target tokens on a slow schedule
      // (default 4h, see TRADINGKIT_ANALYST_INTERVAL_S in .env) and writes
      // data/tradingkit_signals.json for tradingKitFeed.fetchSignal() to
      // read. NOT in the fast debate loop, same reasoning as hermes-analyst
      // above: each backtest costs 1 TradingKit credit (free tier: 1000/wk)
      // and takes 1-3s. Defaults to a 'hold' signal on thin samples or a
      // negative edge — never asserts a trade on weak evidence.
      name: "tradingkit-analyst",
      cwd: "F:/aitradingagent",
      script: "scripts/tradingkit_analyst.js",
      interpreter: "node",
      watch: false,
      autorestart: true,
      restart_delay: 30000,
      max_restarts: 15,
      error_file: "logs/tradingkit-analyst-err.log",
      out_file: "logs/tradingkit-analyst-out.log"
    },
    {
      name: "telegram-listener",
      cwd: "F:/aitradingagent",
      script: "src/notifications/telegramListener.js",
      interpreter: "node",
      watch: false,
      // Until TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION are set in .env,
      // the script logs a warning and exits immediately (by design) — these settings
      // just stop PM2 from restart-looping it while it's unconfigured.
      autorestart: true,
      restart_delay: 30000,
      max_restarts: 30
    },
    {
      // Main 13-agent consensus trading loop — src/orchestrator/index.js + consensus.js
      // This is the process that produces trade_ledger.json / portfolio_state.json.
      // Was previously run manually (npm run bot) and not PM2-managed, so it died
      // whenever the terminal closed. Now supervised: auto-restarts on crash.
      name: "trading-orchestrator",
      cwd: "F:/aitradingagent",
      script: "src/orchestrator/index.js",
      interpreter: "node",
      watch: false,
      autorestart: true,
      restart_delay: 10000,
      max_restarts: 50,
      env: { NODE_ENV: "production" }
    },
    {
      // Live dashboard UI — npm run dashboard equivalent
      // PORT overridden here (not in .env) to 3003 — 3001 is held by a
      // separate Hermes node.exe process on this machine (found 2026-09-11).
      // This override is scoped to just this PM2 app, so nothing else that
      // reads the shared PORT/DASHBOARD_PORT from .env is affected.
      name: "dashboard",
      cwd: "F:/aitradingagent",
      script: "src/dashboard/server.js",
      interpreter: "node",
      watch: false,
      autorestart: true,
      restart_delay: 10000,
      max_restarts: 30,
      env: { PORT: "3003" }
    },
    {
      // Freqtrade execution engine, running in DRY-RUN, acting on signals
      // written by trading-orchestrator's signalBridge.js (see
      // src/orchestrator/signalBridge.js + ConsensusBridgeStrategy.py).
      // This does NOT run its own independent trading logic — it reads
      // data/freqtrade_signals.json for what to buy/sell and gives that
      // real exchange-side stop-loss/position-tracking machinery, which the
      // hand-built Node executor still lacks. dry_run:true is set in
      // config_bridge_dryrun.json — added 2026-09-03, not yet battle-tested,
      // watch its logs before ever considering flipping dry_run off.
      name: "freqtrade-bridge",
      cwd: "F:/aitradingagent/freqtrade-stable",
      script: ".venv/Scripts/freqtrade.exe",
      args: "trade --config user_data/config_bridge_dryrun.json --strategy ConsensusBridgeStrategy",
      interpreter: "none",
      watch: false,
      autorestart: true,
      restart_delay: 15000,
      max_restarts: 30
    }
  ]
};
