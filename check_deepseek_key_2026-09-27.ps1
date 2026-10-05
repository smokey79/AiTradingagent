$line = Select-String -Path F:\aitradingagent\.env -Pattern '^DEEPSEEK_API_KEY='
if ($line) {
    $val = ($line.Line -split '=',2)[1]
    if ([string]::IsNullOrWhiteSpace($val) -or $val.StartsWith('your_')) {
        Write-Output "DEEPSEEK_API_KEY_PLACEHOLDER_OR_EMPTY"
    } else {
        Write-Output "DEEPSEEK_API_KEY_SET"
    }
} else {
    Write-Output "DEEPSEEK_API_KEY_MISSING"
}
$orLine = Select-String -Path F:\aitradingagent\.env -Pattern '^OPENROUTER_API_KEY'
if ($orLine) {
    Write-Output "OPENROUTER_KEY_PRESENT"
} else {
    Write-Output "OPENROUTER_KEY_MISSING"
}
