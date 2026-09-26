$ErrorActionPreference = 'Stop'
$mvn = 'F:\aitradingagent\tools\apache-maven-3.9.16\bin\mvn.cmd'
Set-Location 'F:\aitradingagent\tools\jedai-match'
Write-Host 'Building jedai-match.jar (downloads JedAI + deps from Maven Central once)...'
& $mvn -q package
if ($LASTEXITCODE -ne 0) {
    Write-Host "BUILD FAILED (exit $LASTEXITCODE)" -ForegroundColor Red
    exit 1
}
if (Test-Path 'target\jedai-match.jar') {
    Write-Host "BUILD OK: target\jedai-match.jar" -ForegroundColor Green
} else {
    Write-Host "BUILD claimed success but jar missing." -ForegroundColor Red
}
