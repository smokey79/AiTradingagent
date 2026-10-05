-- config/ledger_schema.sql  (2026-10-03 calibration)
-- Schema of data/ledger.db, the single SQLite trade ledger. Read by BOTH src/utils/ledgerDb.js (Node)
-- and core/ledger_db.py (Python) so the two sides can never drift apart.
--
-- source         'dry_run'  paper / demo fills (Freqtrade dry-run, Node paper engine)   <- can be "real" data
--                'live'     real-money fills                                              <- can be "real" data
--                'backtest' results of a historical simulation                            <- never learned from
--                'legacy'   archived records of unknown/invalid provenance                <- never learned from
-- is_simulated   1 = fabricated or arithmetic-only record (flash-loan paper maths, test fixtures, legacy junk)
-- fees_included  1 = pnl_usd is net of fees (and slippage where the engine models it)
--
-- "Real" rows = the view real_trades: closed, not simulated, fee-inclusive, source dry_run or live.
-- Learning modules must read real_trades only.

PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS trades (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ext_id         TEXT    NOT NULL,                       -- id in the originating system
  source         TEXT    NOT NULL CHECK (source IN ('dry_run','live','backtest','legacy')),
  engine         TEXT,                                   -- 'freqtrade' | 'node_paper' | ...
  is_simulated   INTEGER NOT NULL DEFAULT 0 CHECK (is_simulated IN (0,1)),
  fees_included  INTEGER NOT NULL DEFAULT 0 CHECK (fees_included IN (0,1)),
  strategy       TEXT,
  enter_tag      TEXT,
  exit_reason    TEXT,
  pair           TEXT    NOT NULL,
  side           TEXT    NOT NULL,
  opened_at      TEXT,
  closed_at      TEXT,                                   -- NULL while the trade is still open/pending
  entry_price    REAL,
  exit_price     REAL,
  stake_usd      REAL,
  leverage       REAL    DEFAULT 1,
  pnl_usd        REAL,
  pnl_pct        REAL,
  fees_usd       REAL,
  slippage_usd   REAL,
  outcome        TEXT,                                   -- WIN | LOSS | BREAKEVEN | PENDING
  meta           TEXT,                                   -- JSON: anything else worth keeping
  imported_at    TEXT    NOT NULL,
  UNIQUE (source, ext_id)
);

CREATE INDEX IF NOT EXISTS idx_trades_closed ON trades (closed_at);
CREATE INDEX IF NOT EXISTS idx_trades_pair   ON trades (pair);
CREATE INDEX IF NOT EXISTS idx_trades_tag    ON trades (enter_tag);

DROP VIEW IF EXISTS real_trades;
CREATE VIEW real_trades AS
  SELECT * FROM trades
  WHERE is_simulated = 0
    AND fees_included = 1
    AND source IN ('dry_run','live')
    AND closed_at IS NOT NULL
    AND outcome IN ('WIN','LOSS','BREAKEVEN');
