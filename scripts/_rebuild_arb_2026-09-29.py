# Rebuild continuousArbEngine.js = new header + the NEW body that was appended after the old code.
import pathlib
root = pathlib.Path(r"F:\aitradingagent")
eng = root / "src/arbitrage/continuousArbEngine.js"
header = (root / "scripts/_arb_header_2026-09-29.js.txt").read_text(encoding="utf-8")
src = eng.read_text(encoding="utf-8")
marker = "\n// ── State ─────"
idx = src.rfind(marker)          # last occurrence = start of the new body
assert idx > 0 and "paperObservations" in src[idx:], "new body not found"
eng.write_text(header + src[idx:], encoding="utf-8")
print("rebuilt, lines:", (header + src[idx:]).count("\n"))
