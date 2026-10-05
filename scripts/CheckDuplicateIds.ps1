$f = 'F:\aitradingagent\src\dashboard\public\index.html'
$content = Get-Content -Path $f -Raw
$matches = [regex]::Matches($content, 'id="([^"]+)"')
$ids = $matches | ForEach-Object { $_.Groups[1].Value }
$dupes = $ids | Group-Object | Where-Object { $_.Count -gt 1 }
if ($dupes) {
    Write-Host "=== DUPLICATE IDS ==="
    $dupes | ForEach-Object { Write-Host "$($_.Name) x$($_.Count)" }
} else {
    Write-Host "No duplicate IDs found."
}

Write-Host ""
Write-Host "=== buttons without addEventListener or onclick ==="
$btnMatches = [regex]::Matches($content, '<button[^>]*id="([^"]+)"[^>]*>')
foreach ($m in $btnMatches) {
    $id = $m.Groups[1].Value
    $full = $m.Value
    $hasOnclick = $full -match 'onclick='
    $hasListener = $content -match "getElementById\('$id'\)\.addEventListener" -or $content -match "getElementById\(`"$id`"\)\.addEventListener"
    if (-not $hasOnclick -and -not $hasListener) {
        Write-Host "UNWIRED: $id"
    }
}
