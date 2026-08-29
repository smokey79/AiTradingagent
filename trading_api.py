"""
trading_api.py
==============
REST API endpoints for manual trading and automation control.
Flask-based API for all trading operations.
"""

import os
import logging
from flask import Flask, request, jsonify
from flask_cors import CORS
from trading_mode_controller import TradingModeController, TradeMode
import json
from datetime import datetime

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("TradingAPI")

app = Flask(__name__)
CORS(app)

# Global trading controller
controller = TradingModeController(
    mode=os.getenv("TRADING_MODE", "manual"),
    paper_trading=os.getenv("PAPER_TRADING", "true").lower() == "true",
    max_trade_size=float(os.getenv("MAX_TRADE_SIZE_USDT", "100")),
    require_confirmation=os.getenv("REQUIRE_CONFIRMATION", "false").lower() == "true",
)

# Start trading on startup
controller.start()


# ========== STATUS ENDPOINTS ==========


@app.route("/api/status", methods=["GET"])
def get_status():
    """Get current trading status."""
    return jsonify(controller.get_status())


@app.route("/api/statistics", methods=["GET"])
def get_statistics():
    """Get trading statistics."""
    return jsonify(controller.get_statistics())


@app.route("/api/mode", methods=["GET"])
def get_mode():
    """Get current trading mode."""
    return jsonify({"mode": controller.mode.value})


# ========== MODE CONTROL ENDPOINTS ==========


@app.route("/api/mode/set", methods=["POST"])
def set_mode():
    """Set trading mode (automation/manual/hybrid)."""
    data = request.get_json()
    mode = data.get("mode")

    if not mode:
        return jsonify({"status": "error", "message": "Mode required"}), 400

    success = controller.toggle_mode(mode)
    return jsonify(
        {
            "status": "success" if success else "error",
            "mode": controller.mode.value,
        }
    )


@app.route("/api/trading/start", methods=["POST"])
def start_trading():
    """Activate trading mode."""
    controller.start()
    return jsonify({"status": "active", "message": "Trading started"})


@app.route("/api/trading/stop", methods=["POST"])
def stop_trading():
    """Deactivate trading mode."""
    controller.stop()
    return jsonify({"status": "inactive", "message": "Trading stopped"})


# ========== MANUAL TRADE ENDPOINTS ==========


@app.route("/api/trade/execute", methods=["POST"])
def execute_trade():
    """Execute a manual trade."""
    data = request.get_json()

    required = ["symbol", "action", "amount"]
    if not all(k in data for k in required):
        return jsonify({"status": "error", "message": f"Missing required fields: {required}"}), 400

    result = controller.execute_trade(
        symbol=data.get("symbol"),
        action=data.get("action"),
        amount=float(data.get("amount")),
        price=float(data.get("price", 0)) or None,
        order_type=data.get("order_type", "market"),
        metadata=data.get("metadata"),
        source="manual",
    )

    status_code = 200 if result["status"] != "failed" else 400
    return jsonify(result), status_code


@app.route("/api/trade/buy", methods=["POST"])
def quick_buy():
    """Quick buy button (manual)."""
    data = request.get_json()

    result = controller.execute_trade(
        symbol=data.get("symbol", "BTC/USDT"),
        action="buy",
        amount=float(data.get("amount", 0.01)),
        price=float(data.get("price", 0)) or None,
        order_type="market",
        source="manual",
    )

    return jsonify(result)


@app.route("/api/trade/sell", methods=["POST"])
def quick_sell():
    """Quick sell button (manual)."""
    data = request.get_json()

    result = controller.execute_trade(
        symbol=data.get("symbol", "BTC/USDT"),
        action="sell",
        amount=float(data.get("amount", 0.01)),
        price=float(data.get("price", 0)) or None,
        order_type="market",
        source="manual",
    )

    return jsonify(result)


# ========== CONFIRMATION ENDPOINTS ==========


@app.route("/api/confirmations", methods=["GET"])
def get_confirmations():
    """Get pending trade confirmations."""
    confirmations = controller.get_pending_confirmations()
    return jsonify({"pending": confirmations, "count": len(confirmations)})


@app.route("/api/confirmations/<confirmation_id>/approve", methods=["POST"])
def approve_trade(confirmation_id):
    """Approve a pending trade."""
    result = controller.confirm_trade(confirmation_id)
    return jsonify(result)


@app.route("/api/confirmations/<confirmation_id>/reject", methods=["POST"])
def reject_trade(confirmation_id):
    """Reject a pending trade."""
    result = controller.reject_trade(confirmation_id)
    return jsonify(result)


# ========== HISTORY ENDPOINTS ==========


@app.route("/api/trades", methods=["GET"])
def get_trades():
    """Get trade history."""
    limit = request.args.get("limit", 50, type=int)
    trades = controller.get_trade_history(limit)
    return jsonify({"trades": trades, "count": len(trades)})


@app.route("/api/trades/<trade_id>", methods=["GET"])
def get_trade(trade_id):
    """Get specific trade details."""
    trades = controller.get_trade_history(1000)
    trade = next((t for t in trades if t.get("trade_id") == trade_id), None)

    if not trade:
        return jsonify({"error": "Trade not found"}), 404

    return jsonify(trade)


# ========== HEALTH CHECK ==========


@app.route("/api/health", methods=["GET"])
def health_check():
    """Health check endpoint."""
    return jsonify(
        {
            "status": "healthy",
            "trading_active": controller.is_active,
            "mode": controller.mode.value,
            "timestamp": datetime.utcnow().isoformat(),
        }
    )


# ========== ERROR HANDLERS ==========


@app.errorhandler(400)
def bad_request(error):
    return jsonify({"error": "Bad request"}), 400


@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Endpoint not found"}), 404


@app.errorhandler(500)
def internal_error(error):
    log.error(f"Internal server error: {error}")
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    port = int(os.getenv("TRADING_API_PORT", 3003))
    log.info(f"Trading API starting on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)
