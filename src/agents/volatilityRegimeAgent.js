/**
 * Volatility Regime Agent
 * ========================
 * Classifies the current market state (compression / normal / high-volatility
 * expansion) from ATR% and Bollinger Band Width, using the same thresholds as
 * the original volatility_regimes.py reference module (now archived under
 * _archive/python_modules — ported here to native JS so it runs in-process,
 * with zero extra network calls, using indicators the orchestrator already
 * computes every cycle via src/data/indicators.js).
 *
 * By design this agent never casts a directional BUY/SELL vote — ATR and BB
 * width tell you how much the price is moving, not which way. It always
 * returns HOLD, so it can never count toward consensus.agentsAgreeing (see
 * consensus.js: agreeingAgents excludes signal === 'HOLD') and can never
 * force a trade. Its role is advisory: a low weight, honest "here's the
 * volatility backdrop" input that mildly dampens the consensus score during
 * high-conviction moments and carries regime metadata for anything
 * downstream (e.g. riskGate) that wants to react to it later.
 *
 * Added 2026-09-06 as the 14th consensus agent, at the user's request,
 * pointing at the archived volatility_regimes.py as the reference spec.
 */
'use strict';

const logger = require('../utils/logger');

// Same thresholds as volatility_regimes.py's detect_volatility_regime()
const COMPRESSION_BBW_PCT = 2.5;
const COMPRESSION_ATR_PCT = 1.0;
const EXPANSION_BBW_PCT = 8.0;
const EXPANSION_ATR_PCT = 4.5;

function classifyRegime(atrPct, bbwPct) {
  if (bbwPct < COMPRESSION_BBW_PCT || atrPct < COMPRESSION_ATR_PCT) {
    return {
      regime: 'COMPRESSION_SQUEEZE',
      label: 'Compression squeeze (imminent breakout setup)',
      guidance: 'Tighter stops; a directional breakout may be building — do not chase, wait for confirmation.',
    };
  }
  if (bbwPct > EXPANSION_BBW_PCT || atrPct > EXPANSION_ATR_PCT) {
    return {
      regime: 'HIGH_VOLATILITY_EXPANSION',
      label: 'High volatility expansion (elevated trend/exhaustion risk)',
      guidance: 'Reduce position size — this is a high-variance environment for a fixed stop-loss.',
    };
  }
  return {
    regime: 'NORMAL_VOLATILITY',
    label: 'Normal volatility (typical trading environment)',
    guidance: 'Standard Kelly position sizing applies.',
  };
}

/**
 * @param {string} symbol
 * @param {Object} marketData - must include marketData.indicators.{atr14, bollinger.bandwidth} and marketData.price.price
 * @returns {Promise<Object>} standard agent signal shape (signal is always HOLD by design)
 */
async function getSignal(symbol, marketData = {}) {
  try {
    const price = marketData?.price?.price;
    const atr = marketData?.indicators?.atr14;
    const bbwPct = marketData?.indicators?.bollinger?.bandwidth;

    if (!price || price <= 0 || typeof atr !== 'number' || typeof bbwPct !== 'number') {
      return {
        signal: 'HOLD',
        confidence: 0.30,
        reason: 'Volatility regime: insufficient indicator data this cycle',
        model_used: 'internal-atr-bbw',
        provider: 'volatility_regime',
        regime: 'INSUFFICIENT_DATA',
      };
    }

    const atrPct = parseFloat(((atr / price) * 100).toFixed(2));
    const { regime, label, guidance } = classifyRegime(atrPct, bbwPct);

    // Confident when the regime is clearly one extreme or the other;
    // deliberately modest in the "normal" middle ground where this agent
    // has nothing distinctive to add.
    const confidence = regime === 'NORMAL_VOLATILITY' ? 0.40 : 0.75;

    logger.debug(`[volatilityRegimeAgent] ${symbol}: ${regime} (ATR% ${atrPct}, BBW% ${bbwPct})`);

    return {
      signal: 'HOLD', // advisory only — see file header
      confidence,
      reason: `${label} — ATR ${atrPct}%, BB width ${bbwPct}%. ${guidance}`,
      model_used: 'internal-atr-bbw',
      provider: 'volatility_regime',
      regime,
      atrPct,
      bbwPct,
      guidance,
    };
  } catch (err) {
    logger.warn(`[volatilityRegimeAgent] ${symbol}: ${err.message}`);
    return {
      signal: 'HOLD',
      confidence: 0.30,
      reason: `Volatility regime check failed: ${err.message}`,
      model_used: 'internal-atr-bbw',
      provider: 'volatility_regime',
      regime: 'ERROR',
    };
  }
}

module.exports = { getSignal, classifyRegime };
