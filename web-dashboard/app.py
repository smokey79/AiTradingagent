"""
web-dashboard/app.py - AiTradingAgent v4 Dashboard & Developments Studio
Run: python web-dashboard/app.py or python wsgi.py
Open: http://localhost:3002
"""
import sys, os
from pathlib import Path

# Ensure UTF-8 on Windows
if hasattr(sys.stdout, 'reconfigure'):
    try: sys.stdout.reconfigure(encoding='utf-8')
    except Exception: pass

sys.path.insert(0, str(Path(__file__).parents[1]))

from flask import Flask
from routes.dashboard import dashboard
from routes.health import health_bp
from dotenv import load_dotenv

load_dotenv(Path(__file__).parents[1] / "config" / "master.env")
load_dotenv(Path(__file__).parents[1] / ".env")

app = Flask(__name__, template_folder="templates", static_folder="static")
app.register_blueprint(dashboard)
app.register_blueprint(health_bp)

if __name__ == "__main__":
    port = int(os.getenv("DASHBOARD_PORT", 3002))
    host = os.getenv("HOST", "0.0.0.0")
    try:
        import waitress
        print(f"\n  🚀 Serving AiTradingAgent with Waitress WSGI on http://localhost:{port} (8 worker threads)\n")
        waitress.serve(app, host=host, port=port, threads=8)
    except ImportError:
        print(f"\n  AiTradingAgent Dashboard → http://localhost:{port}\n")
        app.run(host=host, port=port, debug=False)
