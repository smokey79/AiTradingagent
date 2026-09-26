cd 'F:\aitradingagent\research\btc_strategy_lab_2026-09-13'
Write-Output "=== Lines 170-200 (qualification table area) ==="
Get-Content FINAL_REPORT.md | Select-Object -Skip 169 -First 31
Write-Output "`n=== Lines 195-245 (Round 6 / Round 8 sections) ==="
Get-Content FINAL_REPORT.md | Select-Object -Skip 194 -First 51
