# ✅ LAUNCHER CONFIGURATION & TROUBLESHOOTING GUIDE

## Status Report

**Diagnostic Results:**
- ✅ No files blocked by Windows Security
- ✅ Python 3.14.7 installed and in PATH
- ✅ Node.js v26.7.0 installed and in PATH
- ✅ npm 12.0.2 installed and in PATH
- ✅ All project directories exist
- ✅ Ports 3000, 3001, 3002 available
- ✅ PowerShell execution policy: Bypass
- ✅ All shortcuts created

---

## You Now Have TWO Launchers

### 1. Full Stack Launcher (Recommended)
**Shortcut:** `AiTradingAgent.lnk` on your desktop
**Command:** `launch-full-stack.bat`
- Launches all 11+ services
- Full feature set
- Complete MCP servers
- Try this first

### 2. Simple Launcher (If full fails)
**Shortcut:** `AiTradingAgent-Simple.lnk` on your desktop  
**Command:** `LAUNCH_SIMPLE.bat`
- Basic startup only
- Minimal dependencies
- Faster if issues occur
- Debug-friendly output

---

## How to Launch

### Method 1: Desktop Shortcut (Easiest)
1. Look at your desktop
2. Double-click **AiTradingAgent.lnk**
3. Wait 10-15 seconds
4. Open http://localhost:3000

### Method 2: Direct Command
```cmd
F:\aitradingagent\launch-full-stack.bat
```

### Method 3: Simple Mode (If full fails)
```cmd
F:\aitradingagent\LAUNCH_SIMPLE.bat
```

---

## If It Won't Launch

### Step 1: Run Diagnostic
```powershell
cd F:\aitradingagent
powershell -ExecutionPolicy Bypass -File DIAGNOSTIC_AND_UNBLOCK.ps1
```

This checks:
- ✅ Windows security blocks
- ✅ Required tools (Python, Node, npm)
- ✅ Project paths
- ✅ Network ports
- ✅ Execution policies

### Step 2: Check for Obvious Issues

**Python not found?**
→ Install from https://www.python.org/

**Node.js not found?**
→ Install from https://nodejs.org/

**Virtual environment error?**
```cmd
cd F:\aitradingagent
rmdir /s /q venv
python -m venv venv
```

**npm error?**
```cmd
cd F:\aitradingagent
rmdir /s /q node_modules
npm install
```

### Step 3: Check Logs
```cmd
type F:\aitradingagent\logs\startup.log
```

Look for error messages starting with `[ERROR]`

### Step 4: Try Simple Launcher
```cmd
F:\aitradingagent\LAUNCH_SIMPLE.bat
```

If this works, full launcher has a service issue (check logs).

---

## Detailed Troubleshooting

See: `TROUBLESHOOTING.md` in project root

Quick links to common solutions:
- [Python not found](#python-not-found)
- [Node.js not found](#nodejs-not-found)
- [Virtual environment failed](#virtual-environment-failed)
- [npm install fails](#npm-install-fails)
- [Port already in use](#port-already-in-use)
- [Shortcut doesn't work](#shortcut-doesnt-work)

---

## Files Created

```
F:\aitradingagent\
├── launch-full-stack.bat           ← Full launcher (11+ services)
├── LAUNCH_SIMPLE.bat               ← Simple launcher (basic startup)
├── DIAGNOSTIC_AND_UNBLOCK.ps1     ← Auto-diagnose
├── CREATE_DESKTOP_SHORTCUT.ps1    ← Re-create main shortcut
├── CREATE_SIMPLE_SHORTCUT.vbs     ← Create simple shortcut
├── TROUBLESHOOTING.md             ← Common fixes
├── LAUNCHER_README.md             ← Full docs
├── LAUNCHER_OVERVIEW.txt          ← Visual overview
└── logs/                           ← All startup logs
```

Desktop:
```
C:\Users\barcl\OneDrive\Desktop\
├── AiTradingAgent.lnk             ← Main shortcut
└── AiTradingAgent-Simple.lnk      ← Simple shortcut
```

---

## Expected Output

When launcher works, you should see:

```
==========================================
  AiTradingAgent Full Stack Launcher
==========================================

Checking prerequisites...
OK - Python and Node.js found

Setting up Python environment...
OK - Python environment ready

Setting up Node.js environment...
OK - Node environment ready

Creating required directories...
OK - Directories ready

==========================================
  Services Starting...
==========================================

Dashboard:  http://localhost:3000
Backtester: http://localhost:3001
Monitor:    http://localhost:3002

Logs saved to: F:\aitradingagent\logs\

(window stays open for 5 seconds)
```

---

## Next Steps if Working

1. ✅ Open http://localhost:3000
2. ✅ Check dashboard for live data
3. ✅ Test backtester at http://localhost:3001
4. ✅ Check logs at F:\aitradingagent\logs\
5. ✅ Start trading!

---

## Useful Shortcuts

| Shortcut | Does What |
|----------|-----------|
| `F:\aitradingagent\launch-full-stack.bat` | Full launcher |
| `F:\aitradingagent\LAUNCH_SIMPLE.bat` | Simple launcher |
| `python --version` | Check Python |
| `node --version` | Check Node.js |
| `taskkill /F /IM node.exe` | Kill Node processes |
| `taskkill /F /IM python.exe` | Kill Python processes |

---

## Important Notes

⚠️ **If Python/Node not installed:**
- Restart computer AFTER installing
- Check "Add to PATH" during installation
- Verify: Run `python --version` in new command prompt

⚠️ **If virtual environment fails:**
- Delete venv folder
- Recreate it
- Reinstall packages

⚠️ **If ports are in use:**
- Kill old processes: `taskkill /F /IM node.exe /IM python.exe`
- Wait 10 seconds
- Try launcher again

⚠️ **If shortcut won't work:**
- Right-click and select "Run as administrator"
- Or run launcher script directly

---

## Quick Diagnostics

**Everything working?**
```powershell
DIAGNOSTIC_AND_UNBLOCK.ps1
```

**Need to see detailed logs?**
```cmd
type F:\aitradingagent\logs\startup.log
```

**Need to reset everything?**
```cmd
cd F:\aitradingagent
rmdir /s /q venv
rmdir /s /q node_modules
python -m venv venv
call venv\Scripts\activate.bat
pip install -r requirements.txt
npm install
```

---

## Support Resources

1. **Check these files (in order):**
   - `logs\startup.log` — What went wrong
   - `TROUBLESHOOTING.md` — Common fixes
   - `LAUNCHER_README.md` — Full documentation

2. **Run diagnostic:**
   ```powershell
   DIAGNOSTIC_AND_UNBLOCK.ps1
   ```

3. **Try simple launcher:**
   ```cmd
   LAUNCH_SIMPLE.bat
   ```

4. **Collect debug info:**
   - Screenshot of error
   - Contents of logs\startup.log
   - Output of `python --version` and `node --version`

---

## Summary

✅ **Diagnostic** — No issues found
✅ **Security** — No files blocked
✅ **Tools** — Python, Node, npm all installed
✅ **Paths** — All directories ready
✅ **Ports** — Available
✅ **Shortcuts** — Both created

**You're ready to launch!**

1. Double-click **AiTradingAgent.lnk** on your desktop
2. Wait 10-15 seconds
3. Open http://localhost:3000
4. Done!

If it doesn't work:
1. Run `DIAGNOSTIC_AND_UNBLOCK.ps1`
2. Check `logs\startup.log`
3. Try `LAUNCH_SIMPLE.bat`
4. See `TROUBLESHOOTING.md`

---

**Created:** 2026-08-28  
**Status:** ✅ READY FOR LAUNCH  
**Last Diagnostic:** All checks passed
