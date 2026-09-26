#!/usr/bin/env python3
"""
serve.py
Production WSGI entry point for the AiTradingAgent dashboard.
Uses Waitress instead of Flask built-in dev server.
PM2 calls this script directly via ecosystem.config.js.

Config via env vars (set in ecosystem.config.js env_paper/env_live):
  DASHBOARD_HOST    default 0.0.0.0
  DASHBOARD_PORT    default 5000
  DASHBOARD_THREADS default 4
"""

import os
import sys
from waitress import serve

# Adjust the import below if your Flask app factory is named differently
# e.g. from app import app  OR  from flask_dashboard import app
try:
    from dashboard import app
except ImportError as exc:
    print(f"[serve.py] ERROR: Could not import Flask app -- {exc}")
    print("  Check that dashboard.py exists in F:\\aitradingagent and exposes `app`.")
    sys.exit(1)

HOST    = os.getenv("DASHBOARD_HOST",    "0.0.0.0")
PORT    = int(os.getenv("DASHBOARD_PORT",    "5000"))
THREADS = int(os.getenv("DASHBOARD_THREADS", "4"))

if __name__ == "__main__":
    print(f"[Dashboard] Waitress listening on http://{HOST}:{PORT} ({THREADS} threads)")
    serve(app, host=HOST, port=PORT, threads=THREADS)
