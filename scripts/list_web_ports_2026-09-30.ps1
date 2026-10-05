# Lists local web servers (listening TCP ports) and which program owns each. Read-only.
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalAddress -in '0.0.0.0','127.0.0.1','::','::1' -and $_.LocalPort -ge 3000 -and $_.LocalPort -le 9999 } |
  Sort-Object LocalPort -Unique |
  ForEach-Object {
    $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    "{0,-6} {1}" -f $_.LocalPort, $p.ProcessName
  }
docker ps --format "docker: {{.Names}} {{.Ports}}" 2>$null
