/**
 * src/utils/alpacaExecutor.js
 * Same job as oandaExecutor.js/exchangeRouter.js but for Alpaca-covered US
 * stocks. Added 2026-09-27 (Alan's explicit instruction — multi-market
 * expansion, pushing the already-built-but-unwired alpacaBroker.js from
 * diagnostic/testing into the live cycle).
 *
 * Same three-tier safety model as oandaExecutor.js:
 *  - PAPER_TRADING=true (the default, Alan's standing "paper trade first"
 *    rule): behaves exactly like the crypto/OANDA paper paths — opens a
 *    simulated position via riskGate.recordOpenPosition, resolved next
 *    cycle against a real Alpaca price. No order ever reaches Alpaca.
 *  - PAPER_TRADING=false AND ALPACA_ENV=paper (default): places a REAL
 *    bracket order on Alpaca's own PAPER account (fake money) via
 *    alpacaBroker.placeMarketOrder(), so real fills can be tested.
 *  - ALPACA_ENV=live orders stay blocked by alpacaBroker's own live-gate
 *    check (ALPACA_ALLOW_LIVE=true AND the 68%-win-rate/250-trade gate)
 *    regardless of PAPER_TRADING — this file does not add or relax that gate.
 */
const logger = require('./logger');
const alpaca = require('../brokers/alpacaBroker');
const { recordOpenPosition } = require('../risk/riskGate');
const { recordTrade } = require('../risk/tradeLedger');

async function executeTrade(symbol, signal, riskCheck, marketData, isPaper = true) {
  const rc = riskCheck || {};
  const side = String(signal || 'BUY').toUpperCase() === 'BUY' ? 'BUY' : 'SELL';
  const price = marketData?.price?.price || 0;
  const sizeUsd = rc.positionSizeUsd || 25.0;

  if (!price || price <= 0) {
    return { success: false, paper: isPaper, venue: 'Alpaca', reason: 'No Alpaca price available', pnlUsd: 0 };
  }

  if (isPaper) {
    // Identical simulation pattern to oandaExecutor.js/exchangeRouter.js's
    // paper paths, just sourced from a real Alpaca price.
    const spreadPct = 0.0003; // conservative simulated spread for liquid large-cap US equities
    const fillPrice = side === 'BUY' ? price * (1 + spreadPct) : price * (1 - spreadPct);

    recordOpenPosition(symbol, {
      sizeUsd,
      entryPrice: fillPrice,
      side,
      leverage: 1, // Alpaca orders are always plain cash-account sizing — see alpacaBroker.js header
      stopLossPct: rc.stopLossPct || 1.5,
      takeProfitPct: rc.takeProfitPct || 3.0,
      confidence: rc.consensusConfidence || 0.8,
      regime: rc.consensus?.regime || null,
      venueTag: 'Alpaca',
    });

    logger.info(
      `📄 [Alpaca] PAPER POSITION OPENED: ${side} ${symbol} @ $${fillPrice.toFixed(2)} ($${sizeUsd} USD, ${alpaca.ENV} env) — awaiting real price resolution`
    );

    return {
      success: true,
      paper: true,
      pending: true,
      venue: 'Alpaca-PaperEngine',
      side,
      fillPrice,
      sizeUsd,
      pnlUsd: 0,
      orderId: `ALPACA-SIM-${Date.now()}`,
    };
  }

  // Non-paper: real bracket order on whichever ALPACA_ENV is configured.
  // alpacaBroker itself refuses live orders until ALPACA_ALLOW_LIVE=true AND
  // the live gate passes — this function does not bypass that check.
  const stopLossPct = rc.stopLossPct || 1.5;
  const takeProfitPct = rc.takeProfitPct || 3.0;
  const stopLossPrice = side === 'BUY' ? price * (1 - stopLossPct / 100) : price * (1 + stopLossPct / 100);
  const takeProfitPrice = side === 'BUY' ? price * (1 + takeProfitPct / 100) : price * (1 - takeProfitPct / 100);

  logger.info(`🔶 [Alpaca ${alpaca.ENV.toUpperCase()}] Placing real bracket order: ${side} ${symbol} (~$${sizeUsd})`);
  const order = await alpaca.placeMarketOrder(symbol, side, { stopLossPrice, takeProfitPrice, notionalUsd: sizeUsd });

  const tradeRecord = {
    pair: symbol,
    symbol,
    side,
    price,
    positionSizeUsd: sizeUsd,
    leverage: 1,
    pnlUsd: 0,
    paper: alpaca.ENV !== 'live',
    venue: `Alpaca-${alpaca.ENV}`,
    orderId: order?.order?.id || `ALPACA-${Date.now()}`,
  };
  recordTrade(tradeRecord);

  return { success: true, paper: alpaca.ENV !== 'live', venue: `Alpaca-${alpaca.ENV}`, order };
}

module.exports = { executeTrade };
