# ============================================================
#  AiTradingAgent — PageFile Optimiser
#  Run as Administrator in PowerShell
#  Optimises RAM paging for Ollama (Hermes) + Node.js agents
# ============================================================
#
#  HOW TO RUN:
#  1. Right-click PowerShell → "Run as Administrator"
#  2. Paste this whole script and press Enter
#  OR save as Optimize-PageFile.ps1 and run:
#     powershell -ExecutionPolicy Bypass -File "C:\Users\AlanJ\projects\AiTradingagent\scripts\Optimize-PageFile.ps1"
# ============================================================

#Requires -RunAsAdministrator

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  AiTradingAgent — PageFile Optimiser" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Check current RAM ──────────────────────────────────────
$ram = Get-CimInstance Win32_ComputerSystem
$totalRAM_GB = [math]::Round($ram.TotalPhysicalMemory / 1GB, 1)
Write-Host "Detected RAM: $totalRAM_GB GB" -ForegroundColor Yellow

# ── 2. Recommend pagefile size based on RAM ───────────────────
# Rule: Initial = 1x RAM, Max = 2x RAM (good for Ollama + Node)
# Minimum floor of 4GB initial, 8GB max regardless
$initialMB = [math]::Max(4096, [int]($totalRAM_GB * 1024))
$maximumMB = [math]::Max(8192, [int]($totalRAM_GB * 1024 * 2))

Write-Host "Recommended pagefile: Initial=${initialMB}MB  Max=${maximumMB}MB" -ForegroundColor Yellow
Write-Host ""

# ── 3. Show current pagefile settings ────────────────────────
Write-Host "Current pagefile settings:" -ForegroundColor White
Get-CimInstance Win32_PageFileSetting | Format-Table Name, InitialSize, MaximumSize -AutoSize

# ── 4. Which drive to put pagefile on? ───────────────────────
# Prefer F: (your fast/large drive) if it exists, else C:
$targetDrive = "C:"
if (Test-Path "F:\") {
    $fDisk = Get-PSDrive F -ErrorAction SilentlyContinue
    if ($fDisk) {
        $fFreeGB = [math]::Round($fDisk.Free / 1GB, 1)
        Write-Host "F: drive detected with ${fFreeGB}GB free." -ForegroundColor Green
        if ($fFreeGB -gt ($maximumMB / 1024 + 5)) {
            $targetDrive = "F:"
            Write-Host "Placing pagefile on F: (better for C: SSD lifespan)" -ForegroundColor Green
        }
    }
}

$pagefilePath = "$targetDrive\pagefile.sys"
Write-Host "Target pagefile: $pagefilePath" -ForegroundColor Cyan
Write-Host ""

# ── 5. Confirm before making changes ─────────────────────────
$confirm = Read-Host "Apply these settings? (yes/no)"
if ($confirm -ne "yes") {
    Write-Host "Cancelled. No changes made." -ForegroundColor Red
    exit 0
}

# ── 6. Disable automatic management (required before manual set) ──
$cs = Get-CimInstance Win32_ComputerSystem
if ($cs.AutomaticManagedPagefile) {
    Write-Host "Disabling automatic pagefile management..." -ForegroundColor Yellow
    Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $false }
    Write-Host "Done." -ForegroundColor Green
}

# ── 7. Remove any existing pagefile settings ──────────────────
Write-Host "Removing old pagefile settings..." -ForegroundColor Yellow
$existing = Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue
if ($existing) {
    $existing | Remove-CimInstance
}

# ── 8. Create new pagefile setting ───────────────────────────
Write-Host "Creating new pagefile setting at $pagefilePath ..." -ForegroundColor Yellow
$newPF = New-CimInstance -ClassName Win32_PageFileSetting -Property @{
    Name        = $pagefilePath
    InitialSize = $initialMB
    MaximumSize = $maximumMB
}
Write-Host "Pagefile created." -ForegroundColor Green

# ── 9. Optional: Set High Performance power plan ─────────────
Write-Host ""
$powerConfirm = Read-Host "Also set High Performance power plan? (yes/no)"
if ($powerConfirm -eq "yes") {
    powercfg /setactive SCHEME_MIN
    Write-Host "High Performance power plan activated." -ForegroundColor Green
}

# ── 10. Summary ───────────────────────────────────────────────
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  DONE — Changes take effect after reboot" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "New settings:" -ForegroundColor White
Get-CimInstance Win32_PageFileSetting | Format-Table Name, InitialSize, MaximumSize -AutoSize
Write-Host "Reboot your PC now for changes to take effect." -ForegroundColor Yellow
Write-Host ""
