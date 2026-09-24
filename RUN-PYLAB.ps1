<#
  RUN-PYLAB.ps1 - free Python strategy lab (no TradingKit, no keys).
  Run from anywhere; it works in F:\aitradingagent.

    powershell.exe -ExecutionPolicy Bypass -File RUN-PYLAB.ps1 -Test      # offline unit tests only
    powershell.exe -ExecutionPolicy Bypass -File RUN-PYLAB.ps1 -Parity    # re-run the 24 Sep TradingKit grid and compare
    powershell.exe -ExecutionPolicy Bypass -File RUN-PYLAB.ps1            # full grid: 17 coins x 8 TFs x 5 strategies
    powershell.exe -ExecutionPolicy Bypass -File RUN-PYLAB.ps1 -Extra "--coins ETH,ARB --tfs 1h,2h"

  Long runs go to the background; output in research\pylab_<date>\run.log. Re-running resumes.
#>
param([switch]$Test, [switch]$Parity, [string]$Extra = '')
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Definition }
Set-Location $root
$py = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { $py = 'python' }

if ($Test) {
  & $py -m unittest pybacktest.tests.test_pybacktest -v
  exit $LASTEXITCODE
}
$outDir = Join-Path $root ("research\pylab_" + (Get-Date -Format 'yyyy-MM-dd'))
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$argList = @('-m', 'pybacktest.run_grid', '--out', "`"$outDir`"")
if ($Parity) {
  $argList += @('--coins', 'BTC,ETH,SOL,AVAX,ARB,OP,CRO', '--tfs', '15m,30m,1h,2h,4h,1d',
                '--strategies', 'EMA_VWAP,EMA_VWAP_ADX20,EMA_ADX20_ATR15,EMA_ADX20_ATR25',
                '--parity', "`"$(Join-Path $root 'research\multi_tf_lab_2026-09-24\results.json')`"")
}
if ($Extra) { $argList += $Extra.Split(' ') }
$log = Join-Path $outDir 'run.log'
$env:PYTHONUNBUFFERED = '1'   # so run.log fills as cells finish
$p = Start-Process -FilePath $py -ArgumentList $argList -WorkingDirectory $root `
      -RedirectStandardOutput $log -RedirectStandardError (Join-Path $outDir 'run.err.log') -WindowStyle Hidden -PassThru
Write-Host "Python lab started (PID $($p.Id)). Follow: Get-Content `"$log`" -Wait"
