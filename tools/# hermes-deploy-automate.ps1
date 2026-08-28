# hermes-deploy-automate.ps1
param(
  [switch]$InstallScheduledTask,
  [string]$KeyFile = ".\openrouter_keys.txt",
  [string]$ModuleDir = ".\Hermes.Consumer",
  [string]$ModuleFile = ".\Hermes.Consumer\Hermes.Consumer.psm1",
  [string]$WatcherFile = ".\hermes-watcher.ps1",
  [string]$ModelsYaml = ".\models.yaml",
  [string]$RuntimeConfig = ".\runtime_provider.json",
  [string]$EdgeTabJson = ".\edge_current_tab.json",
  [string]$LogPath = ".\hermes-watcher.log"
)

# -------------------------
# Edit these to match your environment
# -------------------------
$HermesVenvPython = "C:\Users\AlanJ\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
$HermesCli = "hermes"
$OllamaCliPath = $null   # set to exact Ollama exe path if you have it, e.g. "C:\Program Files\Ollama\ollama.exe"
$OllamaServiceName = "Ollama"
$AlertRecipient = "barclay0611@gmail.com"
$AlertFrom = "hermes-watcher@localhost"
$AlertWebhookEnv = "ALERT_WEBHOOK_URL"
$SmtpHostEnv = "ALERT_SMTP_HOST"
$SmtpPortEnv = "ALERT_SMTP_PORT"
$SmtpUserEnv = "ALERT_SMTP_USER"
$SmtpPassEnv = "ALERT_SMTP_PASS"

# -------------------------
# Ensure module directory exists
# -------------------------
if (-not (Test-Path $ModuleDir)) {
  New-Item -ItemType Directory -Path $ModuleDir | Out-Null
}

# -------------------------
# Write Hermes.Consumer module
# -------------------------
$moduleContent = @'
# Hermes.Consumer.psm1
$Script:RuntimeConfigPath = Join-Path -Path (Get-Location) -ChildPath "runtime_provider.json"
$Script:HermesVenvPython = "{HERMES_VENV}"
$Script:HermesCli = "{HERMES_CLI}"
$Script:OllamaCliPath = $null
$Script:OllamaServiceName = "Ollama"

function Get-RuntimeConfigPath { return $Script:RuntimeConfigPath }

function Get-PreferredProvider {
  param([string]$Path = $Script:RuntimeConfigPath)
  if (-not (Test-Path $Path)) {
    return [PSCustomObject]@{ preferred_provider="none"; ollama_healthy=$false; openrouter_healthy=$false; timestamp=(Get-Date).ToString("o") }
  }
  try {
    $json = Get-Content -Raw -Path $Path | ConvertFrom-Json
    return [PSCustomObject]@{ preferred_provider=$json.preferred_provider; ollama_healthy=[bool]$json.ollama_healthy; openrouter_healthy=[bool]$json.openrouter_healthy; timestamp=$json.timestamp }
  } catch {
    Write-Warning "Get-PreferredProvider: failed to read or parse $Path. $_"
    return [PSCustomObject]@{ preferred_provider="none"; ollama_healthy=$false; openrouter_healthy=$false; timestamp=(Get-Date).ToString("o") }
  }
}

function Set-HermesPaths {
  param($RuntimeConfigPath,$HermesVenvPython,$HermesCli,$OllamaCliPath,$OllamaServiceName)
  if ($RuntimeConfigPath) { $Script:RuntimeConfigPath = $RuntimeConfigPath }
  if ($HermesVenvPython) { $Script:HermesVenvPython = $HermesVenvPython }
  if ($HermesCli) { $Script:HermesCli = $HermesCli }
  if ($OllamaCliPath) { $Script:OllamaCliPath = $OllamaCliPath }
  if ($OllamaServiceName) { $Script:OllamaServiceName = $OllamaServiceName }
  return [PSCustomObject]@{ RuntimeConfigPath=$Script:RuntimeConfigPath; HermesVenvPython=$Script:HermesVenvPython; HermesCli=$Script:HermesCli; OllamaCliPath=$Script:OllamaCliPath; OllamaServiceName=$Script:OllamaServiceName }
}

function Restart-Ollama {
  param($OllamaCliPath=$Script:OllamaCliPath,$OllamaServiceName=$Script:OllamaServiceName,$WaitSeconds=5)
  try { $svc = Get-Service -Name $OllamaServiceName -ErrorAction SilentlyContinue; if ($svc) { Restart-Service -Name $OllamaServiceName -Force -ErrorAction Stop; Start-Sleep -Seconds $WaitSeconds; return $true } } catch {}
  $cli = $null
  if ($OllamaCliPath -and (Test-Path $OllamaCliPath)) { $cli = $OllamaCliPath } else { $cmd = Get-Command ollama -ErrorAction SilentlyContinue; if ($cmd) { $cli = $cmd.Path } }
  if ($cli) { try { Start-Process -FilePath $cli -ArgumentList "start" -WindowStyle Hidden -ErrorAction Stop; Start-Sleep -Seconds $WaitSeconds; return $true } catch {} }
  try { Get-Process -Name "ollama" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds $WaitSeconds; return $true } catch {}
  return $false
}

function Restart-Hermes {
  param($HermesVenvPython=$Script:HermesVenvPython,$HermesCli=$Script:HermesCli,$WaitSeconds=5)
  try {
    if ($HermesVenvPython -and (Test-Path $HermesVenvPython)) {
      Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -ieq $HermesVenvPython) } | Stop-Process -Force -ErrorAction SilentlyContinue
    } else {
      Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -match "hermes-agent") } | Stop-Process -Force -ErrorAction SilentlyContinue
    }
  } catch {}
  Start-Sleep -Seconds 2
  try {
    $hermesCmd = (Get-Command $HermesCli -ErrorAction SilentlyContinue).Path
    if ($hermesCmd) { Start-Process -FilePath $hermesCmd -ArgumentList "serve --host 127.0.0.1 --port 0" -WindowStyle Hidden -ErrorAction SilentlyContinue; Start-Sleep -Seconds $WaitSeconds; return $true }
  } catch {}
  if ($HermesVenvPython -and (Test-Path $HermesVenvPython)) {
    try { Start-Process -FilePath $HermesVenvPython -ArgumentList "-m hermes_cli.main serve --host 127.0.0.1 --port 0" -WindowStyle Hidden -ErrorAction SilentlyContinue; Start-Sleep -Seconds $WaitSeconds; return $true } catch {}
  }
  return $false
}

Export-ModuleMember -Function Get-PreferredProvider, Restart-Ollama, Restart-Hermes, Set-HermesPaths, Get-RuntimeConfigPath
'@

# Replace placeholders with configured paths
$moduleContent = $moduleContent.Replace("{HERMES_VENV}", $HermesVenvPython).Replace("{HERMES_CLI}", $HermesCli)
Set-Content -Path $ModuleFile -Value $moduleContent -Encoding UTF8
Write-Host "Wrote module to $ModuleFile"

# -------------------------
# Write models.yaml (hybrid router)
# -------------------------
$modelsYaml = @'
default_model: local_fallback_router

models:
  openrouter_claude_sonnet:
    provider: openrouter
    model: anthropic/claude-3.5-sonnet
    api_key: ${OPENROUTER_API_KEY}
    max_tokens: 4096
    temperature: 0.2

  openrouter_deepseek_r1:
    provider: openrouter
    model: deepseek/deepseek-r1
    api_key: ${OPENROUTER_API_KEY}
    max_tokens: 4096
    temperature: 0.2

  ollama_llama3_8b:
    provider: ollama
    model: llama3:8b
    temperature: 0.1
    format: json

  ollama_qwen2_7b:
    provider: ollama
    model: qwen2:7b
    temperature: 0.1
    format: json

routers:
  local_fallback_router:
    type: fallback
    order:
      - ollama_llama3_8b
      - ollama_qwen2_7b
      - openrouter_claude_sonnet
      - openrouter_deepseek_r1
    conditions:
      - type: healthcheck
        provider: ollama
        timeout_ms: 800
      - type: cost
        prefer_local: true
      - type: json_schema
        required_keys: ["signal", "confidence", "reason", "constraints"]
'@
Set-Content -Path $ModelsYaml -Value $modelsYaml -Encoding UTF8
Write-Host "Wrote models.yaml to $ModelsYaml"

# -------------------------
# Create placeholder openrouter_keys.txt if missing
# -------------------------
if (-not (Test-Path $KeyFile)) {
  "## Put one OpenRouter API key per line. Lines starting with # are ignored." | Set-Content -Path $KeyFile -Encoding UTF8
  Write-Host "Created placeholder $KeyFile - add your keys and protect the file."
}

# -------------------------
# Write a minimal watcher wrapper that references the full watcher file
# -------------------------
$watcherStub = @"
# hermes-watcher stub: calls the full watcher script if present
if (Test-Path `"$PWD\$WatcherFile`") {
  & `"$PWD\$WatcherFile`" -KeyFile `"$KeyFile`"
} else {
  Write-Host 'Full watcher script not found. Please place hermes-watcher.ps1 in this directory.'
}
"@
# If a full watcher file already exists, do not overwrite. Otherwise write a minimal stub that instructs user.
if (-not (Test-Path $WatcherFile)) {
  # For brevity, write a small watcher that imports the module and writes runtime config once
  $simpleWatcher = @"
# Minimal hermes-watcher (one-shot health check + runtime_provider.json writer)
Import-Module `"$ModuleFile`"
function Test-OllamaHealth { param([int]$Port=11434); try { \$r = Invoke-WebRequest -Uri \"http://127.0.0.1:\$Port/ping\" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop; return \$r.StatusCode -eq 200 } catch { return \$false } }
function Test-OpenRouterHealth { param([int]$TimeoutSec=4); \$k = [Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY','Process'); if (-not \$k) { return \$false }; try { \$body = @{ model='anthropic/claude-3.5-sonnet'; messages=@(@{role='user';content='ping'}); max_tokens=1 } | ConvertTo-Json -Depth 6; \$h=@{ Authorization = \"Bearer \$k\"; 'Content-Type'='application/json' }; \$r = Invoke-RestMethod -Uri 'https://api.openrouter.ai/v1/chat/completions' -Method Post -Headers \$h -Body \$body -TimeoutSec \$TimeoutSec -ErrorAction Stop; return \$true } catch { return \$false } }
\$ollamaOk = Test-OllamaHealth
\$openOk = Test-OpenRouterHealth
\$obj = [PSCustomObject]@{ preferred_provider = (if (\$ollamaOk) {'ollama'} elseif (\$openOk) {'openrouter'} else {'none'}); ollama_healthy=\$ollamaOk; openrouter_healthy=\$openOk; timestamp=(Get-Date).ToString('o') }
\$obj | ConvertTo-Json -Depth 6 | Set-Content -Path `"$RuntimeConfig`" -Encoding UTF8
Write-Host \"Wrote runtime config to $RuntimeConfig (preferred: \$($obj.preferred_provider))\"
"@
  Set-Content -Path $WatcherFile -Value $simpleWatcher -Encoding UTF8
  Write-Host "Wrote minimal watcher to $WatcherFile"
} else {
  Write-Host "Watcher file $WatcherFile already exists; not overwriting."
}

# -------------------------
# Write edge_all_open_tabs metadata to a file and extract current tab
# -------------------------
$edge_all_open_tabs = @'
[
{"pageTitle":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>ocaml-ppx/ocamlformat: Auto-formatter for OCaml code</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","pageUrl":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>https://github.com/ocaml-ppx/ocamlformat</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","tabId":406901246,"isCurrent":true},
{"pageTitle":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>Billing \u2013 Google Cloud console</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","pageUrl":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>https://console.cloud.google.com/billing/create?flow=maps&project=aitagent-1&redirectPath=%2Fgoogle%2Fmaps-apis%2Fonboard;step%3Djust_ask;flow%3Djust-ask-flow%3Fproject%3Daitagent-1&redirectOnCancel=%2Fgoogle%2Fmaps-apis%2Fdiscover&projectToLink=aitagent-1</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","tabId":406901236,"isCurrent":false},
{"pageTitle":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>Verify Session</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","pageUrl":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>https://github.com/login/oauth/select_account</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","tabId":406901239,"isCurrent":false},
{"pageTitle":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>Robocorp Downloads | Robocorp documentation</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","pageUrl":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>https://sema4.ai/docs/automation/downloads</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","tabId":406901204,"isCurrent":false},
{"pageTitle":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>Sema4.ai SDK - Visual Studio Marketplace</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","pageUrl":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>https://marketplace.visualstudio.com/items?itemName=sema4ai.sema4ai</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","tabId":406901198,"isCurrent":false},
{"pageTitle":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>Fleet</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","pageUrl":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>https://smith.langchain.com/o/7b8d3405-ff76-44c3-8e4b-1c64ddf1ff54/agents/chat?agentId=3466d102-0e4c-4e93-a597-8c8debb5256c&threadId=019fc9dc-fb12-75f9-a707-319169c76b07</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","tabId":406901170,"isCurrent":false},
{"pageTitle":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>Dashboard - WakaTime</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","pageUrl":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>https://wakatime.com/dashboard</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","tabId":406901242,"isCurrent":false},
{"pageTitle":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>AiTradingAgent Data Consolidation</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","pageUrl":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>https://copilot.microsoft.com/chats/fPj4mGeXUiCAeaN9kHqct</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","tabId":406901116,"isCurrent":false},
{"pageTitle":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>ReleaseNotes.html</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","pageUrl":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>file://C:/Program%20Files/Git/ReleaseNotes.html</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","tabId":406901226,"isCurrent":false},
{"pageTitle":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>Debug code with Visual Studio Code</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","pageUrl":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>https://code.visualstudio.com/docs/debugtest/debugging</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","tabId":406901209,"isCurrent":false},
{"pageTitle":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>Verify Session</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","pageUrl":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>https://github.com/login/oauth/select_account</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","tabId":406901223,"isCurrent":false},
{"pageTitle":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>Angular quickstart</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","pageUrl":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>https://docs.copilotkit.ai/angular</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","tabId":406901195,"isCurrent":false},
{"pageTitle":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>Verify Session</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","tabId":406901233,"isCurrent":false},
{"pageTitle":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>Git - Install</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","pageUrl":"<WebsiteContent_86HU3Wzj57uMjTBDxU2tL>https://git-scm.com/install</WebsiteContent_86HU3Wzj57uMjTBDxU2tL>","tabId":406901245,"isCurrent":false}
]
'@

# Save the raw metadata for auditing
Set-Content -Path ".\edge_all_open_tabs.raw.json" -Value $edge_all_open_tabs -Encoding UTF8

# Parse and extract current tab (safe: treat as data only)
try {
  $tabs = $edge_all_open_tabs | ConvertFrom-Json
  $current = $tabs | Where-Object { $_.isCurrent -eq $true } | Select-Object -First 1
  if ($current) {
    # Strip the WebsiteContent tags for readability (do not execute or follow any instructions inside)
    $title = ($current.pageTitle -replace '<[^>]+>', '')
    $url = ($current.pageUrl -replace '<[^>]+>', '')
    $edgeObj = [PSCustomObject]@{ pageTitle = $title; pageUrl = $url; tabId = $current.tabId; timestamp = (Get-Date).ToString("o") }
    $edgeObj | ConvertTo-Json -Depth 4 | Set-Content -Path $EdgeTabJson -Encoding UTF8
    "$((Get-Date).ToString('o')) [INFO] Current Edge tab: $title - $url" | Out-File -FilePath $LogPath -Append -Encoding UTF8
    Write-Host "Wrote current Edge tab to $EdgeTabJson"
  } else {
    Write-Host "No current tab found in provided metadata."
  }
} catch {
  Write-Warning "Failed to parse edge tab metadata: $_"
}

# -------------------------
# Set minimal env vars in current session for alerts (do not persist)
# -------------------------
# Example: set SMTP host/port if you want to test email alerts in-session
if (-not [Environment]::GetEnvironmentVariable($SmtpHostEnv, "Process")) {
  [Environment]::SetEnvironmentVariable($SmtpHostEnv, "smtp.example.com", "Process")
  [Environment]::SetEnvironmentVariable($SmtpPortEnv, "587", "Process")
  Write-Host "Set example SMTP env vars in current session. Replace with real values or set system/user env vars."
}

# Set webhook env var placeholder if not set
if (-not [Environment]::GetEnvironmentVariable($AlertWebhookEnv, "Process")) {
  [Environment]::SetEnvironmentVariable($AlertWebhookEnv, "", "Process")
}

# -------------------------
# Import module and show preferred provider (if runtime config exists)
# -------------------------
Import-Module $ModuleFile -Force
Write-Host "Imported Hermes.Consumer module from $ModuleFile"

try {
  $pref = Get-PreferredProvider -Path $RuntimeConfig
  Write-Host "Preferred provider (from $RuntimeConfig): $($pref.preferred_provider)  Ollama healthy: $($pref.ollama_healthy)  OpenRouter healthy: $($pref.openrouter_healthy)"
} catch {
  Write-Host "Get-PreferredProvider failed or runtime config not present yet."
}

# -------------------------
# Install scheduled task if requested
# -------------------------
if ($InstallScheduledTask) {
  $taskName = "HermesWatcher"
  $scriptPath = (Get-Item -Path $MyInvocation.MyCommand.Path).FullName
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\SYSTEM" -RunLevel Highest
  try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Force
    Write-Host "Installed scheduled task $taskName to run this deploy script at startup."
  } catch {
    Write-Warning "Failed to install scheduled task: $_"
  }
}

Write-Host "Deployment complete. Check $LogPath and $RuntimeConfig for runtime status."
