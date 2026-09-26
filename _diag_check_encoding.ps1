$bytes = [System.IO.File]::ReadAllBytes("F:\aitradingagent\bridge\python_to_node.py")
$first20 = $bytes[0..19]
Write-Output ("First 20 bytes (hex): " + (($first20 | ForEach-Object { $_.ToString("X2") }) -join " "))
Write-Output ("File size: " + $bytes.Length)
