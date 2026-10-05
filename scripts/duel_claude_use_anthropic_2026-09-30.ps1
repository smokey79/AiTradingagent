# Switches the duel's Claude bot (claude-solo) to the direct Anthropic API and raises its API budget to $4.
# Backs up .env, syntax-checks the edited bot, restarts ONLY claude-solo (its state file keeps equity/positions).
$ErrorActionPreference = 'Continue'
Set-Location F:\aitradingagent
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item .env ".env.bak-$stamp"
$env_ = Get-Content .env -Raw
function Set-Kv([string]$text, [string]$k, [string]$v) {
  if ($text -match "(?m)^$k=") { return [regex]::Replace($text, "(?m)^$k=.*$", "$k=$v") }
  return $text.TrimEnd() + "`r`n$k=$v`r`n"
}
$env_ = Set-Kv $env_ 'DUEL_CLAUDE_PROVIDER' 'anthropic'
$env_ = Set-Kv $env_ 'DUEL_CLAUDE_ANTHROPIC_MODEL' 'claude-sonnet-5-5'
$env_ = Set-Kv $env_ 'DUEL_CLAUDE_BUDGET_USD' '4.00'
Set-Content .env $env_ -NoNewline
"env updated (backup .env.bak-$stamp)"
node --check src\duel\claudeSoloTrader.js
if ($LASTEXITCODE -ne 0) { "SYNTAX ERROR - not restarting"; exit 1 }
"syntax OK"
pm2 restart claude-solo --update-env | Out-Null
Start-Sleep -Seconds 20
pm2 logs claude-solo --lines 15 --nostream 2>&1 | Select-String -Pattern 'ClaudeSolo|error|Error' | Select-Object -Last 8
