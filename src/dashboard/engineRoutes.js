/**
 * src/dashboard/engineRoutes.js (2026-10-03) -- READ-ONLY endpoints for the probability engine. Page: /engine.html
 */
'use strict';

const store = require('../engine/store');
const engine = require('../engine/engine');

const safe = (fn) => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(500).json({ error: String(e.message || e) }); } };

function mount(app) {
  app.get('/api/engine/expert', (req, res) => {
    try {
      const fs = require('fs'), path = require('path');
      const file = path.resolve(__dirname, '../../data/expert/latest.json');
      const latest = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { status: 'expert_not_running' };
      const trades = require('../learning/learningTrades').readLearningTrades();
      res.json({ ...latest, tradingCosts90Days: require('../risk/capitalPolicy').costReview(trades), capitalPolicy: require('../risk/capitalPolicy').check() });
    } catch (_) { res.status(503).json({ status: 'expert_state_unavailable' }); }
  });
  app.get('/api/engine/summary', safe(() => {
    const cfg = engine.config(), model = engine.loadModel();
    return {
      gateMode: engine.gateMode(model), gateModeSetting: process.env.ENGINE_GATE_MODE || 'shadow',
      config: { horizonsH: cfg.horizonsH, primaryHorizonH: cfg.primaryHorizonH, flatBand: cfg.flatBand, uncertaintyK: cfg.uncertaintyK, minProb: cfg.minProb, maxSpreadPct: cfg.maxSpreadPct, riskPerTradePct: cfg.riskPerTradePct, validationBar: cfg.validationBar },
      model: model ? { trainedAt: model.trainedAt, validated: model.validated, recommendedMinProb: model.recommendedMinProb, data: model.data, primaryHorizonH: model.primaryHorizonH,
        horizons: Object.fromEntries(Object.entries(model.horizons).map(([h, b]) => [h, b.validation])) } : null,
      market: store.marketCount(), evaluation: store.evaluation(cfg.primaryHorizonH), gateReasons: store.gateReasonCounts(),
      notCollectedYet: ['funding rate', 'liquidations (no free reliable source wired in; columns exist in market_log)'],
    };
  }));
  app.get('/api/engine/recent', safe((req) => store.recent(Math.max(1, Math.min(300, parseInt(req.query.limit, 10) || 60)))));
}

module.exports = { mount };
