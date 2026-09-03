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
      name: "dashboard",
      cwd: "F:/aitradingagent",
      script: "src/dashboard/server.js",
      interpreter: "node",
      watch: false,
      autorestart: true,
      restart_delay: 10000,
      max_restarts: 30
    }
  ]
};
