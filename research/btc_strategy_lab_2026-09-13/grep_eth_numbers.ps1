cd 'F:\aitradingagent\research\btc_strategy_lab_2026-09-13'
Write-Output "=== FINAL_REPORT.md line count ==="
(Get-Content FINAL_REPORT.md).Count
Write-Output "`n=== Lines mentioning ETH + Net profit / drawdown / bootstrap / OOS ==="
Select-String -Path FINAL_REPORT.md -Pattern 'ETH' -Context 0,0 | Select-String -Pattern 'net profit|drawdown|bootstrap|OOS|profit factor|win rate|trades' | ForEach-Object { "$($_.LineNumber): $($_.Line)" }
