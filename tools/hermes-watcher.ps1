# Load global Hermes .env
$envPath = "C:\Users\AlanJ\AppData\Local\hermes\hermes-agent\.env"

if (Test-Path $envPath) {
    foreach ($line in Get-Content $envPath) {
        if ($line -match "^\s*#" -or $line -match "^\s*$") { continue }
        $parts = $line -split "=", 2
        if ($parts.Count -eq 2) {
            [Environment]::SetEnvironmentVariable($parts[0], $parts[1], "Process")
        }
    }
}
# Global Hermes service runner
$hermesPython = "C:\Users\AlanJ\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"

while ($true) {
    try {
        Start-Process $hermesPython -ArgumentList "-m hermes_cli.main serve --host 127.0.0.1 --port 0" -WindowStyle Hidden
        Start-Sleep -Seconds 10
    } catch {
        Start-Sleep -Seconds 5
    }
}
