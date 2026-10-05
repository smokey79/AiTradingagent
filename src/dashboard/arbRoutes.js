/**
 * src/dashboard/arbRoutes.js  (2026-10-03) -- READ-ONLY endpoints for the arbitrage module and the predictor memory.
 * Mounted from server.js. Page: /arb.html
 */
'use strict';

const memory = require('../arb/memory');
const store = require('../predictor/predictionStore');

const safe = (fn) => (req, res) => {
  try { res.json(fn(req)); } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
};
const lim = (req, d) => Math.max(1, Math.min(300, parseInt(req.query.limit, 10) || d));

function mount(app) {
  app.get('/api/arb/summary', safe(() => ({
    mode: 'PAPER ONLY - fills are simulated from live order books after fees, price impact, a latency haircut and a rebalancing cost. No order is ever sent.',
    pnl: memory.summary(), predictor: store.stats('arb'), history: memory.histAll(),
  })));
  app.get('/api/arb/trades', safe((req) => memory.recentTrades(lim(req, 50))));
  app.get('/api/arb/opportunities', safe((req) => ({ latest: memory.recentObservations(lim(req, 40)), routes: memory.topRoutes(15) })));
  app.get('/api/arb/predictions', safe((req) => ({ stats: store.stats('arb'), recent: store.recent('arb', lim(req, 40)) })));
  app.get('/api/predictions/summary', safe(() => ({ trade: store.stats('trade'), arb: store.stats('arb') })));
  app.get('/api/predictions/trade', safe((req) => ({ stats: store.stats('trade'), recent: store.recent('trade', lim(req, 40)) })));
}

module.exports = { mount };
