Write-Output '--- Tailscale install check ---'
$ts = Get-Command tailscale.exe -ErrorAction SilentlyContinue
if ($ts) {
  Write-Output "tailscale.exe found at: $($ts.Source)"
} else {
  $tsPath = 'C:\Program Files\Tailscale\tailscale.exe'
  if (Test-Path $tsPath) {
    Write-Output "tailscale.exe found at: $tsPath (not on PATH)"
  } else {
    Write-Output 'Tailscale does NOT appear to be installed.'
  }
}

Write-Output ''
Write-Output '--- Tailscale service check ---'
$svc = Get-Service -Name 'Tailscale' -ErrorAction SilentlyContinue
if ($svc) {
  Write-Output "Service 'Tailscale' status: $($svc.Status)"
} else {
  Write-Output "No 'Tailscale' service found."
}

Write-Output ''
Write-Output '--- Dashboard port 3001 listener ---'
$conns = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($conns) {
  $conns | ForEach-Object { Write-Output "Listening on $($_.LocalAddress):$($_.LocalPort)" }
} else {
  Write-Output 'Nothing is currently listening on port 3001.'
}

Write-Output ''
Write-Output '--- Firewall rules mentioning 3001 or Tailscale ---'
$rules = Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '3001|Tailscale' }
if ($rules) {
  $rules | ForEach-Object { Write-Output "$($_.DisplayName) | Enabled=$($_.Enabled) | Direction=$($_.Direction) | Action=$($_.Action)" }
} else {
  Write-Output 'No matching firewall rules found.'
}
