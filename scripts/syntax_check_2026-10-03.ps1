# syntax_check_2026-10-03.ps1 -- READ-ONLY. node --check on every JS file touched/added in the calibration work, py_compile on the Python ones.
$root = 'F:\aitradingagent'
Set-Location $root
$js = @(
 'src/agents/providerRotator.js','src/agents/openrouterFreeAgent.js','src/agents/geminiAgent.js','src/data/indicators.js','src/data/marketData.js',
 'src/risk/tradeLedger.js','src/risk/riskGate.js','src/risk/strategyEvidence.js','src/risk/edgeMonitor.js','src/agents/allocationAgent.js',
 'src/agents/strategyResearcher.js','src/learning/improvementLoop.js','src/learning/backtestEngine.js','src/orchestrator/index.js',
 'src/orchestrator/consensus.js','src/utils/realism.js','src/utils/ledgerDb.js','src/utils/exchangeLimits.js','src/utils/ollamaQueue.js',
 'src/utils/exchangeRouter.js','src/flashloan/flashloanExecutor.js','src/duel/paperBook.js','src/agents/evidenceCandidates/engine.js',
 'src/dashboard/server.js','ecosystem.demo.config.cjs'
) + @(Get-ChildItem "$root\src\arb","$root\src\predictor","$root\src\engine" -Filter *.js -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName.Substring($root.Length + 1) }) + @('src/dashboard/arbRoutes.js','src/dashboard/engineRoutes.js','scripts/engine_train.js','src/data/marketData.js')
$bad = 0
foreach ($f in $js) { $o = node --check $f 2>&1; if ($LASTEXITCODE -ne 0) { "SYNTAX FAIL $f :: $o"; $bad++ } }
"JS files checked: $($js.Count), failures: $bad"
$py = @('core/realism.py','core/ledger_db.py','agents/learning_agent.py','scripts/debate_runner.py','scripts/ledger_sync.py','orchestrator/strategy_evidence.py','src/flashloan/flash_loan_executor.py','scripts/calibration_report.py')
$pybad = 0
foreach ($f in $py) { $o = & "$root\.venv\Scripts\python.exe" -m py_compile $f 2>&1; if ($LASTEXITCODE -ne 0) { "PY FAIL $f :: $o"; $pybad++ } }
"Python files checked: $($py.Count), failures: $pybad"
