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
      secret: process.env.BITGET_API_SECRET,
      password: process.env.BITGET_API_PASSPHRASE,
      options: { defaultType: 'spot' },
    });
  }
  return _bitget;
}

function getCryptoCom() {
  if (!_cryptocom && process.env.CRYPTOCOM_API_KEY) {
    _cryptocom = new ccxt.cryptocom({
      apiKey: process.env.CRYPTOCOM_API_KEY,
      secret: process.env.CRYPTOCOM_API_SECRET,
    });
  }
  return _cryptocom;
}

function getBinance() {
  if (!_binance && process.env.BINANCE_API_KEY) {
    _binance = new ccxt.binance({
      apiKey: process.env.BINANCE_API_KEY,
      secret: process.env.BINANCE_API_SECRET,
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

async function executeTrade(pair, signal, riskCheck, marketData, isPaper = true) {
  // Support consensusDecision single-object signature: executeTrade(consensusDecision)
  if (typeof pair === 'object' && pair !== null && ('approved' in pair || 'action' in pair)) {
    const consensusDecision = pair;
    if (!consensusDecision.approved) {
      logger.warn('Trade execution skipped: consensus not approved', { reason: consensusDecision.reason });
      return { executed: false, approved: false, reason: consensusDecision.reason || 'Not approved' };
    }
    const actionStr = String(consensusDecision.action || 'BUY_BTC').toUpperCase();
    const parsedSide = (actionStr.startsWith('SELL') || actionStr.startsWith('SHORT')) ? 'SELL' : 'BUY';
    let asset = 'BTC';
    if (actionStr.includes('_')) {
      asset = actionStr.split('_')[1];
    }
    const parsedPair = consensusDecision.symbol || `${asset}/USDT`;
    const parsedRiskCheck = {
      approved: true,
      positionSizeUsd: consensusDecision.sizeUsd || 25.0,
      consensusConfidence: consensusDecision.confidence || consensusDecision.aggregateScore || 0.85,
      stopLossPct: 1.5,
      takeProfitPct: 3.3,
      reason: consensusDecision.reason || 'Consensus execution validated',
    };
    const parsedMarketData = (typeof signal === 'object' && signal !== null) ? signal : { price: { price: 68000 } };
    const parsedIsPaper = typeof riskCheck === 'boolean' ? riskCheck : (process.env.TRADING_MODE !== 'live');

    return executeTrade(parsedPair, parsedSide, parsedRiskCheck, parsedMarketData, parsedIsPaper);
  }

  const side = String(signal || 'BUY').toUpperCase() === 'BUY' ? 'BUY' : 'SELL';
  const price = marketData?.price?.price || 100.0;
  const sizeUsd = riskCheck.positionSizeUsd || 25.0;
  const amount = parseFloat((sizeUsd / price).toFixed(6));

  if (isPaper) {
    // Realistic Paper Execution simulation
    const slippagePct = 0.0008; // 0.08% simulated slippage
    const fillPrice = side === 'BUY' ? price * (1 + slippagePct) : price * (1 - slippagePct);
    const effectiveLeverage = riskCheck.leverage || 1.0;

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
    // position's TTL expires — at which point THAT function records the
    // real WIN/LOSS/BREAKEVEN outcome based on genuine price movement.
    recordOpenPosition(pair, {
      sizeUsd,
      entryPrice: fillPrice,
      side,
      leverage: effectiveLeverage,
      stopLossPct: riskCheck.stopLossPct,
      takeProfitPct: riskCheck.takeProfitPct,
      confidence: riskCheck.consensusConfidence || 0.8,
    });

    logger.info(
      `📄 PAPER POSITION OPENED: ${side} ${amount} ${pair} @ $${fillPrice.toFixed(2)} ($${sizeUsd} USD, ${effectiveLeverage}x) — SL ${riskCheck.stopLossPct}% / TP ${riskCheck.takeProfitPct}% — awaiting real price resolution`
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
    leverage: riskCheck.leverage || 1,
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
};
