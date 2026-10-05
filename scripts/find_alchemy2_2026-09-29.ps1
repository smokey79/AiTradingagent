# find_alchemy2_2026-09-29.ps1 - read-only: look for an Alchemy key in the other known config locations. Names only, never values.
$places = @(
  'C:\Users\AlanJ\projects\AiTradingagent\.env',
  'C:\Users\barcl\projects\AiTradingagent\.env',
  'C:\Users\AlanJ\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json',
  'C:\Users\barcl\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json',
  'C:\Users\barcl\AppData\Roaming\Claude\claude_desktop_config.json',
  'F:\aitradingagent\.mcp.json'
)
foreach ($p in $places) {
  if (-not (Test-Path $p)) { "missing: $p"; continue }
  $hits = Select-String -Path $p -Pattern '(?i)alchemy' -ErrorAction SilentlyContinue
  if (-not $hits) { "no alchemy: $p"; continue }
  foreach ($h in $hits) { $n = if ($h.Line -match '"?([A-Za-z0-9_]*ALCHEMY[A-Za-z0-9_]*)"?\s*[=:]') { $Matches[1] } else { '(alchemy mentioned)' }; "FOUND  $n  in $p (line $($h.LineNumber))" }
}
[Environment]::GetEnvironmentVariables('User').Keys | Where-Object { $_ -match '(?i)alchemy' } | ForEach-Object { "FOUND  user environment variable $_" }
