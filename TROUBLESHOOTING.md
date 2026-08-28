# AiTradingAgent Launcher — Troubleshooting Guide

## Quick Fix Checklist

### ✅ Step 1: Run Diagnostic
```powershell
cd F:\aitradingagent
powershell -ExecutionPolicy Bypass -File DIAGNOSTIC_AND_UNBLOCK.ps1
```

Look for any **BLOCKED** or **MISSING** items.

---

## Common Issues & Fixes

### Issue: "Python not found" or "Node.js not found"

**Cause:** Tools installed but not in PATH

**Fix:**
1. Install Python from https://www.python.org/
   - ✅ Check: "Add Python to PATH" during install
   - ✅ Restart computer after install
2. Install Node.js from https://nodejs.org/
   - ✅ Check: "Add to PATH" during install
   - ✅ Restart computer after install
3. Verify installation:
   ```cmd
   python --version
   node --version
   npm --version
   ```

---

### Issue: "Virtual environment failed" or "pip install failed"

**Cause:** Python environment corrupted or permissions issue

**Fix:**

Option 1: Delete and recreate venv
```cmd
cd F:\aitradingagent
rmdir /s /q venv
python -m venv venv
call venv\Scripts\activate.bat
pip install -r requirements.txt
```

Option 2: Use system Python (skip venv)
Edit `launch-full-stack.bat`, comment out these lines:
```batch
REM python -m venv venv --upgrade-deps >nul 2>&1
REM call venv\Scripts\activate.bat
```

---

### Issue: "npm install fails" or "node_modules issues"

**Cause:** Corrupted node_modules

**Fix:**
```cmd
cd F:\aitradingagent
rmdir /s /q node_modules
rmdir /s /q package-lock.json
npm install
```

---

### Issue: Services start but don't show output / Dashboard not loading

**Cause:** Services may be running in background but erroring silently

**Fix:**

1. Check logs:
   ```cmd
   cd F:\aitradingagent\logs
   dir
   type startup.log
   ```

2. Try accessing dashboard:
   ```
   http://localhost:3000
   ```

3. If port is busy, kill processes:
   ```cmd
   taskkill /F /IM node.exe
   taskkill /F /IM python.exe
   ```

4. Try launcher again

---

### Issue: "Port 3000 already in use" or similar

**Cause:** Old process still running from previous launch

**Fix:**
```cmd
REM Kill all node/python processes
taskkill /F /IM node.exe
taskkill /F /IM python.exe

REM Wait 10 seconds
timeout /t 10

REM Try launcher again
```

---

### Issue: Shortcut doesn't work / won't launch

**Cause:** Shortcut path or Windows security issue

**Fix:**

Option 1: Re-create shortcut
```powershell
cd F:\aitradingagent
powershell -ExecutionPolicy Bypass -File CREATE_DESKTOP_SHORTCUT.ps1
```

Option 2: Launch directly
```cmd
F:\aitradingagent\LAUNCH_SIMPLE.bat
```

Option 3: Run as Administrator
- Right-click shortcut
- Select "Run as administrator"

---

### Issue: "Files blocked by Windows" error

**Cause:** Windows security flagged downloaded files

**Fix:**
```powershell
cd F:\aitradingagent

REM Unblock individual files
Unblock-File -Path launch-full-stack.bat
Unblock-File -Path CREATE_DESKTOP_SHORTCUT.ps1
Unblock-File -Path data_pipeline.py

REM Or unblock entire folder
Get-ChildItem -Path . -Recurse | Unblock-File
```

---

### Issue: "The system cannot find the path specified"

**Cause:** Working directory wrong or path contains spaces

**Fix:**

1. Verify project location:
   ```cmd
   dir F:\aitradingagent\launch-full-stack.bat
   ```

2. Update paths in launcher if needed
   Edit `launch-full-stack.bat` and change:
   ```batch
   set PROJECT_ROOT=F:\aitradingagent
   ```
   to your actual project path

---

### Issue: Launcher window closes immediately (no output)

**Cause:** Script error or missing dependencies

**Fix:**

1. Create test script `test.bat`:
   ```batch
   @echo off
   cd /d F:\aitradingagent
   echo Testing environment...
   python --version
   node --version
   echo Test completed
   pause
   ```

2. Run it:
   ```cmd
   test.bat
   ```

3. If that works, check `logs\startup.log`

---

## Advanced Troubleshooting

### Check startup logs
```cmd
cd F:\aitradingagent\logs
dir /o-d
type startup.log
```

### Manually start services
```cmd
cd F:\aitradingagent
call venv\Scripts\activate.bat
python data_pipeline.py
```

### Test Node.js services
```cmd
cd F:\aitradingagent
node -v
npm -v
npm test
```

### Check if ports are listening
```cmd
netstat -ano | findstr :3000
netstat -ano | findstr :3001
netstat -ano | findstr :3002
```

### Run with debugging
Edit launcher and add verbose output before service starts:
```batch
echo DEBUG: About to start service...
echo %date% %time%
```

---

## When Everything Fails

### Nuclear Option 1: Fresh Start
```cmd
cd F:\aitradingagent

REM Kill all processes
taskkill /F /IM node.exe
taskkill /F /IM python.exe

REM Clean up
rmdir /s /q venv
rmdir /s /q node_modules
del package-lock.json

REM Reinstall
python -m venv venv
call venv\Scripts\activate.bat
pip install -r requirements.txt
npm install

REM Try again
LAUNCH_SIMPLE.bat
```

### Nuclear Option 2: Check Windows Defender
1. Open Windows Defender
2. Go to "Virus & threat protection"
3. Click "Manage settings"
4. Add exclusion for `F:\aitradingagent`

### Nuclear Option 3: Run as Administrator
- Right-click `LAUNCH_SIMPLE.bat`
- Select "Run as administrator"
- If it works, add shortcut to startup folder

---

## Useful Commands

```cmd
REM Check Python packages
pip list

REM Check npm packages
npm list --depth=0

REM Check all running processes
tasklist

REM Check specific service
tasklist /FI "IMAGENAME eq node.exe"

REM Find what's using a port
netstat -ano | findstr :3000

REM Kill specific process
taskkill /PID 1234 /F

REM Check file exists
dir F:\aitradingagent\launch-full-stack.bat

REM View log file
type F:\aitradingagent\logs\startup.log

REM Clear logs
del F:\aitradingagent\logs\*.log
```

---

## Getting Help

1. **Check logs first:**
   ```
   F:\aitradingagent\logs\startup.log
   F:\aitradingagent\logs\*.log
   ```

2. **Run diagnostic:**
   ```powershell
   DIAGNOSTIC_AND_UNBLOCK.ps1
   ```

3. **Try simple launcher:**
   ```cmd
   LAUNCH_SIMPLE.bat
   ```

4. **Collect info:**
   - What error message do you see?
   - Does `python --version` work?
   - Does `node --version` work?
   - What does startup.log say?
   - What OS/antivirus are you using?

---

## Documentation

- `LAUNCHER_README.md` — Full setup guide
- `QUICK_REFERENCE.txt` — Quick lookup
- `DIAGNOSTIC_AND_UNBLOCK.ps1` — Auto-diagnose
- `LAUNCH_SIMPLE.bat` — Simple launcher (try if main fails)

---

**If issues persist, provide:**
1. Full error message
2. Output of: `DIAGNOSTIC_AND_UNBLOCK.ps1`
3. Contents of: `logs\startup.log`
4. Output of: `python --version` and `node --version`
