/**
 * src/predictor/predictorAgent.js  (2026-10-03)
 * The predictor agent, used by BOTH modules. It runs AFTER the bull/bear debate and BEFORE the final analysis
 * (risk gate / execution decision): it takes the debate result plus the data, gives a probability, writes it to memory
 * (predictionStore) and the store later scores it against what really happened. Deterministic and explainable: no LLM
 * is needed to produce a prediction (the debate agents already use the LLMs); the probability is then calibrated
 * against its own scored history.
 *
 *   predictTrade({pair, price, indicators, consensus, debate, horizonMin})   -> price direction (scope 'trade')
 *   predictArb({symbol, buyEx, sellEx, netPct, grossPct, depthRatio, memory, debate, horizonMin}) -> will the spread
 *       still be profitable at the next scan? (scope 'arb', kind 'event')
 */
'use strict';

const store = require('./predictionStore');

const logistic = (x) => 1 / (1 + Math.exp(-x));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const num = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);

/** Score in roughly [-3, 3]; positive = up. Every part is returned so the reasoning is auditable. */
function scoreTrade({ price, indicators = {}, consensus = {}, debate = {} }) {
  const parts = {};
  const ema20 = num(indicators.ema20), ema50 = num(indicators.ema50);
  if (price > 0 && ema50 > 0) parts.priceVsEma50 = price >= ema50 ? 0.5 : -0.5;
  if (ema20 > 0 && ema50 > 0) parts.ema20VsEma50 = ema20 >= ema50 ? 0.4 : -0.4;
  const rsi = num(indicators.rsi14, 50);
  parts.rsi = rsi >= 75 ? -0.5 : rsi <= 25 ? 0.5 : rsi >= 55 && rsi < 75 ? 0.2 : rsi <= 45 && rsi > 25 ? -0.2 : 0;
  const mh = num(indicators.macd?.histogram);
  parts.macd = mh > 0 ? 0.3 : mh < 0 ? -0.3 : 0;
  const cs = String(consensus.signal || 'HOLD').toUpperCase();
  const cc = clamp(num(consensus.confidence), 0, 1);
  parts.consensus = cs === 'BUY' ? cc * 1.2 : cs === 'SELL' ? -cc * 1.2 : 0;
  const bull = clamp(num(debate.bullConfidence), 0, 1), bear = clamp(num(debate.bearConfidence), 0, 1);
  parts.debate = (bull - bear) * 0.8 - (debate.bearVeto ? 0.8 : 0) - (debate.riskVeto ? 0.4 : 0);
  const score = Object.values(parts).reduce((a, b) => a + b, 0);
  return { score: +score.toFixed(3), parts };
}

function predictTrade({ pair, price, indicators = {}, consensus = {}, debate = {}, horizonMin = Number(process.env.PREDICTOR_HORIZON_MIN || 120), nowMs }) {
  const { score, parts } = scoreTrade({ price, indicators, consensus, debate });
  const direction = score >= 0.25 ? 'UP' : score <= -0.25 ? 'DOWN' : 'FLAT';
  const raw = direction === 'FLAT' ? 0.5 : clamp(0.5 + (logistic(Math.abs(score) * 1.1) - 0.5) * 0.8, 0.5, 0.85);
  const cal = store.calibrate('trade', raw);
  const atrPct = price > 0 ? (num(indicators.atr14) / price) * 100 : 0;
  const expectedMovePct = +(atrPct * clamp(Math.abs(score) / 2, 0, 1)).toFixed(3);
  const cs = String(consensus.signal || 'HOLD').toUpperCase();
  const agrees = (cs === 'BUY' && direction === 'UP') || (cs === 'SELL' && direction === 'DOWN') || (cs === 'HOLD' && direction === 'FLAT');
  const reasoning = `score ${score} (${Object.entries(parts).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${(+v).toFixed(2)}`).join(', ')}); ` +
    `raw P ${raw.toFixed(2)}${cal.weight ? ` -> calibrated ${cal.p.toFixed(2)} (weight ${cal.weight})` : ' (no calibration history yet)'}`;
  let id = null;
  try {
    id = store.record({ scope: 'trade', kind: 'price', key: pair, horizonMin, direction, probability: cal.p, entryPrice: price,
      expectedMovePct, method: 'baseline+calibration', reasoning, features: { score, parts }, debate, nowMs });
  } catch (_) { /* memory problems never block trading */ }
  return { id, direction, probability: cal.p, rawProbability: +raw.toFixed(3), horizonMin, expectedMovePct, agreesWithConsensus: agrees, reasoning };
}

function predictArb({ symbol, buyEx, sellEx, netPct, grossPct, depthRatio = 1, memory = {}, debate = {}, horizonMin = 1, nowMs }) {
  const n = num(memory.n);
  // prior: how often this route's profitable spreads were still profitable next scan (Laplace-smoothed); 0.35 until there is data
  const base = n >= 5 ? clamp(num(memory.persistenceRate, 0.35), 0.05, 0.95) : 0.35;
  const margin = clamp((num(netPct) - 0.05) * 0.5, -0.15, 0.2);              // a bigger net margin survives small moves
  const depth = depthRatio < 1.5 ? -0.10 : depthRatio > 4 ? 0.05 : 0;       // thin books vanish when you touch them
  const deb = (clamp(num(debate.bullConfidence), 0, 1) - clamp(num(debate.bearConfidence), 0, 1)) * 0.10;
  const raw = clamp(base + margin + depth + deb, 0.05, 0.95);
  const cal = store.calibrate('arb', raw);
  const reasoning = `route history n=${n} persistence ${base.toFixed(2)}; net ${num(netPct).toFixed(3)}% margin ${margin >= 0 ? '+' : ''}${margin.toFixed(2)}; ` +
    `depth x${num(depthRatio).toFixed(1)} ${depth >= 0 ? '+' : ''}${depth.toFixed(2)}; debate ${deb >= 0 ? '+' : ''}${deb.toFixed(2)}; raw ${raw.toFixed(2)}` +
    (cal.weight ? ` -> calibrated ${cal.p.toFixed(2)}` : ' (no calibration history yet)');
  let id = null;
  try {
    id = store.record({ scope: 'arb', kind: 'event', key: `${symbol}|${buyEx}>${sellEx}`, horizonMin, direction: 'PERSISTS', probability: cal.p,
      expectedMovePct: num(netPct), method: 'route-memory+calibration', reasoning, features: { grossPct, netPct, depthRatio, memory }, debate, nowMs });
  } catch (_) { /* never blocks */ }
  return { id, probability: cal.p, rawProbability: +raw.toFixed(3), reasoning };
}

module.exports = { predictTrade, predictArb, scoreTrade };
