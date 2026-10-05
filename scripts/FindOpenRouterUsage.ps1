Get-ChildItem -Path F:\aitradingagent\src -Recurse -Include *.js | Select-String -Pattern "openrouterFreeAgent" | ForEach-Object {
    Write-Host "$($_.Path):$($_.LineNumber): $($_.Line.Trim())"
}
