// ecosystem.demo.config.cjs  (2026-10-03)
// Lean PAPER / DEMO process set for the calibration run. Start with:  scripts\START-DEMO.ps1
// (the original ecosystem.config.cjs is untouched). App names match the old ones on purpose:
// the "AiTradingAgent Watchdog" scheduled task restarts "dashboard" by name.
//
// Hard locks: every app below gets paper-mode environment variables that win over .env, so nothing in this
// set can place a real order, whatever .env says (dotenv never overrides variables that already exist).
//
// Deliberately NOT started (all still in ecosystem.config.cjs if you want them back):
//   python-debate       duplicate of the Node Bull/Bear debate, and calls paid router keys
//   arb-scanner         the old cross-chain PRICE-COMPARISON scanner; a flash loan must open and close on ONE chain,
//                       so that comparison can never be a real trade. The Node same-chain engine (observation only)
//                       runs inside trading-orchestrator already.
//   hermes-analyst      commentary only; loads the local model every 30 min (RAM). Ollama is now on demand.
//   tradingkit-analyst  uses TradingKit credits; not needed for calibration
//   mt5-feed            needs the MetaTrader5 terminal
//   claude-solo         paid Claude duel bot; the duel is over
//   risk-gate / trading-data  stdio MCP servers for Claude Desktop, not PM2 services
const PAPER_LOCKS = {
  NODE_ENV: 'production',
  TRADING_MODE: 'paper',
  PAPER_TRADING: 'true',
  LIVE_TRADING: 'false',
  ARB_MODE: 'observe',
  ALLOW_SYNTHETIC_CANDLES: 'false',
  // TEMPORARY (2026-10-03, Alan): the rolling win-rate gate in riskGate.js (it stops NEW paper trades when the last N
  // trades win less often than this) is lowered 68% -> 55% for this PAPER demo set only, to keep realistic data flowing.
  // To revert: delete this line (default is 0.68 from .env). NOT touched on purpose: LIVE_GATE_WIN_RATE (68%, 250 trades,
  // profit factor > 1.3, fees included) - that is the gate that protects real money and it stays exactly as it was.
  RISK_MIN_WIN_RATE_GATE: '0.55',
  // Probability engine gate (src/engine): shadow = every decision is logged and scored, nothing is blocked. 'auto' would enforce only after
  // the model passes its out-of-sample bar (config/engine.json -> validationBar); 'enforce' blocks gate-failed signals regardless.
  ENGINE_GATE_MODE: 'shadow',
  AI_ROUTER_ENABLED: 'true',
  ENGINE_REVIEW: 'true',
  DATA1_ENV_PATH: 'D:/Data1.env',
  AI_DAILY_BUDGET_USD: '0.25',
  AI_MAX_REQUESTS_PER_DAY: '300',
  AI_MAX_INPUT_PRICE: '1',
  AI_MAX_OUTPUT_PRICE: '3',
  EXECUTION_OWNER: 'freqtrade',
};

module.exports = {
  apps: [
    {
      name: 'prediction-expert',
      cwd: 'F:/aitradingagent',
      script: 'scripts/prediction_expert.js',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      restart_delay: 15000,
      env: { ...PAPER_LOCKS },
    },
    {
      // Main multi-agent consensus loop + paper execution. Produces trade_ledger.json / portfolio_state.json
      // and the signals file the Freqtrade bridge reads. Fail-closed data-quality gate, exchange-based
      // minimum order, 0.06% fee + 0.02% slippage (config/realism.json).
      name: 'trading-orchestrator',
      cwd: 'F:/aitradingagent',
      script: 'src/orchestrator/index.js',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      restart_delay: 10000,
      max_restarts: 50,
      env: { ...PAPER_LOCKS },
    },
    {
      // Dashboard UI/API only (DASHBOARD_ONLY keeps it from starting a second trading engine).
      name: 'dashboard',
      cwd: 'F:/aitradingagent',
      script: 'src/dashboard/server.js',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      restart_delay: 10000,
      max_restarts: 30,
      env: { ...PAPER_LOCKS, PORT: '3001', DASHBOARD_ONLY: 'true' },
    },
    {
      // Freqtrade DRY-RUN: the main calibration loop. One strategy (ConsensusBridgeStrategy, every trade tagged
      // consensus_bridge_v1|c<confidence>|a<agents>), 7 pairs, fee 0.06%, orders cross the spread, $250 wallet,
      // $25 per trade, fresh database freqtrade_calibration_dryrun.sqlite. dry_run is also asserted in the config.
      name: 'freqtrade-bridge',
      cwd: 'F:/aitradingagent/freqtrade-stable',
      script: '.venv/Scripts/freqtrade.exe',
      args: 'trade --config user_data/config_bridge_dryrun.json --strategy ConsensusBridgeStrategy',
      interpreter: 'none',
      watch: false,
      autorestart: true,
      restart_delay: 15000,
      max_restarts: 30,
      env: { ...PAPER_LOCKS },
    },
    {
      // Bigdata.com news/macro sentiment refresher (every 30 min; keeps serving the last good cache if the key fails).
      name: 'bigdata-analyst',
      cwd: 'F:/aitradingagent',
      script: 'scripts/bigdata_analyst.py',
      interpreter: 'F:/aitradingagent/venv/Scripts/python.exe',
      watch: false,
      autorestart: true,
      restart_delay: 30000,
      max_restarts: 15,
      error_file: 'logs/bigdata-analyst-err.log',
      out_file: 'logs/bigdata-analyst-out.log',
      env: { ...PAPER_LOCKS },
    },
    {
      // Copies Freqtrade dry-run trades into the single SQLite ledger (data/ledger.db) every 10 minutes
      // (scripts/ledger_sync.py is idempotent). It runs, exits, and PM2 starts it again on the cron schedule.
      name: 'ledger-sync',
      cwd: 'F:/aitradingagent',
      script: 'scripts/ledger_sync.py',
      args: '--quiet',
      interpreter: 'F:/aitradingagent/.venv/Scripts/python.exe',
      watch: false,
      autorestart: false,
      cron_restart: '*/10 * * * *',
      env: { ...PAPER_LOCKS },
    },
    {
      // Telegram signal ingestion (exits quietly if TELEGRAM_* are not configured).
      name: 'telegram-listener',
      cwd: 'F:/aitradingagent',
      script: 'src/notifications/telegramListener.js',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      restart_delay: 30000,
      max_restarts: 30,
      env: { ...PAPER_LOCKS },
    },
    {
      // Multi-exchange arbitrage agent (added 2026-10-03). PAPER ONLY: scans live public order books on several exchanges every
      // 60 s, keeps its own memory + P/L in data/arb/arb.db, runs a bull/bear debate (free Qwen/Gemma models) and the predictor,
      // and "executes" only on paper after fees, price impact, a latency haircut and a rebalancing cost. No API keys, no orders.
      // Dashboard: http://localhost:3001/arb.html
      name: 'arb-agent',
      cwd: 'F:/aitradingagent',
      script: 'src/arb/arbAgent.js',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      restart_delay: 15000,
      max_restarts: 30,
      env: { ...PAPER_LOCKS, ARB_SCAN_INTERVAL_SEC: '60' },
    },
  ],
};
