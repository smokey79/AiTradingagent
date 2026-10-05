# flash_precheck_2026-09-29.ps1 - read-only: toolchain + RPC keys (masked) for the flash-loan simulator
"node: " + (node --version)
"npm: " + (npm --version)
foreach ($t in 'forge','anvil','git','bash') { $c = Get-Command $t -ErrorAction SilentlyContinue; "{0}: {1}" -f $t, $(if ($c) { $c.Source } else { 'not found' }) }
Get-Content F:\aitradingagent\.env | Where-Object { $_ -match '^(ALCHEMY|INFURA|QUICKNODE|ARBITRUM|ARB_RPC|RPC|ANKR|ETHERSCAN|ARBISCAN|WALLET|PRIVATE|DEFI|METAMASK)[A-Z_]*=' } |
  ForEach-Object { $k,$v = $_ -split '=',2; "$k=" + $(if ($v.Trim()) { if ($k -match 'URL|RPC' -and $v -notmatch 'key|/v2/|/v3/') { $v } else { '<set>' } } else { '<EMPTY>' }) }
$os = Get-CimInstance Win32_OperatingSystem; "RAM free: {0:N1} GB" -f ($os.FreePhysicalMemory/1MB)
"F: free: {0:N1} GB" -f ((Get-PSDrive F).Free/1GB)
