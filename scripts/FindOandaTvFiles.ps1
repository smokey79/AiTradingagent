$files = Get-ChildItem -Path F:\aitradingagent -Recurse -Include *.js,*.py -Exclude node_modules -ErrorAction SilentlyContinue
$hits = $files | Select-String -Pattern 'oanda|tradingview' -List
$hits | Select-Object -ExpandProperty Path | Sort-Object -Unique
