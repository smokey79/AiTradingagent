"""
wsgi.py
=======
Production WSGI Server for AiTradingAgent v4 powered by Waitress.
Multi-threaded, high-throughput server hosting the Web Dashboard,
Developments Studio, live AI consensus pipeline, and in-browser terminal APIs.

Usage:
    python wsgi.py
    waitress-serve --port=3002 wsgi:app
"""

import os
import sys
import logging
from pathlib import Path

# Windows UTF-8 console output setup
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
if hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

ROOT_DIR = Path(__file__).resolve().parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from dotenv import load_dotenv
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [Waitress] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("waitress_server")

# Import the Flask application
from flask import Flask

sys.path.insert(0, str(ROOT_DIR / "web-dashboard"))
from routes.dashboard import dashboard as app_bp

app = Flask(
    __name__,
    template_folder=str(ROOT_DIR / "web-dashboard" / "templates"),
    static_folder=str(ROOT_DIR / "web-dashboard" / "static"),
)
app.register_blueprint(app_bp)


def main():
    import waitress

    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("DASHBOARD_PORT", os.getenv("PORT", 3002)))
    threads = int(os.getenv("WAITRESS_THREADS", 8))

    logger.info("=" * 65)
    logger.info("⚡ AITRADINGAGENT PRODUCTION WSGI SERVER (WAITRESS)")
    logger.info("=" * 65)
    logger.info(f"  Serving at: http://localhost:{port}")
    logger.info(f"  Worker Threads: {threads}")
    logger.info(f"  Developments Studio: Enabled (TradingView, Terminal, PineScript)")
    logger.info("=" * 65)

    waitress.serve(app, host=host, port=port, threads=threads)


if __name__ == "__main__":
    main()
