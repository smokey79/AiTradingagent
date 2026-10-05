/**
 * src/engine/engine.js (2026-10-03) -- the pipeline the orchestrator calls once per coin per cycle, AFTER the agent consensus + debate.
 *   1 log      market snapshot (price, spread, depth, imbalance, ATR, vol) -> data/engine/engine.db
 *   2 forecast calibrated P(down/flat/up) + expected return for each horizon (1h/4h/24h) from the trained model (data/engine/model.json)
 *   3 review   the reasoning agent reviews the model outputs + context (conflicts, regime risks, invalidation); it never forecasts
 *   4 gate     fees + spread + slippage + uncertainty + liquidity + risk limits -> pass / reject with reason codes
 *   5 evaluate every forecast is stored and later scored against the real outcome (store.evaluation)
 *
 * ENGINE_GATE_MODE: shadow (default: decisions are logged and shown, nothing is blocked) | enforce | auto (enforce only if the model passed its out-of-sample bar).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const F = require('./features');
const M = require('./model');
const store = require('./store');
const { decide, roundTripCost } = require('./gate');
const { review } = require('./reviewer');

const ROOT = path.resolve(__dirname, '../..');
const MODEL_PATH = () => process.env.ENGINE_MODEL_PATH || path.join(ROOT, 'data', 'engine', 'model.json');
let cfgCache = null, modelCache = null, modelMtime = 0;
let reviewBudget = { hour: -1, used: 0 };

function config() {
  if (!cfgCache) cfgCache = JSON.parse(fs.readFileSync(process.env.ENGINE_CONFIG_PATH || path.join(ROOT, 'config', 'engine.json'), 'utf8'));
  return cfgCache;
}
function loadModel() {
  const p = MODEL_PATH();
  try {
    const st = fs.statSync(p);
    if (!modelCache || st.mtimeMs !== modelMtime) { modelCache = JSON.parse(fs.readFileSync(p, 'utf8')); modelMtime = st.mtimeMs; }
  } catch (_) { modelCache = null; }
  return modelCache;
}
function gateMode(model) {
  const m = String(process.env.ENGINE_GATE_MODE || 'shadow').toLowerCase();
  if (m === 'enforce') return 'enforce';
  if (m === 'auto') return model && model.validated ? 'enforce' : 'shadow';
  return 'shadow';
}
const sideOf = (signal) => (signal === 'BUY' ? 1 : signal === 'SELL' ? -1 : 0);

function liquidityOf(marketData) {
  const ob = marketData.indicators?.orderBook || {};
  const raw = marketData.rawOrderBook;
  const depthUsd = raw && raw.bids && raw.asks ? Math.min(raw.bids.slice(0, 10).reduce((s, [p, q]) => s + p * q, 0), raw.asks.slice(0, 10).reduce((s, [p, q]) => s + p * q, 0)) : 0;
  return { spreadPct: ob.spreadPct ?? 0, depthUsd, imbalance: ob.imbalanceRatio ?? null };
}

async function evaluate({ pair, marketData, consensus = {}, debate = {}, nowMs = Date.now() }) {
  const cfg = config(), model = loadModel(), mode = gateMode(model);
  const res = { mode, modelValidated: !!(model && model.validated), pair };
  // the model is trained on crypto spot (USDT pairs) only; forex / indices / metals have no validated model, so they are never approved by it
  if (!/\/USDT$/.test(pair)) { res.status = 'unsupported_market'; res.gate = { pass: false, reasons: [{ code: 'MODEL_NOT_READY', detail: 'model covers crypto USDT pairs only' }] }; return res; }
  const primaryTimeframe = model?.horizons?.[cfg.primaryHorizonH]?.timeframe || '1h';
  const feat = F.featuresLast(marketData.horizonCandles?.[primaryTimeframe] || (primaryTimeframe === '1h' ? marketData.candles : null));
  const price = marketData.price?.price;
  const liq = liquidityOf(marketData);
  try {
    store.logMarket({ nowMs, pair, price, spreadPct: liq.spreadPct, depthUsd: liq.depthUsd, imbalance: liq.imbalance, atrPct: feat?.atrPct, vol24: feat?.vol24, candleSource: marketData.quality?.metrics?.candleSource || marketData.sources?.candles, qualityOk: marketData.quality?.ok !== false });
    store.resolveDue(pair, price, nowMs);
  } catch (_) { /* logging never blocks trading */ }

  if (!model || !feat || !feat.x) { res.status = !model ? 'no_model' : 'no_features'; res.gate = { pass: false, reasons: [{ code: 'MODEL_NOT_READY', detail: res.status }] }; return res; }

  const forecast = {};
  res.horizonStatus = {};
  for (const h of cfg.horizonsH) {
    const bundle = model.horizons[h];
    const timeframe = bundle?.timeframe || '1h';
    const f = F.featuresLast(marketData.horizonCandles?.[timeframe] || (timeframe === '1h' ? marketData.candles : null));
    if (!bundle || bundle.unavailable || !f?.x) { res.horizonStatus[h] = 'awaiting_model_or_data'; continue; }
    forecast[h] = M.predictBundle(bundle, f.x);
    res.horizonStatus[h] = bundle.validation?.validated ? 'validated' : 'shadow_unvalidated';
  }
  res.forecast = Object.fromEntries(Object.entries(forecast).map(([h, f]) => [h, { pUp: +f.pUp.toFixed(3), pFlat: +f.pFlat.toFixed(3), pDown: +f.pDown.toFixed(3), expectedReturnPct: +(f.expCal * 100).toFixed(3), uncertaintyPct: +(f.se * 100).toFixed(3) }]));

  const side = sideOf(consensus.signal);
  const cost = roundTripCost({ spreadPct: liq.spreadPct, notionalUsd: cfg.notionalUsd, depthUsd: liq.depthUsd });
  let rev = null, gate = decide({ side, forecast, cost, cfg, model, liquidity: liq, atrPct: feat.atrPct });
  if (side !== 0 && gate.pass) {                                           // the LLM only sees signals that already clear the numbers
    const hour = Math.floor(nowMs / 3600000);
    if (reviewBudget.hour !== hour) reviewBudget = { hour, used: 0 };
    if (reviewBudget.used < Number(process.env.ENGINE_REVIEW_MAX_PER_HOUR || 30)) {
      reviewBudget.used++;
      try {
        rev = await review({ side, forecast, cfg, context: { pair, consensus: { signal: consensus.signal, confidence: consensus.confidence, agents: consensus.agentsAgreeing }, debate,
          indicators: { rsi14: marketData.indicators?.rsi14, emaTrend: marketData.indicators?.priceVsEma50 }, costPct: +(cost.total * 100).toFixed(3), spreadPct: liq.spreadPct, volRatio: feat.x[6],
          patternAdvice: marketData.patternAdvice, learningContext: marketData.learningContext, sources: marketData.sourceEvidence } });
        gate = decide({ side, forecast, cost, review: rev, cfg, model, liquidity: liq, atrPct: feat.atrPct });
      } catch (_) { /* a failing reviewer never blocks and never approves */ }
    }
  }
  res.gate = { pass: gate.pass, reasons: gate.reasons, side, netEdgePct: gate.netEdgePct, grossExpPct: gate.grossExpPct, costPct: gate.costPct, uncertaintyPct: gate.uncertaintyPct, pSide: gate.pSide,
    minProbUsed: gate.minProbUsed, horizonsAgreeing: gate.horizonsAgreeing, suggestedSizeUsd: gate.suggestedSizeUsd, stopPct: gate.stopPct };
  res.review = rev;

  try {
    for (const h of cfg.horizonsH) {
      const f = forecast[h]; if (!f) continue;
      const primary = h === cfg.primaryHorizonH;
      store.recordForecast({ nowMs, pair, horizonH: h, pDown: f.pDown, pFlat: f.pFlat, pUp: f.pUp, expRet: f.expCal, expSe: f.se, price, costRt: cost.total, side, mode,
        gatePass: primary && side !== 0 ? gate.pass : null, gateReasons: primary && side !== 0 ? gate.reasons.map((r) => r.code).join(',') : null, netEdgePct: primary ? gate.netEdgePct : null,
        reviewer: primary && rev ? rev.verdict : null, modelValidated: model.horizons[h]?.validation?.validated === true, flatBand: cfg.flatBand });
    }
  } catch (_) { /* never blocks */ }
  return res;
}

module.exports = { evaluate, config, loadModel, gateMode, liquidityOf, sideOf };
