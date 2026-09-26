# src/flashloan/flash_loan_executor.py
# AiTradingAgent -- Flash Loan Executor
#
# Reads arbitrage opportunities produced by arbitrage_scanner.py,
# validates net profitability (spread > gas + Aave 0.09% fee),
# then either simulates (PAPER_TRADE_MODE=true) or executes on-chain.
#
# Supported chains: Ethereum, Arbitrum, Optimism, Avalanche (Aave V3)
# Tokens in scope : ETH, ARB, OP, AVAX, USDC (bridge asset)
#
# Dependencies: pip install web3 python-dotenv requests

import os, sys, json, time, logging, sqlite3
from pathlib import Path
from datetime import datetime, timezone
from dotenv import load_dotenv

# ── Environment ───────────────────────────────────────────────────────────────
# FIX 2026-09-13: was hardcoded to C:/Users/AlanJ/.../.env, a path that no
# longer exists. Resolve the canonical .env from this file's location
# (src/flashloan/flash_loan_executor.py -> project root -> .env), matching
# the pattern already used in src/utils/envValidator.py.
ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(ENV_PATH)

PAPER_MODE       = os.getenv('PAPER_TRADE_MODE', 'true').lower() != 'false'
MIN_PROFIT_USD   = float(os.getenv('FLASHLOAN_MIN_PROFIT_USD', '5'))
SCAN_INTERVAL    = int(os.getenv('FLASHLOAN_EXEC_INTERVAL_S', '30'))
SIGNALS_FILE     = Path(os.getenv('FLASHLOAN_SIGNALS_FILE',
                        'F:/aitradingagent/data/flashloan_signals.json'))
DB_PATH          = Path(os.getenv('TRADING_DB', 'F:/aitradingagent/trading.db'))
AAVE_FEE_PCT     = 0.0009   # Aave V3 flash loan fee: 0.09%

# ── Aave V3 Pool addresses (same proxy across most EVM L2s) ──────────────────
AAVE_POOLS = {
    'ethereum' : '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    'arbitrum' : '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    'optimism' : '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    'avalanche': '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
}

RPC_URLS = {
    'ethereum' : os.getenv('ETH_RPC_URL',  'https://eth.llamarpc.com'),
    'arbitrum' : os.getenv('ARB_RPC_URL',  'https://arb1.arbitrum.io/rpc'),
    'optimism' : os.getenv('OP_RPC_URL',   'https://mainnet.optimism.io'),
    'avalanche': os.getenv('AVAX_RPC_URL', 'https://api.avax.network/ext/bc/C/rpc'),
}

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level   = logging.INFO,
    format  = '%(asctime)s [FlashLoan] %(levelname)s %(message)s',
    datefmt = '%Y-%m-%d %H:%M:%S',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('F:/aitradingagent/logs/flashloan_executor.log'),
    ]
)
log = logging.getLogger('flashloan')

# ── SQLite helpers ────────────────────────────────────────────────────────────
def _ensure_table(conn):
    conn.execute('''
        CREATE TABLE IF NOT EXISTS flashloan_trades (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            ts          TEXT,
            chain       TEXT,
            token_in    TEXT,
            amount_usd  REAL,
            spread_pct  REAL,
            gas_usd     REAL,
            net_pct     REAL,
            profit_usd  REAL,
            mode        TEXT,
            tx_hash     TEXT,
            status      TEXT
        )
    ''')
    conn.commit()

def _log_trade(opp, profit_usd, tx_hash='PAPER', status='simulated'):
    try:
        with sqlite3.connect(DB_PATH) as conn:
            _ensure_table(conn)
            conn.execute('''
                INSERT INTO flashloan_trades
                    (ts, chain, token_in, amount_usd, spread_pct, gas_usd, net_pct, profit_usd, mode, tx_hash, status)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ''', (
                datetime.now(timezone.utc).isoformat(),
                opp.get('chain'), opp.get('token_in'),
                opp.get('amount_usd'), opp.get('spread_pct'),
                opp.get('gas_usd_est', 0), opp.get('net_pct'),
                profit_usd, 'paper' if PAPER_MODE else 'live',
                tx_hash, status
            ))
            conn.commit()
    except Exception as e:
        log.warning(f"DB write failed: {e}")

# ── Profitability gate ────────────────────────────────────────────────────────
def is_profitable(opp: dict) -> tuple[bool, float]:
    """Return (viable, net_profit_usd) after subtracting Aave fee + gas."""
    amount   = opp.get('amount_usd', 0)
    spread   = opp.get('spread_pct', 0) / 100
    gas_est  = opp.get('gas_usd_est', 0)
    gross    = amount * spread
    fee      = amount * AAVE_FEE_PCT
    net      = gross - fee - gas_est
    opp['net_pct'] = (net / amount * 100) if amount else 0
    return net >= MIN_PROFIT_USD, net

# ── Paper mode execution ──────────────────────────────────────────────────────
def execute_paper(opp: dict, profit_usd: float):
    log.info(
        f"[PAPER] {opp['chain'].upper()} | {opp['token_in']} "
        f"${opp['amount_usd']:.0f} | spread {opp['spread_pct']:.3f}% "
        f"| net +${profit_usd:.2f} | gas ${opp.get('gas_usd_est',0):.2f}"
    )
    _log_trade(opp, profit_usd, tx_hash='PAPER', status='simulated')

# ── Live execution stub ───────────────────────────────────────────────────────
def execute_live(opp: dict, profit_usd: float):
    """
    TODO: implement live flash loan execution.
    Requires:
      - EXECUTOR_PRIVATE_KEY in .env (never commit)
      - Deployed FlashLoanReceiver contract on target chain
      - web3.py + ABI wired to AAVE_POOLS[chain]
    """
    chain = opp.get('chain', 'unknown')
    log.warning(f"[LIVE] Execution not yet implemented for {chain}. "
                "Deploy FlashLoanReceiver contract first.")
    _log_trade(opp, profit_usd, tx_hash='NOT_IMPLEMENTED', status='skipped')

# ── Main loop ─────────────────────────────────────────────────────────────────
def load_signals() -> list[dict]:
    if not SIGNALS_FILE.exists():
        return []
    try:
        return json.loads(SIGNALS_FILE.read_text(encoding='utf-8'))
    except Exception:
        return []

def run():
    mode_label = 'PAPER' if PAPER_MODE else 'LIVE'
    log.info(f"Flash Loan Executor starting | mode={mode_label} "
             f"| min_profit=${MIN_PROFIT_USD} | interval={SCAN_INTERVAL}s")

    while True:
        signals = load_signals()
        if not signals:
            log.debug("No signals available -- waiting...")
        for opp in signals:
            viable, profit = is_profitable(opp)
            if not viable:
                log.debug(f"Skip {opp.get('chain')} {opp.get('token_in')} "
                          f"profit=${profit:.2f} < threshold")
                continue
            if PAPER_MODE:
                execute_paper(opp, profit)
            else:
                execute_live(opp, profit)
        time.sleep(SCAN_INTERVAL)

if __name__ == '__main__':
    run()
