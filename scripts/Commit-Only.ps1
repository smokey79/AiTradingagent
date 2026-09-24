# scripts/Commit-Only.ps1 - commit ONLY the listed files (anything else already staged stays staged, uncommitted).
# Usage: powershell.exe -ExecutionPolicy Bypass -File scripts\Commit-Only.ps1 -Title "..." -Body "..." -Files "a.js,b.js"
param([Parameter(Mandatory = $true)][string]$Title, [string]$Body = '', [Parameter(Mandatory = $true)][string]$Files)
Set-Location (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$list = @($Files.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($list | Where-Object { $_ -match '(^|/)\.env$' }) { Write-Host 'Refusing to commit .env'; exit 1 }
$msg = "$Title`n`n$Body`n`nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`nClaude-Session: https://claude.ai/code/session_01T1kkzj1Hx8J33qNfXLSAHi`n"
$tmp = Join-Path $env:TEMP 'commit_only_msg.txt'
[System.IO.File]::WriteAllText($tmp, $msg, (New-Object System.Text.UTF8Encoding($false)))
git add -- $list 2>$null | Out-Null
git commit --only -F $tmp -- $list 2>&1 | Select-Object -Last 1
Remove-Item $tmp
git show --stat --format="%h %s" HEAD | Select-Object -First 1 -Last 1
