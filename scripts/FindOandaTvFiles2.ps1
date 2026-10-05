$dirs = @('src','scripts','core','freqtrade-stable\user_data\strategies')
foreach ($d in $dirs) {
  $full = Join-Path F:\aitradingagent $d
  if (Test-Path $full) {
    Get-ChildItem -Path $full -Recurse -Include *.js,*.py -ErrorAction SilentlyContinue |
      Select-String -Pattern 'oanda|tradingview' -List |
      Select-Object -ExpandProperty Path
  }
}
