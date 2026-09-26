# waitress_server.py
# Production WSGI server for the AiTradingAgent Flask dashboard
# Replaces Flask dev server (app.run()) -- do NOT use app.run() in production
#
# Install : pip install waitress   (already in requirements if present)
# Standalone test: python waitress_server.py

import os
import sys

# ── Import Flask app ──────────────────────────────────────────────────────────
# Update the import below if your Flask app lives in a different module
_imported = False
for _module in ('dashboard', 'app', 'src.dashboard.app', 'flask_dashboard'):
    try:
        mod = __import__(_module)
        app = mod.app
        _imported = True
        print(f"[Waitress] Imported Flask app from '{_module}'")
        break
    except (ImportError, AttributeError):
        continue

if not _imported:
    print("[Waitress] ERROR: Could not import Flask app.")
    print("  Edit waitress_server.py and set the correct module name.")
    sys.exit(1)

# ── Config from env ───────────────────────────────────────────────────────────
HOST    = os.getenv('DASHBOARD_HOST',    '0.0.0.0')
PORT    = int(os.getenv('DASHBOARD_PORT', '5000'))
THREADS = int(os.getenv('WAITRESS_THREADS', '4'))
TIMEOUT = int(os.getenv('WAITRESS_TIMEOUT', '60'))

# ── Serve ─────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    from waitress import serve
    print(f"[Waitress] AiTradingAgent dashboard → http://localhost:{PORT}")
    print(f"[Waitress] Threads: {THREADS}  |  Timeout: {TIMEOUT}s")
    serve(
        app,
        host             = HOST,
        port             = PORT,
        threads          = THREADS,
        channel_timeout  = TIMEOUT,
        cleanup_interval = 30,
        ident            = 'AiTradingAgent',
    )
