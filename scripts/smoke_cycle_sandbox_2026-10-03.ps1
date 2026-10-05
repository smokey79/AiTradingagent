# smoke_cycle_sandbox_2026-10-03.ps1 -- ONE real trading cycle (--once) in a SANDBOX copy: live public market data, paper mode,
# no .env (no keys, no Telegram), nothing written to your real data\ folder. Shows whether the new data-quality gate,
# exchange-minimum order size and SQLite ledger work together end to end.
param([string]$Pairs = 'BTC/USDT,ETH/USDT', [int]$TimeoutSec = 240)
$root = 'F:\aitradingagent'
$sb = Join-Path $env:TEMP ("aita_smoke_" + (Get-Date -Format 'HHmmss'))
New-Item -ItemType Directory -Force -Path $sb | Out-Null
$skipDirs = @('node_modules','.venv','venv','.git','_archive','backups','runs','freqtrade-stable','flashloan-sim','logs','cache','ohlcv','unified_data','.snapshots','.savyre')
$skipFiles = @('*.log','cycle_C*.json','.env','.env.*','*.sqlite','*.sqlite-wal','*.sqlite-shm','ledger.db*')
robocopy $root $sb /E /NFL /NDL /NJH /NJS /NP /XD $skipDirs /XF $skipFiles | Out-Null
cmd /c mklink /J "$sb\node_modules" "$root\node_modules" | Out-Null
Set-Location $sb
$env:TELEGRAM_BOT_TOKEN = ''; $env:TELEGRAM_CHAT_ID = ''; $env:TELEGRAM_ALERTS_ENABLED = 'false'
$env:TRADING_MODE = 'paper'; $env:PAPER_TRADING = 'true'; $env:LIVE_TRADING = 'false'; $env:NO_TRADES = 'false'; $env:EXECUTION_ENABLED = 'false'
$env:TRADING_PAIRS = $Pairs; $env:ARB_MODE = 'observe'; $env:OLLAMA_ON_DEMAND = 'false'
$log = Join-Path $root 'logs\smoke_cycle_latest.txt'
$so = Join-Path $sb 'o.txt'; $se = Join-Path $sb 'e.txt'
$p = Start-Process -FilePath 'node' -ArgumentList 'src/orchestrator/index.js','--once' -NoNewWindow -PassThru -RedirectStandardOutput $so -RedirectStandardError $se
$null = $p.Handle
$done = $p.WaitForExit($TimeoutSec * 1000)
if (-not $done) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; "TIMEOUT after $TimeoutSec s (killed)" } else { "cycle finished, exit code $($p.ExitCode)" }
$all = (Get-Content $so -ErrorAction SilentlyContinue) + (Get-Content $se -ErrorAction SilentlyContinue)
$all | Out-File $log -Encoding utf8
"--- key lines (full output: $log)"
$all | Where-Object { $_ -match 'Data-quality|Allocation Manager|Risk Gate|Master Consensus|PAPER POSITION|CYCLE DONE|exchange minimum|ledger.db|Error|error:|Unhandled|TypeError|ReferenceError|Cannot find' } |
  Select-Object -First 40 | ForEach-Object { $x = $_ -replace '\x1b\[[0-9;]*m',''; if ($x.Length -gt 200) { $x = $x.Substring(0,200) }; "  " + $x }
"--- sandbox ledger rows:"
if (Test-Path "$sb\data\trade_ledger.json") { (Get-Content "$sb\data\trade_ledger.json" | Measure-Object -Line).Lines } else { 0 }
Set-Location $root
cmd /c rmdir "$sb\node_modules" | Out-Null
Remove-Item $sb -Recurse -Force -ErrorAction SilentlyContinue
"sandbox removed (exists: $(Test-Path $sb))"
