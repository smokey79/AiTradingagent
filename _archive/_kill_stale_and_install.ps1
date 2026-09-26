Write-Host '=== Killing stale install script processes ==='
Stop-Process -Id 25952 -Force -ErrorAction SilentlyContinue
Stop-Process -Id 12064 -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host '=== Verifying installer file is usable ==='
$installerPath = Join-Path $env:TEMP 'OllamaSetup.exe'
try {
    $stream = [System.IO.File]::Open($installerPath, 'Open', 'Read', 'None')
    $stream.Close()
    Write-Host "File is free, size: $((Get-Item $installerPath).Length)"
} catch {
    Write-Host "File still locked or missing: $($_.Exception.Message)"
}
