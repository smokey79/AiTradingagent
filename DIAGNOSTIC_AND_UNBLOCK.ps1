# ================================================================
# DIAGNOSTIC_AND_UNBLOCK.ps1
# Check Windows security blocks and fix path issues
# Run: powershell -ExecutionPolicy Bypass -File DIAGNOSTIC_AND_UNBLOCK.ps1
# ================================================================

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "AiTradingAgent Launcher - Diagnostic and Fix Utility" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

$ProjectRoot = "F:\aitradingagent"
$DesktopShortcut = "C:\Users\barcl\OneDrive\Desktop\AiTradingAgent.lnk"

# =========== 1. CHECK FILE BLOCKS ===========
Write-Host "1. CHECKING FOR WINDOWS SECURITY BLOCKS" -ForegroundColor Yellow
Write-Host ""

$FilesToCheck = @(
    "$ProjectRoot\launch-full-stack.bat",
    "$ProjectRoot\CREATE_DESKTOP_SHORTCUT.ps1",
    "$ProjectRoot\CREATE_DESKTOP_SHORTCUT.vbs",
    "$ProjectRoot\data_pipeline.py",
    "$DesktopShortcut"
)

$BlockedCount = 0
$OkCount = 0

foreach ($File in $FilesToCheck) {
    if (Test-Path $File) {
        $Stream = Get-Item $File -Stream "Zone.Identifier" -ErrorAction SilentlyContinue
        if ($Stream) {
            Write-Host "   BLOCKED: $File" -ForegroundColor Red
            $BlockedCount++
        } else {
            Write-Host "   OK: $File" -ForegroundColor Green
            $OkCount++
        }
    } else {
        Write-Host "   NOT FOUND: $File" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "   Summary: $OkCount OK, $BlockedCount BLOCKED" -ForegroundColor Cyan
Write-Host ""

# =========== 2. CHECK PATH VARIABLES ===========
Write-Host "2. CHECKING REQUIRED TOOLS" -ForegroundColor Yellow
Write-Host ""

try {
    $Python = python --version 2>&1
    Write-Host "   OK - Python: $Python" -ForegroundColor Green
}
catch {
    Write-Host "   MISSING - Python not in PATH" -ForegroundColor Red
}

try {
    $Node = node --version 2>&1
    Write-Host "   OK - Node.js: $Node" -ForegroundColor Green
}
catch {
    Write-Host "   MISSING - Node.js not in PATH" -ForegroundColor Red
}

try {
    $Npm = npm --version 2>&1
    Write-Host "   OK - npm: $Npm" -ForegroundColor Green
}
catch {
    Write-Host "   MISSING - npm not in PATH" -ForegroundColor Red
}

Write-Host ""

# =========== 3. CHECK PROJECT PATHS ===========
Write-Host "3. CHECKING PROJECT DIRECTORY STRUCTURE" -ForegroundColor Yellow
Write-Host ""

$PathsToCheck = @(
    "$ProjectRoot",
    "$ProjectRoot\launch-full-stack.bat",
    "$ProjectRoot\node_modules",
    "$ProjectRoot\data",
    "$ProjectRoot\logs"
)

foreach ($Path in $PathsToCheck) {
    if (Test-Path $Path) {
        Write-Host "   OK: $Path" -ForegroundColor Green
    } else {
        Write-Host "   MISSING: $Path" -ForegroundColor Red
    }
}

Write-Host ""

# =========== 4. CHECK EXECUTION POLICY ===========
Write-Host "4. CHECKING POWERSHELL EXECUTION POLICY" -ForegroundColor Yellow
Write-Host ""

$ExecPolicy = Get-ExecutionPolicy
Write-Host "   Current Policy: $ExecPolicy" -ForegroundColor Cyan

if ($ExecPolicy -eq "Restricted") {
    Write-Host "   WARNING: Execution policy is Restricted" -ForegroundColor Yellow
    Write-Host "   FIX THIS: Run as Administrator:" -ForegroundColor Yellow
    Write-Host '   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser' -ForegroundColor Yellow
}

Write-Host ""

# =========== 5. CHECK SHORTCUT ===========
Write-Host "5. CHECKING DESKTOP SHORTCUT" -ForegroundColor Yellow
Write-Host ""

if (Test-Path $DesktopShortcut) {
    Write-Host "   OK: Shortcut exists" -ForegroundColor Green
} else {
    Write-Host "   MISSING: Shortcut not found" -ForegroundColor Red
}

Write-Host ""

# =========== 6. CHECK NETWORK PORTS ===========
Write-Host "6. CHECKING IF PORTS ARE AVAILABLE" -ForegroundColor Yellow
Write-Host ""

$Ports = @(3000, 3001, 3002)
foreach ($Port in $Ports) {
    try {
        $Connection = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        if ($Connection) {
            Write-Host "   WARNING: Port $Port IN USE" -ForegroundColor Yellow
        } else {
            Write-Host "   OK: Port $Port available" -ForegroundColor Green
        }
    }
    catch {
        Write-Host "   OK: Port $Port available" -ForegroundColor Green
    }
}

Write-Host ""

# =========== UNBLOCK FILES ===========
Write-Host "7. UNBLOCKING FILES" -ForegroundColor Yellow
Write-Host ""

if ($BlockedCount -gt 0) {
    Write-Host "Attempting to unblock $BlockedCount files..." -ForegroundColor Cyan
    foreach ($File in $FilesToCheck) {
        if ((Test-Path $File) -and (Get-Item $File -Stream "Zone.Identifier" -ErrorAction SilentlyContinue)) {
            try {
                Unblock-File -Path $File -ErrorAction SilentlyContinue
                Write-Host "   Unblocked: $File" -ForegroundColor Green
            }
            catch {
                Write-Host "   Failed to unblock: $File" -ForegroundColor Red
            }
        }
    }
} else {
    Write-Host "No blocked files to unblock." -ForegroundColor Green
}

Write-Host ""

# =========== SUMMARY ===========
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "SUMMARY AND NEXT STEPS" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Issues Found:" -ForegroundColor White
if ($BlockedCount -gt 0) {
    Write-Host "  - $BlockedCount files were blocked (now unblocked)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "What to do next:" -ForegroundColor Cyan
Write-Host "  1. Close this window" -ForegroundColor White
Write-Host "  2. If Python/Node missing, install from:" -ForegroundColor White
Write-Host "     - Python: https://www.python.org/" -ForegroundColor Cyan
Write-Host "     - Node.js: https://nodejs.org/" -ForegroundColor Cyan
Write-Host "  3. Double-click: AiTradingAgent.lnk on your desktop" -ForegroundColor White
Write-Host "  4. If still fails, try right-click shortcut..." -ForegroundColor White
Write-Host "     then select 'Run as administrator'" -ForegroundColor White
Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
