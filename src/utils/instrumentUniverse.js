/**
 * src/utils/instrumentUniverse.js
 * Loads config/instrument_universe.json and classifies a trading pair by
 * asset class, so the orchestrator can route each pair to the right
 * market-data source and executor (crypto exchanges vs OANDA vs T212/Alpaca).
 * Added 2026-09-26 to wire OANDA into the live cycle.
 */
const fs = require('fs');
const path = require('path');

const UNIVERSE_PATH = path.resolve(__dirname, '../../config/instrument_universe.json');
let _cache = null;

function loadUniverse() {
  if (_cache) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(UNIVERSE_PATH, 'utf8'));
  } catch (e) {
    _cache = { classes: {} };
  }
  return _cache;
}

/** Which class (forex/commodities/indices/crypto/crypto_equities/...) a pair belongs to, or null. */
function classifyPair(pair) {
  const universe = loadUniverse();
  const norm = String(pair).toUpperCase();
  for (const [className, def] of Object.entries(universe.classes || {})) {
    if ((def.symbols || []).some((s) => s.toUpperCase() === norm)) {
      return className;
    }
  }
  return null;
}

/** Pairs routed to OANDA (forex, commodities, indices combined). */
function getOandaPairs() {
  const universe = loadUniverse();
  const classes = universe.classes || {};
  return [
    ...(classes.forex?.symbols || []),
    ...(classes.commodities?.symbols || []),
    ...(classes.indices?.symbols || []),
  ];
}

function isOandaPair(pair) {
  const cls = classifyPair(pair);
  return cls === 'forex' || cls === 'commodities' || cls === 'indices';
}

// 2026-09-27 (Alan's explicit instruction): multi-market expansion — wire
// Alpaca (US stocks) into the same classify-and-route pattern used for
// OANDA above, so consensus.js/riskGate.js/orchestrator/index.js don't need
// to know anything venue-specific beyond "which executor do I call".
/** Pairs routed to Alpaca (US stocks). */
function getAlpacaPairs() {
  const universe = loadUniverse();
  return universe.classes?.us_stocks?.symbols || [];
}

function isAlpacaPair(pair) {
  return classifyPair(pair) === 'us_stocks';
}

module.exports = { loadUniverse, classifyPair, getOandaPairs, isOandaPair, getAlpacaPairs, isAlpacaPair };
