/**
 * src/agents/technicalLabAgent.js
 * Adapter that plugs the validated strategy-lab strategy (technicalLab/)
 * into the main project's 16-agent consensus as a new, additive vote.
 *
 * WHY THIS FETCHES ITS OWN CANDLES instead of using the `marketData` object
 * consensus.js already built: the validated edge in technicalLab/strategy.js
 * was researched specifically on Bybit 2-hour candles with real volume
 * (needed for session VWAP). The rest of this project's agents run on
 * marketData.indicators, which is built from 1-hour Binance/Bitget candles
 * (see src/data/marketData.js). Feeding this strategy 1h Binance data
 * instead of 2h Bybit data would silently change EMA-cross timing and VWAP
 * values enough to invalidate the validated edge, with no error thrown —
 * exactly the failure mode the research lab's out-of-sample test exists to
 * catch. So this agent is deliberately self-contained: its own data source,
 * its own indicators, matching the research exactly.
 *
 * Merged in from F:\aitradingagent2 (2026-09-14) — see
 * claude/session-2026-09-14-merge-report.md for the full reconciliation.
 *
 * Zero LLM cost, zero API key needed (Bybit public market data).
 * Only ETH currently trades live; every other token returns a clean HOLD
 * with the specific research reason attached — see technicalLab/strategy.js
 * TOKEN_STATUS. This can never force a trade on an unvalidated token.
 */
'use strict';
const { getIntradayCandles } = require('./technicalLab/priceFeed');
const strategy = require('./technicalLab/strategy');

async function getSignal(symbol, _marketData) {
  try {
    const candles = await getIntradayCandles(symbol, { interval: '120', limit: 500 });
    const result = strategy.run(symbol, candles);

    return {
      signal: result.signal, // 'BUY' | 'SELL' | 'HOLD' — matches consensus.js's normalizeSignal
      confidence: result.confidence,
      reason: result.reason,
      model_used: 'technical-lab-v1 (deterministic, no LLM)',
      provider: 'technical_lab',
      // Never a hard veto — this is one vote among many, same as the other
      // deterministic agents (smc_agent, volatility_regime).
      veto_flag: false,
      details: result,
    };
  } catch (err) {
    // Bybit hiccup or an unmapped token — fail to a harmless HOLD rather
    // than throwing, so one flaky fetch can't take down the whole
    // consensus cycle. consensus.js's health monitor will still see this
    // as a rejected promise via the timeout/allSettled wrapper upstream if
    // it re-throws; returning HOLD here instead keeps this agent's own
    // reasoning visible in the breakdown rather than just "FAILED".
    return {
      signal: 'HOLD',
      confidence: 0,
      reason: `technical_lab unavailable: ${err.message}`,
      model_used: 'technical-lab-v1 (deterministic, no LLM)',
      provider: 'technical_lab',
      veto_flag: false,
      error: true,
    };
  }
}

module.exports = { getSignal };
