$files = @(
    'F:\aitradingagent\src\dashboard\server.js'
)
foreach ($f in $files) {
    Write-Host "=== $f ==="
    Select-String -Path $f -Pattern "app\.(get|post|put|delete)\(|router\.(get|post|put|delete)\(" | ForEach-Object {
        Write-Host "$($_.LineNumber): $($_.Line.Trim())"
    }
}
