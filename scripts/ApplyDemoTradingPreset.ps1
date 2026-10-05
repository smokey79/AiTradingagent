<#
  ApplyDemoTradingPreset.ps1

  Applies a conservative paper/demo trading preset without printing secrets.
  Uses Set-EnvValue.ps1 so each .env change is backed up and values stay hidden.
#>
param(
  [string] $EnvPath = ''
)

$ErrorActionPreference = 'Stop'

$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
$root = Split-Path -Parent $here
if (-not $EnvPath) {
  $EnvPath = Join-Path $root '.env'
}

$setEnv = Join-Path $here 'Set-EnvValue.ps1'
if (-not (Test-Path $setEnv)) {
  throw "Missing helper: $setEnv"
}

$pairs = @(
  'BTC/USDT',
  'ETH/USDT',
  'SOL/USDT',
  'BNB/USDT',
  'LINK/USDT',
  'AAVE/USDT',
  'XRP/USDT',
  'ADA/USDT',
  'DOGE/USDT',
  'OP/USDT'
) -join ','

$settings = [ordered]@{
  TRADING_MODE = 'paper'
  PAPER_TRADING = 'true'
  PAPER_TRADE = 'true'
  LIVE_TRADING = 'false'
  OANDA_TRADING_ENABLED = 'false'
  AUTO_TRADE_INTERVAL_SEC = '1800'
  OPENROUTER_ALLOW_PAID_FALLBACK = 'false'
  TRADING_PAIRS = $pairs
}

foreach ($entry in $settings.GetEnumerator()) {
  & $setEnv -Name $entry.Key -Value $entry.Value -EnvPath $EnvPath
}

Write-Host "Demo preset applied to $EnvPath."
Write-Host "Configured $($pairs.Split(',').Count) crypto pairs, paper mode, OANDA disabled, paid OpenRouter fallback disabled."
