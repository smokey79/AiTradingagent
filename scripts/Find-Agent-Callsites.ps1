$agents = @('hermesAgent','deepseekAgent','gpt4oAgent','grokAgent','smcAgent','youtubeSentimentAgent','defiAgent','intelligentSignalsAgent','providerRotator','volatilityRegimeAgent')
foreach ($a in $agents) {
  Write-Host "=== $a.getSignal( call sites ==="
  Get-ChildItem F:\aitradingagent\src -Recurse -Include *.js | ForEach-Object {
    $hits = Select-String -Path $_.FullName -Pattern "$a\." -ErrorAction SilentlyContinue
    if ($hits) { Write-Host "$($_.FullName):"; $hits | ForEach-Object { "  $($_.LineNumber): $($_.Line.Trim())" } }
  }
}
