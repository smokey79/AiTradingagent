$now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
Write-Output "now_ms=$now"
$generatedAt = 1790467796406
$diffMs = $now - $generatedAt
$diffHrs = [math]::Round($diffMs / 3600000, 2)
Write-Output "diff_hours=$diffHrs"
