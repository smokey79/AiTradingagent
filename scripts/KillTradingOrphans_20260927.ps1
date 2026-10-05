$orphans = @(14136, 33844, 24244, 21256, 23904)
foreach ($p in $orphans) {
  try {
    $proc = Get-Process -Id $p -ErrorAction Stop
    Stop-Process -Id $p -Force
    Write-Output "Killed PID $p ($($proc.ProcessName))"
  } catch {
    Write-Output "PID $p not found (already gone) - $($_.Exception.Message)"
  }
}
