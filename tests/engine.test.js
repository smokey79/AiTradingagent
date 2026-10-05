// tests/engine.test.js (2026-10-03) -- offline tests for the probability engine, gate, reviewer and evaluation log. Synthetic data, temp files, no network.
// Run: node tests/engine.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'enginetest-'));
process.env.ENGINE_DB_PATH = path.join(tmp, 'engine.db');
process.env.ENGINE_MODEL_PATH = path.join(tmp, 'model.json');
process.env.ENGINE_REVIEW = 'false';
process.env.PREDICTOR_LLM = 'false';
delete process.env.ENGINE_GATE_MODE;

const llm = require('../src/predictor/llm');                       // patched BEFORE reviewer.js loads (it destructures llmJson)
let fakeLlm = null;
llm.llmJson = async () => fakeLlm;
const F = require('../src/engine/features');
const M = require('../src/engine/model');
const T = require('../src/engine/trainer');
const G = require('../src/engine/gate');
const R = require('../src/engine/reviewer');
const S = require('../src/engine/store');
const E = require('../src/engine/engine');
const baseCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/engine.json'), 'utf8'));
// These regression fixtures exercise the original hourly model independently of the live horizon configuration.
baseCfg.horizonsH = [1, 4, 24]; baseCfg.primaryHorizonH = 4;
delete baseCfg.horizonTimeframes; delete baseCfg.gateAgreementHorizons;
process.env.ENGINE_CONFIG_PATH = path.join(tmp, 'engine-config.json');
fs.writeFileSync(process.env.ENGINE_CONFIG_PATH, JSON.stringify(baseCfg));

function rng(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
function series(seed, n, phi, vol) {
  const r = rng(seed); let c = 100, prev = 0; const out = [], t0 = Date.UTC(2026, 0, 1);
  for (let i = 0; i < n; i++) {
    const ret = phi * prev + vol * gauss(r); prev = ret; const o = c; c = c * Math.exp(ret);
    out.push([t0 + i * 3600000, o, Math.max(o, c) * (1 + Math.abs(gauss(r)) * vol * 0.3), Math.min(o, c) * (1 - Math.abs(gauss(r)) * vol * 0.3), c, 1000 * (1 + Math.abs(gauss(r)))]);
  }
  return out;
}
const world = (phi, seeds = [1, 2, 3, 4], n = 2600) => Object.fromEntries(seeds.map((s) => [`C${s}/USDT`, series(s * 7 + 1, n, phi, 0.01)]));
const fastCfg = (over = {}) => ({ ...baseCfg, horizonsH: [1, 4], primaryHorizonH: 1, train: { ...baseCfg.train, epochs: 120 }, ...over });

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '-', e.message); } }
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);

(async () => {
  // ---------------- features
  await t('features: 15 named, finite, and no look-ahead', () => {
    const c = series(5, 120, 0, 0.01), P = F.prepare(c), x = F.featuresAt(P, 80);
    assert.strictEqual(x.length, F.NAMES.length); assert.ok(x.every(Number.isFinite));
    const c2 = c.map((r) => r.slice()); for (let i = 81; i < 120; i++) { c2[i][4] *= 3; c2[i][2] *= 3; }       // change the FUTURE
    const y = F.featuresAt(F.prepare(c2), 80);
    assert.deepStrictEqual(x, y, 'a feature at i must not depend on candles after i');
    assert.strictEqual(F.featuresAt(P, 10), null); assert.strictEqual(F.prepare(c.slice(0, 30)), null);
  });
  await t('features: garbage candles are dropped, not turned into numbers', () => {
    const c = series(5, 120, 0, 0.01); c[60][4] = 0; c[61] = [1, 'x', null, 2, 3];
    const P = F.prepare(c); assert.strictEqual(P.n, 118);
  });

  // ---------------- model
  await t('model: linear solver, ridge recovers coefficients', () => {
    const r = rng(3), X = Array.from({ length: 400 }, () => [gauss(r), gauss(r)]), y = X.map((x) => 2 * x[0] - 1 * x[1] + 0.5);
    const b = M.ridgeFit(X, y, 0.001); near(b[0], 2, 0.01); near(b[1], -1, 0.01); near(b[2], 0.5, 0.01);
  });
  await t('model: softmax separates classes; PAVA is monotone; calibrator maps toward observed frequency', () => {
    const r = rng(4), X = [], y = [];
    for (let i = 0; i < 900; i++) { const k = i % 3; X.push([gauss(r) + (k - 1) * 2.5, gauss(r)]); y.push(k); }
    const s = M.standardize(X), Xs = X.map((x) => M.apply(s, x)), W = M.softmaxFit(Xs, y, { epochs: 200, lr: 0.5 });
    const acc = Xs.filter((x, i) => M.softmaxProbs(W, x).indexOf(Math.max(...M.softmaxProbs(W, x))) === y[i]).length / 900;
    assert.ok(acc > 0.8, `accuracy ${acc}`);
    const m = M.pava([0.1, 0.4, 0.3, 0.5, 0.45], [1, 1, 1, 1, 1]); for (let i = 1; i < m.length; i++) assert.ok(m[i] >= m[i - 1]);
    const p = Array.from({ length: 3000 }, () => r()), hit = p.map((x) => (r() < x * 0.5 ? 1 : 0));   // over-confident by 2x
    const cal = M.fitCalibrator(p, hit); near(M.calibrate(cal, 0.8), 0.4, 0.07);
  });
  await t('model: a forecast with no information gets slope near 0 (it is shrunk, not trusted)', () => {
    const r = rng(8), pred = Array.from({ length: 4000 }, () => gauss(r) * 0.01), real = Array.from({ length: 4000 }, () => gauss(r) * 0.01);
    const f = M.fitSlope(pred, real, 4); assert.ok(Math.abs(f.slope) < 0.15, `slope ${f.slope}`);
  });

  // ---------------- trainer: the honesty tests
  let randomModel, momentumModel;
  await t('trainer: on a RANDOM WALK nothing validates and there is no skill over the base rates', () => {
    randomModel = T.trainModel(world(0), fastCfg());
    for (const h of [1, 4]) { const v = randomModel.horizons[h].validation; assert.strictEqual(v.validated, false, `h${h} validated on noise: ${v.failReasons}`); assert.ok(v.brierSkill < 0.01, `brier skill ${v.brierSkill}`); }
    assert.strictEqual(randomModel.validated, false);
  });
  await t('trainer: on data WITH real momentum it finds skill, and p(up) rises after an up-move', () => {
    momentumModel = T.trainModel(world(0.5), fastCfg());
    const v = momentumModel.horizons[1].validation; assert.ok(v.brierSkill > 0, `skill ${v.brierSkill}`);
    assert.ok(v.testAllEdgeSignals.mean > 0, `mean net ${v.testAllEdgeSignals.mean}`);
    const s = series(99, 120, 0.5, 0.01), P = F.prepare(s);
    let upIdx = -1, dnIdx = -1; for (let i = 60; i < 119; i++) { if (upIdx < 0 && P.lr[i] > 0.015) upIdx = i; if (dnIdx < 0 && P.lr[i] < -0.015) dnIdx = i; }
    const pu = M.predictBundle(momentumModel.horizons[1], F.featuresAt(P, upIdx)), pd = M.predictBundle(momentumModel.horizons[1], F.featuresAt(P, dnIdx));
    assert.ok(pu.pUp > pd.pUp && pu.expCal > pd.expCal, 'after an up bar the model should lean up more than after a down bar');
    assert.ok(Math.abs(pu.pUp + pu.pFlat + pu.pDown - 1) < 1e-6);
  });
  await t('trainer: too little data is an error, not a model', () => {
    assert.throws(() => T.trainModel({ A: series(1, 120, 0, 0.01), B: series(2, 120, 0, 0.01), C: series(3, 120, 0, 0.01) }, fastCfg()));
  });
  await t('trainer: signals are counted one-at-a-time per coin (no overlapping windows)', () => {
    const samples = [0, 1, 2, 3, 4, 5].map((i) => ({ pair: 'A', ts: i * 3600000, lr: 0.01, y: 2, x: [] }));
    const preds = samples.map(() => ({ pUp: 0.9, pDown: 0.05, expCal: 0.01 }));
    assert.strictEqual(T.signalNets(samples, preds, 0.5, 0.002, 4).length, 2);        // ts 0 and ts 4h
  });

  // ---------------- gate
  const cfg = baseCfg, model = { horizons: { 4: { recommendedMinProb: 0.55 } } };
  const f = (pUp, pDown, e, se = 0.0005) => ({ pUp, pDown, pFlat: 1 - pUp - pDown, expCal: e, se });
  const good = { 1: f(0.5, 0.2, 0.004), 4: f(0.62, 0.15, 0.009), 24: f(0.55, 0.2, 0.012) };
  const cost = G.roundTripCost({ spreadPct: 0.03, notionalUsd: 25, depthUsd: 50000 });
  const run = (o = {}) => G.decide({ side: 1, forecast: good, cost, cfg, model, liquidity: { spreadPct: 0.03, depthUsd: 50000 }, atrPct: 0.6, ...o });
  const codes = (g) => g.reasons.map((r) => r.code);
  await t('gate: cost = fees+slippage both ways + spread + impact, and grows with spread', () => {
    const c0 = G.roundTripCost({ spreadPct: 0, notionalUsd: 25, depthUsd: 0 }), c1 = G.roundTripCost({ spreadPct: 0.1, notionalUsd: 25, depthUsd: 0 });
    near(c0.total, 0.0016, 1e-9); near(c1.total - c0.total, 0.001, 1e-9);
  });
  await t('gate: a real edge passes', () => { const g = run(); assert.ok(g.pass, JSON.stringify(g.reasons)); assert.ok(g.netEdgePct > 0 && g.suggestedSizeUsd > 0); });
  await t('gate: no model -> MODEL_NOT_READY', () => assert.deepStrictEqual(codes(G.decide({ side: 1, forecast: null, cost, cfg, model: null })), ['MODEL_NOT_READY']));
  await t('gate: edge smaller than the costs -> NO_NET_EDGE', () => assert.ok(codes(run({ forecast: { ...good, 4: f(0.62, 0.15, 0.0015) } })).includes('NO_NET_EDGE')));
  await t('gate: uncertainty is deducted (same expected return, bigger se -> rejected)', () => {
    assert.ok(run({ forecast: { ...good, 4: f(0.62, 0.15, 0.0045, 0.0005) } }).pass);
    assert.ok(codes(run({ forecast: { ...good, 4: f(0.62, 0.15, 0.0045, 0.004) } })).includes('NO_NET_EDGE'));
  });
  await t('gate: opposite direction / low probability / horizons disagree', () => {
    assert.ok(codes(run({ side: -1 })).includes('DIRECTION_CONFLICT'));
    assert.ok(codes(run({ forecast: { ...good, 4: f(0.5, 0.3, 0.009) } })).includes('LOW_CONFIDENCE'));
    assert.ok(codes(run({ forecast: { 1: f(0.5, 0.2, -0.004), 4: f(0.62, 0.15, 0.009), 24: f(0.55, 0.2, -0.012) } })).includes('HORIZON_DISAGREE'));
  });
  await t('gate: wide spread or thin book -> ILLIQUID; huge stop -> RISK_LIMIT', () => {
    assert.ok(codes(run({ liquidity: { spreadPct: 0.4, depthUsd: 50000 } })).includes('ILLIQUID'));
    assert.ok(codes(run({ liquidity: { spreadPct: 0.03, depthUsd: 60 } })).includes('ILLIQUID'));
    assert.ok(codes(run({ atrPct: 12 })).includes('RISK_LIMIT'));
    assert.ok(codes(run({ atrPct: 0 })).includes('RISK_LIMIT'));
  });
  await t('gate: reviewer veto rejects; caution demands extra margin; agree changes nothing', () => {
    assert.ok(codes(run({ review: { verdict: 'veto', conflicts: ['x'] } })).includes('REVIEWER_VETO'));
    assert.ok(run({ review: { verdict: 'agree' } }).pass);
    const marginal = { ...good, 4: f(0.62, 0.15, 0.0030) };            // net edge ~0.06%: positive, but under half a round-trip cost
    assert.ok(run({ forecast: marginal }).pass); assert.ok(codes(run({ forecast: marginal, review: { verdict: 'caution' } })).includes('NO_NET_EDGE'));
  });
  await t('gate: a short is judged on the downside', () => {
    const dn = { 1: f(0.2, 0.5, -0.004), 4: f(0.15, 0.62, -0.009), 24: f(0.2, 0.55, -0.012) };
    assert.ok(run({ side: -1, forecast: dn }).pass); assert.ok(codes(run({ side: 1, forecast: dn })).includes('DIRECTION_CONFLICT'));
  });

  // ---------------- reviewer
  await t('reviewer: strips anything that looks like a price forecast', () => {
    const cleaned = R.cleanList(['target $65,000 next week', 'will rise 4%', 'RSI divergence vs trend', 'funding looks crowded', 'expects to reach the highs']);
    assert.deepStrictEqual(cleaned, ['RSI divergence vs trend', 'funding looks crowded']);
  });
  await t('reviewer: rule review flags conflicts; LLM cannot soften it, cannot add forecasts', async () => {
    const args = { side: 1, forecast: { 1: f(0.4, 0.3, -0.002), 4: f(0.4, 0.4, -0.004), 24: f(0.5, 0.2, 0.01) }, cfg, context: { consensus: { signal: 'SELL' }, debate: { bearVeto: true } } };
    const rr = R.ruleReview(args); assert.strictEqual(rr.verdict, 'veto');
    process.env.ENGINE_REVIEW = 'true';
    fakeLlm = { json: { verdict: 'agree', conflicts: ['price target 70000'], regimeRisks: ['thin weekend liquidity'], invalidation: ['reclaim of the range low'] }, model: 'fake' };
    const out = await R.review(args); process.env.ENGINE_REVIEW = 'false'; fakeLlm = null;
    assert.strictEqual(out.verdict, 'veto', 'LLM "agree" must not soften a rule veto'); assert.strictEqual(out.source, 'llm');
    assert.ok(!out.conflicts.some((c) => /target/.test(c)) && out.regimeRisks.includes('thin weekend liquidity'));
  });
  await t('reviewer: no LLM answer -> rule review (pipeline still works)', async () => {
    process.env.ENGINE_REVIEW = 'true'; fakeLlm = null;
    const out = await R.review({ side: 1, forecast: good, cfg, context: { consensus: { signal: 'BUY' }, debate: {}, indicators: { rsi14: 55 } } }); process.env.ENGINE_REVIEW = 'false';
    assert.strictEqual(out.source, 'rules'); assert.ok(['agree', 'caution'].includes(out.verdict));
  });

  // ---------------- evaluation log
  await t('store: outcomes are scored after the horizon; gate-passed vs rejected are compared after costs', () => {
    const t0 = Date.now() - 10 * 3600000, rec = (pair, pUp, pDown, side, pass, price) => S.recordForecast({ nowMs: t0, pair, horizonH: 4, pDown, pFlat: 1 - pUp - pDown, pUp, expRet: 0.004, expSe: 0.001, price, costRt: 0.002, side, mode: 'shadow', gatePass: pass, gateReasons: pass ? '' : 'NO_NET_EDGE', netEdgePct: 0.1, flatBand: 0.002 });
    rec('X/USDT', 0.7, 0.1, 1, true, 100); rec('Y/USDT', 0.4, 0.3, 1, false, 100); rec('Z/USDT', 0.3, 0.5, -1, true, 100);
    S.recordForecast({ nowMs: Date.now() - 1000, pair: 'X/USDT', horizonH: 24, pDown: 0.2, pFlat: 0.3, pUp: 0.5, expRet: 0, expSe: 0, price: 100, costRt: 0.002, side: 0, flatBand: 0.002 });
    assert.strictEqual(S.resolveDue('X/USDT', 102), 1, 'only the due one is scored'); S.resolveDue('Y/USDT', 99); S.resolveDue('Z/USDT', 98);
    const ev = S.evaluation(4);
    assert.strictEqual(ev.resolved, 3); assert.strictEqual(ev.gate.gatePassed.n, 2); assert.strictEqual(ev.gate.gateRejected.n, 1);
    assert.ok(ev.gate.gatePassed.mean > 0 && ev.gate.gateRejected.mean < 0, JSON.stringify(ev.gate));
    near(S.recent(5).find((r) => r.pair === 'X/USDT' && r.horizon_h === 4).net_ret_side, 0.02 - 0.002, 1e-9);
  });

  // ---------------- engine end to end (shadow)
  await t('engine: forecasts 3 horizons, logs them, gate decision recorded, shadow by default', async () => {
    fs.writeFileSync(process.env.ENGINE_MODEL_PATH, JSON.stringify(T.trainModel(world(0, [11, 12, 13, 14]), { ...baseCfg, train: { ...baseCfg.train, epochs: 100 } })));
    const candles = series(77, 100, 0, 0.01), price = candles[99][4];
    const md = { price: { price }, candles, rawOrderBook: { bids: [[price * 0.9998, 800]], asks: [[price * 1.0002, 800]] }, indicators: { rsi14: 55, orderBook: { spreadPct: 0.04, imbalanceRatio: 0.5 } }, quality: { ok: true } };
    const r = await E.evaluate({ pair: 'C1/USDT', marketData: md, consensus: { signal: 'BUY', confidence: 0.7 }, debate: {} });
    assert.strictEqual(r.mode, 'shadow'); assert.deepStrictEqual(Object.keys(r.forecast).sort(), ['1', '24', '4']); assert.ok(r.gate.reasons !== undefined);
    assert.strictEqual(r.gate.pass, false, 'a model trained on noise must not approve a trade'); assert.ok(r.gate.reasons.length > 0);
    assert.strictEqual(S.marketCount().n >= 1, true);
    assert.strictEqual(S.recent(10).filter((x) => x.pair === 'C1/USDT').length, 3);
    process.env.ENGINE_GATE_MODE = 'auto'; assert.strictEqual(E.gateMode(E.loadModel()), 'shadow', 'auto must stay in shadow while the model is not validated');
    process.env.ENGINE_GATE_MODE = 'enforce'; assert.strictEqual(E.gateMode(E.loadModel()), 'enforce'); delete process.env.ENGINE_GATE_MODE;
  });
  await t('engine: no model file -> MODEL_NOT_READY, never an approval', async () => {
    const keep = process.env.ENGINE_MODEL_PATH; process.env.ENGINE_MODEL_PATH = path.join(tmp, 'missing.json');
    const candles = series(78, 100, 0, 0.01);
    const r = await E.evaluate({ pair: 'C2/USDT', marketData: { price: { price: candles[99][4] }, candles, indicators: {}, quality: { ok: true } }, consensus: { signal: 'BUY' } });
    process.env.ENGINE_MODEL_PATH = keep; assert.strictEqual(r.gate.pass, false); assert.strictEqual(r.gate.reasons[0].code, 'MODEL_NOT_READY');
  });

  S.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
