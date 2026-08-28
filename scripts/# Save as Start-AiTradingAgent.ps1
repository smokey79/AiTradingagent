# Save as Start-AiTradingAgent.ps1 (place in C:\Users\AlanJ\Scripts or project folder)
# Adjust paths below if your project is in a different location.

# --- Configuration ---
$ProjectRoot = "C:\Users\barcl\projects\AiTradingagent"
$NodeMcp1 = Join-Path $ProjectRoot "mcp-servers\trading-data-mcp"
$NodeMcp2 = Join-Path $ProjectRoot "mcp-servers\risk-gate-mcp"
$PythonCmd = "C:\Users\AlanJ\AppData\Local\Programs\Python\Python311\python.exe"  # change if different
$Orchestrator = Join-Path $ProjectRoot "orchestrator\consensus_engine.py"
$OrchArgs = "--symbol BTC/USDT --paper"
$LogDir = Join-Path $ProjectRoot "logs"
New-Item -Path $LogDir -ItemType Directory -Force | Out-Null

# --- Helper to start a Node MCP in a new window ---
function Start-NodeMcp {
    param($Folder, $Name, $Port)
    $StartInfo = @{
        FilePath = "powershell.exe"
        ArgumentList = "-NoExit","-Command","cd `"$Folder`"; npm start 2>&1 | Tee-Object -FilePath `"$LogDir\$Name.log`""
        WorkingDirectory = $Folder
    }
    Start-Process @StartInfo
}

# --- Start MCP servers (each opens a new PowerShell window) ---
Start-NodeMcp -Folder $NodeMcp1 -Name "trading-data-mcp" -Port 3001
Start-NodeMcp -Folder $NodeMcp2 -Name "risk-gate-mcp" -Port 3002

# --- Wait a few seconds for MCPs to boot ---
Start-Sleep -Seconds 6

# --- Start the Python orchestrator in a new window and log output ---
$pyArgs = "-NoExit -Command `"$PythonCmd `"$Orchestrator`" $OrchArgs 2>&1 | Tee-Object -FilePath `"$LogDir\orchestrator.log`"`""
Start-Process -FilePath "powershell.exe" -ArgumentList $pyArgs -WorkingDirectory $ProjectRoot

# --- Optional: write a small status file for UI or monitoring ---
"Started at $(Get-Date -Format o)" | Out-File -FilePath (Join-Path $LogDir "last_start.txt") -Encoding utf8
