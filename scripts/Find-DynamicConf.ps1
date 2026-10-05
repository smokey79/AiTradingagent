Select-String -Path F:\aitradingagent\src\risk\riskGate.js -Pattern 'dynamicMinConf|CHOPPY|0\.8[0-9]?\b|0\.85|REGIMES\.|MIN_CONFIDENCE' |
  ForEach-Object { "$($_.LineNumber): $($_.Line.Trim())" }
