# PM2-Startup-Resurrect.ps1
# ============================
# Windows has no native `pm2 startup` support (that command errors with
# "Init system not found" here - confirmed 2026-09-27). Without this, a
# machine reboot leaves EVERY PM2-managed process (orchestrator, dashboard,
# freqtrade-bridge, arb-scanner, hermes-analyst, mt5-feed, telegram-listener,
# etc.) simply not running until someone manually runs `pm2 resurrect` -
# exactly what happened after the 03:42 reboot on 2026-09-27, where the
# whole trading stack sat down for ~40 minutes with nothing running.
#
# This script is registered as a Windows Scheduled Task (trigger: at logon
# for user barcl) so PM2's saved process list (C:\Users\barcl\.pm2\dump.pm2)
# is restored automatically every time the machine starts back up.
#
# The 45s delay gives networking, disk and any dependent local services
# (Ollama, MT5 terminal, etc.) a moment to come up first.

Start-Sleep -Seconds 45
& pm2 resurrect *>> "F:\aitradingagent\logs\pm2-startup-resurrect.log"
