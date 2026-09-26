/**
 * scripts/testVotesEndpoint.js — proves the live-votes feature works end to end
 * WITHOUT needing the trading bot to be running.
 *
 * 1. Writes a realistic sample into data/latest_agent_votes.json (only if no
 *    real file exists yet — never overwrites live data).
 * 2. Starts the dashboard server in-process on a spare port.
 * 3. Hits /api/agent-votes and /votes.html and checks both respond correctly.
 *
 * Run: node scripts/testVotesEndpoint.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const DATA = path.join(__dirname, '..', 'data');
const VOTES = path.join(DATA, 'latest_agent_votes.json');
const PORT = process.env.TEST_PORT || 3999;

let seeded = false;
if (!fs.existsSync(VOTES)) {
  const sample = {
    updatedAt: new Date().toISOString(),
    pairs: {
      'BTC/USDT': {
        type: 'agent_votes', pair: 'BTC/USDT', timestamp: new Date().toISOString(),
        finalSignal: 'HOLD', confidence: 0.41, agentsAgreeing: 1, totalAgents: 11,
        approvedForExecution: false, vetoTriggered: false,
        votes: [
          { name: 'gemini', signal: 'BUY', confidence: 0.70, weight: 0.20, agreed: false, reason: 'sample' },
          { name: 'deepseek', signal: 'HOLD', confidence: 0, weight: 0.15, agreed: false, reason: '' },
          { name: 'grok', signal: 'HOLD', confidence: 0, weight: 0.15, agreed: false, reason: '' },
          { name: 'hermes', signal: 'HOLD', confidence: 0, weight: 0.10, agreed: false, reason: '' },
        ],
      },
    },
  };
  fs.writeFileSync(VOTES, JSON.stringify(sample, null, 2));
  seeded = true;
  console.log('  seeded a sample latest_agent_votes.json (no real one existed yet)');
} else {
  console.log('  using the REAL latest_agent_votes.json already on disk');
}

process.env.DASHBOARD_PORT = String(PORT);
process.env.PORT = String(PORT);

function get(p) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: global.__TEST_PORT || PORT, path: p, timeout: 8000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', (e) => resolve({ status: 0, body: e.message }));
  });
}

(async () => {
  // DASHBOARD_ONLY guards against this test ever kicking off live trading:
  // server.js starts autoTrader when run as main unless this is set.
  process.env.DASHBOARD_ONLY = 'true';

  let mod;
  try { mod = require('../src/dashboard/server'); } catch (e) {
    console.log('  ❌ dashboard failed to load:', e.message);
    process.exit(1);
  }
  if (typeof mod.startServer !== 'function') {
    console.log('  ❌ server.js does not export startServer()');
    process.exit(1);
  }

  // server.js binds the port it read at load time; discover it rather than assume.
  const srv = await mod.startServer();
  const bound = srv.address();
  const livePort = bound && bound.port ? bound.port : PORT;
  console.log(`\nDashboard listening on port ${livePort}\n`);
  global.__TEST_PORT = livePort;

  await new Promise((r) => setTimeout(r, 800));

  let pass = 0, fail = 0;
  const t = (n, c, d) => { c ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '  <- ' + d : ''))); };

  const api = await get('/api/agent-votes');
  t('GET /api/agent-votes returns 200', api.status === 200, 'status ' + api.status);

  let parsed = null;
  try { parsed = JSON.parse(api.body); } catch (_) {}
  t('response is valid JSON', !!parsed);
  if (parsed) {
    t('carries a pairs object', parsed.pairs && typeof parsed.pairs === 'object');
    t('carries thresholds', parsed.thresholds && typeof parsed.thresholds.minConfidence === 'number');
    t(`threshold reports 0.68`, parsed.thresholds && parsed.thresholds.minConfidence === 0.68,
      parsed.thresholds ? String(parsed.thresholds.minConfidence) : 'missing');
    t('merges agent_health so silent agents are visible', parsed.health && Object.keys(parsed.health).length > 0,
      'health keys: ' + Object.keys(parsed.health || {}).length);
    const pairs = Object.values(parsed.pairs || {});
    console.log(`        ${pairs.length} pair(s); health entries: ${Object.keys(parsed.health || {}).length}`);
    if (pairs[0]) console.log(`        e.g. ${pairs[0].pair}: ${pairs[0].finalSignal} ${pairs[0].agentsAgreeing}/${pairs[0].totalAgents} @ ${(pairs[0].confidence*100).toFixed(0)}%`);
  }

  const page = await get('/votes.html');
  t('GET /votes.html returns 200', page.status === 200, 'status ' + page.status);
  t('page contains the vote table markup', /Agent Votes/.test(page.body));
  t('page fetches the API', /\/api\/agent-votes/.test(page.body));

  console.log(`\n================  ${pass} passed, ${fail} failed  ================`);
  if (seeded) console.log('(sample vote file left in place; the bot will overwrite it on its next cycle)');
  console.log(`\nOpen it at:  http://localhost:${process.env.REAL_PORT || 3001}/votes.html\n`);
  process.exit(fail ? 1 : 0);
})();
