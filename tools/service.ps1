# Windows service loop for AiTradingAgent
Import-Module .\Hermes.Consumer\Hermes.Consumer.psm1

Write-Host "Starting AiTradingAgent service loop..."

while ($true) {
    try {
        node orchestratorRunner.js
    } catch {
        Write-Warning "Node orchestrator crashed — restarting Hermes + Ollama"
        Restart-Hermes
        Restart-Ollama
    }

    Start-Sleep -Seconds 30
}
