# show_candidates_rest_2026-10-03.ps1 -- READ-ONLY. Names of the remaining candidate key files (not the VSCode-extension samples, example files or .env backups already listed).
$f = 'F:\aitradingagent\runs\2026-10-03_calibration\key_file_candidates.txt'
Get-Content $f | Where-Object { $_ -match '^[A-Z]:\\' -and $_ -notmatch 'VSCode\\extensions|\.env\.example|\\\.env\.(bak|backup)|\.env\.backup|mojibake|LICENSE' -and $_ -notmatch '^F:\\aitrader\\orchestrator\\_OLD|^F:\\aitradingagent\\_archive\\_OLD_BACKUPS' } |
  Where-Object { $_ -match 'aitradingagent2|credentials_review|F:\\[^\\]+\s|F:\\barcl|C:\\Users|aitrader\\data|aitradingagent\\(config|agents|orchestrator|freqtrade)|_archive' } |
  ForEach-Object { ($_ -replace '\s{2,}', '  ').Trim() }
