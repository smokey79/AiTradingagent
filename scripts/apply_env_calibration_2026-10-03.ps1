# apply_env_calibration_2026-10-03.ps1 -- SUPERSEDED, kept only so nobody re-creates it.
# The first version of this script read .env with Windows PowerShell's default (ANSI) decoding and turned multi-byte
# characters in COMMENTS into mojibake. The .env changes (ROUND_TRIP_COST_PCT commented out, ARB_MODE=observe,
# ALLOW_SYNTHETIC_CANDLES=false) were redone byte-safely by scripts\rebuild_env_from_backup_2026-10-03.py.
# Do not edit .env with Get-Content/Set-Content on this machine; use Python or [System.IO.File] with an explicit UTF-8 encoding.
"superseded: see scripts\rebuild_env_from_backup_2026-10-03.py"
