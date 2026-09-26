# Why these files were moved here (2026-09-23)

`START_DASHBOARD_AND_AGENTS.bat`, `STOP_DASHBOARD_AND_AGENTS.bat`, and
`scripts\create_demoAITMLLM_shortcut.py` all predate the 2026-09-16 PM2
migration. They start the dashboard, orchestrator, WSGI studio, and
Telegram listener as bare, unsupervised `cmd` windows — completely outside
PM2's management.

Running any of them today would start a SECOND, unmanaged copy of the
dashboard/orchestrator alongside the real PM2-managed fleet, both writing
to the same `trade_ledger.json`/`portfolio_state.json` at once. This is the
exact "two independent auto-trading engines running at once" bug already
found and fixed once (2026-09-16 session notes) — these files would
reintroduce it if run.

They're kept here (not deleted) in case anything in them is still useful
for reference. The safe, current way to start/stop everything is:
- `START-PM2-BOT.bat` / `STOP-PM2-BOT.bat` (root of the project), or
- The "Restart AiTradingAgent" desktop shortcut (created by
  `scripts\MakeDesktopShortcut.ps1`, targets `scripts\RestartBot.ps1`).

Both are PM2-aware and won't create a duplicate trading engine.

Note: there are also ~13 other older launcher `.bat` files still sitting in
the project root (LAUNCH.bat, START-ALL.bat, launch-full-stack.bat, etc.)
from earlier iterations of this project. They weren't touched in this pass
(out of scope for "fix bot, replace desktop shortcut") but are worth a
cleanup pass if you want the root folder less cluttered — say the word.
