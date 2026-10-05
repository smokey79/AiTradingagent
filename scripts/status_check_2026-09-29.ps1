# status_check_2026-09-29.ps1 - read-only snapshot: PM2 processes, MCP config names, trading mode flags (no secrets printed)
Set-Location F:\aitradingagent
Write-Output "=== PM2 ==="
try { pm2 jlist | ConvertFrom-Json | ForEach-Object { "{0,-30} {1,-10} restarts={2}" -f $_.name, $_.pm2_env.status, $_.pm2_env.restart_time } } catch { "pm2 not available: $_" }
Write-Output "=== .mcp.json servers ==="
try { (Get-Content .mcp.json -Raw | ConvertFrom-Json).mcpServers.PSObject.Properties.Name } catch { "no .mcp.json parse: $_" }
Write-Output "=== Claude desktop config servers ==="
$cfg = "C:\Users\AlanJ\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json"
if (-not (Test-Path $cfg)) { $cfg = "C:\Users\barcl\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json" }
try { (Get-Content $cfg -Raw | ConvertFrom-Json).mcpServers.PSObject.Properties.Name } catch { "no desktop config: $_" }
Write-Output "=== .env mode / bitget keys present (names only) ==="
Get-Content .env | Where-Object { $_ -match '^(TRADING_MODE|PAPER|MODE|DRY_RUN|BITGET_[A-Z_]*|TRADINGVIEW[A-Z_]*|LIVE[A-Z_]*)=' } | ForEach-Object { ($_ -split '=')[0] + '=' + $(if ($_ -match 'KEY|SECRET|PASS') { '<set>' } else { ($_ -split '=',2)[1] }) }
Write-Output "=== Recent logs ==="
Get-ChildItem logs -File | Sort-Object LastWriteTime -Descending | Select-Object -First 8 Name, LastWriteTime, Length
