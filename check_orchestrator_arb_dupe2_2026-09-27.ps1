$lines = Get-Content C:\Users\barcl\.pm2\logs\trading-orchestrator-out.log -Tail 200
$arbLines = $lines | Select-String -Pattern 'ArbEngine\] Scan #|ArbEngine\] .*STARTED'
$arbLines | Select-Object -Last 30
