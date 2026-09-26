/**
 * src/agents/technicalDailyAgent.js
 * Adapter that plugs technicalConsensusAgent.js's cross-cycle-robust
 * daily-bar strategy into the main project's consensus as `technical_daily`
 * — the 2026-09-14 "remove Alpha Vantage, use my own OHLCV, backtest 3
 * cycles, implement findings" request. See technicalConsensusAgent.js's
 * header for the full per-token backtest numbers.
 *
 * Fetches its OWN daily candles (Binance, no key) rather than reusing
 * marketData's 1h candles — same reasoning as technicalLabAgent.js: a
 * strategy validated on one timeframe silently breaks if fed another.
 *
 * Zero LLM cost. Never hard-vetoes. OP and CRO are disabled inside
 * technicalConsensusAgent.js itself (no real edge / too little data) and
 * will always return a clean HOLD with the research reason attached —
 * this agent cannot force a trade on either of them.
 */
'use strict';
const { getDailyCandles } = require('./technicalDaily/priceFeed');
const { getTechnicalSignal } = require('./technicalConsensusAgent');

async function getSignal(symbol, _marketData) {
  try {
    const candles = await getDailyCandles(symbol, { limit: 300 });
    const result = getTechnicalSignal(symbol, candles);

    return {
      signal: result.signal, // 'BUY' | 'HOLD' — matches consensus.js's normalizeSignal
      confidence: result.confidence,
      reason: result.reason,
      model_used: 'technical-daily-v1 (deterministic, no LLM)',
      provider: 'technical_daily',
      veto_flag: false,
      details: result,
    };
  } catch (err) {
    // Unmapped token (OP/CRO have no robust combo anyway) or a Binance
    // hiccup — fail to a harmless HOLD, same pattern as technicalLabAgent.js.
    return {
      signal: 'HOLD',
      confidence: 0,
      reason: `technical_daily unavailable: ${err.message}`,
      model_used: 'technical-daily-v1 (deterministic, no LLM)',
      provider: 'technical_daily',
      veto_flag: false,
      error: true,
    };
  }
}

module.exports = { getSignal };
