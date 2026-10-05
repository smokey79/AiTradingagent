/**
 * src/engine/reviewer.js (2026-10-03) -- the reasoning agent as REVIEWER, never as forecaster.
 * It receives the model's numbers and the market context and may only: flag conflicts, flag regime risks, state invalidation conditions,
 * and give a verdict that can tighten the gate (agree / caution / veto). It cannot raise confidence, cannot size, and any text that looks
 * like a price target or a numeric forecast is stripped before it is stored. Free LLMs first (src/predictor/llm.js); a deterministic rule
 * review is the fallback, so the pipeline works with no LLM at all.
 */
'use strict';

const { llmJson } = require('../predictor/llm');

const VERDICTS = new Set(['agree', 'caution', 'veto']);
// strings that smell like an invented forecast: a price, a target, a % move prediction
const FORECASTY = /(\$\s?\d)|\b(target|price target|(will|could|should|may) (rise|fall|drop|rally|reach|hit)|expect(s|ed)? to (reach|hit|rise|fall|drop|rally)|forecast|predict(s|ion)?)\b|\b\d+(\.\d+)?\s?%/i;

function cleanList(arr, max = 4) {
  if (!Array.isArray(arr)) return [];
  return arr.map((s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 160)).filter((s) => s && !FORECASTY.test(s)).slice(0, max);
}

/** Deterministic review used when no LLM answers. */
function ruleReview({ side, forecast, cfg, context = {} }) {
  const conflicts = [], regime = [], invalid = [];
  const f = forecast?.[cfg.primaryHorizonH];
  const c = context.consensus || {}, d = context.debate || {}, ind = context.indicators || {};
  if (f && Math.sign(f.expCal) !== side) conflicts.push('model direction disagrees with the agent consensus');
  if (d.bearVeto && side > 0) conflicts.push('bear debate vetoed this long');
  if (d.riskVeto) conflicts.push('risk-manager debate vetoed');
  if (c.signal && c.signal !== (side > 0 ? 'BUY' : 'SELL')) conflicts.push('consensus signal differs from the side being gated');
  if (ind.rsi14 >= 75 && side > 0) regime.push('RSI overbought while going long');
  if (ind.rsi14 <= 25 && side < 0) regime.push('RSI oversold while going short');
  if (f && forecast[cfg.horizonsH[0]] && Math.sign(forecast[cfg.horizonsH[0]].expCal) !== Math.sign(f.expCal)) regime.push('short and primary horizons point in different directions');
  if (context.volRatio > 1.0) regime.push('short-term volatility well above its 24h level');
  if (context.spreadPct > 0.08) regime.push('wider than usual spread');
  invalid.push(side > 0 ? 'close below the entry stop (ATR-based)' : 'close above the entry stop (ATR-based)');
  invalid.push('model direction flips at the next forecast');
  const hard = conflicts.length >= 2 || (d.bearVeto && d.riskVeto);
  return { verdict: hard ? 'veto' : (conflicts.length || regime.length ? 'caution' : 'agree'), conflicts: cleanList(conflicts), regimeRisks: cleanList(regime), invalidation: cleanList(invalid), source: 'rules', model: null };
}

async function review(args) {
  const base = ruleReview(args);
  if (process.env.ENGINE_REVIEW === 'false') return { ...base, source: 'rules(llm off)' };
  const { side, forecast, cfg, context = {} } = args;
  const pick = (h) => forecast[h] && { horizonH: h, pUp: +forecast[h].pUp.toFixed(3), pDown: +forecast[h].pDown.toFixed(3), expectedReturnPct: +(forecast[h].expCal * 100).toFixed(3), uncertaintyPct: +(forecast[h].se * 100).toFixed(3) };
  const payload = { pair: context.pair, signalSide: side > 0 ? 'long' : 'short', modelOutputs: cfg.horizonsH.map(pick).filter(Boolean),
    costPct: context.costPct, spreadPct: context.spreadPct, consensus: context.consensus, debate: context.debate, indicators: context.indicators,
    patternAdvice: context.patternAdvice, sharedLearning: context.learningContext, sources: context.sources,
    ruleFindings: { conflicts: base.conflicts, regimeRisks: base.regimeRisks } };
  const r = await llmJson({
    system: 'You are a risk reviewer for a trading system. A numerical model has already produced probabilities and expected returns. You DO NOT forecast prices and you must not state any price, target or percentage move. ' +
      'Review the model outputs against the market context: flag conflicts, regime risks, and the conditions that would invalidate the trade. ' +
      'Answer ONLY JSON: {"verdict":"agree|caution|veto","conflicts":["max 3 short items"],"regimeRisks":["max 3 short items"],"invalidation":["max 3 short items, conditions not prices"]}. Use "veto" only for a clear disqualifying conflict.',
    user: JSON.stringify(payload), maxTokens: 350 });
  const j = r?.json;
  if (!j || !VERDICTS.has(String(j.verdict).toLowerCase())) return base;
  const llm = { verdict: String(j.verdict).toLowerCase(), conflicts: cleanList(j.conflicts, 3), regimeRisks: cleanList(j.regimeRisks, 3), invalidation: cleanList(j.invalidation, 3), source: 'llm', model: r.model };
  // the reviewer can only TIGHTEN: never softer than the rule review's verdict
  const rank = { agree: 0, caution: 1, veto: 2 };
  if (rank[base.verdict] > rank[llm.verdict]) llm.verdict = base.verdict;
  llm.conflicts = [...new Set([...base.conflicts, ...llm.conflicts])].slice(0, 4);
  llm.regimeRisks = [...new Set([...base.regimeRisks, ...llm.regimeRisks])].slice(0, 4);
  if (!llm.invalidation.length) llm.invalidation = base.invalidation;
  return llm;
}

module.exports = { review, ruleReview, cleanList, FORECASTY };
