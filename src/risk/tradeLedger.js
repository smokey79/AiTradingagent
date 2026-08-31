/**
 * Persistent Trade Ledger & Performance Analytics
 * Tracks trade executions, rolling win rate, PnL history, and risk metrics.
 */
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DATA_DIR = path.resolve(__dirname, '../../data');
const LEDGER_PATH = path.join(DATA_DIR, 'trade_ledger.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadLedger() {
  ensureDataDir();
  try {
    if (fs.existsSync(LEDGER_PATH)) {
      const data = fs.readFileSync(LEDGER_PATH, 'utf8');
      return data
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line);
          } catch (err) {
            return null;
          }
        })
        .filter(Boolean);
    }
  } catch (e) {
    logger.warn(`Could not read trade ledger: ${e.message}`);
  }
  return [];
}

function recordTrade(trade) {
  const entry = {
    id: trade.id || `T${Date.now()}`,
    timestamp: trade.timestamp || new Date().toISOString(),
    pair: trade.pair,
    symbol: trade.symbol || trade.pair?.split('/')[0],
    side: trade.side?.toUpperCase() || 'BUY',
    price: trade.price,
    amount: trade.amount,
    positionSizeUsd: trade.positionSizeUsd || 0,
    leverage: trade.leverage || 1,
    pnlUsd: trade.pnlUsd || 0,
    pnlPct: trade.pnlPct || 0,
    outcome: trade.outcome || (trade.pnlUsd > 0 ? 'WIN' : trade.pnlUsd < 0 ? 'LOSS' : 'BREAKEVEN'),
    confidence: trade.confidence || 0,
    agentsAgreeing: trade.agentsAgreeing || 0,
    paper: trade.paper !== false,
    reason: trade.reason || '',
  };

  ensureDataDir();
  fs.appendFileSync(LEDGER_PATH, JSON.stringify(entry) + '\n');

  // Dispatch asynchronous Telegram trade alert
  try {
    const { sendTradeAlert } = require('../notifications/telegramNotifier');
    sendTradeAlert(entry).catch(() => {});
  } catch (e) {}

  return entry;
}

function getPerformanceStats(lastN = 20) {
  const ledger = loadLedger();
  const recent = ledger.slice(-lastN);
  const total = recent.length;

  if (total === 0) {
    return {
      sampleSize: 0,
      totalTradesEver: ledger.length,
      winRate: 0.85, // Default prior for bootstrap
      winRatePct: '85.0%',
      wins: 0,
      losses: 0,
      breakeven: 0,
      totalPnlUsd: 0,
      avgPnlUsd: 0,
      profitabilityGatePassed: true,
      sufficientSample: false,
    };
  }

  const wins = recent.filter(t => t.outcome === 'WIN').length;
  const losses = recent.filter(t => t.outcome === 'LOSS').length;
  const be = recent.filter(t => t.outcome === 'BREAKEVEN').length;

  const winRate = parseFloat((wins / total).toFixed(3));
  const totalPnlUsd = parseFloat(recent.reduce((s, t) => s + (t.pnlUsd || 0), 0).toFixed(2));
  const avgPnlUsd = parseFloat((totalPnlUsd / total).toFixed(2));

  return {
    sampleSize: total,
    totalTradesEver: ledger.length,
    winRate,
    winRatePct: `${(winRate * 100).toFixed(1)}%`,
    wins,
    losses,
    breakeven: be,
    totalPnlUsd,
    avgPnlUsd,
    profitabilityGatePassed: total < 10 || winRate >= 0.80,
    sufficientSample: total >= 20,
    recentTrades: recent.slice(-10),
  };
}

module.exports = {
  loadLedger,
  recordTrade,
  getPerformanceStats,
};
