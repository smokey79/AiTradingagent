Get-BitsTransfer | Select-Object JobId, JobState, DisplayName,
    @{n='MB_Done';e={[math]::Round($_.BytesTransferred/1MB,1)}},
    @{n='MB_Total';e={ if ($_.BytesTotal -gt 0 -and $_.BytesTotal -lt 100GB) { [math]::Round($_.BytesTotal/1MB,1) } else { '?' } }}
