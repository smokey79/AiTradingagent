# Hermes Global Service Runner

# Load Hermes .env
$envPath = "C:\Users\AlanJ\AppData\Local\hermes\hermes-agent\.env"
if (Test-Path $envPath) {
    foreach ($line in Get-Content $envPath) {
        if ($line -match "^\s*#" -or $line -match "^\s*$") { continue }
        $parts = $line -split "="
        if ($parts.Count -eq 2) {
            [Environment]::SetEnvironmentVariable($parts[0], $parts[1], "Process")
        }
    }
}

# Path to Hermes venv Python
$hermesPython = "C:\Users\AlanJ\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"

# Run Hermes in foreground so Windows SCM sees a running process
while ($true) {
    try {
        & $hermesPython -m hermes_cli.main serve --host 127.0.0.1 --port 11434
    } catch {
        Start-Sleep -Seconds 5
    }
}
