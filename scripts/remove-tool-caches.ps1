# Removes leftover editor-extension cache folders confirmed to hold no unique
# project data (verified by hand before deleting):
#   .adsum/  - Adsum IoT Coder's workspace file-map + notes cache (auto-regenerated;
#              MAP.md is just an index of files that already exist elsewhere)
#   .savyre/ - Savyre session-index.json, an empty session list (no sessions recorded)

$targets = @(".adsum", ".savyre")
foreach ($t in $targets) {
    $path = Join-Path $PSScriptRoot "..\$t"
    if (Test-Path $path) {
        Remove-Item -Path $path -Recurse -Force
        Write-Host "Removed $t" -ForegroundColor Green
    } else {
        Write-Host "$t not found (already removed)" -ForegroundColor Yellow
    }
}
