# scripts/commit_gate_68_250.ps1 - commits ONLY the 68%/250 gate change and the 10 new coins (2026-09-24)
# Uses `git commit --only -- <paths>` so anything else already staged stays staged and is NOT committed.
Set-Location (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$files = @(
  'src/risk/tradeLedger.js', 'src/risk/riskGate.js', 'src/health/systemHealthCheck.js',
  'src/learning/strategyLearner.js', 'mcp-servers/risk-gate-mcp/index.js', 'web-dashboard/routes/dashboard.py',
  'START-PAPER-TRADE.ps1', 'src/brokers/trading212Broker.js', 'orchestrator/data_sourcer_agent.py',
  'tests/test_trade_ledger_gate.js', 'tests/test_data_sourcer_real.py', 'pybacktest/run_grid.py',
  'config/instrument_universe.json', 'src/agents/technicalDaily/priceFeed.js', 'src/agents/technicalLab/priceFeed.js',
  'RUN-PYLAB.ps1', 'scripts/patch_gate_68_250.py', 'scripts/probe_new_coins.js', 'scripts/Add-TradingPairs.ps1',
  'scripts/commit_gate_68_250.ps1'
)
$msg = @"
Gates: 68% win rate over 250 real trades (live gate and per-signal risk gate); add 10 coins

- Live-funds gate 70%/50 -> 68%/250 (tradeLedger, strategyLearner, risk-gate MCP, dashboard, T212 broker)
- Per-signal risk gate, health check and data sourcer: sample 20 -> 250 (RISK_GATE_MIN_TRADES)
- Coins LTC TRX ZEC SUI OKB ICP AAVE POL ATOM FLR: Python lab grid, instrument universe, price feeds
- Tests updated for 250-trade windows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01T1kkzj1Hx8J33qNfXLSAHi
"@
$tmp = Join-Path $env:TEMP 'commit_msg_68_250.txt'
[System.IO.File]::WriteAllText($tmp, $msg, (New-Object System.Text.UTF8Encoding($false)))
git commit --only -F $tmp -- $files 2>&1 | Select-Object -Last 2
Remove-Item $tmp
git log --oneline -1
