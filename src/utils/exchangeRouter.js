/**
 * Smart Exchange Router & Execution Engine
 * Evaluates fees and spread across Bitget, Crypto.com, and Binance.
 * Handles simulated paper fills or live exchange order placement.
 */
const ccxt = require('ccxt');
const logger = require('./logger');
const { recordTrade } = require('../risk/tradeLedger');
const { recordOpenPosition, removePosition } = require('../risk/riskGate');

let _bitget = null;
let _cryptocom = null;
let _binance = null;

function getBitget() {
  if (!_bitget && process.env.BITGET_API_KEY) {
    _bitget = new ccxt.bitget({
      apiKey: process.env.BITGET_API_KEY,
      secret: process.env.BITGET_API_SECRET || process.env.BITGET_SECRET || process.env.BITGET_SECRET_KEY,
      password: process.env.BITGET_API_PASSPHRASE || process.env.BITGET_PASSPHRASE,
      options: { defaultType: 'spot' },
    });
  }
  return _bitget;
}

function getCryptoCom() {
  if (!_cryptocom && process.env.CRYPTOCOM_API_KEY) {
    _cryptocom = new ccxt.cryptocom({
      apiKey: process.env.CRYPTOCOM_API_KEY,
      secret: process.env.CRYPTOCOM_API_SECRET || process.env.CRYPTOCOM_SECRET,
    });
  }
  return _cryptocom;
}

function getBinance() {
  if (!_binance && process.env.BINANCE_API_KEY) {
    _binance = new ccxt.binance({
      apiKey: process.env.BINANCE_API_KEY,
      secret: process.env.BINANCE_API_SECRET || process.env.BINANCE_SECRET,
    });
  }
  return _binance;
}

async function getBestVenue(pair) {
  const candidates = [
    { name: 'Bitget', client: getBitget(), fee: 0.0008 },
    { name: 'Crypto.com', client: getCryptoCom(), fee: 0.0010 },
    { name: 'Binance', client: getBinance(), fee: 0.00075 },
  ];

  const configured = candidates.filter(c => c.client !== null);
  if (configured.length === 0) {
    return { name: 'PaperExchange', client: null, fee: 0.0008 };
  }

  configured.sort((a, b) => a.fee - b.fee);
  return configured[0];
}

/**
 * Normalize a consensus-decision object into the positional executeTrade args.
 * Accepts shapes like { approved, action: 'BUY_BTC', sizeUsd, exchange, aggregateScore }.
 * Returns null when the decision is not actionable (caller should short-circuit).
 */
function decisionToTradeArgs(decision) {
  if (!decision || decision.approved !== true) return null;

  const rawAction = String(decision.action || decision.signal || '').toUpperCase();
  const [sideToken, assetToken] = rawAction.split(/[_\s/-]+/);
  const side = sideToken === 'BUY' || sideToken === 'LONG'
    ? 'BUY'
    : sideToken === 'SELL' || sideToken === 'SHORT'
      ? 'SELL'
      : null;
  if (!side) return null;

  const asset = (assetToken || decision.asset || decision.symbol || 'BTC')
    .toUpperCase()
    .replace(/USDT?$/, '') || 'BTC';
  const pair = `${asset}/USDT`;

  return {
    pair,
    signal: side,
    riskCheck: {
      approved: true,
      positionSizeUsd: Number(decision.sizeUsd || decision.positionSizeUsd || 25.0),
      leverage: Number(decision.leverage || 1),
      stopLossPct: Number(decision.stopLossPct || 2.0),
      takeProfitPct: Number(decision.takeProfitPct || 4.4),
      consensusConfidence: Number(decision.aggregateScore || decision.confidence || 0.8),
    },
    marketData: decision.marketData || null,
    isPaper: decision.isPaper !== undefined ? decision.isPaper : true,
  };
}

async function executeTrade(pair, signal, riskCheck, marketData, isPaper = true) {
  // Single-argument overload: executeTrade(consensusDecision)
  if (pair && typeof pair === 'object' && signal === undefined) {
    const decision = pair;
    const args = decisionToTradeArgs(decision);
    if (!args) {
      return {
        executed: false,
        success: false,
        approved: false,
        reason: decision?.reason || 'Consensus decision not approved or not actionable',
      };
    }
    return executeTrade(args.pair, args.signal, args.riskCheck, args.marketData, args.isPaper);
  }

  const rc = riskCheck || {};
  const side = String(signal || 'BUY').toUpperCase() === 'BUY' ? 'BUY' : 'SELL';
  const price = marketData?.price?.price || 100.0;
  const sizeUsd = rc.positionSizeUsd || 25.0;
  const amount = parseFloat((sizeUsd / price).toFixed(6));

  if (isPaper) {
    // Realistic Paper Execution simulation
    const takerFeePct = 0.0010; // 0.10% typical exchange taker fee
    const slippagePct = 0.0005; // 0.05% simulated market slippage
    const totalPenaltyPct = takerFeePct + slippagePct;
    const fillPrice = side === 'BUY' ? price * (1 + totalPenaltyPct) : price * (1 - totalPenaltyPct);
    const effectiveLeverage = rc.leverage || 1.0;

    // Fixed 2026-09-03: this used to fabricate the outcome with
    // `Math.random() < riskCheck.consensusConfidence` — a coin-flip weighted
    // by the AI's own confidence score, completely divorced from what price
    // actually did. That silently made "confidence" and "win rate" the same
    // number by construction, so the reported win rate never measured
    // prediction skill at all.
    //
    // Real fix: open a REAL pending position (entry price, side, TP/SL,
    // timestamp) via riskGate.recordOpenPosition, same as riskGate already
    // does for live trades. No outcome is recorded yet. The position sits
    // open until riskGate.resolveOpenPosition() (called each cycle from
    // orchestrator/index.js with the next real fetched price) sees the
    // price actually cross the take-profit or stop-loss level, or the
    let btcEntryPrice = null;
    try {
      // Synchronous snapshot: the trade path must not block on a network fetch,
      // and the orchestrator has already warmed this cache earlier in the cycle.
      const { getCachedBtcBenchmark } = require('../data/btcBenchmark');
      const btc = getCachedBtcBenchmark();
      btcEntryPrice = btc?.price || (pair.startsWith('BTC') ? fillPrice : null);
    } catch (_) {}

    // Extract agent votes from consensus breakdown for empirical accuracy learning
    const agentVotes = {};
    if (rc.consensus?.breakdown && Array.isArray(rc.consensus.breakdown)) {
      for (const a of rc.consensus.breakdown) {
        if (a.agent && a.signal) {
          agentVotes[a.agent] = a.signal;
        }
      }
    }

    recordOpenPosition(pair, {
      sizeUsd,
      entryPrice: fillPrice,
      side,
      leverage: effectiveLeverage,
      stopLossPct: rc.stopLossPct,
      takeProfitPct: rc.takeProfitPct,
      confidence: rc.consensusConfidence || 0.8,
      btcEntryPrice,
      agentVotes,
      regime: rc.consensus?.regime || null,
      marketDataSnapshot: marketData ? {
        price: marketData.price,
        indicators: marketData.indicators,
        fearGreed: marketData.fearGreed,
      } : null,
    });

    logger.info(
      `📄 PAPER POSITION OPENED: ${side} ${amount} ${pair} @ $${fillPrice.toFixed(2)} ($${sizeUsd} USD, ${effectiveLeverage}x) — SL ${rc.stopLossPct}% / TP ${rc.takeProfitPct}% — awaiting real price resolution`
    );

    return {
      success: true,
      paper: true,
      pending: true,
      venue: 'PaperEngine',
      side,
      amount,
      fillPrice,
      sizeUsd,
      pnlUsd: 0,
      orderId: `SIM-${Date.now()}`,
    };
  }

  // Live Exchange Execution Guard
  if (process.env.NO_TRADES === 'true' || process.env.EXECUTION_ENABLED === 'false') {
    logger.warn(`🛡️ [NO TRADES POLICY] Real order blocked by user configuration (NO_TRADES=true).`);
    return {
      success: true,
      paper: true,
      venue: 'ObservationOnly',
      side,
      amount,
      fillPrice: price,
      sizeUsd: 0,
      pnlUsd: 0,
      orderId: `NO-TRADE-${Date.now()}`
    };
  }

  const venue = await getBestVenue(pair);
  if (!venue.client) {
    throw new Error('No live exchange API keys configured. Switch to PAPER_TRADING=true.');
  }

  logger.info(`🔴 LIVE EXECUTION on ${venue.name}: ${side} ${pair} (${sizeUsd} USD)`);
  const ticker = await venue.client.fetchTicker(pair).catch(() => null);
  const currentPrice = ticker?.last || marketData?.price?.price || 100;
  const orderAmount = parseFloat((sizeUsd / currentPrice).toFixed(6));
  const order = await venue.client.createOrder(
    pair,
    'market',
    side.toLowerCase(),
    orderAmount
  );

  const tradeRecord = {
    pair,
    symbol: pair.split('/')[0],
    side,
    price: order.price || ticker.last,
    amount: orderAmount,
    positionSizeUsd: sizeUsd,
    leverage: rc.leverage || 1,
    pnlUsd: 0,
    paper: false,
    venue: venue.name,
    orderId: order.id,
  };

  recordTrade(tradeRecord);
  return {
    success: true,
    paper: false,
    venue: venue.name,
    order,
  };
}

module.exports = {
  executeTrade,
  getBestVenue,
  getBitget,
  getCryptoCom,
  getBinance,
};
