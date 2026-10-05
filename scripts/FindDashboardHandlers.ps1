$f = 'F:\aitradingagent\src\dashboard\public\index.html'
Write-Host "=== fetch calls ==="
Select-String -Path $f -Pattern "fetch\(" | ForEach-Object {
    Write-Host "$($_.LineNumber): $($_.Line.Trim())"
}
Write-Host ""
Write-Host "=== settings/allocation refs ==="
Select-String -Path $f -Pattern "settings|allocation" -CaseSensitive:$false | ForEach-Object {
    Write-Host "$($_.LineNumber): $($_.Line.Trim())"
}
