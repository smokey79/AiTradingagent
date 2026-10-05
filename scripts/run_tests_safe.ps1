# run_tests_safe.ps1 (2026-10-03) -- run the project's JS test suite in a SANDBOX COPY, never against live data.
# Why: node tests/runAllTests.js writes to data\ (trade ledger, portfolio, allocation settings, ...) and sends real
# Telegram messages. This copies the code + data to a temp folder WITHOUT .env (so no keys, no Telegram), links the
# existing node_modules, runs the suite there, prints the summary, and removes the copy.
#   powershell -ExecutionPolicy Bypass -File scripts\run_tests_safe.ps1 [-Keep]
#   -WithEnv copies .env into the sandbox so the suite sees your real settings (needed for a faithful run); Telegram
#   alerts are switched off for the run and the sandbox, including that .env copy, is deleted afterwards.
param([switch]$Keep, [switch]$WithEnv, [string]$TestArgs = '')
$root = 'F:\aitradingagent'
$sb = Join-Path $env:TEMP ("aita_sandbox_" + (Get-Date -Format 'HHmmss'))
New-Item -ItemType Directory -Force -Path $sb | Out-Null
"sandbox: $sb"
$skipDirs = @('node_modules','.venv','venv','.git','_archive','backups','runs','freqtrade-stable','flashloan-sim','logs','cache','ohlcv','unified_data','.snapshots','.savyre')
$skipFiles = @('*.log','cycle_C*.json','.env','.env.*','*.sqlite','*.sqlite-wal','*.sqlite-shm','*.db')
robocopy $root $sb /E /NFL /NDL /NJH /NJS /NP /XD $skipDirs /XF $skipFiles | Out-Null
cmd /c mklink /J "$sb\node_modules" "$root\node_modules" | Out-Null
if ($WithEnv) { Copy-Item "$root\.env" "$sb\.env" }
Set-Location $sb
# Set (even to empty) BEFORE dotenv loads: dotenv never overrides variables that already exist, so no message can go out.
$env:TELEGRAM_BOT_TOKEN = ''; $env:TELEGRAM_CHAT_ID = ''; $env:TELEGRAM_ALERTS_ENABLED = 'false'
$env:AITA_TEST_SANDBOX = '1'   # tells tests/runAllTests.js it is safe to run (it refuses otherwise)
$log = Join-Path $root 'logs\tests_sandbox_latest.txt'
if ($TestArgs) { node tests/runAllTests.js $TestArgs *>&1 | Out-File -FilePath $log -Encoding utf8 } else { node tests/runAllTests.js *>&1 | Out-File -FilePath $log -Encoding utf8 }
"exit code: $LASTEXITCODE"
$res = Select-String -Path $log -Pattern 'TEST RESULTS' -CaseSensitive | Select-Object -First 1
if ($res) { $res.Line } else { "no summary line found - see $log" }
"Failing tests:"
Select-String -Path $log -Pattern 'FAIL' -CaseSensitive | Where-Object { $_.Line -notmatch 'warn' } | ForEach-Object { "  " + $_.Line.Trim() }
Set-Location $root
cmd /c rmdir "$sb\node_modules" | Out-Null
if (-not $Keep) { Remove-Item $sb -Recurse -Force -ErrorAction SilentlyContinue; "sandbox removed" } else { "sandbox kept: $sb" }
"full log: $log"
