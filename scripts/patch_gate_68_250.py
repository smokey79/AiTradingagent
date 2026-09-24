"""
scripts/patch_gate_68_250.py  (2026-09-24, Alan's instruction)
Changes BOTH gates to 68% win rate over 250 real trades:
  * live-funds gate  (LIVE_GATE_WIN_RATE 0.68 / LIVE_GATE_MIN_TRADES 250)
  * per-signal risk gate + health check + data sourcer (RISK_GATE_MIN_TRADES 250)
and adds LTC TRX ZEC SUI OKB ICP AAVE POL ATOM FLR to the Python lab coin list.

All-or-nothing: every replacement is checked first; nothing is written unless all match.
Line endings (CRLF/LF) are preserved. A .bak copy is kept next to each changed file.
Run from F:\\aitradingagent:   .venv\\Scripts\\python.exe scripts\\patch_gate_68_250.py
"""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
R = "RISK_GATE_N"

PATCHES = {
    "src/risk/tradeLedger.js": [
        ("// Live-funds gate (2026-09-24): 70% win rate over the last 50 real trades.",
         "// Live-funds gate (2026-09-24): 68% win rate over the last 250 real trades (was 70%/50)."),
        ("// Measured on its own 50-trade window", "// Measured on its own 250-trade window"),
        ("FAILS until 50 real trades exist", "FAILS until 250 real trades exist"),
        ("process.env.LIVE_GATE_WIN_RATE || '0.70'", "process.env.LIVE_GATE_WIN_RATE || '0.68'"),
        ("process.env.LIVE_GATE_MIN_TRADES || '50', 10", "process.env.LIVE_GATE_MIN_TRADES || '250', 10"),
        ("// Live-funds gate: 70% over the last 50 real trades. No small-sample pass.",
         "// Live-funds gate: 68% over the last 250 real trades. No small-sample pass."),
    ],
    "src/risk/riskGate.js": [
        ("const MIN_WIN_RATE_GATE = parseFloat(process.env.RISK_MIN_WIN_RATE_GATE || '0.68');",
         "const MIN_WIN_RATE_GATE = parseFloat(process.env.RISK_MIN_WIN_RATE_GATE || '0.68');\n"
         "const RISK_GATE_N = parseInt(process.env.RISK_GATE_MIN_TRADES || '250', 10); // 68% over 250 real trades (Alan, 2026-09-24)"),
        ("const perf = getPerformanceStats(20);", f"const perf = getPerformanceStats({R});"),
        ("if (perf.sampleSize >= 20 && perf.winRate < MIN_WIN_RATE_GATE)",
         f"if (perf.sampleSize >= {R} && perf.winRate < MIN_WIN_RATE_GATE)"),
        ("`Rolling 20-trade win rate (", "`Rolling ${" + R + "}-trade win rate ("),
        ("} else if (perf.sampleSize < 20) {", f"}} else if (perf.sampleSize < {R}) {{"),
        ("${perf.sampleSize}/20 real trades`", "${perf.sampleSize}/${" + R + "} real trades`"),
    ],
    "src/health/systemHealthCheck.js": [
        ("// 2026-09-24: aligned with riskGate.js, 68% over the last 20 real trades (was 72%).",
         "// 2026-09-24: aligned with riskGate.js, 68% over the last 250 real trades (was 72%/20)."),
        ("const stats = getPerformanceStats(20);",
         "const N = parseInt(process.env.RISK_GATE_MIN_TRADES || '250', 10);\n    const stats = getPerformanceStats(N);"),
        ("const collecting = stats.sampleSize < 20;", "const collecting = stats.sampleSize < N;"),
        ("${stats.sampleSize}/20 real trades", "${stats.sampleSize}/${N} real trades"),
    ],
    "src/learning/strategyLearner.js": [
        ("(default 70% over 50 trades)", "(default 68% over 250 trades)"),
        ("to 70% over 50 trades at Alan's instruction.", "to 70% over 50, then to 68% over 250 trades at Alan's instruction."),
        ('process.env.LIVE_GATE_WIN_RATE   || "0.70"', 'process.env.LIVE_GATE_WIN_RATE   || "0.68"'),
        ('process.env.LIVE_GATE_MIN_TRADES || "50", 10', 'process.env.LIVE_GATE_MIN_TRADES || "250", 10'),
    ],
    "mcp-servers/risk-gate-mcp/index.js": [
        ("// Live-funds gate: 70% over 50 trades (changed from 80% / 20 on 2026-09-24).",
         "// Live-funds gate: 68% over 250 trades (80%/20 -> 70%/50 -> 68%/250 on 2026-09-24)."),
        ("process.env.LIVE_GATE_WIN_RATE || '0.70'", "process.env.LIVE_GATE_WIN_RATE || '0.68'"),
        ("process.env.LIVE_GATE_MIN_TRADES || '50', 10", "process.env.LIVE_GATE_MIN_TRADES || '250', 10"),
    ],
    "web-dashboard/routes/dashboard.py": [
        ("# Live-funds gate: 70% over 50 paper trades (changed from 80% / 20 on 2026-09-24).",
         "# Live-funds gate: 68% over 250 paper trades (80%/20 -> 70%/50 -> 68%/250 on 2026-09-24)."),
        ('os.getenv("LIVE_GATE_WIN_RATE", "0.70")', 'os.getenv("LIVE_GATE_WIN_RATE", "0.68")'),
        ('os.getenv("LIVE_GATE_MIN_TRADES", "50")', 'os.getenv("LIVE_GATE_MIN_TRADES", "250")'),
    ],
    "START-PAPER-TRADE.ps1": [
        ("Need 70% over 50 paper trades", "Need 68% over 250 paper trades"),
    ],
    "src/brokers/trading212Broker.js": [
        ("(70% win rate over the last 50 real trades)", "(68% win rate over the last 250 real trades)"),
        ("getPerformanceStats(50).liveGate", "getPerformanceStats(250).liveGate"),
        ("gate.requiredTrades || 50}", "gate.requiredTrades || 250}"),
    ],
    "orchestrator/data_sourcer_agent.py": [
        ("GATE_MIN_SAMPLE (20) real trades", "GATE_MIN_SAMPLE (250) real trades"),
        ("Below 20 trades the gate", "Below 250 trades the gate"),
        ("GATE_MIN_SAMPLE          default 20", "GATE_MIN_SAMPLE          default 250 (or RISK_GATE_MIN_TRADES)"),
        ('GATE_MIN_SAMPLE = int(os.getenv("GATE_MIN_SAMPLE", "20"))',
         'GATE_MIN_SAMPLE = int(os.getenv("GATE_MIN_SAMPLE", os.getenv("RISK_GATE_MIN_TRADES", "250")))'),
        ("trades = self._get_trade_history(50)", "trades = self._get_trade_history(max(GATE_MIN_SAMPLE, 50))"),
        ("before 20 trades", "before 250 trades"),
    ],
    "tests/test_trade_ledger_gate.js": [
        ("(70% over the last 50 real trades,", "(68% over the last 250 real trades,"),
        ("s = statsFor(trades(49, 49));\n", "s = statsFor(trades(249, 249));\n"),
        ("'49 trades is below the 50-trade minimum'", "'249 trades is below the 250-trade minimum'"),
        ("s = statsFor(trades(50, 34));", "s = statsFor(trades(250, 169));"),
        ("'68% over 50 is below 70%'", "'67.6% over 250 is below 68%'"),
        ("s = statsFor(trades(50, 35));", "s = statsFor(trades(250, 170));"),
        ("'70% over 50 passes, even when", "'68% over 250 passes, even when"),
        ("s = statsFor([...trades(50, 35),", "s = statsFor([...trades(250, 170),"),
        ("assert.strictEqual(s.liveGate.trades, 50,", "assert.strictEqual(s.liveGate.trades, 250,"),
    ],
    "tests/test_data_sourcer_real.py": [
        ("# 7 < 20", "# 7 < 250"),
        ("def test_gate_met_and_failed_after_20(paths):", "def test_gate_met_and_failed_after_250(paths):"),
        ('_write_ledger(paths / "trade_ledger.json", 14, 6)               # 70%',
         '_write_ledger(paths / "trade_ledger.json", 175, 75)             # 70% over 250'),
        ('_write_ledger(paths / "trade_ledger.json", 13, 7)               # 65%',
         '_write_ledger(paths / "trade_ledger.json", 163, 87)             # 65.2% over 250\n'
         '    s = ds.DataSourcerAgent().evaluate_feeds(market_data=GOOD_MARKET)\n'
         '    assert s["gate_status"] == "FAILED" and s["sourcer_verdict"] == "HOLD"\n'
         '    _write_ledger(paths / "trade_ledger.json", 200, 49)             # 80% but only 249 trades\n'
         '    s = ds.DataSourcerAgent().evaluate_feeds(market_data=GOOD_MARKET)\n'
         '    assert s["gate_applicable"] is False and not s["gate_68_met"]\n'
         '    _write_ledger(paths / "trade_ledger.json", 163, 87)'),
    ],
    "pybacktest/run_grid.py": [
        ('COINS = ["BTC", "ETH", "SOL", "AVAX", "ARB", "OP", "CRO"]',
         'COINS = ["BTC", "ETH", "SOL", "AVAX", "ARB", "OP", "CRO",\n'
         '         "LTC", "TRX", "ZEC", "SUI", "OKB", "ICP", "AAVE", "POL", "ATOM", "FLR"]  # +10 added 2026-09-24'),
        ("Defaults: 7 coins (BTC ETH SOL AVAX ARB OP CRO) x 8 timeframes (15m 30m 1h 2h 4h 6h 12h 1d)\nx 5 strategies (the 4 lab strategies + ST_AI) = 280 cells",
         "Defaults: 17 coins (BTC ETH SOL AVAX ARB OP CRO LTC TRX ZEC SUI OKB ICP AAVE POL ATOM FLR)\nx 8 timeframes (15m 30m 1h 2h 4h 6h 12h 1d) x 5 strategies (4 lab + ST_AI) = 680 cells"),
    ],
}


def main():
    staged = {}
    bad = []
    for rel, reps in PATCHES.items():
        p = ROOT / rel
        with open(p, "r", encoding="utf-8", newline="") as f:
            text = f.read()
        eol = "\r\n" if "\r\n" in text else "\n"
        for old, new in reps:
            o, n = old.replace("\n", eol), new.replace("\n", eol)
            c = text.count(o)
            if c != 1:
                bad.append(f"{rel}: expected 1 match, found {c}: {old[:70]!r}")
                continue
            text = text.replace(o, n)
        staged[rel] = text
    if bad:
        print("NOTHING WRITTEN. Mismatches:\n  " + "\n  ".join(bad))
        return 1
    for rel, text in staged.items():
        p = ROOT / rel
        shutil.copy2(p, p.with_suffix(p.suffix + ".bak"))
        with open(p, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        print("patched", rel)
    return 0


if __name__ == "__main__":
    sys.exit(main())
