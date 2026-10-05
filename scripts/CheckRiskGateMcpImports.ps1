Select-String -Path "F:\aitradingagent\mcp-servers\risk-gate-mcp\index.js" -Pattern "require\(" | ForEach-Object {
    Write-Host "$($_.LineNumber): $($_.Line.Trim())"
}
