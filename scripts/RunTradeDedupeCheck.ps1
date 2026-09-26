param(
    [string]$File1 = 'F:\aitradingagent\data\trade_ledger.json',
    [string]$File2 = 'F:\aitradingagent\data\quarantine_simulated_trades.json',
    [double]$Threshold = 0.65
)
$ErrorActionPreference = 'Stop'
$work = 'F:\aitradingagent\tools\jedai-match'
$csv1 = Join-Path $work 'export1.csv'
$csv2 = Join-Path $work 'export2.csv'
$out  = Join-Path $work 'dedupe_report.csv'

Write-Host "Exporting $File1 ..."
python "F:\aitradingagent\scripts\export_ledger_to_csv.py" $File1 $csv1
Write-Host "Exporting $File2 ..."
python "F:\aitradingagent\scripts\export_ledger_to_csv.py" $File2 $csv2

Write-Host "Comparing (threshold $Threshold)..."
java -jar (Join-Path $work 'target\jedai-match.jar') $csv1 $csv2 $out $Threshold

Write-Host ""
Write-Host "Report: $out" -ForegroundColor Cyan
if (Test-Path $out) {
    $rows = Import-Csv $out
    Write-Host "$($rows.Count) candidate duplicate pair(s) found." -ForegroundColor $(if ($rows.Count -gt 0) {'Yellow'} else {'Green'})
}
