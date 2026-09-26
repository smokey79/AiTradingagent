"""
bridge/python_to_node.py

Publishes Python engine decisions and arbitrage signals
to the Node.js engine at F:\\aitradingagent via:
  1. Shared JSON files (portfolio_state.json etc)
  2. HTTP POST to the Node.js internal API (port 3002)

This is the glue layer between:
  - Python: multi-chain arb scanner + LLM debate + learning
  - Node.js: 13-agent orchestrator + dashboard + PM2

Alan J | barcay0611@gmail.com | github: smokey79
"""

from __future__ import annotations
import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
import requests

logger = logging.getLogger(__name__)

# ── Paths — adjust if F: drive letter changes ──────────────────────────────
NODE_ROOT          = Path(os.getenv("NODE_ROOT", r"F:\aitradingagent"))
PORTFOLIO_STATE    = NODE_ROOT / "portfolio_state.json"
VAULT_SUMMARY      = NODE_ROOT / "vault_summary.json"
LATEST_DECISION    = NODE_ROOT / "latest_decision.json"

# ── Node.js dashboard API (port 3002) ──────────────────────────────────────
NODE_API_BASE      = os.getenv("NODE_API_BASE", f"http://localhost:{os.getenv('PORT', os.getenv('DASHBOARD_PORT', '3001'))}")
NODE_API_TIMEOUT   = 5   # seconds

PAPER_TRADE_MODE   = os.getenv("PAPER_TRADE_MODE", "true").lower() == "true"


# ---------------------------------------------------------------------------
# File bridge (always works — no network needed)
# ---------------------------------------------------------------------------

def _write_json(path: Path, data: Dict[str, Any]) -> None:
    """
    Atomic JSON write — write to temp file then os.replace() so Node.js
    never reads a partial file. Retries on Windows file-lock conflicts.
    """
    import tempfile

    content = json.dumps(data, indent=2, default=str)
    path.parent.mkdir(parents=True, exist_ok=True)

    max_retries = 3
    for attempt in range(max_retries):
        try:
            # Write to temp file in same directory (required for atomic replace)
            fd, tmp_path = tempfile.mkstemp(
                suffix=".tmp", prefix=path.stem + "_", dir=str(path.parent)
            )
            try:
                os.write(fd, content.encode("utf-8"))
            finally:
                os.close(fd)

            # Atomic replace (os.replace is atomic on same filesystem)
            os.replace(tmp_path, str(path))
            logger.debug("Written: %s", path)
            return
        except PermissionError:
            # Windows file-lock conflict — brief retry
            if attempt < max_retries - 1:
                time.sleep(0.1 * (attempt + 1))
                logger.debug("Retrying write to %s (attempt %d)", path, attempt + 2)
            else:
                logger.error("Failed to write %s after %d attempts", path, max_retries)
                raise
        except Exception:
            # Clean up temp file on unexpected error
            try:
                os.unlink(tmp_path)
            except (OSError, UnboundLocalError):
                pass
            raise


def publish_decision(
    symbol  : str,
    action  : str,    # LONG | SHORT | FLAT
    size    : float,
    reason  : str,
    source  : str,    # debate | llm | baseline
    confidence: float = 0.0,
) -> None:
    """Write latest_decision.json — Node.js orchestrator polls this."""
    payload = {
        "timestamp"  : datetime.now(timezone.utc).isoformat(),
        "symbol"     : symbol,
        "action"     : action,
        "size"        : round(size, 4),
        "reason"     : reason,
        "source"     : source,
        "confidence" : round(confidence, 4),
        "paper_mode" : PAPER_TRADE_MODE,
        "engine"     : "python",
    }
    _write_json(LATEST_DECISION, payload)
    logger.info("Decision published: %s %s (src=%s)", action, symbol, source)


def publish_arb_opportunity(opportunities: List[Dict[str, Any]]) -> None:
    """
    Write arbitrage opportunities into vault_summary.json so the
    Node.js dashboard can display them in real time.
    """
    payload = {
        "timestamp"     : datetime.now(timezone.utc).isoformat(),
        "engine"        : "python_arb_scanner",
        "opportunities" : opportunities[:10],   # cap at 10
        "count"         : len(opportunities),
        "paper_mode"    : PAPER_TRADE_MODE,
    }
    _write_json(VAULT_SUMMARY, payload)
    logger.info("Arb opportunities published: %d", len(opportunities))


def publish_portfolio_state(
    equity_usd  : float,
    open_trades : List[Dict],
    daily_pnl   : float,
    win_rate    : float,
) -> None:
    """Update portfolio_state.json — the Node.js dashboard reads this for charts."""
    payload = {
        "timestamp"      : datetime.now(timezone.utc).isoformat(),
        "equity_usd"     : round(equity_usd,  2),
        "daily_pnl_usd"  : round(daily_pnl,   2),
        "win_rate"       : round(win_rate,     4),
        "open_trades"    : open_trades,
        "open_count"     : len(open_trades),
        "paper_mode"     : PAPER_TRADE_MODE,
        "engine"         : "python",
    }
    _write_json(PORTFOLIO_STATE, payload)


# ---------------------------------------------------------------------------
# HTTP bridge (when Node.js API is running)
# ---------------------------------------------------------------------------

def _post(endpoint: str, payload: Dict) -> bool:
    """POST to Node.js API. Returns True on success, False on any error."""
    url = f"{NODE_API_BASE}{endpoint}"
    try:
        resp = requests.post(url, json=payload, timeout=NODE_API_TIMEOUT)
        if resp.ok:
            return True
        logger.warning("Node API %s returned %d: %s", url, resp.status_code, resp.text[:100])
        return False
    except requests.exceptions.ConnectionError:
        logger.debug("Node API not reachable at %s — using file bridge only.", url)
        return False
    except Exception as exc:
        logger.warning("Node API error: %s", exc)
        return False


def notify_node_decision(symbol: str, action: str, reason: str) -> None:
    """
    Send a signal to Node.js orchestrator via HTTP.
    Falls back silently if Node.js isn't running.
    """
    _post("/api/python-signal", {
        "symbol": symbol,
        "action": action,
        "reason": reason,
        "ts"    : datetime.now(timezone.utc).isoformat(),
    })


def notify_node_arb(opportunities: List[Dict]) -> None:
    _post("/api/python-arb", {
        "opportunities": opportunities[:5],
        "ts": datetime.now(timezone.utc).isoformat(),
    })


# ---------------------------------------------------------------------------
# Combined publisher (use this in prod)
# ---------------------------------------------------------------------------

class BridgePublisher:
    """
    Single entry point — writes JSON files AND pings Node.js API.
    Always writes files (reliable), HTTP is best-effort.
    """

    def on_decision(
        self,
        symbol     : str,
        action     : str,
        size       : float,
        reason     : str,
        source     : str,
        confidence : float = 0.0,
    ) -> None:
        publish_decision(symbol, action, size, reason, source, confidence)
        notify_node_decision(symbol, action, reason)

    def on_arb_scan(self, opportunities: List[Dict]) -> None:
        publish_arb_opportunity(opportunities)
        notify_node_arb(opportunities)

    def on_portfolio_update(
        self,
        equity_usd  : float,
        open_trades : List[Dict],
        daily_pnl   : float,
        win_rate    : float,
    ) -> None:
        publish_portfolio_state(equity_usd, open_trades, daily_pnl, win_rate)

# ---------------------------------------------------------------------------
# CLI entry point (invoked by Node.js via child_process / stdio)
# ---------------------------------------------------------------------------

def _emit(payload: Dict[str, Any], stream: Any = None) -> None:
    """Emit a single structured JSON line to stdout (or the given stream)."""
    target = stream if stream is not None else sys.stdout
    target.write(json.dumps(payload, default=str) + "\n")
    target.flush()


def _error(message: str, error_type: str, **extra: Any) -> Dict[str, Any]:
    """Build the structured JSON error envelope returned on any failure."""
    payload: Dict[str, Any] = {
        "ok"        : False,
        "error"     : message,
        "error_type": error_type,
        "timestamp" : datetime.now(timezone.utc).isoformat(),
        "engine"    : "python",
    }
    payload.update(extra)
    return payload

def _read_stdin_payload(raw: Optional[str]) -> Optional[Dict[str, Any]]:
    """
    Read and validate a JSON payload from raw text (or stdin when raw is None).

    Returns the parsed dict, or None when the input is empty/whitespace-only.
    Raises ValueError on malformed JSON or a non-object top level.
    """
    if raw is None:
        stream = getattr(sys, "stdin", None)
        if stream is None:
            raise ValueError("no stdin available on this platform")
        try:
            raw = stream.read()
        except (OSError, ValueError) as exc:
            raise ValueError(f"could not read stdin: {exc}") from exc
    if raw is None or not raw.strip():
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid JSON on stdin: {exc.msg} (line {exc.lineno}"
                         f" col {exc.colno})") from exc
    if parsed is None:
        return None
    if not isinstance(parsed, dict):
        raise ValueError(
            f"expected a JSON object at top level, got {type(parsed).__name__}"
        )
    return parsed

def _dispatch(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Route a validated payload to the correct publisher."""
    command = str(payload.get("command") or payload.get("type") or "").strip().lower()

    if command in ("decision", "signal"):
        symbol = payload.get("symbol")
        action = payload.get("action")
        if not symbol or not action:
            raise ValueError("decision payload requires 'symbol' and 'action'")
        publish_decision(
            symbol     = str(symbol),
            action     = str(action).upper(),
            size       = float(payload.get("size", 0.0) or 0.0),
            reason     = str(payload.get("reason", "")),
            source     = str(payload.get("source", "cli")),
            confidence = float(payload.get("confidence", 0.0) or 0.0),
        )
        notify_node_decision(str(symbol), str(action).upper(), str(payload.get("reason", "")))
        return {"command": "decision", "symbol": str(symbol), "action": str(action).upper()}

    if command in ("arb", "opportunities"):
        opportunities = payload.get("opportunities")
        if not isinstance(opportunities, list):
            raise ValueError("arb payload requires an 'opportunities' array")
        publish_arb_opportunity(opportunities)
        notify_node_arb(opportunities)
        return {"command": "arb", "count": len(opportunities)}

    if command in ("portfolio", "portfolio_update"):
        open_trades = payload.get("open_trades", [])
        if not isinstance(open_trades, list):
            raise ValueError("'open_trades' must be an array")
        publish_portfolio_state(
            equity_usd  = float(payload.get("equity_usd", 0.0) or 0.0),
            open_trades = open_trades,
            daily_pnl   = float(payload.get("daily_pnl", 0.0) or 0.0),
            win_rate    = float(payload.get("win_rate", 0.0) or 0.0),
        )
        return {"command": "portfolio", "open_count": len(open_trades)}

    raise ValueError(
        f"unknown command {command!r}; expected one of: "
        "decision, arb, portfolio"
    )


def main(argv: Optional[List[str]] = None) -> int:
    """
    CLI entry point. Never raises: all failures are reported as a structured
    JSON error payload on stdout plus a non-zero exit code.
    """
    parser = argparse.ArgumentParser(
        prog="python_to_node",
        description="Publish Python engine output to the Node.js bridge.",
    )
    parser.add_argument(
        "--json",
        dest="raw_json",
        default=None,
        help="JSON payload as a string (otherwise read from stdin).",
    )
    parser.add_argument(
        "--command",
        default=None,
        help="Payload command when passing flags instead of a JSON blob.",
    )
    parser.add_argument("--symbol", default=None)
    parser.add_argument("--action", default=None)
    parser.add_argument("--size", type=float, default=0.0)
    parser.add_argument("--reason", default="")
    parser.add_argument("--source", default="cli")
    parser.add_argument("--confidence", type=float, default=0.0)

    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        # argparse exits on --help / bad flags — surface it as structured JSON.
        code = exc.code if isinstance(exc.code, int) else 2
        if code != 0:
            _emit(_error(
                "invalid command-line arguments",
                "ArgumentError",
                ok=False,
            ))
        return code
    try:
        # Build the payload from either --json, stdin, or explicit flags.
        payload: Optional[Dict[str, Any]] = None
        if args.raw_json is not None:
            payload = _read_stdin_payload(args.raw_json)
        elif args.command is None:
            payload = _read_stdin_payload(None)

        if payload is None and args.command is not None:
            payload = {
                "command"   : args.command,
                "symbol"    : args.symbol,
                "action"    : args.action,
                "size"      : args.size,
                "reason"    : args.reason,
                "source"    : args.source,
                "confidence": args.confidence,
            }

        if payload is None:
            _emit(_error(
                "no input received: stdin was empty and no --command was given",
                "EmptyInputError",
            ))
            return 2
        result = _dispatch(payload)

    except ValueError as exc:
        logger.warning("Bridge input rejected: %s", exc)
        _emit(_error(str(exc), type(exc).__name__))
        return 2
    except (OSError, PermissionError) as exc:
        logger.error("Bridge I/O failure: %s", exc)
        _emit(_error(str(exc), type(exc).__name__))
        return 3
    except Exception as exc:  # pragma: no cover - defensive catch-all
        logger.exception("Bridge unexpected failure")
        _emit(_error(str(exc), type(exc).__name__))
        return 1
    _emit({
        "ok"        : True,
        "result"    : result,
        "timestamp" : datetime.now(timezone.utc).isoformat(),
        "engine"    : "python",
        "paper_mode": PAPER_TRADE_MODE,
    })
    return 0
if __name__ == "__main__":
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    raise SystemExit(main())
