# Adds Claude Code's install location to the current user's PATH permanently,
# so the 'claude' command works in any new terminal (Antigravity, PowerShell, CMD).

$claudeBin = "C:\Users\barcl\.local\bin"
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")

if ($currentPath -notlike "*$claudeBin*") {
    [Environment]::SetEnvironmentVariable("Path", "$currentPath;$claudeBin", "User")
    Write-Host "Added $claudeBin to your user PATH." -ForegroundColor Green
    Write-Host "Close and reopen any terminal (including Antigravity's) for it to take effect." -ForegroundColor Yellow
} else {
    Write-Host "$claudeBin is already on your PATH." -ForegroundColor Yellow
}
