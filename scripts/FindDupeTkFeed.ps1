Get-ChildItem -Path F:\aitradingagent -Recurse -Filter 'tradingKitFeed.js' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules' } |
  Select-Object FullName, LastWriteTime
