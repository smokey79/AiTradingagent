# run_unit_tests_2026-10-03.ps1 -- the fast, self-contained unit tests added/updated during calibration. Each uses temp files only.
Set-Location F:\aitradingagent
$tests = @('tests/realism.test.js','tests/test_trade_ledger_gate.js','tests/ledgerdb.test.js','tests/paperBook.test.js','tests/test_allocation_and_candidates.js','tests/indicators_atr.test.js','tests/arb.test.js','tests/engine.test.js')
$bad = 0
foreach ($t in $tests) {
  $out = node $t 2>&1 | Out-String
  $code = $LASTEXITCODE
  $last = ($out -split "`n" | Where-Object { $_.Trim() } | Select-Object -Last 1).Trim()
  if ($code -eq 0) { "PASS  $t   [$last]" } else { "FAIL  $t   [exit $code] $last"; $bad++ }
}
$py = & "F:\aitradingagent\.venv\Scripts\python.exe" tests/test_calibration_py.py 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) { "PASS  tests/test_calibration_py.py   [$(($py -split "`n" | Where-Object { $_.Trim() } | Select-Object -Last 1).Trim())]" } else { "FAIL  tests/test_calibration_py.py"; $bad++ }
"failed files: $bad"
