<#
hermes-hybrid-setup.ps1
Hybrid Ollama/OpenRouter config writer + key rotation + runtime provider health fallback.

Usage examples:
  .\hermes-hybrid-setup.ps1 -Action WriteConfig
  .\hermes-hybrid-setup.ps1 -Action RotateKey -KeyFile ".\openrouter_keys.txt" -RunHealthCheck
  .\hermes-hybrid-setup.ps1 -Action RotateKey -KeyFile ".\openrouter_keys.txt" -RunHealthCheck -RunHermesUpdate

Outputs:
  - models.yaml
  - runtime_provider.json  <-- runtime health + preferred provider
  - .openrouter_key_index  <-- rotation state
#>

param(
  [ValidateSet("WriteConfig","RotateKey","HealthCheck","RunHermesUpdate","All")]
  [string]$Action = "All",

  [string]$ConfigPath = ".\models.yaml",

  [string]$KeyFile = "",

  [switch]$RunHealthCheck,

  [switch]$RunHermesUpdate,

  [int]$OllamaHealthPort = 11434,

  [int]$OllamaTimeoutMs = 800,

  [int]$OpenRouterTimeoutSec = 4,

  [string]$OpenRouterTestModel = "anthropic/claude-3.5-sonnet"
)

# -------------------------
# Helper: Read API keys
# -------------------------
function Read-ApiKeysFromFile {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return @() }
  Get-Content $Path | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith("#") }
}

function Read-ApiKeysFromEnv {
  param([string]$EnvVarName = "OPENROUTER_KEYS")
  $val = [Environment]::GetEnvironmentVariable($EnvVarName, "User")
  if (-not $val) { $val = [Environment]::GetEnvironmentVariable($EnvVarName, "Process") }
  if (-not $val) { return @() }
  $val.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
}

function Get-ApiKeys {
  param([string]$KeyFile)
  if ($KeyFile -and (Test-Path $KeyFile)) {
    return Read-ApiKeysFromFile -Path $KeyFile
  }
  $fromEnv = Read-ApiKeysFromEnv
  return $fromEnv
}

# -------------------------
# Helper: Rotate API key
# -------------------------
function Rotate-ApiKey {
  param([string]$KeyFile)
  $keys = Get-ApiKeys -KeyFile $KeyFile
  if (-not $keys -or $keys.Count -eq 0) {
    Write-Warning "No OpenRouter API keys found in file or OPENROUTER_KEYS environment variable."
    return $null
  }

  $stateFile = Join-Path -Path (Get-Location) -ChildPath ".openrouter_key_index"
  $index = 0
  if (Test-Path $stateFile) {
    try { $index = [int](Get-Content $stateFile) } catch { $index = 0 }
  }

  $index = ($index + 1) % $keys.Count
  Set-Content -Path $stateFile -Value $index -Encoding UTF8

  $selected = $keys[$index]
  [Environment]::SetEnvironmentVariable("OPENROUTER_API_KEY", $selected, "Process")
  Write-Host "Rotated OPENROUTER_API_KEY to key index $index"
  return $selected
}

# -------------------------
# Write models.yaml
# -------------------------
function Write-ModelsYaml {
  param([string]$Path)
  $yaml = @'
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

  $yaml | Set-Content -Path $Path -Encoding UTF8
  Write-Host "Wrote models.yaml to $Path"
}

# -------------------------
# Health checks
# -------------------------
function Test-OllamaHealth {
  param([int]$Port = 11434, [int]$TimeoutMs = 800)
  $url = "http://127.0.0.1:$Port/ping"
  try {
    $wc = New-Object System.Net.WebClient
    $wc.Proxy = $null
    $wc.Encoding = [System.Text.Encoding]::UTF8
    $req = [System.Net.WebRequest]::Create($url)
    $req.Method = "GET"
    $req.Timeout = $TimeoutMs
    $resp = $req.GetResponse()
    if ($resp.StatusCode -eq 200) {
      return $true
    }
  } catch {
    return $false
  }
}

function Test-OpenRouterHealth {
  param([int]$TimeoutSec = 4, [string]$ApiKey = $null, [string]$TestModel = "anthropic/claude-3.5-sonnet")
  # Lightweight test: call the OpenRouter model metadata or a minimal completion endpoint.
  # If OpenRouter exposes a model list endpoint, prefer that; otherwise do a tiny completion with max_tokens=1.
  if (-not $ApiKey) {
    $ApiKey = [Environment]::GetEnvironmentVariable("OPENROUTER_API_KEY", "Process")
    if (-not $ApiKey) {
      Write-Verbose "No OPENROUTER_API_KEY in process environment."
      return $false
    }
  }

  # Example OpenRouter test URL pattern (may vary by provider). Use a minimal completion call.
  $url = "https://api.openrouter.ai/v1/chat/completions"
  $body = @{
    model = $TestModel
    messages = @(@{role="user"; content="ping"})
    max_tokens = 1
    temperature = 0.0
  } | ConvertTo-Json -Depth 6

  try {
    $headers = @{ "Authorization" = "Bearer $ApiKey"; "Content-Type" = "application/json" }
    $resp = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body -TimeoutSec $TimeoutSec -ErrorAction Stop
    # If we get a valid JSON response with choices or id, consider healthy
    if ($resp -and ($resp.choices -or $resp.id)) {
      return $true
    }
  } catch {
    return $false
  }
  return $false
}

# -------------------------
# Runtime provider config writer
# -------------------------
function Write-RuntimeProviderConfig {
  param(
    [bool]$OllamaHealthy,
    [bool]$OpenRouterHealthy,
    [string]$Path = ".\runtime_provider.json"
  )

  $preferred = if ($OllamaHealthy) { "ollama" } elseif ($OpenRouterHealthy) { "openrouter" } else { "none" }

  $obj = [PSCustomObject]@{
    preferred_provider = $preferred
    ollama_healthy     = $OllamaHealthy
    openrouter_healthy = $OpenRouterHealthy
    timestamp          = (Get-Date).ToString("o")
  }

  $tmp = "$Path.tmp"
  $obj | ConvertTo-Json -Depth 6 | Set-Content -Path $tmp -Encoding UTF8
  Move-Item -Force -Path $tmp -Destination $Path
  Write-Host "Wrote runtime provider config to $Path (preferred: $preferred)"
}

# -------------------------
# Safe hermes update
# -------------------------
function Safe-HermesUpdate {
  Write-Host "Running hermes update in safe mode..."
  try {
    & hermes update
  } catch {
    Write-Warning "hermes update failed. If you see locked files, close Hermes Desktop and retry."
  }
}

# -------------------------
# Main dispatcher
# -------------------------
if ($Action -in @("WriteConfig","All")) {
  Write-ModelsYaml -Path $ConfigPath
}

if ($Action -in @("RotateKey","All")) {
  $newKey = Rotate-ApiKey -KeyFile $KeyFile
  if ($newKey) {
    Write-Host "OPENROUTER_API_KEY exported to current session."
  }
  if ($RunHealthCheck) {
    $ollamaOk = Test-OllamaHealth -Port $OllamaHealthPort -TimeoutMs $OllamaTimeoutMs
    $openOk = Test-OpenRouterHealth -TimeoutSec $OpenRouterTimeoutSec -ApiKey $newKey -TestModel $OpenRouterTestModel
    Write-RuntimeProviderConfig -OllamaHealthy $ollamaOk -OpenRouterHealthy $openOk
  }
  if ($RunHermesUpdate) {
    Safe-HermesUpdate
  }
}

if ($Action -eq "HealthCheck") {
  $ollamaOk = Test-OllamaHealth -Port $OllamaHealthPort -TimeoutMs $OllamaTimeoutMs
  $openOk = Test-OpenRouterHealth -TimeoutSec $OpenRouterTimeoutSec
  Write-RuntimeProviderConfig -OllamaHealthy $ollamaOk -OpenRouterHealthy $openOk
  if (-not $ollamaOk) { Write-Host "Ollama not reachable. runtime_provider.json will prefer OpenRouter if healthy." }
}

if ($Action -eq "RunHermesUpdate") {
  Safe-HermesUpdate
}

Write-Host "Done."
