# F:\aitradingagent\MERGE_PROJECT.py
# Merges Aitradingbot-skeleton and agents\AI-Trading-Agent into canonical root
# Run: python MERGE_PROJECT.py
import os, shutil, pathlib

ROOT     = pathlib.Path("F:/aitradingagent")
SKELETON = ROOT / "Aitradingbot-skeleton" / "caudemllmcode2arbritrage"
AGENT    = ROOT / "agents" / "AI-Trading-Agent"

# Map: source file -> destination in canonical structure
MERGE_MAP = {
    # Arbitrage modules from skeleton
    SKELETON / "arbitrage_scanner.py"   : ROOT / "src/flashloan/arbitrage_scanner.py",
    SKELETON / "chains.py"              : ROOT / "config/chains.py",
    SKELETON / "cross_chain_arbitrage.py": ROOT / "src/flashloan/cross_chain_arbitrage.py",
    SKELETON / "dexscreener_feed.py"    : ROOT / "src/data/dexscreener_feed.py",
    SKELETON / "gas_optimizer.py"       : ROOT / "src/utils/gas_optimizer.py",
    SKELETON / "slippage_control.py"    : ROOT / "src/utils/slippage_control.py",
    SKELETON / "test_multichain.py"     : ROOT / "tests/test_multichain.py",
    SKELETON / "price_aggregator.py"    : ROOT / "src/data/price_aggregator.py",
    # Agent connectors
    AGENT / "connectors/bitget_client.py"   : ROOT / "src/execution/bitget_client.py",
    AGENT / "connectors/cryptocom_client.py": ROOT / "src/execution/cryptocom_client.py",
    # Agent core
    AGENT / "autonomous_engine.py"  : ROOT / "src/orchestrator/autonomous_engine.py",
    AGENT / "main_engine.py"        : ROOT / "src/orchestrator/main_engine.py",
    AGENT / "webhook_engine.py"     : ROOT / "src/orchestrator/webhook_engine.py",
    AGENT / "agents/openrouterFreeAgent.js": ROOT / "src/agents/openrouterFreeAgent.js",
}

print("="*60)
print("  AITRADINGAGENT PROJECT MERGE")
print("="*60)

merged, skipped, errors = 0, 0, 0
for src, dst in MERGE_MAP.items():
    if not src.exists():
        print(f"  SKIP (not found): {src.name}")
        skipped += 1
        continue
    dst.parent.mkdir(parents=True, exist_ok=True)
    # Only overwrite if source is newer or destination doesn't exist
    if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
        print(f"  KEEP (newer):     {dst.relative_to(ROOT)}")
        skipped += 1
        continue
    try:
        shutil.copy2(src, dst)
        print(f"  MERGED:           {src.name} -> {dst.relative_to(ROOT)}")
        merged += 1
    except Exception as e:
        print(f"  ERROR:            {src.name}: {e}")
        errors += 1

# Create missing __init__.py markers
init_dirs = [
    "src", "src/data", "src/flashloan", "src/utils",
    "src/agents", "src/execution", "src/orchestrator",
    "src/sentiment", "src/learning", "src/strategy",
    "src/risk", "config", "tests", "data_sources", "risk",
    "web-dashboard/routes"
]
for d in init_dirs:
    init_file = ROOT / d / "__init__.py"
    init_file.parent.mkdir(parents=True, exist_ok=True)
    if not init_file.exists():
        init_file.write_text("# package\n")
        print(f"  CREATED:          {d}/__init__.py")

print()
print(f"  Done: {merged} merged, {skipped} skipped, {errors} errors")
print("="*60)
