/**
 * src/utils/oandaExecutor.js
 * Same job as exchangeRouter.js but for OANDA-covered pairs (forex,
 * commodities, indices). Added 2026-09-26.
 *
 * PAPER_TRADING=true (the default, and Alan's standing "paper trade first"
 * rule): behaves EXACTLY like exchangeRouter's crypto paper path - opens a
 * simulated position via riskGate.recordOpenPosition, resolved next cycle
 * against a real OANDA price. No order ever reaches OANDA.
 *
 * PAPER_TRADING=false AND OANDA_ENV=practice: places a REAL order on the
 * OANDA PRACTICE account (fake money - zero real-money risk) via
 * oandaBroker.placeMarketOrder(), so real fills/spread/broker-side stop-loss
 * handling can be tested. OANDA_ENV=live orders stay blocked by
 * oandaBroker's own live-gate check (68% win rate over 250 real trades)
 * regardless of PAPER_TRADING - this file does not add or relax that gate.
 */
const logger = require('./logger');
const oanda = require('../brokers/oandaBroker');
const { recordOpenPosition } = require('../risk/riskGate');
const { recordTrade } = require('../risk/tradeLedger');

async function executeTrade(pair, signal, riskCheck, marketData, isPaper = true) {
  const rc = riskCheck || {};
  const side = String(signal || 'BUY').toUpperCase() === 'BUY' ? 'BUY' : 'SELL';
  const price = marketData?.price?.price || 0;
  const sizeUsd = rc.positionSizeUsd || 25.0;

  if (!price || price <= 0) {
    return { success: false, paper: isPaper, venue: 'OANDA', reason: 'No OANDA price available', pnlUsd: 0 };
  }

  if (isPaper) {
    // Identical simulation pattern to exchangeRouter.js's crypto paper path,
    // just sourced from a real OANDA price instead of a crypto exchange feed.
    const spreadPct = 0.0006; // conservative simulated spread for majors/CFDs
    const fillPrice = side === 'BUY' ? price * (1 + spreadPct) : price * (1 - spreadPct);

    recordOpenPosition(pair, {
      sizeUsd,
      entryPrice: fillPrice,
      side,
      leverage: rc.leverage || 1,
      stopLossPct: rc.stopLossPct || 1.5,
      takeProfitPct: rc.takeProfitPct || 3.0,
      confidence: rc.consensusConfidence || 0.8,
      regime: rc.consensus?.regime || null,
      venueTag: 'OANDA',
    });

    logger.info(
      `📄 [OANDA] PAPER POSITION OPENED: ${side} ${pair} @ ${fillPrice.toFixed(5)} ($${sizeUsd} USD, ${oanda.ENV} env) - awaiting real price resolution`
    );

    return {
      success: true,
      paper: true,
      pending: true,
      venue: 'OANDA-PaperEngine',
      side,
      fillPrice,
      sizeUsd,
      pnlUsd: 0,
      orderId: `OANDA-SIM-${Date.now()}`,
    };
  }

  // Non-paper: real order on whichever OANDA_ENV is configured. oandaBroker
  // itself refuses live orders until OANDA_ALLOW_LIVE=true AND the live gate
  // passes - this function does not bypass that check.
  const stopLossPrice = side === 'BUY'
    ? price * (1 - (rc.stopLossPct || 1.5) / 100)
    : price * (1 + (rc.stopLossPct || 1.5) / 100);
  const takeProfitPrice = side === 'BUY'
    ? price * (1 + (rc.takeProfitPct || 3.0) / 100)
    : price * (1 - (rc.takeProfitPct || 3.0) / 100);
  const units = side === 'BUY' ? Math.round(sizeUsd) : -Math.round(sizeUsd);

  logger.info(`🔶 [OANDA ${oanda.ENV.toUpperCase()}] Placing real order: ${side} ${pair} (~$${sizeUsd})`);
  const order = await oanda.placeMarketOrder(pair, units, { stopLossPrice, takeProfitPrice });

  const tradeRecord = {
    pair,
    symbol: pair.split('/')[0],
    side,
    price,
    positionSizeUsd: sizeUsd,
    leverage: rc.leverage || 1,
    pnlUsd: 0,
    paper: oanda.ENV !== 'live',
    venue: `OANDA-${oanda.ENV}`,
    orderId: order?.fill?.id || order?.raw?.orderCreateTransaction?.id || `OANDA-${Date.now()}`,
  };
  recordTrade(tradeRecord);

  return { success: true, paper: oanda.ENV !== 'live', venue: `OANDA-${oanda.ENV}`, order };
}

module.exports = { executeTrade };
