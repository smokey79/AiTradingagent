Write-Output '--- Tailscale IP ---'
& "C:\Program Files\Tailscale\tailscale.exe" ip -4

Write-Output ''
Write-Output '--- Tailscale status (connected devices) ---'
& "C:\Program Files\Tailscale\tailscale.exe" status

Write-Output ''
Write-Output '--- Network profile of active adapters ---'
Get-NetConnectionProfile | Select-Object InterfaceAlias, NetworkCategory | Format-Table -AutoSize | Out-String

Write-Output ''
Write-Output '--- Node.js inbound firewall rules ---'
$nodeRules = Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'Node' -or $_.DisplayName -match 'node.exe' }
if ($nodeRules) {
  $nodeRules | ForEach-Object { Write-Output "$($_.DisplayName) | Enabled=$($_.Enabled) | Direction=$($_.Direction) | Action=$($_.Action) | Profile=$($_.Profile)" }
} else {
  Write-Output 'No Node.js-specific firewall rules found.'
}
