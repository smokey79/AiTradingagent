function Get-ActiveProvider {
    param(
        [string]$RuntimeConfigPath = ".\runtime_provider.json"
    )

    if (-not (Test-Path $RuntimeConfigPath)) {
        Write-Warning "runtime_provider.json not found. Defaulting to 'none'."
        return "none"
    }

    try {
        $json = Get-Content $RuntimeConfigPath -Raw | ConvertFrom-Json
    } catch {
        Write-Warning "runtime_provider.json is malformed. Defaulting to 'none'."
        return "none"
    }

    if (-not $json.preferred_provider) {
        Write-Warning "runtime_provider.json missing preferred_provider. Defaulting to 'none'."
        return "none"
    }

    return $json.preferred_provider
}
