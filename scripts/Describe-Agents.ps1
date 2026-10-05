$files = @(
  'hermesAgent.js','defiAgent.js','providerRotator.js','deepseekAgent.js','gpt4oAgent.js',
  'grokAgent.js','smcAgent.js','intelligentSignalsAgent.js','youtubeSentimentAgent.js',
  'volatilityRegimeAgent.js','oandaSentimentAgent.js','tradingKitFeed.js'
)
foreach ($f in $files) {
  $path = "F:\aitradingagent\src\agents\$f"
  if ($f -eq 'tradingKitFeed.js') { $path = "F:\aitradingagent\src\data\$f" }
  if (Test-Path $path) {
    Write-Host "=== $f ==="
    Get-Content $path -TotalCount 18 | Where-Object { $_ -match '\S' }
    Write-Host ""
  } else {
    Write-Host "=== $f : NOT FOUND at $path ==="
  }
}
