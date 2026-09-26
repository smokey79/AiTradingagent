// src/bridge/pythonBridge.js
// ─────────────────────────────────────────────────────────────────────────────
// Receives signals from the Python engine and feeds them into the
// Node.js 13-agent orchestrator.
//
// Add to your Express app:
//   const pythonBridge = require('./src/bridge/pythonBridge');
//   app.use('/api', pythonBridge);
//
// Alan J | barcay0611@gmail.com | github: smokey79
// ─────────────────────────────────────────────────────────────────────────────

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const router   = express.Router();

const DATA_DIR = path.join(__dirname, '../../');
const LATEST_DECISION  = path.join(DATA_DIR, 'latest_decision.json');
const VAULT_SUMMARY    = path.join(DATA_DIR, 'vault_summary.json');
const PORTFOLIO_STATE  = path.join(DATA_DIR, 'portfolio_state.json');

// ── In-memory signal queue (replace with Redis for prod) ───────────────────
const signalQueue   = [];
const arbQueue      = [];
const MAX_QUEUE     = 100;


// ─────────────────────────────────────────────────────────────────────────────
// POST /api/python-signal
// Receives a trading decision from the Python debate/strategy engine
// ─────────────────────────────────────────────────────────────────────────────
router.post('/python-signal', (req, res) => {
  const { symbol, action, reason, ts } = req.body;

  if (!symbol || !action) {
    return res.status(400).json({ error: 'symbol and action required' });
  }

  const signal = {
    symbol,
    action : action.toUpperCase(),
    reason : reason || '',
    ts     : ts || new Date().toISOString(),
    source : 'python_engine',
  };

  // Push to queue for orchestrator to consume
  signalQueue.unshift(signal);
  if (signalQueue.length > MAX_QUEUE) signalQueue.pop();

  // Write to shared file for dashboard
  try {
    fs.writeFileSync(
      LATEST_DECISION,
      JSON.stringify({ ...signal, updated_at: new Date().toISOString() }, null, 2)
    );
  } catch (e) {
    console.warn('[Bridge] Could not write latest_decision.json:', e.message);
  }

  console.log(`[Bridge] Signal received: ${action} ${symbol} — ${reason?.slice(0, 60)}`);

  // Emit to connected dashboard clients via SSE/WebSocket if available
  if (global.broadcastToClients) {
    global.broadcastToClients({ type: 'python_signal', payload: signal });
  }

  res.json({ status: 'queued', signal });
});


// ─────────────────────────────────────────────────────────────────────────────
// POST /api/python-arb
// Receives arbitrage opportunities from the Python multi-chain scanner
// ─────────────────────────────────────────────────────────────────────────────
router.post('/python-arb', (req, res) => {
  const { opportunities, ts } = req.body;

  if (!Array.isArray(opportunities)) {
    return res.status(400).json({ error: 'opportunities must be an array' });
  }

  const payload = {
    opportunities,
    count    : opportunities.length,
    ts       : ts || new Date().toISOString(),
    source   : 'python_arb_scanner',
  };

  arbQueue.unshift(payload);
  if (arbQueue.length > MAX_QUEUE) arbQueue.pop();

  try {
    fs.writeFileSync(VAULT_SUMMARY, JSON.stringify(payload, null, 2));
  } catch (e) {
    console.warn('[Bridge] Could not write vault_summary.json:', e.message);
  }

  if (global.broadcastToClients) {
    global.broadcastToClients({ type: 'arb_opportunities', payload });
  }

  res.json({ status: 'ok', count: opportunities.length });
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/python-signal/latest
// Orchestrator polls this to consume the next queued Python signal
// ─────────────────────────────────────────────────────────────────────────────
router.get('/python-signal/latest', (req, res) => {
  const signal = signalQueue[0] || null;
  res.json({ signal });
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/python-signal/consume
// Pops and returns the next signal (call from orchestrator after processing)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/python-signal/consume', (req, res) => {
  const signal = signalQueue.shift() || null;
  res.json({ signal, remaining: signalQueue.length });
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bridge/status
// Health check for the bridge
// ─────────────────────────────────────────────────────────────────────────────
router.get('/bridge/status', (req, res) => {
  res.json({
    status          : 'ok',
    queued_signals  : signalQueue.length,
    queued_arb      : arbQueue.length,
    latest_signal   : signalQueue[0]?.ts || null,
    latest_arb      : arbQueue[0]?.ts || null,
  });
});


module.exports = router;
