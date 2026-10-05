# Fetches the page title of each local python web server so we know what it is. Read-only.
foreach ($port in 3680, 8081) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 5
    $t = [regex]::Match($r.Content, '<title>(.*?)</title>', 'IgnoreCase').Groups[1].Value
    "{0}: HTTP {1} title '{2}'" -f $port, $r.StatusCode, $t
  } catch { "{0}: {1}" -f $port, $_.Exception.Message }
  $procId = (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
  $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue).CommandLine
  "   started by: $cmd"
}
