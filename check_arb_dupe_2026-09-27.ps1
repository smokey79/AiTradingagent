$lines = Get-Content C:\Users\barcl\.pm2\logs\trading-orchestrator-out.log -Tail 400
$arbLines = $lines | Select-String -Pattern 'ArbEngine\] Scan #|ARB EXECUTED'
$arbLines | Select-Object -Last 40
