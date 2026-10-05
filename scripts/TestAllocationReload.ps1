$get1 = Invoke-RestMethod -Uri "http://localhost:3001/api/settings/allocation" -Method Get
Write-Host "BEFORE: $($get1.settings | ConvertTo-Json -Compress)"

$body = @{
    baseCurrency = $get1.settings.baseCurrency
    defaultAllocationPct = $get1.settings.defaultAllocationPct
    overrideAllocationPct = $get1.settings.overrideAllocationPct
    memeAllocationPct = $get1.settings.memeAllocationPct
} | ConvertTo-Json

$post = Invoke-RestMethod -Uri "http://localhost:3001/api/settings/allocation" -Method Post -Body $body -ContentType "application/json"
Write-Host "POST RESPONSE: $($post.settings | ConvertTo-Json -Compress)"

Start-Sleep -Seconds 4
Write-Host ""
Write-Host "=== risk-gate log tail (looking for reload message) ==="
pm2 logs risk-gate --lines 15 --nostream
