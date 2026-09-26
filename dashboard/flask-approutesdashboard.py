
from flask import Blueprint, render_template, jsonify
import requests

dashboard = Blueprint("dashboard", __name__)

SIGNAL_ENGINE_URL = "http://localhost:7001"
RISK_GATE_URL = "http://localhost:7002"
PORTFOLIO_URL = "http://localhost:7003"

def fetch_json(url):
    try:
        return requests.get(url).json()
    except Exception as e:
        return {"error": str(e)}

@dashboard.route("/")
def home():
    signal = fetch_json(f"{SIGNAL_ENGINE_URL}/latest")
    risk = fetch_json(f"{RISK_GATE_URL}/status")
    portfolio = fetch_json(f"{PORTFOLIO_URL}/summary")

    return render_template(
        "dashboard.html",
        signal=signal,
        risk=risk,
        portfolio=portfolio
    )

@dashboard.route("/signals")
def signals():
    data = fetch_json(f"{SIGNAL_ENGINE_URL}/history")
    return render_template("signals.html", data=data)

@dashboard.route("/risk")
def risk():
    data = fetch_json(f"{RISK_GATE_URL}/status")
    return render_template("risk.html", data=data)

@dashboard.route("/portfolio")
def portfolio():
    data = fetch_json(f"{PORTFOLIO_URL}/summary")
    return render_template("portfolio.html", data=data)
