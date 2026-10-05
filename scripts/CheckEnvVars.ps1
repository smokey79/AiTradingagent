$f = "F:\aitradingagent\.env"
Select-String -Path $f -Pattern "AUTO_TRADE_INTERVAL_SEC|TRADING_PAIRS|PAPER_TRADING|MAX_CONCURRENT|MAX_OPEN_POSITIONS|MIN_CONFIDENCE|MAX_PORTFOLIO_EXPOSURE|LIVE_GATE" | ForEach-Object {
    Write-Host "$($_.Line.Trim())"
}
