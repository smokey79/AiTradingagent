"""
Health Check & Self-Heal API — Flask Blueprint
===============================================
Exposes:
  GET  /api/health                — overall system health snapshot
  GET  /api/health/agents         — per-agent status table
  GET  /api/health/checks         — individual subsystem check results
  GET  /api/health/heal-log       — history of all heal events
  POST /api/health/heal/<agent>   — manually trigger heal for one agent
  POST /api/health/include/<agent>— re-include a previously excluded agent
  POST /api/health/run            — force an immediate health check cycle
"""

import json
import os
import subprocess
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

health_bp = Blueprint("health", __name__)

# Paths relative to this file's location
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, "../../"))
_DATA = os.path.join(_ROOT, "data")

HEALTH_STATE_PATH = os.path.join(_DATA, "system_health.json")
AGENT_HEALTH_PATH = os.path.join(_DATA, "agent_health.json")
HEAL_LOG_PATH     = os.path.join(_DATA, "heal_log.json")


def _load_json(path: str, default=None):
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return default if default is not None else {}


def _iso_now():
    return datetime.now(timezone.utc).isoformat()


# ── GET /api/health ───────────────────────────────────────────────────────────

@health_bp.route("/api/health")
def api_health():
    """Full system health snapshot."""
    state = _load_json(HEALTH_STATE_PATH)
    if not state:
        return jsonify({
            "overallStatus": "UNKNOWN",
            "detail":        "No health check has run yet. Start the trading engine first.",
            "timestamp":     _iso_now(),
        })
    return jsonify({"success": True, **state})


# ── GET /api/health/agents ────────────────────────────────────────────────────

@health_bp.route("/api/health/agents")
def api_health_agents():
    """Per-agent health table with status, latency, and error rates."""
    agents = _load_json(AGENT_HEALTH_PATH, default={})

    # Compute summary row
    statuses    = [v.get("status", "UNKNOWN") for v in agents.values()]
    healthy_n   = sum(1 for s in statuses if s in ("HEALTHY", "RECOVERED"))
    degraded_n  = sum(1 for s in statuses if s == "DEGRADED")
    failing_n   = sum(1 for s in statuses if s == "FAILING")
    dead_n      = sum(1 for s in statuses if s == "DEAD")

    # Build display rows sorted by status severity
    status_order = {"DEAD": 0, "FAILING": 1, "DEGRADED": 2, "RECOVERED": 3, "HEALTHY": 4, "UNKNOWN": 5}
    rows = sorted(
        [
            {
                "agent":            name,
                "status":           v.get("status", "UNKNOWN"),
                "latencyMs":        v.get("latencyMs"),
                "avgLatencyMs":     v.get("avgLatencyMs"),
                "errorRate":        v.get("errorRate", 0),
                "errorRatePct":     round((v.get("errorRate", 0)) * 100, 1),
                "consecutiveFails": v.get("consecutiveFails", 0),
                "totalCalls":       v.get("totalCalls", 0),
                "totalErrors":      v.get("totalErrors", 0),
                "lastSeen":         v.get("lastSeen"),
                "lastError":        v.get("lastError"),
                "healCount":        v.get("healCount", 0),
            }
            for name, v in agents.items()
        ],
        key=lambda r: status_order.get(r["status"], 5),
    )

    return jsonify({
        "success":  True,
        "summary":  {
            "total":   len(agents),
            "healthy": healthy_n,
            "degraded": degraded_n,
            "failing": failing_n,
            "dead":    dead_n,
            "consensusAble": (healthy_n + degraded_n) >= 7,
        },
        "agents":    rows,
        "timestamp": _iso_now(),
    })


# ── GET /api/health/checks ────────────────────────────────────────────────────

@health_bp.route("/api/health/checks")
def api_health_checks():
    """Individual subsystem check results."""
    state  = _load_json(HEALTH_STATE_PATH, default={})
    checks = state.get("checks", {})
    return jsonify({
        "success":      True,
        "overallStatus": state.get("overallStatus", "UNKNOWN"),
        "checks":       checks,
        "failedChecks": state.get("failedChecks", []),
        "timestamp":    state.get("timestamp", _iso_now()),
    })


# ── GET /api/health/heal-log ──────────────────────────────────────────────────

@health_bp.route("/api/health/heal-log")
def api_heal_log():
    """All heal events, most recent first."""
    limit    = int(request.args.get("limit", 50))
    heal_log = _load_json(HEAL_LOG_PATH, default=[])
    recent   = list(reversed(heal_log))[:limit]
    return jsonify({
        "success":   True,
        "total":     len(heal_log),
        "returned":  len(recent),
        "healEvents": recent,
    })


# ── POST /api/health/heal/<agent> ─────────────────────────────────────────────

@health_bp.route("/api/health/heal/<agent_name>", methods=["POST"])
def api_heal_agent(agent_name: str):
    """
    Manually trigger the heal sequence for a specific agent.
    Body (optional): { "force": true }  — skip rate-limit check
    """
    valid_agents = [
        "deepseek", "claude", "gpt4o", "gemini",
        "grok", "openrouter_free", "perplexity", "hermes", "sentiment",
    ]
    if agent_name not in valid_agents:
        return jsonify({"success": False, "error": f"Unknown agent '{agent_name}'"}), 400

    # Trigger via Node subprocess (the healer runs in the JS process)
    heal_script = os.path.join(_ROOT, "scripts", "trigger_heal.js")
    if not os.path.exists(heal_script):
        # Fallback: write a heal request file that the JS process picks up
        req_path = os.path.join(_DATA, f"heal_request_{agent_name}.json")
        with open(req_path, "w") as f:
            json.dump({
                "agent":     agent_name,
                "requested": _iso_now(),
                "source":    "dashboard_api",
            }, f)
        return jsonify({
            "success": True,
            "message": f"Heal request queued for {agent_name}. JS process will pick it up on next check.",
            "requestFile": req_path,
        })

    try:
        result = subprocess.run(
            ["node", heal_script, agent_name],
            capture_output=True, text=True,
            encoding="utf-8", errors="replace",
            timeout=15,
            cwd=_ROOT,
        )
        return jsonify({
            "success": result.returncode == 0,
            "output":  result.stdout.strip(),
            "error":   result.stderr.strip() or None,
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ── POST /api/health/include/<agent> ─────────────────────────────────────────

@health_bp.route("/api/health/include/<agent_name>", methods=["POST"])
def api_include_agent(agent_name: str):
    """Re-include a previously excluded agent in the consensus pool."""
    req_path = os.path.join(_DATA, f"include_request_{agent_name}.json")
    with open(req_path, "w") as f:
        json.dump({"agent": agent_name, "requested": _iso_now()}, f)
    return jsonify({
        "success": True,
        "message": f"Include request queued for {agent_name}.",
    })


# ── POST /api/health/run ──────────────────────────────────────────────────────

@health_bp.route("/api/health/run", methods=["POST"])
def api_run_health_check():
    """Force an immediate health check cycle (reads last result after a short delay)."""
    trigger_path = os.path.join(_DATA, "health_check_trigger.json")
    with open(trigger_path, "w") as f:
        json.dump({"triggered": _iso_now(), "source": "api"}, f)
    return jsonify({
        "success": True,
        "message": "Health check triggered. Poll /api/health in ~5 seconds for results.",
        "pollUrl": "/api/health",
    })
