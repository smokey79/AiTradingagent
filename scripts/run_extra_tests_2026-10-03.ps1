# run_extra_tests_2026-10-03.ps1 -- runs the stand-alone test files that are NOT part of runAllTests.js, in a sandbox copy
# (same isolation as run_tests_safe.ps1: temp copy, no .env, Telegram off). Each test gets a 90 s limit; a test that
# does not finish is killed and reported as TIMEOUT. Prints one line per file.
param([string]$Only = '', [int]$TimeoutSec = 90)
$root = 'F:\aitradingagent'
$sb = Join-Path $env:TEMP ("aita_extra_" + (Get-Date -Format 'HHmmss'))
New-Item -ItemType Directory -Force -Path $sb | Out-Null
$skipDirs = @('node_modules','.venv','venv','.git','_archive','backups','runs','freqtrade-stable','flashloan-sim','logs','cache','ohlcv','unified_data','.snapshots','.savyre')
$skipFiles = @('*.log','cycle_C*.json','.env','.env.*','*.sqlite','*.sqlite-wal','*.sqlite-shm','*.db')
robocopy $root $sb /E /NFL /NDL /NJH /NJS /NP /XD $skipDirs /XF $skipFiles | Out-Null
cmd /c mklink /J "$sb\node_modules" "$root\node_modules" | Out-Null
Set-Location $sb
$env:TELEGRAM_BOT_TOKEN = ''; $env:TELEGRAM_CHAT_ID = ''; $env:TELEGRAM_ALERTS_ENABLED = 'false'; $env:AITA_TEST_SANDBOX = '1'
$jsTests = 'tests\test_allocation_and_candidates.js','tests\test_alpaca_broker.js','tests\test_oanda_broker.js','tests\test_trading212_broker.js','tests\testSelfHealingHitRate.js','tests\test_strategy_learning_agent.js','tests\test_trade_ledger_gate.js','tests\realism.test.js','tests\ledgerdb.test.js'
if ($Only) { $jsTests = @($Only) }
foreach ($t in $jsTests) {
  if (-not (Test-Path $t)) { "MISSING  $t"; continue }
  $so = Join-Path $sb 'out.txt'; $se = Join-Path $sb 'err.txt'
  $p = Start-Process -FilePath 'node' -ArgumentList $t -NoNewWindow -PassThru -RedirectStandardOutput $so -RedirectStandardError $se
  $null = $p.Handle   # PowerShell quirk: without touching Handle, ExitCode comes back empty
  if (-not $p.WaitForExit($TimeoutSec * 1000)) {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    "TIMEOUT $t  (killed after $TimeoutSec s). Last lines of its output:"
    ((Get-Content $so -ErrorAction SilentlyContinue) + (Get-Content $se -ErrorAction SilentlyContinue)) | Where-Object { $_.Trim() } | Select-Object -Last 8 | ForEach-Object { $x = $_; if ($x.Length -gt 170) { $x = $x.Substring(0,170) }; "         " + $x }
    continue
  }
  $out = ((Get-Content $so -ErrorAction SilentlyContinue) + (Get-Content $se -ErrorAction SilentlyContinue)) -join "`n"
  if ($p.ExitCode -eq 0) { "PASS   $t  :: " + (($out -split "`n" | Where-Object { $_.Trim() } | Select-Object -Last 1)) }
  else { "FAIL   $t  (exit $($p.ExitCode))"; ($out -split "`n" | Where-Object { $_ -match 'FAIL|Error|assert' } | Select-Object -First 5) | ForEach-Object { "         " + $_.Trim() } }
}
Set-Location $root
cmd /c rmdir "$sb\node_modules" | Out-Null
Remove-Item $sb -Recurse -Force -ErrorAction SilentlyContinue
"sandbox removed (exists: $(Test-Path $sb))"
