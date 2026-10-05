# backup_before_calibration_2026-10-03.ps1
# Copies every file the 2026-10-03 calibration edits into backups\2026-10-03_precalibration\ (same relative paths),
# so any change can be undone by copying the file back. Skips a file if it was already backed up (never overwrites a backup).
$root = 'F:\aitradingagent'
$dest = "$root\backups\2026-10-03_precalibration"
$files = @(
 'src\risk\tradeLedger.js','src\utils\exchangeRouter.js','src\duel\paperBook.js','tests\paperBook.test.js',
 'src\learning\backtestEngine.js','src\agents\evidenceCandidates\engine.js','orchestrator\trader_oversight.py',
 'src\data\marketData.js','src\orchestrator\index.js','src\risk\strategyEvidence.js','orchestrator\strategy_evidence.py',
 'agents\learning_agent.py','scripts\debate_runner.py','src\flashloan\flashloanExecutor.js','src\flashloan\flash_loan_executor.py',
 'src\learning\improvementLoop.js','src\risk\edgeMonitor.js','src\agents\strategyResearcher.js','src\bridge\pythonBridge.js',
 'src\agents\allocationAgent.js','src\risk\riskGate.js','src\learning\backtestEngine.js','scripts\backtest_amd_po3_poc.js',
 'freqtrade-stable\user_data\config_bridge_dryrun.json','freqtrade-stable\user_data\strategies\ConsensusBridgeStrategy.py',
 'ecosystem.config.cjs','.env','tests\runAllTests.js','data\allocation_settings.json','src\utils\ollamaQueue.js','src\orchestrator\consensus.js','.gitignore','package.json','src\data\indicators.js','src\agents\metaEvaluatorAgent.js','src\dashboard\server.js','src\agents\openrouterFreeAgent.js','src\agents\providerRotator.js','src\agents\geminiAgent.js'
)
$n = 0; $skipped = 0; $missing = @()
foreach ($f in $files) {
  $src = Join-Path $root $f
  if (-not (Test-Path $src)) { $missing += $f; continue }
  $dst = Join-Path $dest $f
  if (Test-Path $dst) { $skipped++; continue }
  New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
  Copy-Item $src $dst
  $n++
}
"backed up: $n  already-backed-up: $skipped  missing: $($missing -join ', ')"
"NOTE: src\agents\allocationAgent.js was already edited (3 small edits) before this backup ran; use 'git show HEAD:src/agents/allocationAgent.js' for the committed original."
"destination: $dest"
