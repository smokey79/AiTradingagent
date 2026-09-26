$body = @{ model = "llama3.2"; prompt = "Say hi in 3 words."; stream = $false } | ConvertTo-Json
try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/generate" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 45
    Write-Host "STATUS:" $resp.StatusCode
    Write-Host $resp.Content
} catch {
    Write-Host "ERROR:" $_.Exception.Message
    if ($_.Exception.Response) {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        Write-Host $reader.ReadToEnd()
    }
}
