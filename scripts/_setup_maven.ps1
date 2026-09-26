$ErrorActionPreference = 'Stop'
$toolsDir = 'F:\aitradingagent\tools'
New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null

$zipUrl = 'https://dlcdn.apache.org/maven/maven-3/3.9.16/binaries/apache-maven-3.9.16-bin.zip'
$zipPath = Join-Path $toolsDir 'maven.zip'

if (Test-Path (Join-Path $toolsDir 'apache-maven-3.9.16\bin\mvn.cmd')) {
    Write-Host "Maven already present."
} else {
    Write-Host "Downloading Maven..."
    Invoke-WebRequest -UseBasicParsing -Uri $zipUrl -OutFile $zipPath -TimeoutSec 120
    Write-Host "Extracting..."
    Expand-Archive -Path $zipPath -DestinationPath $toolsDir -Force
    Remove-Item $zipPath -Force
    Write-Host "Done."
}

$mvnCmd = Join-Path $toolsDir 'apache-maven-3.9.16\bin\mvn.cmd'
if (Test-Path $mvnCmd) {
    Write-Host "Maven ready at: $mvnCmd"
    & $mvnCmd -v
} else {
    Write-Host "ERROR: mvn.cmd not found after extraction."
}
