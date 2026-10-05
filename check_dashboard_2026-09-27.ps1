Set-Location F:\aitradingagent
$json = pm2 jlist | Out-String | ConvertFrom-Json
$dash = $json | Where-Object { $_.name -eq 'dashboard' }
if ($dash) {
  Write-Output "PM2 process 'dashboard': status=$($dash.pm2_env.status) pid=$($dash.pid) restarts=$($dash.pm2_env.restart_time)"
} else {
  Write-Output "PM2 process 'dashboard' NOT FOUND"
}
try {
  $r = Invoke-WebRequest -Uri 'http://localhost:3001/api/autotrading/status' -TimeoutSec 5 -UseBasicParsing
  Write-Output "HTTP $($r.StatusCode) : $($r.Content)"
} catch {
  Write-Output "LOCAL SERVER CHECK FAILED: $($_.Exception.Message)"
}
