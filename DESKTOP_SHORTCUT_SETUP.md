# Desktop Shortcut Setup Guide

## Quick Start (Recommended)

### Option 1: PowerShell (Easiest)
```powershell
cd F:\aitradingagent
powershell -ExecutionPolicy Bypass -File CREATE_DESKTOP_SHORTCUT.ps1
```

### Option 2: VBScript
```cmd
cd F:\aitradingagent
cscript.exe CREATE_DESKTOP_SHORTCUT.vbs
```

### Option 3: Manual (Windows Explorer)
1. Right-click on desktop → New → Shortcut
2. Location: `C:\Windows\System32\cmd.exe`
3. Name: `AiTradingAgent`
4. Right-click shortcut → Properties
5. Target: `C:\Windows\System32\cmd.exe /k "F:\aitradingagent\launch-full-stack.bat"`
6. Start in: `F:\aitradingagent`
7. Click "Change Icon" → Browse to `F:\aitradingagent\icon.ico` (if available)

---

## What the Launcher Does

When you double-click the **AiTradingAgent** shortcut, it:

1. ✅ Activates Python virtual environment
2. ✅ Installs/updates Python dependencies from `requirements.txt`
3. ✅ Installs/updates Node.js dependencies from `package.json`
4. ✅ Runs preflight checks on all directories
5. ✅ Starts all MCP servers:
   - Trading Data MCP (market feeds)
   - Signal Engine MCP (AI signals)
   - Risk Gate MCP (risk management)
   - Portfolio MCP (portfolio tracking)
6. ✅ Starts Orchestrator (core coordinator)
7. ✅ Launches web dashboard (http://localhost:3000)
8. ✅ Starts backtester (http://localhost:3001)
9. ✅ Starts trade visualizer (if available)
10. ✅ Starts risk tuning panel (if available)
11. ✅ Starts Telegram bot in background

---

## Logs and Monitoring

After launching, all activity is logged to:
```
F:\aitradingagent\logs\
```

Individual service logs:
- `mcp-trading-data.log` — Market data feeds
- `mcp-signal-engine.log` — AI signal generation
- `mcp-risk-gate.log` — Risk management
- `mcp-portfolio.log` — Portfolio tracking
- `orchestrator.log` — Core coordinator
- `web-dashboard.log` — Dashboard server
- `backtester.log` — Backtester engine
- `visualizer.log` — Trade visualizer
- `telegram-bot.log` — Telegram notifications

---

## Access Points

Once running, access:

| Service | URL |
|---------|-----|
| Web Dashboard | http://localhost:3000 |
| Backtester | http://localhost:3001 |
| Risk Monitor | http://localhost:3002 |
| API (if enabled) | http://localhost:3003 |

---

## Optional: Add Custom Icon

For a custom launcher icon:

1. Create or download an `.ico` file (trading/robot themed)
2. Save as `F:\aitradingagent\icon.ico`
3. Re-run the shortcut creation script

Recommended free icon tools:
- https://convertio.co/png-ico/ (convert PNG to ICO)
- https://www.favicon-generator.org/

---

## Optional: Add to Startup

To auto-launch on Windows startup:

1. Create shortcut (as above)
2. Go to: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`
3. Copy the **AiTradingAgent.lnk** shortcut there
4. Next time you boot, the stack launches automatically

---

## Troubleshooting

### "launch-full-stack.bat not found"
✓ Make sure `launch-full-stack.bat` exists in `F:\aitradingagent\`

### "Node.js not installed"
✓ Install Node.js from https://nodejs.org/
✓ Add to PATH and restart

### "Python not installed"
✓ Install Python from https://www.python.org/
✓ Check "Add Python to PATH" during install

### Services won't start
✓ Check `F:\aitradingagent\logs\` for error messages
✓ Verify firewall allows ports 3000-3003

### Hotkey (CTRL+ALT+T) not working
✓ PowerShell version sets this automatically
✓ Windows may disable user-defined hotkeys in some scenarios
✓ Use desktop shortcut instead

---

## Stopping the Stack

To stop all services:

1. Close the launcher window (will close background services)
2. Or run: `taskkill /F /IM node.exe /IM python.exe`

---

## Advanced: Modify Launch Behavior

Edit `launch-full-stack.bat` to:
- Enable/disable specific services
- Change log locations
- Add custom startup scripts
- Modify window styles (minimized/hidden)

