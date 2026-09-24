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
    // Added 2026-09-15. pnlUsd is NET of execution cost; keep the gross figure
    // and the deduction alongside it so a result can never be mistaken for a
    // cost-free one, and so the cost assumption itself stays auditable.
    grossPnlUsd: trade.grossPnlUsd !== undefined ? trade.grossPnlUsd : null,
    costUsd: trade.costUsd !== undefined ? trade.costUsd : null,
    costPct: trade.costPct !== undefined ? trade.costPct : null,
    outcome: trade.outcome || (trade.pnlUsd > 0 ? 'WIN' : trade.pnlUsd < 0 ? 'LOSS' : 'BREAKEVEN'),
    confidence: trade.confidence || 0,
    agentsAgreeing: trade.agentsAgreeing || 0,
    // Added 2026-09-15 so the improvement loop can attribute outcomes to the
    // agents that actually voted for the trade. Without these three fields the
    // ledger records WHAT happened but never WHO called it, and no amount of
    // trade history can then tell a useful agent from a harmful one.
    totalAgents: trade.totalAgents || 0,
    agentVotes: trade.agentVotes || null,
    regime: trade.regime || trade.marketRegime || null,
    paper: trade.paper !== false,
    reason: trade.reason || '',
    // BTC Benchmark Attribution
    btcEntryPrice: trade.btcEntryPrice || null,
    btcExitPrice: trade.btcExitPrice || null,
    btcReturnPct: trade.btcReturnPct !== undefined ? trade.btcReturnPct : null,
    alphaVsBtcPct: trade.alphaVsBtcPct !== undefined ? trade.alphaVsBtcPct : null,
    outperformedBtc: trade.outperformedBtc !== undefined ? trade.outperformedBtc : null,
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
  // Exclude PENDING trades (outcome not yet resolved, e.g. meme-coin scalps
  // awaiting real price resolution) from win-rate math entirely — they are
  // neither a win nor a loss yet, and including them in `total` would just
  // dilute the win rate with unresolved noise. Added 2026-09-03 alongside
  // the autoTrader.js fix that stopped fabricating WIN outcomes for these.
  // 2026-09-15: ALSO exclude simulated arbitrage records. Note the comment
  // above — a near-identical bug (fabricated WIN outcomes) was fixed here on
  // 2026-09-03. It recurred through a different route: continuousArbEngine.js
  // wrote flash-loan "wins" whose P&L came from a simulator, never from the
  // portfolio. On 2026-09-15 that put +$82.55 of 100%-win-rate records into a
  // ledger whose real P&L was -$0.08, which would have taught the win-rate
  // gate that flash-loan arbitrage never loses.
  // A record counts toward performance only if it is a real directional
  // outcome: resolved, and not flagged simulated / excludeFromLearning.
  const resolved = ledger.filter(t =>
    t.outcome !== 'PENDING' &&
    t.simulated !== true &&
    t.excludeFromLearning !== true &&
    t.side !== 'FLASHLOAN'
  );
  const recent = resolved.slice(-lastN);
  const total = recent.length;

  // Live-funds gate (2026-09-24): 68% win rate over the last 250 real trades (was 70%/50).
  // Measured on its own 250-trade window, whatever lastN the caller asked for, and it
  // FAILS until 250 real trades exist (the old code passed it with fewer than 10 trades).
  const LIVE_WR = parseFloat(process.env.LIVE_GATE_WIN_RATE || '0.68');
  const LIVE_N = parseInt(process.env.LIVE_GATE_MIN_TRADES || '250', 10);
  const liveWindow = resolved.slice(-LIVE_N);
  const liveWins = liveWindow.filter(t => t.outcome === 'WIN').length;
  const liveWinRate = liveWindow.length > 0 ? liveWins / liveWindow.length : 0;
  const liveGate = {
    requiredWinRate: LIVE_WR,
    requiredTrades: LIVE_N,
    trades: liveWindow.length,
    winRate: parseFloat(liveWinRate.toFixed(3)),
    passed: liveWindow.length >= LIVE_N && liveWinRate >= LIVE_WR,
  };

  if (total === 0) {
    return {
      sampleSize: 0,
      totalTradesEver: ledger.length,
      winRate: 0, // no trades = no win rate (was an invented 85% prior)
      winRatePct: '0.0% (no real trades yet)',
      wins: 0,
      losses: 0,
      breakeven: 0,
      totalPnlUsd: 0,
      avgPnlUsd: 0,
      profitabilityGatePassed: false,
      sufficientSample: false,
      liveGate,
      alphaVsBtcAvgPct: 0.0,
      tradesBeatingBtcPct: 'n/a',
      benchmarkVsBtc: {
        totalBenchmarkTrades: 0,
        tradesBeatingBtc: 0,
        beatBtcRatePct: 'n/a',
        avgAlphaPct: 0.0,
      },
    };
  }

  const wins = recent.filter(t => t.outcome === 'WIN').length;
  const losses = recent.filter(t => t.outcome === 'LOSS').length;
  const be = recent.filter(t => t.outcome === 'BREAKEVEN').length;

  const winRate = parseFloat((wins / total).toFixed(3));
  const totalPnlUsd = parseFloat(recent.reduce((s, t) => s + (t.pnlUsd || 0), 0).toFixed(2));
  const avgPnlUsd = parseFloat((totalPnlUsd / total).toFixed(2));
  const totalVolumeUsd = parseFloat(recent.reduce((s, t) => s + ((t.positionSizeUsd || 0) * (t.leverage || 1)), 0).toFixed(2));

  // BTC Benchmark attribution
  const withAlpha = recent.filter(t => typeof t.alphaVsBtcPct === 'number');
  const tradesBeatingBtc = withAlpha.filter(t => t.alphaVsBtcPct > 0).length;
  const totalAlphaSum = withAlpha.reduce((s, t) => s + t.alphaVsBtcPct, 0);
  const avgAlphaPct = withAlpha.length > 0 ? parseFloat((totalAlphaSum / withAlpha.length).toFixed(2)) : 0.0;
  const beatBtcRatePct = withAlpha.length > 0
    ? `${((tradesBeatingBtc / withAlpha.length) * 100).toFixed(1)}%`
    : 'n/a'; // was '100.0%' with no benchmark data

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
    totalVolumeUsd,
    // Live-funds gate: 68% over the last 250 real trades. No small-sample pass.
    profitabilityGatePassed: liveGate.passed,
    sufficientSample: resolved.length >= LIVE_N,
    liveGate,
    alphaVsBtcAvgPct: avgAlphaPct,
    tradesBeatingBtcPct: beatBtcRatePct,
    benchmarkVsBtc: {
      totalBenchmarkTrades: withAlpha.length,
      tradesBeatingBtc,
      beatBtcRatePct,
      avgAlphaPct,
    },
    recentTrades: recent.slice(-10),
  };
}

module.exports = {
  loadLedger,
  recordTrade,
  getPerformanceStats,
};
