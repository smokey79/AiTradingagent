# scripts/Find-BrokerKeys.ps1 - finds where OANDA / MetaTrader 5 credentials are saved on a drive. 2026-09-24
# Prints file path, line number and the KEY NAME only. Values are never printed (shown as <hidden, N chars>).
# Usage: powershell.exe -ExecutionPolicy Bypass -File scripts\Find-BrokerKeys.ps1 [-Root F:\]
param([string]$Root = 'F:\')
$skipDirs = '\\(node_modules|\.git|\.venv|venv|__pycache__|site-packages|dist|build|\.cache|ohlcv)\\'
$exts = '.env', '.txt', '.json', '.ini', '.cfg', '.conf', '.yaml', '.yml', '.py', '.js', '.ts', '.ps1', '.md', '.toml', '.set', '.csv', ''
$namePattern = 'oanda|mt5|meta ?trader|metaquotes|\.env'
$keyPattern = '(?i)(oanda[\w\-]*|mt5[\w\-]*|metatrader[\w\-]*|meta5[\w\-]*)\s*[:=]\s*["'']?([^"''\s,#]+)'

Write-Host "Scanning $Root ... (values hidden)"
$files = Get-ChildItem -Path $Root -Recurse -File -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch $skipDirs -and $_.Length -lt 2MB -and ($exts -contains $_.Extension.ToLower() -or $_.Name -like '.env*') }

Write-Host "`n== Files whose NAME mentions OANDA / MT5 / MetaTrader / .env =="
$files | Where-Object { $_.Name -match $namePattern } | ForEach-Object { "  $($_.FullName)  ($([math]::Round($_.Length/1KB,1)) KB, $($_.LastWriteTime.ToString('yyyy-MM-dd')))" }

Write-Host "`n== Lines that SET an OANDA / MT5 value (key names only) =="
foreach ($f in $files) {
  $hits = Select-String -Path $f.FullName -Pattern $keyPattern -AllMatches -ErrorAction SilentlyContinue
  foreach ($h in $hits) {
    foreach ($m in $h.Matches) {
      $val = $m.Groups[2].Value
      $kind = if ($val -match '^(your|xxx|<|\$|process\.env|os\.getenv|None|null|""|changeme)' -or $val.Length -lt 4) { 'placeholder/empty' } else { "<hidden, $($val.Length) chars>" }
      "  $($f.FullName):$($h.LineNumber)  $($m.Groups[1].Value) = $kind"
    }
  }
}
Write-Host "`nDone."
