<#
  RUN-LAB.ps1 - starts the multi-timeframe lab (or the probe) from F:\aitradingagent.
  -Probe : checks TradingKit credits / supported intervals / trade fields, runs no backtests.
  (no flag): runs the 168-cell grid in the background, output in run.log. Resumable.
  Needs TRADINGKIT_API_KEY in F:\aitradingagent\.env. No secrets are written by this script.
#>
param([switch]$Probe)
$ErrorActionPreference = 'Stop'
$lab = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $lab '..\..')
Set-Location $root
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js not found on PATH.' }
if ($Probe) {
  node (Join-Path $lab 'probe.js') 2>&1 | Tee-Object -FilePath (Join-Path $lab 'probe.log')
  exit $LASTEXITCODE
}
$log = Join-Path $lab 'run.log'
$err = Join-Path $lab 'run.err.log'
$p = Start-Process -FilePath 'node' -ArgumentList "`"$(Join-Path $lab 'run.js')`"" -WorkingDirectory $root `
      -RedirectStandardOutput $log -RedirectStandardError $err -WindowStyle Hidden -PassThru
Write-Host "Lab started (PID $($p.Id)). Follow progress: Get-Content `"$log`" -Wait"
