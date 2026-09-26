/**
 * Signal Bridge — Node Consensus -> Freqtrade
 * =============================================
 * Writes the 13-agent consensus decision for each pair to a shared JSON
 * file that a custom Freqtrade strategy (ConsensusBridgeStrategy) reads on
 * every candle. This lets Freqtrade's mature execution engine (real
 * exchange-side stop-loss orders, position tracking, restart reconciliation
 * — all things the custom Node executor does NOT have yet, see
 * claude/real-trading-readiness-report.md) act on the SAME signal your
 * existing 13-agent system already produces, instead of Freqtrade computing
 * its own indicators.
 *
 * This does not change what the Node orchestrator does today — it is purely
 * additive. runTradingCycle() keeps running its own paper/live execution
 * exactly as before; this just also writes a copy of the decision out.
 *
 * File format (data/freqtrade_signals.json):
 * {
 *   "updatedAt": "2026-09-03T21:00:00.000Z",
 *   "signals": {
 *     "BTC/USDT": { "signal": "BUY", "confidence": 0.62, "agentsAgreeing": 6, "reasoning": "...", "ts": "..." },
 *     "ETH/USDT": { "signal": "HOLD", "confidence": 0.31, ... }
 *   }
 * }
 *
 * Freqtrade's pair format is "BTC/USDT" too, so no translation needed.
 */
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DATA_DIR    = path.resolve(__dirname, '../../data');
const SIGNALS_FILE = path.join(DATA_DIR, 'freqtrade_signals.json');
const TG_FILE      = path.join(DATA_DIR, 'telegram_signals.json');

let pending = {};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function recordSignal(pair, consensus) {
  pending[pair] = {
    signal:        consensus.signal || 'HOLD',
    confidence:    typeof consensus.confidence === 'number' ? consensus.confidence : 0,
    approved:      !!consensus.approved_for_execution,
    agentsAgreeing:consensus.agentsAgreeing ?? null,
    reasoning:     consensus.reasoning || '',
    ts:            new Date().toISOString(),
  };
}

/**
 * Called by telegramListener when a structured signal arrives.
 * Writes to telegram_signals.json so orchestrator picks it up next cycle.
 */
function recordSignalFromTelegram(signal) {
  try {
    ensureDataDir();
    let existing = [];
    if (fs.existsSync(TG_FILE)) {
      existing = JSON.parse(fs.readFileSync(TG_FILE, 'utf8'));
    }
    existing.unshift({ ...signal, savedAt: new Date().toISOString() });
    if (existing.length > 100) existing = existing.slice(0, 100);
    fs.writeFileSync(TG_FILE, JSON.stringify(existing, null, 2));
    logger.info(`[SignalBridge] Telegram signal saved: ${signal.action} ${signal.symbol || '?'}`);
  } catch (err) {
    logger.warn(`[SignalBridge] Could not save Telegram signal: ${err.message}`);
  }
}

function flushSignals() {
  try {
    ensureDataDir();
    const payload = { updatedAt: new Date().toISOString(), signals: pending };
    const tmp = `${SIGNALS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, SIGNALS_FILE);
    pending = {};
  } catch (err) {
    logger.warn(`[signalBridge] Failed to write freqtrade_signals.json: ${err.message}`);
  }
}

module.exports = { recordSignal, flushSignals, recordSignalFromTelegram, SIGNALS_FILE };
