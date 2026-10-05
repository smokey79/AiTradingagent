$ids = 32660,21368,27268,13916,29424,31864,22584
foreach ($id in $ids) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
    if ($p) {
        Write-Host "PID=$id CMD=$($p.CommandLine)"
    } else {
        Write-Host "PID=$id NOT FOUND (already exited)"
    }
}
