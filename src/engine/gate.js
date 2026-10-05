/**
 * src/engine/gate.js (2026-10-03) -- the cost- and risk-aware trade gate. Pure function of its inputs (no I/O).
 * A signal passes only if ALL of these hold; every failure is returned as a reason code so the dashboard can show why.
 *   MODEL_NOT_READY      no trained model / no forecast for this coin
 *   DIRECTION_CONFLICT   the model's expected return points the other way from the signal
 *   HORIZON_DISAGREE     fewer than minHorizonAgree horizons agree with the signal
 *   LOW_CONFIDENCE       calibrated probability of the signal's direction is below the TESTED threshold (or not above the opposite one)
 *   NO_NET_EDGE          expected return minus fees, spread, slippage, impact and an uncertainty haircut is not positive
 *   ILLIQUID             spread too wide or order book too thin for the order
 *   RISK_LIMIT           the ATR stop would risk more than the per-trade limit
 *   REVIEWER_VETO        the reasoning reviewer found a conflict it considers disqualifying
 */
'use strict';

const realism = require('../utils/realism');

/** Round-trip cost as a fraction of notional: fees + slippage both sides, crossing the spread, and a small depth-based impact term. */
function roundTripCost({ spreadPct = 0, notionalUsd = 25, depthUsd = 0 }) {
  const perSide = realism.costFractionPerSide();
  const spread = Math.max(0, spreadPct) / 100;
  const impact = depthUsd > 0 ? (notionalUsd / depthUsd) * 0.001 : 0;
  return { total: 2 * perSide + spread + impact, feesAndSlippage: 2 * perSide, spread, impact };
}

function decide({ side, forecast, cost, review = null, cfg, model, liquidity = {}, atrPct = 0, equityUsd }) {
  const reasons = [];
  const why = (code, detail) => reasons.push({ code, detail });
  const prim = cfg.primaryHorizonH;
  const out = { pass: false, side, primaryHorizonH: prim, reasons };
  if (!model || !forecast || !forecast[prim]) { why('MODEL_NOT_READY', 'no trained model or no forecast'); return out; }
  if (side === 0) { out.pass = true; out.note = 'no BUY/SELL signal to gate'; return out; }

  const f = forecast[prim];
  const k = cfg.uncertaintyK;
  const caution = review && review.verdict === 'caution';
  const pSide = side > 0 ? f.pUp : f.pDown, pOpp = side > 0 ? f.pDown : f.pUp;
  const minProb = (model.horizons?.[prim]?.recommendedMinProb) ?? cfg.minProb;
  const gross = side * f.expCal, unc = k * f.se;
  const net = gross - cost.total - unc;
  Object.assign(out, { pSide, minProbUsed: minProb, grossExpPct: gross * 100, costPct: cost.total * 100, uncertaintyPct: unc * 100, netEdgePct: net * 100 });

  if (gross <= 0) why('DIRECTION_CONFLICT', `model expects ${(f.expCal * 100).toFixed(3)}% over ${prim}h, signal is ${side > 0 ? 'long' : 'short'}`);
  const agreementHorizons = cfg.gateAgreementHorizons || cfg.horizonsH;
  const agree = agreementHorizons.filter((h) => forecast[h] && Math.sign(forecast[h].expCal) === side).length;
  out.horizonsAgreeing = agree;
  if (agree < cfg.minHorizonAgree) why('HORIZON_DISAGREE', `${agree}/${cfg.horizonsH.length} horizons agree (need ${cfg.minHorizonAgree})`);
  if (pSide < minProb || pSide <= pOpp) why('LOW_CONFIDENCE', `P(${side > 0 ? 'up' : 'down'}) ${(pSide * 100).toFixed(1)}% vs needed ${(minProb * 100).toFixed(0)}% and above the opposite ${(pOpp * 100).toFixed(1)}%`);
  const need = caution ? 0.5 * cost.total : 0;                      // a "caution" review demands extra margin
  if (net <= need) why('NO_NET_EDGE', `net edge ${(net * 100).toFixed(3)}% (gross ${(gross * 100).toFixed(3)}% - cost ${(cost.total * 100).toFixed(3)}% - uncertainty ${(unc * 100).toFixed(3)}%)${caution ? ` must exceed ${(need * 100).toFixed(3)}% after a cautious review` : ''}`);

  if ((liquidity.spreadPct ?? 0) > cfg.maxSpreadPct) why('ILLIQUID', `spread ${liquidity.spreadPct.toFixed(3)}% > ${cfg.maxSpreadPct}%`);
  if (liquidity.depthUsd > 0 && liquidity.depthUsd < cfg.minDepthMultiple * cfg.notionalUsd) why('ILLIQUID', `book depth $${liquidity.depthUsd.toFixed(0)} < ${cfg.minDepthMultiple}x order size`);

  const stopFrac = (cfg.stopAtrMultiple * atrPct) / 100;
  const eq = equityUsd || cfg.equityUsd;
  if (!(stopFrac > 0)) why('RISK_LIMIT', 'no volatility estimate for the stop');
  else {
    const sizeByRisk = (eq * cfg.riskPerTradePct / 100) / stopFrac, cap = eq * cfg.maxPositionPct / 100;
    out.stopPct = stopFrac * 100;
    out.suggestedSizeUsd = Math.max(0, Math.min(sizeByRisk, cap));
    if (cfg.notionalUsd * stopFrac > eq * cfg.riskPerTradePct / 100 + 1e-9) why('RISK_LIMIT', `stop ${(stopFrac * 100).toFixed(2)}% on $${cfg.notionalUsd} risks more than ${cfg.riskPerTradePct}% of equity`);
  }
  if (review && review.verdict === 'veto') why('REVIEWER_VETO', (review.conflicts && review.conflicts[0]) || 'reviewer veto');

  out.pass = reasons.length === 0;
  return out;
}

module.exports = { decide, roundTripCost };
