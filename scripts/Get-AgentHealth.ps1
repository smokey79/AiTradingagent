$f = 'F:\aitradingagent\data\agent_health.json'
if (Test-Path $f) {
  $h = Get-Content $f -Raw | ConvertFrom-Json
  $h.PSObject.Properties | ForEach-Object {
    $name = $_.Name
    $v = $_.Value
    "$name : status=$($v.status) lastSuccess=$($v.lastSuccess) lastError=$($v.lastError)"
  }
} else {
  Write-Host "agent_health.json not found"
}

Write-Host ""
Write-Host "=== latest_agent_votes.json (if present) ==="
$v2 = 'F:\aitradingagent\data\latest_agent_votes.json'
if (Test-Path $v2) {
  Get-Content $v2 -Raw | ConvertFrom-Json | ConvertTo-Json -Depth 4 | Select-Object -First 1
} else {
  Write-Host "not found"
}
